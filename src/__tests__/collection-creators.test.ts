import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover, resolveDiscoverSlugs } from '../builder/discover.js';
import { postProcessCollections } from '../builder/orchestrator.js';
import { loadStateFile, persistCompletedState, stateUsableForBuild } from '../builder/state-serialize.js';

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'iteraciones-collection-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

async function buildStep(cwd: string) {
  const result = await discover(cwd, { prevState: stateUsableForBuild(await loadStateFile(cwd)) });
  resolveDiscoverSlugs(result.discoveryIndex, result.slugComputer);
  await postProcessCollections(result.discoveryIndex, cwd);
  await persistCompletedState(cwd, result.pendingState);
  return result;
}

describe('collection creator aggregation', () => {
  it('aggregationa creators de children y ordena alfabéticamente', async () => {
    const cwd = makeProject({
      'collection.md': ['---', 'title: Antología', 'type: collection', 'files:', '  - ./child-a.md', '  - ./child-b.md', '---'].join('\n'),
      'child-a.md': '---\ntitle: Texto A\ncreator: Luis Pérez\n---\n\nContenido A',
      'child-b.md': '---\ntitle: Texto B\ncreator: Ana García\n---\n\nContenido B',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.creator).toEqual(['Ana García', 'Luis Pérez']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('deduplica creators repetidos entre children', async () => {
    const cwd = makeProject({
      'collection.md': '---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---',
      'a.md': '---\ntitle: A\ncreator: María López\n---\n\nContenido',
      'b.md': '---\ntitle: B\ncreator: María López\n---\n\nContenido',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.creator).toEqual(['María López']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('children sin creator no aportan al aggregation', async () => {
    const cwd = makeProject({
      'collection.md': '---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---',
      'a.md': '---\ntitle: A\ncreator: Autor X\n---\n\nContenido',
      'b.md': '---\ntitle: B\n---\n\nContenido sin creator',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.creator).toEqual(['Autor X']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('collection sin creator propio aggregationa de children', async () => {
    const cwd = makeProject({
      'collection.md': '---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n---',
      'a.md': '---\ntitle: A\ncreator: Autora Única\n---\n\nContenido',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.creator).toEqual(['Autora Única']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('collection con creator propio: slug usa creator original, author usa aggregationados', async () => {
    const cwd = makeProject({
      'collection.md': '---\ntitle: Antología\ncreator: Editora Principal\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---',
      'a.md': '---\ntitle: A\ncreator: Autora Alpha\n---\n\nContenido',
      'b.md': '---\ntitle: B\ncreator: Autora Beta\n---\n\nContenido',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.slug).toBe('antologia-por-editora-principal');
      expect(entry?.creator).toEqual(['Autora Alpha', 'Autora Beta']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('collection con creator propio inyecta titlehead', async () => {
    const cwd = makeProject({
      'collection.md': '---\ntitle: Antología\ncreator: Editora Principal\ntype: collection\nfiles:\n  - ./a.md\n---',
      'a.md': '---\ntitle: A\n---\n\nContenido',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.fm?.titlehead).toBe('Editora Principal');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('collection sin creator propio no inyecta titlehead', async () => {
    const cwd = makeProject({
      'collection.md': '---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n---',
      'a.md': '---\ntitle: A\ncreator: Autora\n---\n\nContenido',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.fm?.titlehead).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('titlehead explícito tiene preferencia sobre el auto-generado', async () => {
    const cwd = makeProject({
      'collection.md': '---\ntitle: Antología\ncreator: Editora Principal\ntitlehead: Custom Titlehead\ntype: collection\nfiles:\n  - ./a.md\n---',
      'a.md': '---\ntitle: A\n---\n\nContenido',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.fm?.titlehead).toBe('Custom Titlehead');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('collection con creator propio en多人数: titlehead es creator original, author es aggregationados', async () => {
    const cwd = makeProject({
      'collection.md': '---\ntitle: Antología\ncreator: [Editora Alpha, Editora Beta]\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---',
      'a.md': '---\ntitle: A\ncreator: Autora Gamma\n---\n\nContenido',
      'b.md': '---\ntitle: B\ncreator: Autora Delta\n---\n\nContenido',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.slug).toBe('antologia-por-editora-alpha');
      expect(entry?.creator).toEqual(['Autora Delta', 'Autora Gamma']);
      expect(entry?.fm?.titlehead).toBe('Editora Alpha, Editora Beta');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('children con múltiples creators se expansionan correctamente', async () => {
    const cwd = makeProject({
      'collection.md': '---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n---',
      'a.md': '---\ntitle: A\ncreator: [Ana García, Luis Pérez, María López]\n---\n\nContenido',
    });
    try {
      const result = await buildStep(cwd);
      const entry = result.discoveryIndex.get('collection.md');
      expect(entry?.creator).toEqual(['Ana García', 'Luis Pérez', 'María López']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

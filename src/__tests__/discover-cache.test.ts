import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../builder/discover.js';

/**
 * Caché content-addressed de discovery:
 * - mtime+size iguales → unchanged sin leer ni hashear
 * - size distinto → changed
 * - mtime distinto con size igual → hash; igual → unchanged (touch), distinto → changed
 */

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iteraciones-discover-'));
  writeFileSync(join(dir, 'doc.md'), '---\ntitle: Prueba\n---\n\nContenido');
  return dir;
}

function touch(file: string, mtimeMs: number): void {
  utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}

describe('discover (caché content-addressed)', () => {
  it('primer build marca todos los documentos como changed', async () => {
    const cwd = makeProject();
    try {
      const result = await discover(cwd);
      expect(result.changedPaths).toEqual(new Set(['doc.md']));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('advierte cuando un documento no tiene título en el frontmatter', async () => {
    const cwd = makeProject();
    writeFileSync(join(cwd, 'sin-titulo.md'), '# Solo contenido, sin frontmatter');
    const stderrSpy = spyOn(process.stderr, 'write');
    let output = '';
    try {
      await discover(cwd);
    } finally {
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      stderrSpy.mockRestore();
    }
    expect(output).toContain('sin-titulo.md');
    expect(output).toContain('no tiene título');
    expect(output).toContain('Sin título');
  });

  it('build sin cambios no reprocesa nada (solo stat)', async () => {
    const cwd = makeProject();
    try {
      await discover(cwd);
      const result = await discover(cwd);
      expect(result.changedPaths.size).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('touch de un archivo no dispara rebuild (mismo contenido → hash igual)', async () => {
    const cwd = makeProject();
    try {
      await discover(cwd);
      touch(join(cwd, 'doc.md'), Date.now() + 60_000);
      const result = await discover(cwd);
      expect(result.changedPaths.size).toBe(0);
      // El mtime actualizado se persiste: el siguiente build tampoco reprocesa
      const next = await discover(cwd);
      expect(next.changedPaths.size).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('cambio de contenido con el mismo tamaño se detecta vía hash', async () => {
    const cwd = makeProject();
    try {
      await discover(cwd);
      // Mismo largo que "Contenido" (9 caracteres), distinto contenido
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\n---\n\nCambiado');
      touch(join(cwd, 'doc.md'), Date.now() + 120_000);
      const result = await discover(cwd);
      expect(result.changedPaths).toEqual(new Set(['doc.md']));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('cambio de tamaño se detecta sin necesidad de hash', async () => {
    const cwd = makeProject();
    try {
      await discover(cwd);
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\n---\n\nContenido mucho más largo');
      const result = await discover(cwd);
      expect(result.changedPaths).toEqual(new Set(['doc.md']));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('un archivo nuevo agregado se detecta como changed', async () => {
    const cwd = makeProject();
    try {
      await discover(cwd);
      writeFileSync(join(cwd, 'nuevo.md'), '---\ntitle: Nuevo\n---\n\nTexto');
      const result = await discover(cwd);
      expect(result.changedPaths).toEqual(new Set(['nuevo.md']));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('un archivo eliminado se detecta como changed y entra en deletedFiles', async () => {
    const cwd = makeProject();
    try {
      await discover(cwd);
      rmSync(join(cwd, 'doc.md'));
      const result = await discover(cwd);
      expect(result.changedPaths).toEqual(new Set(['doc.md']));
      expect(result.deletedEntries.has('doc.md')).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('persiste mtime/size/hash en state.json para builds entre máquinas (mismos contenidos → unchanged)', async () => {
    const cwd = makeProject();
    try {
      await discover(cwd);
      // Simula git clone: todos los archivos se reescriben con mtime nuevo,
      // mismo contenido y mismo tamaño → hash igual → unchanged
      const original = Bun.file(join(cwd, 'doc.md')).text();
      const content = await original;
      writeFileSync(join(cwd, 'doc.md'), content);
      touch(join(cwd, 'doc.md'), Date.now() + 240_000);
      const result = await discover(cwd);
      expect(result.changedPaths.size).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

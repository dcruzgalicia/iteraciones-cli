import { Given, Then, When } from '@cucumber/cucumber';
import { type BuildMetadata, computeBuildMetadata, computeWorkSets } from '../../builder/build-planner.js';
import type { BuildDocument } from '../../builder/types.js';
import { loadSiteConfig } from '../../config/config-loader.js';
import { type FormatKey, toActiveFormats } from '../../config/site-config.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

function doc(relativePath: string): BuildDocument {
  return {
    filePath: `/proyecto/${relativePath}`,
    relativePath,
    frontmatter: { title: relativePath, date: '', creator: [] },
  };
}

function meta(over: Partial<BuildMetadata>): BuildMetadata {
  return {
    currentFormats: ['latex'],
    newFormats: [],
    removedFormats: [],
    configHashes: {},
    configFileCache: {},
    filtersHash: 'h',
    filterFileCache: {},
    schemaFileCache: {},
    bibHash: 'b',
    bibFileCache: {},
    formatInvalidated: { print: false, html: false, epub: false, markdown: false },
    filtersInvalidated: false,
    bibInvalidated: false,
    bibFiles: [],
    bibOptions: undefined,
    activeFormats: toActiveFormats(['latex'] as FormatKey[]),
    generateLatex: true,
    needsCss: false,
    ...over,
  };
}

Given('tres documentos', () => {
  world.docsPlan = [doc('a.md'), doc('b.md'), doc('c.md')];
});

Given('los formatos activos son {string}', (lista: string) => {
  world.formatosActivos = lista
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
});

Given('el build está invalidated por nada', () => {
  world.invalidaciones = {};
});

Given('el build está invalidated por {string}', (que: string) => {
  world.invalidaciones = { [que.trim()]: true };
});

Given('el formato {string} está activo', (formato: string) => {
  const actuales = (world.formatosActivos as string[] | undefined) ?? ['latex'];
  world.formatosActivos = [...new Set([...actuales, formato.trim()])];
});

Given('el formato {string} se acaba de pedir', (formato: string) => {
  world.formatoNuevo = [...new Set([...(world.formatoNuevo as string[]), formato.trim()])];
});

Given('todos los formatos se acaban de pedir', () => {
  world.formatoNuevo = ['pdf', 'latex', 'html', 'epub', 'markdown'];
});

Given('cambiaron estos documentos {string}', (lista: string) => {
  world.docsCambiados = new Set(
    lista
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean),
  );
});

Given('no cambió ningún documento', () => {
  world.docsCambiados = new Set<string>();
});

When('calculo qué hay que recompilar', () => {
  const invalidas = world.invalidaciones as Record<string, boolean>;
  const activos = (world.formatosActivos as string[] | undefined) ?? ['latex'];
  const nuevos = world.formatoNuevo as string[];

  const formatInvalidated = {
    print: nuevos.includes('pdf') || nuevos.includes('latex'),
    html: nuevos.includes('html'),
    epub: nuevos.includes('epub'),
    markdown: nuevos.includes('markdown'),
  } as BuildMetadata['formatInvalidated'];
  const m = meta({
    activeFormats: toActiveFormats(activos as FormatKey[]),
    generateLatex: activos.includes('latex'),
    filtersInvalidated: invalidas.filtros === true,
    bibInvalidated: invalidas.bibliografia === true,
    formatInvalidated,
    ...(nuevos.length > 0 ? { newFormats: nuevos } : {}),
  });
  world.trabajo = computeWorkSets(m, world.docsPlan as BuildDocument[], (world.docsCambiados ?? new Set<string>()) as Set<string>);
});

Then('no hay nada que hacer', () => {
  const t = world.trabajo as { anyWork: boolean };
  if (t.anyWork) throw new Error('anyWork es true y no había nada que recompilar');
});

Then('sí hay algo que hacer', () => {
  const t = world.trabajo as { anyWork: boolean };
  if (!t.anyWork) throw new Error('anyWork es false y había documentos que recompilar');
});

Then('los documentos a recompilar son {string}', (esperados: string) => {
  const leidos = [...(world.trabajo as { docsChanged: Set<string> }).docsChanged].sort().join(', ');
  const queried = esperados.trim();
  if (leidos !== queried) {
    throw new Error(`los documentos a recompilar son ${JSON.stringify(leidos)} y debían ser ${JSON.stringify(queried)}`);
  }
});

Then('el conjunto de export para {word} son {string}', (formato: string, esperados: string) => {
  const clave = formato.replace(/["']/g, '');
  const conjuntos = (world.trabajo as { exportSets: Record<string, BuildDocument[]> }).exportSets;
  const leidos = (conjuntos[clave] ?? [])
    .map((d) => d.relativePath)
    .sort()
    .join(', ');
  const queried = esperados.trim();
  if (leidos !== queried) {
    throw new Error(`el exportSet de print es ${JSON.stringify(leidos)} y debía ser ${JSON.stringify(queried)}`);
  }
});

Given('un proyecto con la configuración:', (yaml: string) => {
  escribirEnProyecto('iteraciones.config.yaml', `${yaml.replace(/<br>/g, '\n')}\n`);
});

Given('un build anterior con los formatos {string}', (lista: string) => {
  world.formatosPrevios = lista
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
});

Given('no hay builds anteriores', () => {
  world.formatosPrevios = [];
});

When('calculo la metadata del build', async () => {
  const config = await loadSiteConfig(world.root);
  const previos = (world.formatosPrevios as string[]) ?? [];
  world.metadata = await computeBuildMetadata(
    world.root,
    config,
    previos.length === 0
      ? null
      : {
          schemaVersion: 2,
          startedAt: 0,
          activeFormats: previos as never,
          entries: new Map(),
        },
  );
});

Then('los formatos del build son {string}', (esperados: string) => {
  const leidos = [...(world.metadata as BuildMetadata).currentFormats].sort().join(', ');
  const queried = esperados.trim();
  if (leidos !== queried) {
    throw new Error(`los formatos son ${JSON.stringify(leidos)} y debían ser ${JSON.stringify(queried)}`);
  }
});

Then('los formatos nuevos son {string}', (esperados: string) => {
  const leidos = [...(world.metadata as BuildMetadata).newFormats].sort().join(', ');
  const queried = esperados.trim();
  if (leidos !== queried) {
    throw new Error(`los formatos nuevos son ${JSON.stringify(leidos)} y debían ser ${JSON.stringify(queried)}`);
  }
});

Then('los formatos que se fueron son {string}', (esperados: string) => {
  const leidos = [...(world.metadata as BuildMetadata).removedFormats].sort().join(', ');
  const queried = esperados.trim();
  if (leidos !== queried) {
    throw new Error(`los formatos que se fueron son ${JSON.stringify(leidos)} y debían ser ${JSON.stringify(queried)}`);
  }
});

Then('el proyecto pide LaTeX', () => {
  if (!(world.metadata as BuildMetadata).generateLatex) {
    throw new Error('la config pide LaTeX y el plan no lo generó');
  }
});

Then('el proyecto necesita CSS', () => {
  if (!(world.metadata as BuildMetadata).needsCss) {
    throw new Error('la config pide HTML y el plan no necesita CSS');
  }
});

Then('nada está invalidated', () => {
  const m = world.metadata as BuildMetadata;
  const reasons = [
    m.filtersInvalidated ? 'filtersInvalidated' : '',
    m.bibInvalidated ? 'bibInvalidated' : '',
    ...Object.entries(m.formatInvalidated)
      .filter(([, v]) => v)
      .map(([k]) => k),
  ].filter(Boolean);
  if (reasons.length > 0) {
    throw new Error(`sin build anterior no debería invalidarse nada, pero se invalidó: ${reasons.join(', ')}`);
  }
});

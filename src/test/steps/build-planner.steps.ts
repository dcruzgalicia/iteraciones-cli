import { Given, Then, When } from '@cucumber/cucumber';
import { type BuildMetadata, computeBuildMetadata, computeWorkSets } from '../../builder/build-planner.js';
import type { BuildDocument } from '../../builder/types.js';
import { loadSiteConfig } from '../../config/config-loader.js';
import { type FormatKey, toActiveFormats } from '../../config/site-config.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — qué se recompila y qué no.
 *
 * ## La pregunta del build incremental
 *
 * Un build es caro porque compila. La pregunta es qué documento hay que volver a
 * compilar, y la respuesta tiene que ser **más estrecha que "todo"**: rehacer
 * los tres documentos porque cambió uno es lo que hace que el build incremental
 * no sirva de nada.
 *
 * ## TresTranscriptores de invalidación, tres alcances
 *
 * - **`docsChanged`**: este documento cambió. Se re-renderiza él y se vuelve a
 *   exportar en los formatos activos.
 * - **`filtersInvalidated`**: cambió un filtro de LaTeX. El resultado depende de
 *   los filtros, así que **todos** los documentos se re-renderizan.
 * - **`bibInvalidated`**: cambió la bibliografía. **Nadie** se re-renderiza: las
 *   citas se resuelven en el export, así que basta con re-exportar. Es el
 *   inverso del caso anterior y por eso merece un escenario propio.
 *
 * ## Un formato nuevo no invalida los documentos
 *
 * Pedir PDF en un proyecto que sólo hacía HTML no obliga a re-renderizar el
 * LaTeX de nada: los documentos van al `exportSet` del formato nuevo y punto.
 */

function doc(relativePath: string): BuildDocument {
  return {
    filePath: `/proyecto/${relativePath}`,
    relativePath,
    frontmatter: { title: relativePath, date: '', creator: [] },
  };
}

/** Los metadatos base; el escenario ajusta lo que le importa. */
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

/**
 * Un formato que este build pide y el anterior no.
 *
 * Se ACUMULA, no se pisa: un build puede encender PDF y EPUB a la vez, y cada
 * uno va a su propio conjunto de exportación. Con un único `formatoNuevo` el
 * segundo `Dado` borraba al primero y el escenario acababa exercising menos de
 * lo que decía.
 */
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
  // Un formato recién pedido invalida SU clave de formato, que es lo que
  // producción saca del hash de la config (`state-hash.ts:157`): `print` sale
  // del hash de `format.pdf`, y ese hash incluye `latex.generate`, así que un
  // LaTeX nuevo también invalida `print`.
  //
  // ponytail: el paso no recalcula hashes — modela la relación formato→clave.
  // Si `computeConfigHashes` mezclara otra clave, este mapeo se queda corto; lo
  // que no puede es mentir en más de una dirección, porque lo verifica el
  // escenario de metadata (`nada está invalidated`).
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

// ── Lo que se recompila ────────────────────────────────────────────────────

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
  // El matcher entrega el texto CON las comillas del Gherkin.
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

// ── La metadata, que viene de la config y del estado anterior ──────────────

Given('un proyecto con la configuración:', (yaml: string) => {
  escribirEnProyecto('iteraciones.config.yaml', `${yaml.replace(/<br>/g, '\n')}\n`);
});

/**
 * `prevState` es lo que hace que el build sea incremental: sin él no hay con
 * qué comparar y nada se considera invalidado. El estado se declara por sus
 * formatos activos, que es lo único que este escenario necesita observar.
 */
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

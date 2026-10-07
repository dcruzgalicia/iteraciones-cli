import { spyOn } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { convertToEpub, convertToMarkdown, type ExportDocument } from '../../builder/export.js';
import type { LuaFilterGroup } from '../../builder/filter-resolver.js';
import * as pandocRunner from '../../lib/pandoc-runner.js';

/**
 * #2545 (onda 1) — contrato de argumentos de los exportadores.
 *
 * `execPandoc` está espiado: los scenarios verifican el contrato sin invocar el
 * binario. El espío vive en `world.calls` y **no** se restaura a mano —
 * `00-higiene-del-mundo.steps.ts` lo hace en su `After` con `mock.restore()`.
 * El original usaba `try/finally` + `spy.mockRestore()` en cada test; aquí eso
 * es código repetido que además se olvidaría en el primer scenario nuevo.
 *
 * Cada `Then` afirma un comportamiento, no un `expect`: "recibe el índice y los
 * metadatos" son seis asserts del original en un solo paso. Un step por assert
 * daría 20 pasos y volvería la prosa decorativa, que es justo lo que el
 * catálogo de #2544 rechaza.
 */

type Call = Parameters<typeof pandocRunner.execPandoc>[0];

const NO_FILTERS: LuaFilterGroup = {
  semantic: [],
  latex: [],
  html: [],
  flags: [],
  user: [],
  resolvedNames: new Set(),
};

const BODY = '---\ntitle: "Mi título"\n---\n\nHola.\n';
const MD_READER = 'markdown+auto_identifiers+mark';

interface ExportWorld {
  dir: string;
  outputPath: string;
  calls: Call[];
  baseDoc: ExportDocument;
}

const world: ExportWorld = { dir: '', outputPath: '', calls: [], baseDoc: {} as ExportDocument };

// ## Por qué el espío va en un hook con tag y no en un `Before` normal
//
// Los hooks de cucumber son GLOBALES en cuanto se importa el archivo: no
// existen hooks por feature. Un `Before` normal aquí espiaba `execPandoc`
// para TODOS los scenarios, incluidos los de `build-script.feature`, que
// necesitan pandoc de verdad — y ese feature empezó a fallar con
// "falta la sección # === Pandoc: LaTeX ===" porque el pandoc real nunca
// corría.
//
// Los tags resuelven el alcance: `@spy-pandoc` en el scenario activa este
// hook sólo para él. Es una dimensión de tags distinta de `@requires-*`:
// esta dice "qué espiar", aquella dice "qué hace falta en la máquina".
//
// El `Before` global que sí hace falta (crear el temporal) se queda sin
// tag; el espío, con tag.
Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  world.calls = [];
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

// Sólo para los scenarios marcados `@spy-pandoc`.
Before({ tags: '@spy-pandoc' }, () => {
  world.calls = [];
  // Sin implementar devuelve vacío y captura las opciones: el mismo contrato
  // que el `spyPandoc` del original. `00-higiene-del-mundo.steps.ts` lo
  // restaura en su `After` con `mock.restore()`.
  spyOn(pandocRunner, 'execPandoc').mockImplementation(async (options) => {
    world.calls.push(options);
    return '';
  });
});

Given('un proyecto de prueba', () => {
  world.outputPath = join(world.dir, 'salida');
});

Given('un documento titulado {string} de la autora {string}', (title: string, creator: string) => {
  world.baseDoc = {
    filePath: '/proyecto/doc.md',
    relativePath: 'doc.md',
    metadata: {
      title,
      creator: [creator],
      date: '8 de agosto de 2026',
      dateIso: '2026-08-08',
      language: 'es-MX',
      toc: false,
    },
  };
});

When('convierto el documento a EPUB con índice', async () => {
  world.outputPath = `${join(world.dir, 'libro')}.epub`;
  await convertToEpub(BODY, world.outputPath, world.baseDoc, NO_FILTERS, undefined, { toc: true, language: 'en' });
});

When('convierto el documento a EPUB sin índice', async () => {
  world.outputPath = `${join(world.dir, 'b')}.epub`;
  await convertToEpub(BODY, world.outputPath, world.baseDoc, NO_FILTERS);
});

When('lo convierto de nuevo con bibliografía {string}', async (bibliography: string) => {
  const conBib: ExportDocument = {
    ...world.baseDoc,
    metadata: { ...world.baseDoc.metadata, bibliography },
  };
  await convertToEpub(BODY, world.outputPath, conBib, NO_FILTERS);
});

When('convierto el documento a Markdown con índice y bibliografía local', async () => {
  world.outputPath = join(world.dir, 'salida.md');
  const doc: ExportDocument = {
    ...world.baseDoc,
    metadata: {
      ...world.baseDoc.metadata,
      toc: true,
      tocDepth: 2,
      bibliography: join(world.dir, 'refs.bib'),
      csl: join(world.dir, 'estilos.csl'),
    },
  };
  await convertToMarkdown(BODY, world.outputPath, doc, {});
});

function call(index: number): Call {
  const found = world.calls[index];
  if (found === undefined) {
    throw new Error(`pandoc fue invocado ${world.calls.length} veces y no llegó a la llamada ${index + 1}`);
  }
  return found;
}

function lastCall(): Call {
  return call(world.calls.length - 1);
}

function exige(argumentos: string[] | undefined, esperado: string): void {
  if (!(argumentos ?? []).includes(esperado)) {
    throw new Error(`esperaba ${esperado} en:\n${JSON.stringify(argumentos)}`);
  }
}

Then('pandoc recibe una llamada que escribe en el archivo de salida', () => {
  if (world.calls.length !== 1) throw new Error(`esperaba 1 llamada y hubo ${world.calls.length}`);
  const found = lastCall();
  if (found.outputPath !== world.outputPath) {
    throw new Error(`esperaba que escribiera en ${world.outputPath} y escribió en ${found.outputPath}`);
  }
});

Then('pandoc escribe en {string} leyendo del markdown del proyecto', (format: string) => {
  const found = lastCall();
  if (found.to !== format) throw new Error(`esperaba el formato "${format}" y fue "${found.to}"`);
  if (found.from !== MD_READER) throw new Error(`esperaba leer desde "${MD_READER}" y leí "${found.from}"`);
});

Then('pandoc recibe el índice y los metadatos del documento', () => {
  const args = lastCall().extraArgs;
  // #2010: el frontmatter manda sobre el `language` de las opciones.
  exige(args, '--toc');
  exige(args, '--metadata=language:en');
  exige(args, '--metadata=title:Mi título');
  exige(args, '--metadata=creator:Autora Uno');
  exige(args, '--metadata=date:2026-08-08');
});

Then('pandoc recibe dos llamadas', () => {
  if (world.calls.length !== 2) throw new Error(`esperaba 2 llamadas y hubo ${world.calls.length}`);
});

Then('la primera no lleva ni índice ni citeproc', () => {
  const args = call(0).extraArgs;
  if ((args ?? []).includes('--toc')) throw new Error(`la primera llamada no debía llevar índice: ${JSON.stringify(args)}`);
  if ((args ?? []).includes('--citeproc')) throw new Error(`sin bibliografía no debe haber citeproc: ${JSON.stringify(args)}`);
});

Then('la segunda lleva citeproc', () => {
  exige(call(1).extraArgs, '--citeproc');
});

Then('pandoc no recibe ninguna llamada', () => {
  if (world.calls.length !== 0) throw new Error(`pandoc fue invocado ${world.calls.length} veces y no debía`);
});

Then('el Markdown sale con el frontmatter del documento y sin rutas absolutas', async () => {
  const content = await readFile(world.outputPath, 'utf8');
  if (!content.includes('title: Mi título')) throw new Error('falta el título en el frontmatter');
  if (!content.includes('language: es-MX')) throw new Error('falta el idioma en el frontmatter');
  // Sin roundtrip por pandoc: el body no se transforma (#2436).
  if (!content.endsWith('\n\nHola.\n')) {
    throw new Error(`esperaba que el body quedara intacto y terminó en ${JSON.stringify(content.slice(-20))}`);
  }
  // bibliography y csl los aporta la config del sitio al reprocesar; no viajan.
  if (content.includes('bibliography:')) throw new Error('el markdown exportado no debe llevar bibliography');
  if (content.includes('csl:')) throw new Error('el markdown exportado no debe llevar csl');
  if (content.includes(world.dir)) throw new Error(`el markdown exportado filtró la ruta ${world.dir}`);
});

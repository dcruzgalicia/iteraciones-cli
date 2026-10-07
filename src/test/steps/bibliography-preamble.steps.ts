import { spyOn } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import type { BuildMetadata } from '../../builder/build-planner.js';
import { convertToPdf } from '../../builder/export.js';
import { writeEffectiveTemplates } from '../../builder/pipeline-setup.js';
import { disableBibliographyWithoutBibFiles, resolveEffectiveDisabledPreamble } from '../../builder/preamble-loader.js';
import type { BuildContext } from '../../builder/types.js';
import { listFilters } from '../../cli/filters.js';
import { runTemplate } from '../../cli/template.js';
import { DEFAULT_SITE_CONFIG, resolveDisabledPreambleConfig } from '../../config/site-config.js';
import { initTestProject } from '../helpers.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — la regla `11-bibliography` sin archivos `.bib` (#2419).
 *
 * ## Por qué se apaga el snippet
 *
 * Un proyecto sin un solo `.bib` no cita nada. Con `csquotes` + `biblatex`
 * cargados, LaTeX emite avisos por cada `\cite` vacío y el log se llena de ruido
 * que no es un error. Peor: el autor ve advertencias de bibliografía en un libro
 * que no tiene bibliografía y busca un problema que no existe.
 *
 * ## Sin lista previa no se arriesga nada
 *
 * `bibFiles` llega a `undefined` cuando nadie la calculó todavía. Desactivar el
 * snippet con esa información sería adivinar, y adivinar aquí significa apagar
 * la bibliografía de un libro que sí la tiene. La función prefiere no hacer
 * nada.
 *
 * ## Tres sitios, una sola regla
 *
 * El build, `iteraciones template` y `iteraciones filters` tienen que decir lo
 * mismo, porque el `.sh` regenera las plantillas con `template`: si `template`
 * dijera una cosa y el build otra, el PDF del `.sh` saldría distinto del que dio
 * el build.
 *
 * ## Y `-nobibtex` al compilar
 *
 * Con el snippet apagado, `biblatex` no está, así que `latexmk` no debe buscar
 * el `.bib`: la flag evita un segundo punto de fallo.
 */

const DISABLED = resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(DEFAULT_SITE_CONFIG));

function ctx(): BuildContext {
  return {
    siteConfig: DEFAULT_SITE_CONFIG,
    cwd: world.root,
    outputDir: join(world.root, 'dist'),
    needsCss: false,
    concurrency: 1,
  };
}

/** Compone la plantilla LaTeX como hace el build. */
async function componerLaTex(bibFiles: string[]): Promise<{ tex: string; biblatex: boolean }> {
  const state = await writeEffectiveTemplates(ctx(), { generateLatex: true } as BuildMetadata, false, DEFAULT_SITE_CONFIG, bibFiles, DISABLED);
  return { tex: readFileSync(state.latexTemplatePath, 'utf8'), biblatex: state.biblatexAvailable };
}

// ── La regla ───────────────────────────────────────────────────────────────

Given('ningún archivo .bib', () => {
  world.bibFiles = [];
});

Given('un archivo .bib en {string}', (ruta: string) => {
  world.bibFiles = [ruta];
});

Given('desactivados {string}', (lista: string) => {
  world.desactivadosBib = lista
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
});

Given('la lista previa de .bib no se calculó', () => {
  world.bibFilesSinCalcular = true;
});

When('aplico la regla de la bibliografía', () => {
  world.desactivadosBib = disableBibliographyWithoutBibFiles(
    world.desactivadosBib as string[],
    world.bibFilesSinCalcular === true ? undefined : (world.bibFiles as string[]),
  );
});

Then('el resultado son {string}', (esperado: string) => {
  const leido = [...(world.desactivadosBib as string[])].join(', ');
  const querido = esperado
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ');
  if (leido !== querido) {
    throw new Error(`el resultado es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(querido)}`);
  }
});

// ── El build escribe la plantilla ──────────────────────────────────────────

Given('un proyecto con una bibliografía en {string}', (ruta: string) => {
  escribirEnProyecto(ruta, '@book{ref,\n  title = {T}\n}\n');
});

When('compongo la plantilla LaTeX del build', async () => {
  const r = await componerLaTex(world.bibFiles as string[]);
  world.texBib = r.tex;
  world.biblatexDisponible = r.biblatex;
});

Then('la plantilla NO lleva {string}', (fragmento: string) => {
  const limpio = fragmento.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  if (String(world.texBib).includes(limpio)) {
    throw new Error(`la plantilla sí lleva ${JSON.stringify(limpio)} y no debería`);
  }
});

Then('la plantilla SÍ lleva {string}', (fragmento: string) => {
  const limpio = fragmento.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  if (!String(world.texBib).includes(limpio)) {
    throw new Error(`la plantilla no lleva ${JSON.stringify(limpio)}`);
  }
});

Then('biblatex queda {string}', (estado: string) => {
  const leido = world.biblatexDisponible as boolean;
  const quiero = estado === 'true';
  if (leido !== quiero) throw new Error(`biblatexAvailable es ${String(leido)} y el escenario dice ${estado}`);
});

// ── `iteraciones template` dice lo mismo que el build ─────────────────────

Given('un proyecto de prueba inicializado', async () => {
  initTestProject(world.root);
  const espia = spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await runTemplate(world.root, 'latex', {});
  } finally {
    espia.mockRestore();
  }
});

When('vuelvo a generar la plantilla LaTeX', async () => {
  const espia = spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await runTemplate(world.root, 'latex', {});
    world.texBib = readFileSync(join(world.root, '.iteraciones', 'templates', 'latex.tex'), 'utf8');
  } finally {
    espia.mockRestore();
  }
});

Then('la plantilla SÍ lleva el paquete de bibliografía', () => {
  if (!String(world.texBib).includes('\\usepackage[style=apa]{biblatex}')) {
    throw new Error('la plantilla regenerada no lleva biblatex');
  }
});

Then('la plantilla NO lleva el paquete de bibliografía', () => {
  if (String(world.texBib).includes('\\usepackage[style=apa]{biblatex}')) {
    throw new Error('la plantilla regenerada sí lleva biblatex');
  }
});

// ── `iteraciones filters` ──────────────────────────────────────────────────

When('pregunto el estado de 11-bibliography', async () => {
  const espia = spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await listFilters(world.root, { json: true });
    const salida = espia.mock.calls.map((c) => String(c[0])).join('');
    const parsed = JSON.parse(salida) as { preamble: { name: string; active: boolean }[] };
    world.estadoBib = parsed.preamble.find((i) => i.name === '11-bibliography')?.active;
  } finally {
    espia.mockRestore();
  }
});

Then('11-bibliography está {string}', (estado: string) => {
  if (String(world.estadoBib) !== estado) {
    throw new Error(`11-bibliography está en ${String(world.estadoBib)} y el escenario dice ${estado}`);
  }
});

// ── El flag de latexmk ────────────────────────────────────────────────────

Given('un latexmk falso que registra sus argumentos', () => {
  const dirBin = join(world.root, 'bin');
  mkdirSync(dirBin, { recursive: true });
  const argumentos = join(world.root, 'latexmk-args.txt');
  const falso = join(dirBin, 'latexmk');
  writeFileSync(falso, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argumentos}'\n`, 'utf8');
  chmodSync(falso, 0o755);
  mkdirSync(join(world.root, 'slot'), { recursive: true });
  escribirEnProyecto('doc.tex', '\\documentclass{article}\n\\begin{document}\nhola\n\\end{document}\n');
  world.pathOriginal = process.env.PATH;
  process.env.PATH = `${dirBin}:${world.pathOriginal as string}`;
});

When('compilo el PDF con noBibtex {string}', async (valor: string) => {
  await convertToPdf(join(world.root, 'doc.tex'), 'doc.md', join(world.root, 'slot'), 'salida', undefined, undefined, valor === 'true');
  world.argumentosLatexmk = readFileSync(join(world.root, 'latexmk-args.txt'), 'utf8');
});

When('restauro el PATH', () => {
  if (world.pathOriginal === undefined) delete process.env.PATH;
  else process.env.PATH = world.pathOriginal as string;
});

Then('latexmk recibe -nobibtex', () => {
  if (!String(world.argumentosLatexmk).includes('-nobibtex')) {
    throw new Error(`latexmk no recibió -nobibtex. Recibió:\n${world.argumentosLatexmk}`);
  }
});

Then('latexmk NO recibe -nobibtex', () => {
  if (String(world.argumentosLatexmk).includes('-nobibtex')) {
    throw new Error(`latexmk recibió -nobibtex y no debía`);
  }
});

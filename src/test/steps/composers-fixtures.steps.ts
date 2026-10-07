import { spyOn } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, Given, Then, When } from '@cucumber/cucumber';
import type { LuaFilterGroup } from '../../builder/filter-resolver.js';
import { buildTexDistribution, markdownToLatex, rewriteTexForDist } from '../../builder/latex-composer.js';
import { htmlPageFromMarkdown } from '../../builder/render.js';
import { BuildError } from '../../lib/errors.js';
import * as pandocRunner from '../../lib/pandoc-runner.js';

const NO_FILTERS: LuaFilterGroup = {
  semantic: [],
  latex: [],
  html: [],
  flags: [],
  user: [],
  resolvedNames: new Set(),
};

const FOUR_GROUPS: LuaFilterGroup = {
  semantic: ['/f/semantic.lua'],
  user: ['/f/user.lua'],
  flags: ['/f/flags.lua'],
  latex: ['/f/latex.lua'],
  html: [],
  resolvedNames: new Set(),
};

const MD_READER = 'markdown+auto_identifiers+mark';
const REFS_CARD = '<section class="refs-card">{{refs-list}}</section>';

const DOC = {
  filePath: '/proyecto/doc.md',
  relativePath: 'doc.md',
  frontmatter: { title: 'Documento', creator: [], date: '' },
};

const SITE_CONFIG = { language: 'es-MX', toc: false, format: {} } as never;

type Call = Parameters<typeof pandocRunner.execPandoc>[0];
type Fixture = 'latex' | 'html' | 'refs';

interface ComposersWorld {
  fixtureLatex: string;
  fixtureHtml: string;
  fixtureHtmlRefs: string;
  pending: Fixture;
  calls: Call[];
  texResult: { tex?: string; processedImages?: unknown[] };
  html: string;
  failedWith: unknown;
  distribution: Map<string, string>;
  texToRewrite: string;
}

const world: ComposersWorld = {
  fixtureLatex: '',
  fixtureHtml: '',
  fixtureHtmlRefs: '',
  pending: 'html',
  calls: [],
  texResult: {},
  html: '',
  failedWith: undefined,
  distribution: new Map(),
  texToRewrite: '',
};

async function fixturesDir(): Promise<string> {
  const base = join(import.meta.dir, '../fixtures/pandoc');
  const versions = (await readdir(base).catch(() => [] as string[])).sort();
  const latest = versions.at(-1);
  if (latest === undefined) {
    throw new Error(`no hay fixtures de pandoc en ${base}. Se regeneran con: bun tools/record-pandoc-fixtures.ts`);
  }
  return join(base, latest);
}

function setFixture(which: Fixture): void {
  world.pending = which;
}

Before({ tags: '@spy-composers' }, async () => {
  const dir = await fixturesDir();
  world.fixtureLatex = await Bun.file(join(dir, 'sample.latex')).text();
  world.fixtureHtml = await Bun.file(join(dir, 'sample.html')).text();
  world.fixtureHtmlRefs = await Bun.file(join(dir, 'sample-refs.html')).text();
  world.calls = [];
  spyOn(pandocRunner, 'execPandoc').mockImplementation(async (options) => {
    world.calls.push(options);
    if (world.pending === 'latex') return world.fixtureLatex;
    if (world.pending === 'refs') return world.fixtureHtmlRefs;
    return world.fixtureHtml;
  });
});

function lastCall(index = world.calls.length - 1): Call {
  const call = world.calls[index];
  if (call === undefined) {
    throw new Error(`pandoc fue invocado ${world.calls.length} veces y no llegó a la llamada ${index + 1}`);
  }
  return call;
}

function argsOf(index?: number): string[] {
  return lastCall(index).extraArgs ?? [];
}

function exigeLista(args: string[], esperado: string[]): void {
  for (const item of esperado) {
    if (!args.includes(item)) throw new Error(`falta ${JSON.stringify(item)} en:\n${args.join(' ')}`);
  }
}

Given('el fixture de salida LaTeX de pandoc', () => setFixture('latex'));
Given('el fixture de salida HTML sin referencias de pandoc', () => setFixture('html'));
Given('el fixture de salida HTML con referencias de pandoc', () => setFixture('refs'));

When('convierto el markdown a LaTeX con la bibliografía {string}', async (bibFile: string) => {
  setFixture('latex');
  world.texResult = await markdownToLatex('Contenido', DOC, {
    filters: NO_FILTERS,
    bibFiles: [bibFile],
    templatePath: '/build/template.tex',
    fm: { title: 'Documento' },
    siteConfig: SITE_CONFIG,
    warnedLangs: new Set<string>(),
  });
});

When('convierto el markdown a LaTeX con los cuatro grupos de filtros', async () => {
  setFixture('latex');
  await markdownToLatex('Contenido', DOC, {
    filters: FOUR_GROUPS,
    bibFiles: [],
    templatePath: '/t.tex',
    fm: {},
    siteConfig: SITE_CONFIG,
    warnedLangs: new Set<string>(),
  });
});

When('convierto el markdown a LaTeX con una portada que no existe', async () => {
  setFixture('latex');
  world.failedWith = undefined;
  try {
    await markdownToLatex('Contenido', DOC, {
      filters: NO_FILTERS,
      bibFiles: [],
      templatePath: '/t.tex',
      fm: { title: 'D', titleImage: 'no-existe.png' },
      siteConfig: SITE_CONFIG,
      warnedLangs: new Set<string>(),
    });
  } catch (error) {
    world.failedWith = error;
  }
});

function htmlOptions(): Parameters<typeof htmlPageFromMarkdown>[2] {
  return {
    cwd: '/proyecto',
    vars: { title: 'T', siteTitle: 'S', lang: 'es-MX' },
    siteConfig: SITE_CONFIG,
    templatePath: '/build/template.html',
    refsCardTemplate: REFS_CARD,
    fm: {},
  };
}

When('convierto el markdown a una página HTML con tarjeta de referencias', async () => {
  world.html = await htmlPageFromMarkdown('Contenido', DOC as never, htmlOptions());
});

When('convierto el markdown a una página HTML con bibliografía y estilo APA', async () => {
  setFixture('html');
  await htmlPageFromMarkdown('Contenido', DOC as never, {
    ...htmlOptions(),
    bibOptions: { bibliography: '/abs/refs.bib', csl: '/abs/apa.csl' },
  });
});

When('lo convierto de nuevo sin opciones de bibliografía', async () => {
  setFixture('html');
  await htmlPageFromMarkdown('Contenido', DOC as never, htmlOptions());
});

When('distribuyo las imágenes {string}, {string} y {string}', (a: string, b: string, c: string) => {
  world.distribution = buildTexDistribution([a, b, c]);
});

When('distribuyo ninguna imagen procesada', () => {
  world.distribution = buildTexDistribution([]);
});

When('distribuyo la imagen procesada {string}', (absoluta: string) => {
  world.distribution = buildTexDistribution([absoluta]);
  world.texToRewrite = `\\includegraphics{${absoluta}}\n\\mbox{${absoluta}}`;
});

When('reescribo el .tex que la referencia dos veces', () => {});

Then('el LaTeX es el fixture y no hay imágenes procesadas', () => {
  if (world.texResult.tex !== world.fixtureLatex) throw new Error('el .tex emitido no es el fixture');
  const processed = world.texResult.processedImages ?? [];
  if (processed.length !== 0) throw new Error(`esperaba 0 imágenes procesadas y hubo ${processed.length}`);
});

Then('la llamada a pandoc lleva el contrato completo de LaTeX', () => {
  if (world.calls.length !== 1) throw new Error(`esperaba 1 llamada y hubo ${world.calls.length}`);
  const call = lastCall();
  if (call.from !== MD_READER) throw new Error(`esperaba leer desde "${MD_READER}" y leí "${call.from}"`);
  if (call.to !== 'latex') throw new Error(`esperaba convertir a latex y se convirtió a "${call.to}"`);
  if (call.env?.ITERACIONES_MBOX_HELPERS === undefined) throw new Error('falta ITERACIONES_MBOX_HELPERS en el entorno');

  const args = argsOf();
  exigeLista(args, ['--template', '--top-level-division', 'section', '--shift-heading-level-by=2', '--biblatex', '--metadata=title:Documento']);
  if (args[args.indexOf('--template') + 1] !== '/build/template.tex') {
    throw new Error(`la plantilla no es la esperada: ${args[args.indexOf('--template') + 1]}`);
  }

  exigeLista(args, ['--metadata=babel-lang:spanish,mexico,es-noshorthands,es-noindentfirst', '--metadata=biblatex-available:true']);

  exigeLista(args, ['--metadata=page-number-command:\\ohead*{\\pagemark}']);
  const bibCount = args.filter((a) => a === '--bibliography').length;
  if (bibCount !== 1) throw new Error(`esperaba exactamente un --bibliography y hubo ${bibCount}`);
  if (args[args.indexOf('--bibliography') + 1] !== 'refs/biblio.bib') {
    throw new Error(`la bibliografía no es la esperada: ${args[args.indexOf('--bibliography') + 1]}`);
  }

  if (args.join('\n').includes('--metadata=subtitle:')) throw new Error('viajó un --metadata=subtitle vacío');
});

Then('los filtros lua salen en el orden semantic, user, flags y latex', () => {
  const args = argsOf();
  const order = ['/f/semantic.lua', '/f/user.lua', '/f/flags.lua', '/f/latex.lua'].map((path) => args.indexOf(path));
  for (let i = 1; i < order.length; i += 1) {
    const previous = order[i - 1] ?? -1;
    const current = order[i] ?? -1;
    if (current <= previous) {
      throw new Error(`el filtro en la posición ${i} aparece en ${current} y el anterior en ${previous}. Orden: ${JSON.stringify(args)}`);
    }
  }
});

Then('la conversión falla con un error de build', () => {
  if (world.failedWith === undefined) throw new Error('la conversión no falló y debía');
  if (!(world.failedWith instanceof BuildError)) {
    throw new Error(`esperaba un BuildError y obtuve ${String(world.failedWith)}`);
  }
});

Then('pandoc no fue invocado', () => {
  if (world.calls.length !== 0) throw new Error(`pandoc fue invocado ${world.calls.length} veces y no debía`);
});

Then('el índice ya no enlaza al encabezado de referencias', () => {
  if (world.html.includes('<a href="#refs-heading">')) throw new Error('quedó el ítem del TOC hacia #refs-heading');
});

Then('el marcador se sustituye por la tarjeta con la lista extraída', () => {
  if (!world.html.includes('<section class="refs-card">')) throw new Error('no se insertó la tarjeta de referencias');
  if (!world.html.includes('csl-entry')) throw new Error('la tarjeta no trae la lista de entradas');
  if (world.html.includes('<div id="block-referencias">')) throw new Error('quedó el marcador del bloque de referencias');
});

Then('el encabezado sintético no queda en el artículo', () => {
  if (world.html.includes('id="refs-heading"')) throw new Error('quedó el h1 sintético de referencias');
});

Then('la llamada a pandoc pide HTML5 con el idioma del sitio y citas enlazadas', () => {
  const call = lastCall();
  if (call.to !== 'html5') throw new Error(`esperaba html5 y fue "${call.to}"`);
  exigeLista(argsOf(), ['--metadata=lang:es-MX', '--metadata=link-citations:true']);
});

Then('el HTML es el fixture sin post-procesar', () => {
  if (world.calls.length !== 1) throw new Error(`esperaba 1 llamada y hubo ${world.calls.length}`);
  if (world.html !== world.fixtureHtml) throw new Error('el HTML post-procesado difiere del fixture');
});

Then('la primera llamada lleva citeproc, la bibliografía y el estilo APA', () => {
  const args = argsOf(0);
  exigeLista(args, ['--citeproc', '--bibliography', '--csl']);
  if (args[args.indexOf('--bibliography') + 1] !== '/abs/refs.bib') throw new Error('la bibliografía no viaja');
  if (args[args.indexOf('--csl') + 1] !== '/abs/apa.csl') throw new Error('el estilo APA no viaja');
});

Then('la segunda llamada no lleva citeproc', () => {
  if (argsOf(1).includes('--citeproc')) throw new Error('sin bibliografía no debe haber citeproc');
});

Then('la distribución es:', (tabla: { hashes: () => Record<string, string>[] }) => {
  const esperado = tabla.hashes();
  for (const fila of esperado) {
    const origen = fila.origen ?? '';
    const destino = fila.destino ?? '';
    const got = world.distribution.get(origen);
    if (got !== destino) throw new Error(`esperaba ${origen} → ${destino} y obtuve ${String(got)}`);
  }
});

Then('la distribución está vacía', () => {
  if (world.distribution.size !== 0) throw new Error(`esperaba 0 entradas y hubo ${world.distribution.size}`);
});

Then('reescribir {string} lo deja igual', (tex: string) => {
  const got = rewriteTexForDist(tex, world.distribution);
  if (got !== tex) throw new Error(`esperaba el .tex intacto y salió ${JSON.stringify(got)}`);
});

Then('las dos referencias quedan dentro de la carpeta de imágenes', () => {
  const got = rewriteTexForDist(world.texToRewrite, world.distribution);
  const expected = '\\includegraphics{assets/images/ensayo-portada-cmyk.jpg}\n\\mbox{assets/images/ensayo-portada-cmyk.jpg}';
  if (got !== expected) throw new Error(`esperaba ${JSON.stringify(expected)} y obtuve ${JSON.stringify(got)}`);
});

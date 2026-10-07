import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { loadFilterGroups } from '../../builder/filter-resolver.js';
import { markdownToLatex } from '../../builder/latex-composer.js';
import type { BuildDocument } from '../../builder/types.js';
import { loadSiteConfig } from '../../config/config-loader.js';
import { splitFrontmatter } from '../../lib/frontmatter.js';
import { execPandoc } from '../../lib/pandoc-runner.js';

const USER_FILTER = [
  '-- Convierte Div.nota según el formato de salida',
  'function Div(div)',
  '  if not div.classes:includes("nota") then return nil end',
  '  if FORMAT == "latex" then',
  '    return pandoc.RawBlock("latex", "\\\\fbox{Nota}")',
  '  elseif FORMAT == "html5" then',
  '    return pandoc.RawBlock("html", \'<aside class="nota">Nota</aside>\')',
  '  end',
  '  return nil',
  'end',
].join('\n');

const DOC = '---\ntitle: Prueba\n---\n\n::: {.nota}\nImportante\n:::\n';

const TEMPLATE = '\\documentclass{article}\n\\begin{document}\n$body$\n\\end{document}\n';

const RESOURCES = join(import.meta.dir, '../../lib/resources/filters');

const PKG_LATEX_FILTERS = [
  '01-spacer',
  '02-dictum',
  '03-verse',
  '04-center',
  '05-flushright',
  '06-mbox-sentence-end',
  '09-quote-noindent',
  '10-cjk',
  '07-titlepages',
  '11-uppercase',
].map((name) => join(RESOURCES, 'latex', `${name}.lua`));

const SEMANTIC_FILTERS = [
  join(RESOURCES, 'semantic', 'string', '01-double-colon.lua'),
  join(RESOURCES, 'semantic', 'ast', '02-double-colon-noindent.lua'),
];

interface UserWorld {
  dir: string;
  filterPath: string;
  mboxOverride: string;
  useConfig: boolean;
  latex: string;
  html: string;
}

const world: UserWorld = { dir: '', filterPath: '', mboxOverride: '', useConfig: false, latex: '', html: '' };

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  await mkdir(join(world.dir, 'filters'), { recursive: true });
  world.filterPath = join(world.dir, 'filters', 'nota.lua');
  await writeFile(world.filterPath, USER_FILTER);
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

Given('un proyecto con un filtro de usuario que convierte la clase nota', () => {
  world.useConfig = false;
});

Given('un proyecto con una copia del filtro de mbox como override', async () => {
  await mkdir(join(world.dir, 'filters', 'latex'), { recursive: true });
  const pkg06 = await Bun.file(join(RESOURCES, 'latex', '06-mbox-sentence-end.lua')).text();
  world.mboxOverride = join(world.dir, 'filters', 'latex', '06-mbox-sentence-end.lua');
  await writeFile(world.mboxOverride, pkg06);
});

Given('el filtro declarado en la configuración del proyecto', async () => {
  world.useConfig = true;
  await writeFile(join(world.dir, 'iteraciones.config.yaml'), 'luaFilters:\n  - filters/nota.lua\n');
});

When('convierto el documento con el override y los helpers del paquete por env', async () => {
  const sinEl06 = PKG_LATEX_FILTERS.filter((f) => !f.endsWith('06-mbox-sentence-end.lua'));
  const filters = [...SEMANTIC_FILTERS, world.mboxOverride, ...sinEl06];
  world.latex = await execPandoc({
    input: 'Primera oración de ejemplo. Segunda oración aquí.',
    sourcePath: 'test.md',
    to: 'latex',
    extraArgs: filters.flatMap((f) => ['--lua-filter', f]),
    env: { ITERACIONES_MBOX_HELPERS: join(RESOURCES, 'latex', 'shared', 'mbox-helpers.lua') },
  });
});

Then('el LaTeX lleva la caja de mbox', () => {
  if (!world.latex.includes('\\mbox{')) throw new Error('el LaTeX no trae ninguna caja mbox');
});

When('convierto el documento con el filtro a LaTeX', async () => {
  world.latex = await execPandoc({
    input: DOC,
    sourcePath: 'test.md',
    to: 'latex',
    extraArgs: ['--lua-filter', world.filterPath],
  });
});

When('convierto el documento con el filtro a HTML', async () => {
  world.html = await execPandoc({
    input: DOC,
    sourcePath: 'test.md',
    to: 'html5',
    extraArgs: ['--lua-filter', world.filterPath],
  });
});

When('compilo el documento por el pipeline', async () => {
  const filePath = join(world.dir, 'doc.md');
  await writeFile(filePath, DOC);
  const doc: BuildDocument = {
    filePath,
    relativePath: 'doc.md',
    frontmatter: { title: 'Prueba', date: '', creator: [] },
    slug: 'prueba',
  };
  const siteConfig = await loadSiteConfig(world.dir);
  const filters = await loadFilterGroups(siteConfig, undefined, world.dir);
  const templatePath = join(world.dir, 'tpl.tex');
  await writeFile(templatePath, TEMPLATE);
  const content = await Bun.file(doc.filePath).text();
  const { body } = splitFrontmatter(content);
  const result = await markdownToLatex(body, doc, {
    filters,
    bibFiles: [],
    templatePath,
    fm: { title: 'Prueba' },
    siteConfig,
    warnedLangs: new Set(),
  });
  world.latex = result.tex;
});

Then('el LaTeX lleva la caja de nota', () => {
  if (!world.latex.includes('\\fbox{Nota}')) throw new Error('el LaTeX no trae la caja de nota');
});

Then('el HTML lleva el bloque aside de nota', () => {
  if (!world.html.includes('<aside class="nota">')) throw new Error('el HTML no trae el bloque aside de nota');
});

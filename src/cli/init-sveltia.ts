import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { slugify } from '../builder/discover.js';
import { writeExclusive } from '../builder/pipeline-io.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { computeActiveFormats } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { logInfo, logSuccess, logWarning } from '../lib/logger.js';
import { initProject } from './init.js';

const require = createRequire(import.meta.url);

const ADMIN_INDEX = [
  '<!doctype html>',
  '<html lang="es">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
  '    <title>Administración</title>',
  '  </head>',
  '  <body>',
  '    <script src="./vendor/sveltia-cms.js"></script>',
  '  </body>',
  '</html>',
  '',
].join('\n');

const NETLIFY_CACHE_VERSION = '1.0.3';

const LICENCIAS = [
  { label: 'Usar la licencia global', value: '' },
  { label: 'CC BY-NC-ND 4.0', value: 'CC-BY-NC-ND-4.0' },
  { label: 'PF-AC-PR-FA-1.0', value: 'PF-AC-PR-FA-1.0' },
];

const IDIOMAS: Record<string, string> = {
  'es-MX': 'Español (México)',
  es: 'Español',
  en: 'English',
};

const TEXTO_EJEMPLO = [
  '---',
  'title: "Texto de ejemplo"',
  'type: file',
  '---',
  '',
  'Este es un texto de ejemplo. Reemplázalo o bórralo desde el admin.',
  '',
].join('\n');

function campo(name: string, label: string, widget: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, label, widget, ...extra };
}

function campoFecha(name = 'date', label = 'Fecha'): Record<string, unknown> {
  return campo(name, label, 'datetime', { type: 'date', required: false });
}

function campoIdioma(idioma: string): Record<string, unknown> {
  return campo('language', 'Idioma', 'select', {
    required: false,
    dropdown_threshold: 0,
    options: [
      { label: 'Usar el idioma global', value: '' },
      { label: IDIOMAS[idioma] ?? idioma, value: idioma },
    ],
  });
}

function campoLicencia(): Record<string, unknown> {
  return campo('license', 'Licencia', 'select', { required: false, dropdown_threshold: 0, options: LICENCIAS });
}

function campoSlug(): Record<string, unknown> {
  return campo('slug', 'Slug', 'string', {
    required: false,
    pattern: ['^[a-z0-9]+(?:-[a-z0-9]+)*$', 'Solo minúsculas, números y guiones'],
    hint: 'Opcional. Si lo dejas vacío, la CLI lo genera con el título.',
  });
}

function campoType(tipo: string): Record<string, unknown> {
  return campo('type', 'Tipo', 'hidden', { default: tipo });
}

function campoRelacion(name: string, label: string, coleccion: string, multiple = true): Record<string, unknown> {
  return campo(name, label, 'relation', {
    collection: coleccion,
    value_field: 'name',
    search_fields: ['name'],
    display_fields: ['name'],
    dropdown_threshold: 0,
    ...(multiple ? { multiple: true } : {}),
    required: false,
  });
}

function campoCuerpo(label = 'Texto', required = true): Record<string, unknown> {
  return campo('body', label, 'markdown', { modes: ['raw'], required });
}

function campoSubtitulo(): Record<string, unknown> {
  return campo('subtitle', 'Subtítulo', 'string', { required: false });
}

function campoTitulo(): Record<string, unknown> {
  return campo('title', 'Título', 'string', {
    required: false,
    hint: 'Si se deja vacío, la CLI usará «Sin título».',
  });
}

function camposEnlaces(): Record<string, unknown> {
  return campo('links', 'Enlaces', 'list', {
    required: false,
    label_singular: 'Enlace',
    fields: [campo('name', 'Nombre', 'string'), campo('url', 'URL', 'string')],
  });
}

function campoFiltro(): Record<string, unknown> {
  return campo('filter', 'Filtro', 'object', {
    required: false,
    hint: 'Sólo para type: list.',
    fields: [
      campo('type', 'Tipo de documento', 'select', { required: false, dropdown_threshold: 0, options: ['file', 'collection', 'creator', 'list'] }),
      campoRelacion('creator', 'Autora', 'creadoras', false),
      campo('date', 'Fecha', 'object', {
        required: false,
        fields: [campoFecha('from', 'Desde'), campoFecha('to', 'Hasta')],
      }),
      campoRelacion('keyword', 'Palabra clave', 'palabras_clave', false),
      campo('path', 'Ruta', 'string', { required: false }),
    ],
  });
}

function campoOrden(): Record<string, unknown> {
  return campo('order', 'Orden', 'select', {
    required: false,
    dropdown_threshold: 0,
    hint: 'Sólo para type: list.',
    options: ['date-desc', 'date-asc', 'title-asc', 'title-desc', 'creator-asc'],
  });
}

function configuracionSveltia(idioma: string, repo: string, rama: string, slug: string, cwd: string): string {
  const dominio = `${slug}.netlify.app`;
  const medios = { media_folder: '/assets/images', public_folder: '../assets/images' };

  const config = {
    backend: {
      name: 'github',
      repo,
      branch: rama,
      site_domain: dominio,
      auth_scope: 'public_repo',
      open_authoring: true,
    },
    site_url: `https://${dominio}`,
    display_url: `https://${dominio}`,
    publish_mode: 'editorial_workflow',
    slug: {
      encoding: 'ascii',
      clean_accents: true,
      lowercase: true,
      sanitize_replacement: '-',
    },
    media_folder: 'assets/images',
    public_folder: 'assets/images',
    output: { omit_empty_optional_fields: true },
    collections: [
      {
        name: 'textos',
        label: 'Textos',
        label_singular: 'Texto',
        folder: 'textos',
        create: true,
        extension: 'md',
        format: 'frontmatter',
        identifier_field: 'title',
        ...medios,
        slug: '{{slug}}',
        summary: '{{title}} — {{creator}}',
        sortable_fields: ['date', 'title', 'creator'],
        fields: [
          campoTitulo(),
          campoSubtitulo(),
          campoRelacion('creator', 'Autora', 'creadoras'),
          campoCuerpo(),
          campoFecha(),
          campoRelacion('keywords', 'Palabras clave', 'palabras_clave'),
          campoLicencia(),
          campoIdioma(idioma),
          campoSlug(),
          campoType('file'),
        ],
      },
      {
        name: 'creadoras',
        label: 'Creadoras',
        label_singular: 'Creadora',
        folder: 'creadoras',
        create: true,
        extension: 'md',
        format: 'frontmatter',
        identifier_field: 'name',
        ...medios,
        slug: '{{slug}}',
        summary: '{{name}}',
        fields: [
          campo('name', 'Nombre', 'string', { required: true }),
          campoCuerpo('Semblanza'),
          campo('image', 'Retrato', 'image', { required: false }),
          camposEnlaces(),
          campoSlug(),
          campoType('creator'),
        ],
      },
      {
        name: 'colecciones',
        label: 'Colecciones',
        label_singular: 'Colección',
        folder: 'colecciones',
        create: true,
        extension: 'md',
        format: 'frontmatter',
        identifier_field: 'title',
        ...medios,
        slug: '{{slug}}',
        summary: '{{title}}',
        fields: [
          campoTitulo(),
          campoSubtitulo(),
          campo('collectionCreatorPrefix', 'Rol de la antologadora', 'string', { required: false }),
          campoRelacion('collectionCreator', 'Antologadora', 'creadoras'),
          campoCuerpo('Texto', false),
          campoFecha(),
          campoRelacion('keywords', 'Palabras clave', 'palabras_clave'),
          campoLicencia(),
          campoIdioma(idioma),
          campo('files', 'Textos incluidos', 'list', {
            required: true,
            label_singular: 'Texto',
            hint: 'Rutas relativas al repositorio, por ejemplo: textos/mi-texto.md.',
          }),
          campoSlug(),
          campoType('collection'),
        ],
      },
      {
        name: 'anuncios',
        label: 'Anuncios',
        label_singular: 'Anuncio',
        folder: 'anuncios',
        create: true,
        extension: 'md',
        format: 'frontmatter',
        identifier_field: 'title',
        ...medios,
        slug: '{{slug}}',
        summary: '{{title}}',
        fields: [
          campoTitulo(),
          campoCuerpo(),
          campoFecha(),
          campo('placement', 'Ubicación', 'select', { required: false, dropdown_threshold: 0, options: ['top', 'bottom'] }),
          campoIdioma(idioma),
          campoSlug(),
          campoType('announcement'),
        ],
      },
      {
        name: 'listas',
        label: 'Listas',
        label_singular: 'Lista',
        folder: 'listas',
        create: true,
        extension: 'md',
        format: 'frontmatter',
        identifier_field: 'title',
        ...medios,
        slug: '{{slug}}',
        summary: '{{title}}',
        fields: [campoTitulo(), campoSubtitulo(), campoCuerpo(), campoFiltro(), campoOrden(), campoSlug(), campoType('list')],
      },
      {
        name: 'intervenciones',
        label: 'Intervenciones',
        label_singular: 'Intervención',
        folder: 'intervenciones',
        create: true,
        extension: 'md',
        format: 'frontmatter',
        identifier_field: 'title',
        ...medios,
        slug: '{{slug}}',
        summary: '{{title}}',
        fields: [
          campoTitulo(),
          campoSubtitulo(),
          campoRelacion('creator', 'Autora', 'creadoras'),
          campoCuerpo('Texto', false),
          campoFecha(),
          campo('pages', 'Páginas', 'number', { required: false, min: 1, value_type: 'int' }),
          campo('lineLength', 'Longitud de línea', 'number', { required: false, min: 0.1, max: 1, value_type: 'float' }),
          campo('letterhead', 'Membrete', 'list', { required: false }),
          campo('letterheadHeight', 'Altura del membrete', 'string', {
            required: false,
            hint: 'Ejemplo: 5cm, 50mm o 2in',
          }),
          campoLicencia(),
          campoIdioma(idioma),
          campoSlug(),
          campoType('intervention'),
        ],
      },
      {
        name: 'paginas',
        label: 'Páginas',
        label_singular: 'Página',
        folder: 'paginas',
        create: true,
        extension: 'md',
        format: 'frontmatter',
        identifier_field: 'title',
        ...medios,
        slug: '{{slug}}',
        summary: '{{title}}',
        fields: [campoTitulo(), campoSubtitulo(), campoCuerpo(), campoFecha(), campoLicencia(), campoIdioma(idioma), campoSlug(), campoType('file')],
      },
      {
        name: 'documentos',
        label: 'Documentos',
        label_singular: 'Documento',
        folder: 'documentos',
        create: true,
        extension: 'md',
        format: 'frontmatter',
        identifier_field: 'title',
        ...medios,
        slug: '{{slug}}',
        summary: '{{title}} — {{creator}}',
        sortable_fields: ['date', 'title', 'creator'],
        fields: [
          campoTitulo(),
          campoRelacion('creator', 'Autora', 'creadoras'),
          campoRelacion('contributor', 'Colaboradoras', 'creadoras'),
          campo('publisher', 'Editorial', 'string', { required: false }),
          campo('identifier', 'Identificador', 'string', { required: false }),
          campo('doi', 'DOI', 'string', { required: false }),
          campo('isbn', 'ISBN', 'string', { required: false }),
          campo('abstract', 'Resumen', 'text', { required: false }),
          campoRelacion('keywords', 'Palabras clave', 'palabras_clave'),
          campoFecha(),
          campoLicencia(),
          campoIdioma(idioma),
          campoSlug(),
          campoCuerpo(),
          campoType('file'),
        ],
      },
      {
        name: 'convocatorias',
        label: 'Convocatorias',
        label_singular: 'Convocatoria',
        folder: 'convocatorias',
        create: true,
        extension: 'md',
        format: 'frontmatter',
        identifier_field: 'title',
        ...medios,
        slug: '{{slug}}',
        summary: '{{title}}',
        fields: [campoTitulo(), campoFecha(), campoCuerpo(), campoLicencia(), campoIdioma(idioma), campoSlug(), campoType('file')],
      },
      {
        name: 'menu',
        label: 'Menú',
        files: [
          {
            name: 'menu',
            label: 'Menú principal',
            file: 'menu.md',
            fields: [camposEnlaces(), campoType('menu')],
          },
        ],
      },
      {
        name: 'palabras_clave',
        label: 'Palabras clave',
        label_singular: 'Palabra clave',
        description: 'Vocabulario reutilizable para el campo «Palabras clave». No genera contenido en el sitio.',
        folder: 'palabras-clave',
        extension: 'json',
        format: 'json',
        identifier_field: 'name',
        create: true,
        editor: { preview: false },
        fields: [campo('name', 'Palabra clave', 'string')],
      },
    ],
  };

  const colecciones = (config.collections as Array<Record<string, unknown>>).filter((col) => {
    const folder = col.folder;
    return typeof folder !== 'string' || existsSync(join(cwd, folder));
  });
  (config as { collections: unknown[] }).collections = colecciones;

  ocultarDespuesDelBody(config.collections);

  return stringify(config, { lineWidth: 0 });
}

interface ColeccionConfig {
  fields?: Record<string, unknown>[];
  files?: Array<{ fields?: Record<string, unknown>[] }>;
}

function ocultarDespuesDelBody(collections: unknown): void {
  for (const col of collections as ColeccionConfig[]) {
    if (col.fields !== undefined) ocultarCamposDespuesDelBody(col.fields);
    for (const file of col.files ?? []) {
      if (file.fields !== undefined) ocultarCamposDespuesDelBody(file.fields);
    }
  }
}

function ocultarCamposDespuesDelBody(fields: Record<string, unknown>[]): void {
  const indice = fields.findIndex((field) => field.name === 'body');
  if (indice < 0) return;
  for (const field of fields.slice(indice + 1)) {
    if (field.widget !== 'hidden') field.preview = false;
  }
}

async function copiarVendorSveltia(destino: string): Promise<boolean> {
  if (await Bun.file(destino).exists()) return false;

  let vendor: string;
  try {
    const main = require.resolve('@sveltia/cms');
    vendor = join(dirname(dirname(main)), 'dist', 'sveltia-cms.js');
  } catch {
    throw new BuildError('falta @sveltia/cms; reinstala iteraciones-cli e inténtalo de nuevo', 'sveltia-missing');
  }
  if (!(await Bun.file(vendor).exists())) {
    throw new BuildError(`no se encontró el bundle de Sveltia en ${vendor}`, 'sveltia-missing');
  }

  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, await readFile(vendor));
  return true;
}

interface Paquete {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [clave: string]: unknown;
}

function versionSveltia(): string {
  const propio = require('../../package.json') as { dependencies?: Record<string, string> };
  return propio.dependencies?.['@sveltia/cms'] ?? '0.261.0';
}

function fusionarPaquete(existente: Paquete | null, cwd: string, conCache: boolean): { paquete: Paquete; cambios: string[] } {
  const paquete: Paquete = existente ?? { name: basename(cwd), private: true };
  const cambios: string[] = [];

  paquete.scripts ??= {};
  for (const [nombre, comando] of [
    ['build', 'iteraciones build'],
    ['dev', 'iteraciones preview'],
  ] as const) {
    if (paquete.scripts[nombre] === undefined) {
      paquete.scripts[nombre] = comando;
      cambios.push(`scripts.${nombre}`);
    }
  }

  paquete.devDependencies ??= {};
  if (paquete.devDependencies['@sveltia/cms'] === undefined) {
    paquete.devDependencies['@sveltia/cms'] = versionSveltia();
    cambios.push('devDependencies.@sveltia/cms');
  }
  if (conCache && paquete.devDependencies['netlify-plugin-cache'] === undefined) {
    paquete.devDependencies['netlify-plugin-cache'] = NETLIFY_CACHE_VERSION;
    cambios.push('devDependencies.netlify-plugin-cache');
  }

  return { paquete, cambios };
}

function salidaGit(cwd: string, args: string[]): string | undefined {
  const proc = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'ignore' });
  if (proc.exitCode !== 0) return undefined;
  const salida = new TextDecoder().decode(proc.stdout).trim();
  return salida === '' ? undefined : salida;
}

function detectarRepo(cwd: string): string | undefined {
  const url = salidaGit(cwd, ['remote', 'get-url', 'origin']);
  if (url === undefined) return undefined;
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  return match?.[1] !== undefined && match[2] !== undefined ? `${match[1]}/${match[2]}` : undefined;
}

function detectarRama(cwd: string): string {
  return salidaGit(cwd, ['branch', '--show-current']) ?? 'main';
}

function netlifyToml(): string {
  return [
    '[build]',
    '  command = "bun run build"',
    '  publish = "dist/files"',
    '',
    '  [build.environment]',
    `    BUN_VERSION = "${Bun.version}"`,
    '',
    '[[plugins]]',
    '  package = "netlify-plugin-cache"',
    '  [plugins.inputs]',
    '    paths = [".iteraciones", "dist"]',
    '',
  ].join('\n');
}

function brewfile(format: Awaited<ReturnType<typeof loadSiteConfig>>['format']): string | undefined {
  const active = new Set(computeActiveFormats(format));
  if (active.size === 0) return undefined;

  const formulas = ['pandoc', 'imagemagick', 'librsvg'];
  if (active.has('pdf') || active.has('latex')) formulas.push('texlive', 'biber', 'poppler');
  return `${formulas.map((formula) => `brew "${formula}"`).join('\n')}\n`;
}

export async function initSveltia(cwd: string): Promise<void> {
  await initProject(cwd);

  const { language, format } = await loadSiteConfig(cwd);
  const slug = slugify(basename(cwd)) || 'iteraciones';
  const repo = detectarRepo(cwd) ?? `OWNER/${slug}`;
  const rama = detectarRama(cwd);

  await Promise.all(
    [
      'admin',
      'admin/vendor',
      'paginas',
      'textos',
      'documentos',
      'creadoras',
      'colecciones',
      'convocatorias',
      'listas',
      'anuncios',
      'intervenciones',
      'palabras-clave',
    ].map((dir) => mkdir(join(cwd, dir), { recursive: true })),
  );

  const report = (created: boolean, archivo: string): void => {
    if (created) logSuccess(`creado ${archivo}`, 'init');
    else logInfo(`omitido ${archivo} (ya existe)`, 'init');
  };

  const adminIndex = join(cwd, 'admin', 'index.html');
  const adminConfig = join(cwd, 'admin', 'config.yml');
  const vendor = join(cwd, 'admin', 'vendor', 'sveltia-cms.js');

  const [indexCreado, configCreado] = await Promise.all([
    writeExclusive(adminIndex, ADMIN_INDEX),
    writeExclusive(adminConfig, configuracionSveltia(language, repo, rama, slug, cwd)),
  ]);
  const vendorCreado = await copiarVendorSveltia(vendor);

  report(indexCreado, 'admin/index.html');
  report(configCreado, 'admin/config.yml');
  report(vendorCreado, 'admin/vendor/sveltia-cms.js');
  report(await writeExclusive(join(cwd, 'palabras-clave', '.gitkeep'), ''), 'palabras-clave/.gitkeep');
  report(await writeExclusive(join(cwd, 'textos', 'ejemplo.md'), TEXTO_EJEMPLO), 'textos/ejemplo.md');
  const netlifyPath = join(cwd, 'netlify.toml');
  const netlifyCreado = await writeExclusive(netlifyPath, netlifyToml());
  const conCache =
    netlifyCreado ||
    (
      await Bun.file(netlifyPath)
        .text()
        .catch(() => '')
    ).includes('netlify-plugin-cache');
  report(netlifyCreado, 'netlify.toml');
  const brew = brewfile(format);
  if (brew === undefined) logWarning('no hay formatos activos; no se generó Brewfile.netlify', 'init');
  else report(await writeExclusive(join(cwd, 'Brewfile.netlify'), brew), 'Brewfile.netlify');
  if (repo.startsWith('OWNER/')) logWarning(`no encontré un remoto de GitHub; admin/config.yml usa ${repo}`, 'init');

  const paquetePath = join(cwd, 'package.json');
  const crudo = await Bun.file(paquetePath)
    .text()
    .catch(() => null);
  let existente: Paquete | null = null;
  if (crudo !== null) {
    try {
      existente = JSON.parse(crudo) as Paquete;
    } catch {
      logWarning('package.json no es JSON válido; se dejó intacto', 'init');
    }
  }
  if (crudo === null || existente !== null) {
    const { paquete, cambios } = fusionarPaquete(existente, cwd, conCache);
    await writeFile(paquetePath, `${JSON.stringify(paquete, null, 2)}\n`);
    logSuccess(cambios.length === 0 ? 'package.json sin cambios' : `actualizado package.json (${cambios.join(', ')})`, 'init');
  }

  logSuccess('admin de Sveltia listo. Ajusta admin/config.yml y ejecuta el build.', 'init');
}

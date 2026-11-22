import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { LICENSE_DEFS } from '../builder/licenses.js';
import { writeExclusive } from '../builder/pipeline-io.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { BuildError, ConfigError } from '../lib/errors.js';
import { logSuccess, logWarning } from '../lib/logger.js';
import { DEFAULT_BUILD_IMAGE, writeGitlabPages } from './gitlab-pages.js';
import { ensurePackage } from './package-json.js';
import { ensureGitignore, report } from './project-files.js';

const require = createRequire(import.meta.url);

export type SveltiaWorkflow = 'simple' | 'editorial' | 'open-authoring';

export interface SveltiaOptions {
  workflow: SveltiaWorkflow;
  repo?: string;
  branch?: string;
  siteUrl?: string;
  appId?: string;
  buildImage?: string;
}

export const DEFAULT_REPO = 'OWNER/REPO';
export const DEFAULT_BRANCH = 'main';
export const DEFAULT_SITE_URL = 'https://example.com';
export const DEFAULT_APP_ID = 'YOUR_GITLAB_APP_ID';

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

const LICENCIAS = [
  { label: 'Usar la licencia global', value: '' },
  ...Object.entries(LICENSE_DEFS).map(([value, def]) => ({ label: def.label, value })),
];

const IDIOMAS: Record<string, string> = {
  'es-MX': 'Español (México)',
  es: 'Español',
  en: 'English',
};

const CREADORA_EJEMPLO = [
  '---',
  'name: "Ejemplo"',
  'slug: ejemplo',
  'type: creator',
  '---',
  '',
  'Esta es una semblanza de ejemplo. Reemplázala o bórrala desde el admin.',
  '',
].join('\n');

const TEXTO_EJEMPLO = [
  '---',
  'title: "Texto de ejemplo"',
  'creator:',
  '  - "Ejemplo"',
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

function campoRelacion(name: string, label: string, coleccion: string, multiple = true, required = false): Record<string, unknown> {
  return campo(name, label, 'relation', {
    collection: coleccion,
    value_field: 'name',
    search_fields: ['name'],
    display_fields: ['name'],
    dropdown_threshold: 0,
    ...(multiple ? { multiple: true } : {}),
    required,
  });
}

function campoCuerpo(label = 'Texto', required = true): Record<string, unknown> {
  return campo('body', label, 'markdown', { modes: ['raw'], required });
}

function campoSubtitulo(): Record<string, unknown> {
  return campo('subtitle', 'Subtítulo', 'string', { required: false });
}

function campoTitulo(required = false): Record<string, unknown> {
  return campo('title', 'Título', 'string', {
    required,
    ...(required ? {} : { hint: 'Si se deja vacío, la CLI usará «Sin título».' }),
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

function configuracionSveltia(
  idioma: string,
  repo: string,
  rama: string,
  siteUrl: string,
  appId: string,
  cwd: string,
  workflow: SveltiaWorkflow,
): string {
  const coleccion = (
    name: string,
    label: string,
    singular: string,
    fields: Record<string, unknown>[],
    extras: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    name,
    label,
    label_singular: singular,
    folder: name,
    create: true,
    extension: 'md',
    format: 'frontmatter',
    identifier_field: 'title',
    slug: '{{slug}}',
    ...extras,
    fields,
  });

  const backend: Record<string, unknown> = {
    name: 'gitlab',
    repo,
    branch: rama,
    auth_type: 'pkce',
    app_id: appId,
  };
  if (workflow === 'open-authoring') backend.open_authoring = true;

  const config: Record<string, unknown> = {
    backend,
    site_url: siteUrl,
    display_url: siteUrl,
    show_preview_links: false,
    ...(workflow === 'simple' ? {} : { publish_mode: 'editorial_workflow' }),
    slug: {
      encoding: 'ascii',
      clean_accents: true,
      lowercase: true,
      sanitize_replacement: '-',
    },
    media_folder: 'assets/images',
    public_folder: '/assets/images',
    output: { omit_empty_optional_fields: true },
    collections: [
      coleccion(
        'textos',
        'Textos',
        'Texto',
        [
          campoTitulo(true),
          campoSubtitulo(),
          campoRelacion('creator', 'Autora', 'creadoras', true, true),
          campoCuerpo(),
          campoFecha(),
          campoRelacion('keywords', 'Palabras clave', 'palabras_clave'),
          campoLicencia(),
          campoIdioma(idioma),
          campoSlug(),
          campoType('file'),
        ],
        {
          folder: 'texts',
          path: '{{creator.0 | slugify}}/{{slug}}',
          nested: { depth: 2, subfolders: false, summary: '{{dirname}} / {{title}}' },
          filter: { field: 'type', value: 'file' },
          summary: '{{title}} — {{creator}}',
          sortable_fields: ['date', 'title', 'creator'],
        },
      ),
      coleccion(
        'creadoras',
        'Creadoras',
        'Creadora',
        [
          campo('name', 'Nombre', 'string', { required: true }),
          campoCuerpo('Semblanza'),
          campo('image', 'Retrato', 'image', { required: false }),
          camposEnlaces(),
          campoSlug(),
          campoType('creator'),
        ],
        {
          folder: 'texts',
          identifier_field: 'name',
          nested: { depth: 2, subfolders: true, summary: '{{name}}' },
          meta: { path: { index_file: 'creadora' } },
          filter: { field: 'type', value: 'creator' },
          summary: '{{name}}',
        },
      ),
      coleccion(
        'colecciones',
        'Colecciones',
        'Colección',
        [
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
            hint: 'Rutas relativas al repositorio, por ejemplo: texts/mi-texto.md.',
          }),
          campoSlug(),
          campoType('collection'),
        ],
        {
          folder: 'collections',
          filter: { field: 'type', value: 'collection' },
          summary: '{{title}}',
        },
      ),
      coleccion(
        'anuncios',
        'Anuncios',
        'Anuncio',
        [
          campoTitulo(),
          campoCuerpo(),
          campoFecha(),
          campo('placement', 'Ubicación', 'select', { required: false, dropdown_threshold: 0, options: ['top', 'bottom'] }),
          campoIdioma(idioma),
          campoSlug(),
          campoType('announcement'),
        ],
        {
          folder: 'announcements',
          filter: { field: 'type', value: 'announcement' },
          summary: '{{title}}',
        },
      ),
      coleccion(
        'listas',
        'Listas',
        'Lista',
        [campoTitulo(), campoSubtitulo(), campoCuerpo(), campoFiltro(), campoOrden(), campoSlug(), campoType('list')],
        {
          folder: 'lists',
          filter: { field: 'type', value: 'list' },
          summary: '{{title}}',
        },
      ),
      coleccion(
        'intervenciones',
        'Intervenciones',
        'Intervención',
        [
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
        {
          folder: 'interventions',
          filter: { field: 'type', value: 'intervention' },
          editor: { preview: false },
          summary: '{{title}}',
        },
      ),
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
        folder: 'keywords',
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

function configError(message: string): ConfigError {
  return new ConfigError(message, '');
}

function normalizeRepo(repo: string | undefined): string {
  const value = repo?.trim() || DEFAULT_REPO;
  if (value === DEFAULT_REPO) return value;
  if (/\s/.test(value) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+$/.test(value)) {
    throw configError(`repositorio de GitLab inválido: "${value}"; usa owner/repo o group/subgroup/repo`);
  }
  return value;
}

function normalizeBranch(branch: string | undefined): string {
  const value = branch?.trim() || DEFAULT_BRANCH;
  if (value === '' || /\s/.test(value)) throw configError(`rama de GitLab inválida: "${value}"`);
  return value;
}

function normalizeSiteUrl(siteUrl: string | undefined): string {
  const value = (siteUrl?.trim() || DEFAULT_SITE_URL).replace(/\/+$/, '');
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocolo');
  } catch {
    throw configError(`URL del sitio inválida: "${value}"; usa una URL http o https`);
  }
  return value;
}

function normalizeAppId(appId: string | undefined): string {
  return appId?.trim() || DEFAULT_APP_ID;
}

function normalizeBuildImage(buildImage: string | undefined): string {
  return buildImage?.trim() || DEFAULT_BUILD_IMAGE;
}

function avisarPlaceholders(repo: string, siteUrl: string, appId: string): void {
  if (repo === DEFAULT_REPO) logWarning(`admin/config.yml usa el repositorio ${DEFAULT_REPO}; cámbialo por el de GitLab`, 'add');
  if (siteUrl === DEFAULT_SITE_URL) logWarning(`admin/config.yml usa ${DEFAULT_SITE_URL}; cámbialo por la URL pública`, 'add');
  if (appId === DEFAULT_APP_ID) logWarning(`admin/config.yml usa ${DEFAULT_APP_ID}; cámbialo por el Application ID de GitLab`, 'add');
}

export async function addSveltia(cwd: string, options: SveltiaOptions): Promise<void> {
  await ensureGitignore(cwd, 'add');

  const repo = normalizeRepo(options.repo);
  const rama = normalizeBranch(options.branch);
  const siteUrl = normalizeSiteUrl(options.siteUrl);
  const appId = normalizeAppId(options.appId);
  const buildImage = normalizeBuildImage(options.buildImage);
  const { language } = await loadSiteConfig(cwd);

  await Promise.all(
    ['admin', 'admin/vendor', 'texts/ejemplo', 'collections', 'lists', 'announcements', 'interventions', 'keywords'].map((dir) =>
      mkdir(join(cwd, dir), { recursive: true }),
    ),
  );

  const adminIndex = join(cwd, 'admin', 'index.html');
  const adminConfig = join(cwd, 'admin', 'config.yml');
  const vendor = join(cwd, 'admin', 'vendor', 'sveltia-cms.js');

  const [indexCreado, configCreado] = await Promise.all([
    writeExclusive(adminIndex, ADMIN_INDEX),
    writeExclusive(adminConfig, configuracionSveltia(language, repo, rama, siteUrl, appId, cwd, options.workflow)),
  ]);
  const vendorCreado = await copiarVendorSveltia(vendor);

  report(indexCreado, 'admin/index.html', 'add');
  report(configCreado, 'admin/config.yml', 'add');
  report(vendorCreado, 'admin/vendor/sveltia-cms.js', 'add');
  report(await writeExclusive(join(cwd, 'keywords', '.gitkeep'), ''), 'keywords/.gitkeep', 'add');
  report(await writeExclusive(join(cwd, 'texts', 'ejemplo', 'creadora.md'), CREADORA_EJEMPLO), 'texts/ejemplo/creadora.md', 'add');
  report(await writeExclusive(join(cwd, 'texts', 'ejemplo', 'ejemplo.md'), TEXTO_EJEMPLO), 'texts/ejemplo/ejemplo.md', 'add');

  await writeGitlabPages(cwd, buildImage, 'add');
  await ensurePackage(cwd, { sveltia: true }, 'add');
  avisarPlaceholders(repo, siteUrl, appId);

  logSuccess('admin de Sveltia listo. Completa admin/config.yml y .gitlab-ci.yml antes de publicar.', 'add');
}

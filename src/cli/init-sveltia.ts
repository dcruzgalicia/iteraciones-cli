import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { writeExclusive } from '../builder/pipeline-io.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { todayIso } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { logInfo, logSuccess, logWarning } from '../lib/logger.js';
import { initProject } from './init.js';

const PLACEHOLDER_SITE = 'https://TU-SITIO.netlify.app';

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

const LICENCIAS = [
  { label: 'Usar la licencia del proyecto', value: '' },
  { label: 'CC BY-NC-ND 4.0', value: 'CC-BY-NC-ND-4.0' },
  { label: 'Producción Feminista 1.0', value: 'PF-AC-PR-FA-1.0' },
];

function campo(name: string, label: string, widget: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, label, widget, ...extra };
}

function campoFecha(name = 'date', label = 'Fecha'): Record<string, unknown> {
  return campo(name, label, 'datetime', { date_format: 'YYYY-MM-DD', time_format: false, required: false });
}

function campoIdioma(idioma: string): Record<string, unknown> {
  return campo('language', 'Idioma', 'select', {
    required: false,
    options: [
      { label: 'Usar el idioma del proyecto', value: '' },
      { label: idioma, value: idioma },
    ],
  });
}

function campoLicencia(): Record<string, unknown> {
  return campo('license', 'Licencia', 'select', { required: false, options: LICENCIAS });
}

const CAMPO_SLUG = campo('slug', 'Identificador', 'string', {
  required: false,
  hint: 'Minúsculas, números y guiones. Si lo dejas vacío se genera desde el título.',
});

const CAMPO_CUERPO = campo('body', 'Contenido', 'markdown');

function camposEnlaces(): Record<string, unknown> {
  return campo('links', 'Enlaces', 'list', {
    required: false,
    label_singular: 'Enlace',
    fields: [campo('name', 'Nombre', 'string'), campo('url', 'URL', 'string')],
  });
}

function configuracionSveltia(idioma: string): string {
  const documentos = (tipo: string): Record<string, unknown> => campo('type', 'Tipo', 'hidden', { default: tipo });

  const config = {
    backend: {
      name: 'github',
      repo: 'OWNER/REPO',
      branch: 'main',
      auth_scope: 'public_repo',
      open_authoring: true,
    },
    site_url: PLACEHOLDER_SITE,
    display_url: PLACEHOLDER_SITE,
    publish_mode: 'editorial_workflow',
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
        slug: '{{slug}}',
        summary: '{{title}}',
        media_folder: '/assets/images',
        public_folder: '../assets/images',
        fields: [
          documentos('file'),
          campo('title', 'Título', 'string'),
          campoFecha(),
          campo('creator', 'Creadoras', 'list', { required: false, label_singular: 'Creadora' }),
          campoIdioma(idioma),
          campo('keywords', 'Palabras clave', 'list', { required: false, label_singular: 'Palabra clave' }),
          CAMPO_SLUG,
          campoLicencia(),
          CAMPO_CUERPO,
        ],
      },
      {
        name: 'colecciones',
        label: 'Colecciones',
        label_singular: 'Colección',
        folder: 'colecciones',
        create: true,
        slug: '{{slug}}',
        summary: '{{title}}',
        media_folder: '/assets/images',
        public_folder: '../assets/images',
        fields: [
          documentos('collection'),
          campo('title', 'Título', 'string'),
          campoFecha(),
          campo('collectionCreator', 'Creadoras de la colección', 'list', { required: false, label_singular: 'Creadora' }),
          campo('collectionCreatorPrefix', 'Prefijo de creadoras', 'string', {
            required: false,
            hint: 'Por ejemplo: Coordinado por.',
          }),
          campoIdioma(idioma),
          CAMPO_SLUG,
          campo('files', 'Textos de la colección', 'list', {
            required: true,
            label_singular: 'Texto',
            hint: 'Rutas relativas al proyecto, por ejemplo: textos/mi-texto.md.',
          }),
          campoLicencia(),
          CAMPO_CUERPO,
        ],
      },
      {
        name: 'creadoras',
        label: 'Creadoras',
        label_singular: 'Creadora',
        folder: 'creadoras',
        create: true,
        slug: '{{slug}}',
        summary: '{{name}}',
        media_folder: '/assets/images',
        public_folder: '../assets/images',
        fields: [documentos('creator'), campo('name', 'Nombre', 'string'), CAMPO_SLUG, camposEnlaces(), CAMPO_CUERPO],
      },
      {
        name: 'intervenciones',
        label: 'Intervenciones',
        label_singular: 'Intervención',
        folder: 'intervenciones',
        create: true,
        slug: '{{slug}}',
        summary: '{{title}}',
        media_folder: '/assets/images',
        public_folder: '../assets/images',
        fields: [
          documentos('intervention'),
          campo('title', 'Título', 'string'),
          campoFecha(),
          campoIdioma(idioma),
          CAMPO_SLUG,
          campo('pages', 'Páginas', 'number', { required: false, min: 1, value_type: 'int' }),
          campo('lineLength', 'Ancho de línea', 'number', { required: false, min: 0.1, max: 1, step: 0.1 }),
          campo('letterhead', 'Membrete', 'image', { required: false }),
          campo('letterheadHeight', 'Alto del membrete', 'string', { required: false, hint: 'Por ejemplo: 5cm.' }),
          CAMPO_CUERPO,
        ],
      },
      {
        name: 'listas',
        label: 'Listas',
        label_singular: 'Lista',
        folder: 'listas',
        create: true,
        slug: '{{slug}}',
        summary: '{{title}}',
        media_folder: '/assets/images',
        public_folder: '../assets/images',
        fields: [
          documentos('list'),
          campo('title', 'Título', 'string'),
          campoFecha(),
          campoIdioma(idioma),
          CAMPO_SLUG,
          campo('filter', 'Filtro', 'object', {
            required: false,
            fields: [
              campo('type', 'Tipo', 'select', { required: false, options: ['file', 'collection', 'creator', 'list'] }),
              campo('creator', 'Creadora', 'string', { required: false }),
              campo('keyword', 'Palabra clave', 'string', { required: false }),
              campo('path', 'Ruta', 'string', { required: false }),
              campo('date', 'Rango de fechas', 'object', {
                required: false,
                fields: [campoFecha('from', 'Desde'), campoFecha('to', 'Hasta')],
              }),
            ],
          }),
          campo('order', 'Orden', 'select', {
            required: false,
            options: [
              { label: 'Fecha descendente', value: 'date-desc' },
              { label: 'Fecha ascendente', value: 'date-asc' },
              { label: 'Título ascendente', value: 'title-asc' },
              { label: 'Título descendente', value: 'title-desc' },
              { label: 'Creadora ascendente', value: 'creator-asc' },
            ],
          }),
          campoLicencia(),
          CAMPO_CUERPO,
        ],
      },
      {
        name: 'anuncios',
        label: 'Anuncios',
        label_singular: 'Anuncio',
        folder: 'anuncios',
        create: true,
        slug: '{{slug}}',
        summary: '{{title}}',
        media_folder: '/assets/images',
        public_folder: '../assets/images',
        fields: [
          documentos('announcement'),
          campo('title', 'Título', 'string'),
          campoFecha(),
          campo('creator', 'Creadora', 'string', { required: false }),
          campo('placement', 'Ubicación', 'select', {
            required: false,
            options: [
              { label: 'Arriba', value: 'top' },
              { label: 'Abajo', value: 'bottom' },
            ],
          }),
          campoIdioma(idioma),
          CAMPO_SLUG,
          campoLicencia(),
          CAMPO_CUERPO,
        ],
      },
      {
        name: 'menu',
        label: 'Menú',
        files: [
          {
            name: 'menu',
            label: 'Menú del sitio',
            file: 'menu.md',
            fields: [campo('title', 'Título', 'string'), camposEnlaces()],
          },
        ],
      },
    ],
  };

  return stringify(config, { lineWidth: 0 });
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

function fusionarPaquete(existente: Paquete | null, cwd: string): { paquete: Paquete; cambios: string[] } {
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

  return { paquete, cambios };
}

const DOC_EJEMPLO = (frontmatter: string[], cuerpo: string): string => ['---', ...frontmatter, '---', '', cuerpo, ''].join('\n');

function fecha(): string {
  return todayIso();
}

export async function initSveltia(cwd: string): Promise<void> {
  await initProject(cwd);

  const { language } = await loadSiteConfig(cwd);

  await Promise.all(
    ['admin', 'admin/vendor', 'textos', 'creadoras', 'colecciones', 'listas', 'anuncios', 'intervenciones'].map((dir) =>
      mkdir(join(cwd, dir), { recursive: true }),
    ),
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
    writeExclusive(adminConfig, configuracionSveltia(language)),
  ]);
  const vendorCreado = await copiarVendorSveltia(vendor);

  report(indexCreado, 'admin/index.html');
  report(configCreado, 'admin/config.yml');
  report(vendorCreado, 'admin/vendor/sveltia-cms.js');

  const ejemplo = join(cwd, 'textos', 'ejemplo.md');
  const docs: Array<[string, string]> = [
    [
      ejemplo,
      DOC_EJEMPLO(
        ['title: "Texto de ejemplo"', `date: "${fecha()}"`, 'type: file', `language: ${language}`, 'creator:', '  - "Creadora de ejemplo"'],
        'Este es un texto de ejemplo. Reemplázalo o bórralo desde el admin.',
      ),
    ],
    [
      join(cwd, 'creadoras', 'ejemplo.md'),
      DOC_EJEMPLO(['type: creator', 'name: "Creadora de ejemplo"', 'slug: creadora-de-ejemplo'], 'Una semblanza breve de la creadora.'),
    ],
    [
      join(cwd, 'colecciones', 'ejemplo.md'),
      DOC_EJEMPLO(
        [
          'title: "Colección de ejemplo"',
          `date: "${fecha()}"`,
          'type: collection',
          'collectionCreator:',
          '  - "Creadora de ejemplo"',
          'files:',
          '  - textos/ejemplo.md',
        ],
        'Una colección de ejemplo.',
      ),
    ],
    [
      join(cwd, 'listas', 'ejemplo.md'),
      DOC_EJEMPLO(
        ['title: "Lista de ejemplo"', `date: "${fecha()}"`, 'type: list', 'filter:', '  type: file', 'order: date-desc'],
        'Una lista de ejemplo.',
      ),
    ],
    [
      join(cwd, 'anuncios', 'ejemplo.md'),
      DOC_EJEMPLO(['title: "Anuncio de ejemplo"', `date: "${fecha()}"`, 'type: announcement', 'placement: top'], 'Un anuncio de ejemplo.'),
    ],
    [
      join(cwd, 'intervenciones', 'ejemplo.md'),
      DOC_EJEMPLO(
        ['title: "Intervención de ejemplo"', `date: "${fecha()}"`, 'type: intervention', 'pages: 1', 'lineLength: 0.7'],
        'Una intervención de ejemplo.',
      ),
    ],
    [join(cwd, 'menu.md'), ['---', 'type: menu', 'title: "Menú"', 'links:', '  - name: Inicio', '    url: ./index.html', '---', ''].join('\n')],
  ];

  for (const [ruta, contenido] of docs) {
    report(await writeExclusive(ruta, contenido), ruta.slice(cwd.length + 1));
  }

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
    const { paquete, cambios } = fusionarPaquete(existente, cwd);
    await writeFile(paquetePath, `${JSON.stringify(paquete, null, 2)}\n`);
    logSuccess(cambios.length === 0 ? 'package.json sin cambios' : `actualizado package.json (${cambios.join(', ')})`, 'init');
  }

  logSuccess('admin de Sveltia listo. Ajusta admin/config.yml y ejecuta el build.', 'init');
}

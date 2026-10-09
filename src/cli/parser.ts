import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { TEMPLATE_KINDS } from '../builder/pipeline-setup.js';
import { DPI, FUZZ_PERCENT, THRESHOLD_PERCENT } from '../lib/visual-diff.js';
import { runAssets } from './assets.js';
import { runBundle } from './bundle.js';
import { configHelp } from './config-help.js';
import { runCover } from './cover.js';
import { runBuild, runClean, runDoctor, runFilters, runInit, runNew, runValidate } from './dispatcher.js';
import { runMarkdown } from './markdown.js';
import { runMerge } from './merge.js';
import { runCollectPdf } from './pdf.js';
import { runPost } from './post.js';
import { runPrepare } from './prepare.js';
import { runPreview } from './preview.js';
import { runSnapshots, type SnapshotsOptions } from './snapshots.js';
import { runTemplate } from './template.js';

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function translateCommanderError(message: string): string {
  return message
    .split('\n')
    .map((line) =>
      line
        .replace(/^error: unknown command '([^']+)'$/, "error: comando desconocido '$1'")
        .replace(/^\(Did you mean (.+)\?\)$/, '(¿Quisiste decir $1?)')
        .replace(/^error: option '([^']+)' argument missing$/, "error: falta el argumento de la opción '$1'")
        .replace(/^error: required option '([^']+)' not specified$/, "error: falta la opción requerida '$1'")
        .replace(/^error: missing required argument '([^']+)'$/, "error: falta el argumento requerido '$1'")
        .replace(/^error: unknown option '([^']+)'$/, "error: opción desconocida '$1'"),
    )
    .join('\n');
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(packageJson.name.replace(/-cli$/, ''))
    .version(packageJson.version, '-V, --version', 'muestra la versión')
    .helpOption('-h, --help', 'muestra la ayuda')
    .helpCommand(false);
  program.addHelpText(
    'before',
    `escribir, compartir, re-existir

Construye documentos HTML, PDF, EPUB, LaTeX y Markdown a partir de archivos Markdown (pandoc + Tailwind CSS).

Primeros pasos:
  iteraciones init                 crea la estructura del proyecto
  iteraciones new posts/doc.md     crea un documento
  iteraciones build                 construye los documentos del proyecto
`,
  );
  program.addHelpText(
    'after',
    `
Entorno:
  NO_COLOR                  desactiva los colores (la salida no interactiva nunca los emite)
${configHelp()}
Markdown: pandoc más los filtros del paquete. "iteraciones list-filters" dice qué hace cada uno.
`,
  );
  program.option('--project-root <path>', 'directorio raíz del proyecto (por defecto: directorio actual)');
  program.configureHelp({ showGlobalOptions: true });
  program.configureOutput({ outputError: (str, write) => write(translateCommanderError(str)) });
  program.exitOverride();

  const projectRoot = (): string => program.opts().projectRoot ?? process.cwd();

  program
    .command('build [paths...]')
    .description('construye los documentos del proyecto a partir de los archivos Markdown; con paths, solo esos documentos y su cierre')
    .option('--full', 'build completo desde cero: elimina la salida anterior y la caché')
    .option('--output <path>', 'directorio de salida (por defecto: dist/files)')
    .option('--verbose', 'muestra información adicional de progreso')
    .option('--json', 'imprime el resultado como JSON en stdout (consumo programático)')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones build                build incremental (solo archivos modificados)
  iteraciones build --full         build completo desde cero (sin caché)
  iteraciones build doc.md         construye solo ese documento (una collection arrastra sus files[] y creators)
  iteraciones build cap1.md suelto.md   varios documentos en la misma corrida
  iteraciones build --verbose      muestra información adicional de progreso
  iteraciones build --json         imprime el resultado como JSON en stdout
`,
    )
    .action(async (paths: string[], opts: { full?: boolean; output?: string; verbose?: boolean; json?: boolean }) => {
      await runBuild(projectRoot(), {
        full: opts.full,
        outputDir: opts.output,
        verbose: opts.verbose,
        json: opts.json,
        only: paths.length > 0 ? paths : undefined,
      });
    });

  program
    .command('merge <path>')
    .description('escribe la entrada exacta de pandoc de una collection en .iteraciones/collections/ (formatos: latex | html | epub | markdown)')
    .requiredOption('-f, --format <formato>', 'formato de la entrada a generar (latex | html | epub | markdown)')
    .requiredOption('-o, --output <path>', 'ruta del .md de salida')
    .option('--slug <slug>', 'slug de salida para nombrar las imágenes procesadas (por defecto se infiere del nombre de -o)')
    .addHelpText(
      'after',
      `
Siempre trabaja sobre los archivos originales de files[], nunca sobre dist/.

Ejemplos:
  iteraciones merge collection.md -f latex -o .iteraciones/collections/c.latex.md
  iteraciones merge collection.md -f html   -o .iteraciones/collections/c.html.md
`,
    )
    .action(async (path: string, opts: { output: string; format: string; slug?: string }) => {
      await runMerge(projectRoot(), path, opts);
    });

  program
    .command('template <tipo>')
    .description('escribe una plantilla de .iteraciones/templates (las que pandoc recibe por --template)')
    .option('-o, --output <path>', 'ruta de la plantilla de salida')
    .addHelpText(
      'after',
      `
Tipos: ${TEMPLATE_KINDS.join(' | ')}

Ejemplos:
  iteraciones template html                 regenera .iteraciones/templates/html.html
  iteraciones template latex -o pl.tex      la misma plantilla en otra ruta
`,
    )
    .action(async (tipo: string, opts: { output?: string }) => {
      await runTemplate(projectRoot(), tipo, opts);
    });

  program
    .command('post <tipo>')
    .description('aplica el post-proceso de iteraciones a una salida cruda de pandoc que recibe por stdin')
    .requiredOption('-o, --output <path>', 'ruta del archivo de salida')
    .option('--post <path>', 'manifiesto .iteraciones/post/<slug>.json (obligatorio en latex)')

    .option('--type <type>', 'type del documento en html: file | collection | creator (por defecto: file)')
    .addHelpText(
      'after',
      `
Tipos: html | latex

Ejemplos:
  pandoc doc.md --to html5 | iteraciones post html -o dist/doc.html
  pandoc doc.md --to latex  | iteraciones post latex --post .iteraciones/post/doc.json -o dist/doc.tex
`,
    )
    .action(async (tipo: string, opts: { output: string; post?: string; type?: string }) => {
      await runPost(projectRoot(), tipo, opts);
    });

  program
    .command('prepare')
    .description('prepara directorios para los comandos externos y deja la plantilla XMP en su slot de latexmk')
    .option('--dir <path>', 'directorio a crear (se puede repetir)', collect, [])
    .option('--xmp <path>', 'slot que recibe la plantilla pdfx.xmp (se puede repetir)', collect, [])
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones prepare --dir dist/files --dir dist/files/css
  iteraciones prepare --dir .iteraciones/tmp/pdf/slot-1 --xmp .iteraciones/tmp/pdf/slot-1
`,
    )
    .action(async (opts: { dir: string[]; xmp: string[] }) => {
      await runPrepare(projectRoot(), opts);
    });

  program
    .command('assets')
    .description('copia al directorio de salida las fuentes del paquete y el logo que referencia el HTML')
    .requiredOption('-o, --output <path>', 'directorio de salida')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones assets -o dist/files
`,
    )
    .action(async (opts: { output: string }) => {
      await runAssets(projectRoot(), opts);
    });

  program
    .command('bundle')
    .description('replica en la salida los insumos del proyecto que un rebuild necesita (config, preamble*, filters, bibliografía)')
    .requiredOption('-o, --output <path>', 'directorio de salida')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones bundle -o dist/files
`,
    )
    .action(async (opts: { output: string }) => {
      await runBundle(projectRoot(), opts);
    });

  program
    .command('markdown <path>')
    .description('escribe el markdown de dist (#2436) con las mismas salidas que usa iteraciones build')
    .requiredOption('-o, --output <path>', 'ruta del .md de salida')
    .addHelpText(
      'after',
      `
Para una collection escribe además las copias de sus miembros junto a la salida.

Ejemplos:
  iteraciones markdown doc.md        -o dist/files/doc-por-autor.md
  iteraciones markdown coleccion.md  -o dist/files/coleccion.md
`,
    )
    .action(async (path: string, opts: { output: string }) => {
      await runMarkdown(projectRoot(), path, opts);
    });

  program
    .command('cover <png>')
    .description('mueve la portada que pdftoppm dejó en su nombre final y retira los residuos')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones cover dist/files/doc.png
`,
    )
    .action(async (png: string) => {
      await runCover(projectRoot(), png);
    });

  const pdf = program.command('pdf').description('operaciones sobre el PDF de trabajo de latexmk');
  pdf
    .command('collect <slot>')
    .description('retira los auxiliares del slot y deja el PDF compilado en su destino')
    .requiredOption('-o, --output <path>', 'ruta del PDF de salida')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones pdf collect .iteraciones/tmp/pdf/slot-1 -o dist/files/doc.pdf
`,
    )
    .action(async (slot: string, opts: { output: string }) => {
      await runCollectPdf(projectRoot(), slot, opts);
    });

  const snapshots = program
    .command('snapshots')
    .description('línea base de regresión visual: imágenes de cada página para comparar contra el build (#2479)');

  snapshots
    .command('check [pdf] [reference]')
    .description('compara los snapshots de <raíz>/snapshots contra el último build, o dos PDFs entre sí, y sale con exit 1 si hay regresión visual')
    .option('--output <path>', 'directorio de salida donde están los PDFs (por defecto: dist/files)')

    .allowExcessArguments(true)
    .addHelpText(
      'after',
      `
Requiere pdftoppm (poppler) y ImageMagick. Compara página por página sobre PNGs de ${DPI} dpi, con
fuzz ${FUZZ_PERCENT} % y umbral ${THRESHOLD_PERCENT} % de píxeles distintos: la comparación es visual y
LaTeX rinde la misma página aunque el PDF cambie de bytes, así que un píxel de diferencia es un cambio.

Sin rutas compara cada PDF de --output contra sus páginas en <raíz>/snapshots/, y avisa de lo que no
encaja: un PDF sin snapshot es un agregado y un snapshot sin PDF es una eliminación; ninguno de los
dos detiene, se revisan. Con dos rutas compara pdf contra referencia y no toca los snapshots. Una sola
ruta es error: no dice contra qué comparar. Los diffs se escriben en <raíz>/diff/, que no se versiona.

Ejemplos:
  iteraciones snapshots check                             compara snapshots/ contra el build
  iteraciones snapshots check nuevo.pdf viejo.pdf         compara dos PDFs, sin snapshots de por medio
`,
    )
    .action(async (_pdf: string | undefined, _reference: string | undefined, opts: SnapshotsOptions, command: Command) => {
      await runSnapshots(projectRoot(), command.args, 'check', opts);
    });

  snapshots
    .command('save [pdf]')
    .description('guarda las páginas de cada PDF de la salida como línea base en snapshots/')
    .option('--output <path>', 'directorio de salida donde están los PDFs (por defecto: dist/files)')

    .allowExcessArguments(true)
    .addHelpText(
      'after',
      `
Las páginas se renderizan a ${DPI} dpi sin difuminar y se guardan en <raíz>/snapshots/ con el camino
aplanado (anexos/index.pdf → anexos--index--page-001.png), y van versionadas en git: son la línea base.
Con una ruta sólo se guarda ese documento y los demás snapshots no se tocan. Sin ruta, la línea base
completa avanza: los snapshots de documentos que ya no están en la salida se retiran, y con ellos los
diffs de <raíz>/diff/, que tampoco se versionan.

No hay build incremental aquí: para saltarse un documento habría que guardar aparte qué había en el
último save, y ese registro puede quedar desfasado sin avisar.

Ejemplos:
  iteraciones snapshots save                        guarda la línea base de todo dist/files
  iteraciones snapshots save dist/files/index.pdf   guarda las páginas de un solo documento
`,
    )
    .action(async (_pdf: string | undefined, opts: SnapshotsOptions, command: Command) => {
      await runSnapshots(projectRoot(), command.args, 'save', opts);
    });

  program
    .command('init')
    .description('crea iteraciones.config.yaml, index.md, bibliography.bib y .gitignore mínimos en el directorio actual')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones init    crea la estructura mínima del proyecto en el directorio actual
`,
    )
    .action(async () => {
      await runInit(projectRoot());
    });

  program
    .command('validate')
    .description('valida iteraciones.config.yaml y el frontmatter de todos los documentos Markdown')
    .option('--json', 'imprime el resultado como JSON en stdout (consumo programático)')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones validate         valida la configuración y el frontmatter del proyecto
  iteraciones validate --json  imprime el resultado como JSON en stdout
`,
    )
    .action(async (opts: { json?: boolean }) => {
      await runValidate(projectRoot(), { json: opts.json });
    });

  program
    .command('preview [paths...]')
    .description('construye el proyecto y vuelve a construirlo con cada cambio; Ctrl+C para salir')
    .option('--verbose', 'muestra información adicional de progreso')
    .addHelpText(
      'after',
      `
No levanta servidor: el build escribe los PDF en la salida y tu visor los muestra.
Un cambio durante un build no se pierde: el build siguiente lo recoge.
Acepta los mismos paths que build.

Ejemplos:
  iteraciones preview                 construye y reconstruye el proyecto entero
  iteraciones preview posts/x.md      reconstruye solo ese documento
  iteraciones preview --verbose       muestra el detalle de cada build
`,
    )
    .action(async (paths: string[], opts: { verbose?: boolean }) => {
      await runPreview(projectRoot(), { verbose: opts.verbose, only: paths.length > 0 ? paths : undefined });
    });

  program
    .command('doctor')
    .description('verifica el entorno de build')
    .option('--info', 'muestra también la configuración del proyecto')
    .option('--json', 'imprime el resultado como JSON en stdout (consumo programático)')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones doctor                verifica pandoc, motor LaTeX y permisos
  iteraciones doctor --info         además, muestra la configuración del proyecto
  iteraciones doctor --json         imprime el resultado como JSON en stdout
  iteraciones doctor --info --json  incluye la configuración en el JSON
`,
    )
    .action(async (opts: { info?: boolean; json?: boolean }) => {
      await runDoctor(projectRoot(), { info: opts.info, json: opts.json });
    });

  program
    .command('new <path>')
    .description(
      'crea un archivo Markdown con frontmatter mínimo (el título se infiere del nombre del archivo, capitalizando cada palabra; usa --title para un título distinto)',
    )
    .option('-t, --title <title>', 'título del documento (por defecto: inferido del nombre del archivo)')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones new posts/mi-articulo.md    crea el archivo con title, date y frontmatter
  iteraciones new --title "Mi artículo" posts/mi-articulo.md   crea el archivo con un título explícito
`,
    )
    .action(async (path: string, opts: { title?: string }) => {
      await runNew(projectRoot(), path, { title: opts.title });
    });

  program
    .command('clean')
    .description('elimina el directorio de salida (dist/) y la caché (.iteraciones)')
    .option('--json', 'imprime el resultado como JSON en stdout (consumo programático)')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones clean         elimina dist/ y .iteraciones/ del proyecto
  iteraciones clean --json  imprime el resultado como JSON en stdout
`,
    )
    .action(async (opts: { json?: boolean }) => {
      await runClean(projectRoot(), { json: opts.json });
    });

  program
    .command('list-filters')
    .description('lista los filters Lua y los filters de preámbulo disponibles con su estado')
    .option('--verbose', 'incluye la descripción completa de cada filtro')
    .option('--json', 'imprime el resultado como JSON en stdout (consumo programático)')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones list-filters         lista filters y preamble filters con su estado
  iteraciones list-filters --json  imprime el resultado como JSON en stdout
`,
    )
    .action((options: { verbose?: boolean; json?: boolean }) => runFilters(projectRoot(), options));

  program
    .command('help [comando]')
    .description('muestra la ayuda de un comando')
    .action((cmdName?: string) => {
      if (cmdName === undefined) {
        program.outputHelp();
        return;
      }
      const target = program.commands.find((c) => c.name() === cmdName);
      if (target === undefined) {
        try {
          program.parse([cmdName], { from: 'user' });
        } catch {}
        process.exitCode = 1;
        return;
      }
      target.outputHelp();
    });

  return program;
}

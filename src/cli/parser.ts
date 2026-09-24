import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { TEMPLATE_KINDS } from '../builder/pipeline-setup.js';
import { runAssets } from './assets.js';
import { runCover } from './cover.js';
import { runBuild, runClean, runDoctor, runFilters, runInit, runNew, runValidate } from './dispatcher.js';
import { runMarkdown } from './markdown.js';
import { runMerge } from './merge.js';
import { runCollectPdf } from './pdf.js';
import { runPost } from './post.js';
import { runPrepare } from './prepare.js';
import { runTemplate } from './template.js';

/** Opción repetible: el build acumula valores, el argv del .sh los repite. */
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

function suggestCommand(name: string, commands: string[]): string | undefined {
  const prefix = name.slice(0, 3);
  const byPrefix = commands.find((c) => c.startsWith(prefix));
  if (byPrefix !== undefined) return byPrefix;
  const distance = (a: string, b: string): number => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const curr: number[] = [i];
      for (let j = 1; j <= b.length; j++) {
        curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = curr;
    }
    return prev[b.length] ?? a.length + b.length;
  };
  return commands.find((c) => distance(c, name) <= 2);
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

Documentación:
  docs/configuration.md     todas las opciones de iteraciones.config.yaml
  docs/ejemplos.md          elementos del lenguaje Markdown soportados
`,
  );
  program.option('--project-root <path>', 'directorio raíz del proyecto (por defecto: directorio actual)');
  program.configureHelp({ showGlobalOptions: true });
  program.configureOutput({ outputError: (str, write) => write(translateCommanderError(str)) });
  program.exitOverride();

  const projectRoot = (): string => program.opts().projectRoot ?? process.cwd();

  program
    .command('build')
    .description('construye los documentos del proyecto a partir de los archivos Markdown')
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
  iteraciones build --verbose      muestra información adicional de progreso
  iteraciones build --json         imprime el resultado como JSON en stdout
`,
    )
    .action(async (opts: { full?: boolean; output?: string; verbose?: boolean; json?: boolean }) => {
      await runBuild(projectRoot(), {
        full: opts.full,
        outputDir: opts.output,
        verbose: opts.verbose,
        json: opts.json,
      });
    });

  program
    .command('merge <path>')
    .description('escribe la entrada exacta de pandoc de una collection en .iteraciones/collections/ (formatos: latex | html | epub | markdown)')
    .requiredOption('-f, --format <formato>', 'formato de la entrada a generar (latex | html | epub | markdown)')
    .requiredOption('-o, --output <path>', 'ruta del .md de salida')
    .addHelpText(
      'after',
      `
Siempre trabaja sobre los archivos originales de files[], nunca sobre dist/.

Ejemplos:
  iteraciones merge collection.md -f latex -o .iteraciones/collections/c.latex.md
  iteraciones merge collection.md -f html   -o .iteraciones/collections/c.html.md
`,
    )
    .action(async (path: string, opts: { output: string; format: string }) => {
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
    .addHelpText(
      'after',
      `
Tipos: html | latex

Ejemplos:
  pandoc doc.md --to html5 | iteraciones post html -o dist/doc.html
  pandoc doc.md --to latex  | iteraciones post latex --post .iteraciones/post/doc.json -o dist/doc.tex
`,
    )
    .action(async (tipo: string, opts: { output: string; post?: string }) => {
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
        const suggestion = suggestCommand(
          cmdName,
          program.commands.map((c) => c.name()).filter((n) => n !== 'help'),
        );
        process.stderr.write(`error: comando desconocido '${cmdName}'${suggestion ? `\n(¿Quisiste decir ${suggestion}?)` : ''}\n`);
        process.exitCode = 1;
        return;
      }
      target.outputHelp();
    });

  return program;
}

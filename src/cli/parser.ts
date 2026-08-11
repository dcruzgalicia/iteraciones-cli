import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { runBuild, runClean, runDoctor, runFilters, runInit, runNew, runOpen, runValidate } from './dispatcher.js';

/**
 * Traduce los mensajes de error conocidos de commander al español.
 * Los mensajes no reconocidos se conservan tal cual.
 */
function translateCommanderError(message: string): string {
  // El mensaje puede traer varias líneas (p. ej. la sugerencia de comandos
  // cercanos en una segunda línea): se traduce línea por línea.
  return message
    .split('\n')
    .map((line) =>
      line
        .replace(/^error: unknown command '([^']+)'$/, "error: comando desconocido '$1'")
        .replace(/^\(Did you mean (.+)\?\)$/, '(¿Quisiste decir $1?)')
        .replace(/^error: option '([^']+)' argument missing$/, "error: falta el argumento de la opción '$1'")
        .replace(/^error: missing required argument '([^']+)'$/, "error: falta el argumento requerido '$1'")
        .replace(/^error: unknown option '([^']+)'$/, "error: opción desconocida '$1'"),
    )
    .join('\n');
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(packageJson.name.replace(/-cli$/, ''))
    .description(packageJson.description)
    .version(packageJson.version, '-V, --version', 'muestra la versión')
    .helpOption('-h, --help', 'muestra la ayuda')
    .helpCommand('help [comando]', 'muestra la ayuda de un comando');
  program.option('--project-root <path>', 'directorio raíz del proyecto (por defecto: directorio actual)');
  // Los errores de uso de commander llegan en inglés: se traducen los 4 casos
  // conocidos (comando/opción desconocida, argumento faltante) con regex; la
  // ayuda y la versión se configuran nativamente en español arriba.
  program.configureOutput({ outputError: (str, write) => write(translateCommanderError(str)) });
  program.exitOverride();

  /** Resuelve el directorio raíz del proyecto: --project-root global o el directorio actual. */
  const projectRoot = (): string => program.opts().projectRoot ?? process.cwd();

  program
    .command('build')
    .description('construye el sitio a partir de los archivos Markdown')
    .option('-c, --concurrency <n>', 'máximo de invocaciones pandoc simultáneas (por defecto: CPU − 1)')
    .option('--full', 'build completo desde cero: elimina la salida anterior y la caché')
    .option('--output <path>', 'directorio de salida (por defecto: dist/files)')
    .option('--dry-run', 'muestra los documentos que se procesarían sin generar salida')
    .option('--verbose', 'muestra información adicional de progreso')
    .option('--profile', 'muestra el tiempo de cada fase del pipeline al final del build')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones build                build incremental (solo archivos modificados)
  iteraciones build --full         build completo desde cero (sin caché)
  iteraciones build --dry-run      muestra los documentos a procesar sin generar salida
  iteraciones build --verbose      muestra información adicional de progreso
`,
    )
    .action(async (opts: { concurrency?: string; full?: boolean; output?: string; dryRun?: boolean; verbose?: boolean; profile?: boolean }) => {
      // La validación de --concurrency y --output ocurre en runBuild, donde
      // los errores se reportan con el formato unificado (sin stack traces).
      await runBuild(projectRoot(), {
        concurrency: opts.concurrency,
        full: opts.full,
        outputDir: opts.output,
        dryRun: opts.dryRun,
        verbose: opts.verbose,
        profile: opts.profile,
      });
    });

  program
    .command('init')
    .description('crea iteraciones.config.yaml, index.md y bibliography.bib mínimos en el directorio actual')
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
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones validate    valida la configuración y el frontmatter del proyecto
`,
    )
    .action(async () => {
      await runValidate(projectRoot());
    });

  program
    .command('doctor')
    .description('verifica el entorno de build')
    .option('--verbose', 'muestra también la configuración del proyecto')
    .option('--json', 'salida en JSON (para scripting)')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones doctor               verifica pandoc, motor LaTeX y permisos
  iteraciones doctor --verbose     además, muestra la configuración del proyecto
  iteraciones doctor --json        toda la información en JSON
`,
    )
    .action(async (opts: { verbose?: boolean; json?: boolean }) => {
      await runDoctor(projectRoot(), { verbose: opts.verbose, json: opts.json });
    });

  program
    .command('new <path>')
    .description('crea un archivo Markdown con frontmatter mínimo')
    .option('-t, --title <title>', 'título del documento (por defecto: inferido del nombre del archivo)')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones new posts/mi-articulo.md    crea el archivo con title, date y frontmatter
  iteraciones new --title "Mi artículo" a.md   crea el archivo con un título explícito
`,
    )
    .action(async (path: string, opts: { title?: string }) => {
      await runNew(projectRoot(), path, { title: opts.title });
    });

  program
    .command('clean')
    .description('elimina el directorio de salida (dist/) y la caché (.iteraciones)')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones clean    elimina dist/ y .iteraciones/ del proyecto
`,
    )
    .action(async () => {
      await runClean(projectRoot());
    });

  program
    .command('filters')
    .description('lista los filtros Lua disponibles y su estado')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones filters    lista filters y preamble filters con su estado
`,
    )
    .action(() => runFilters(projectRoot()));

  program
    .command('open')
    .description('abre la salida generada (index.html) en el navegador por defecto')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones open    abre dist/files/index.html en el navegador
`,
    )
    .action(async () => {
      await runOpen(projectRoot());
    });

  return program;
}

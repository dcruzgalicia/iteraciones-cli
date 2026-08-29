import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { runBuild, runClean, runDoctor, runFilters, runInit, runNew, runValidate } from './dispatcher.js';

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

/**
 * Sugerencia de comando cercano para `help <desconocido>`: coincidencia por
 * prefijo (buil → build) o distancia de edición acotada. Suficiente para el
 * caso de uso; sin dependencia de librerías de distancia.
 */
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
    // El help command nativo de commander imprime el help raíz sin error para
    // un comando desconocido: se sustituye por uno propio que valida el
    // argumento y sugiere comandos cercanos (#2179).
    .helpCommand(false);
  // La descripción vive en el bloque 'before' (slogan + primeros pasos): el
  // .description() de commander la repetiría bajo "Usage" en el help raíz.
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
  // Las opciones globales (--project-root) se muestran también en el help de
  // cada subcomando, no solo en el help raíz.
  program.configureHelp({ showGlobalOptions: true });
  // Los errores de uso de commander llegan en inglés: se traducen los 4 casos
  // conocidos (comando/opción desconocida, argumento faltante) con regex; la
  // ayuda y la versión se configuran nativamente en español arriba.
  program.configureOutput({ outputError: (str, write) => write(translateCommanderError(str)) });
  program.exitOverride();

  /** Resuelve el directorio raíz del proyecto: --project-root global o el directorio actual. */
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
      // La validación de --output y la exclusión mutua --json/--verbose ocurren
      // en runBuild, donde los errores se reportan con el formato unificado
      // (sin stack traces).
      await runBuild(projectRoot(), {
        full: opts.full,
        outputDir: opts.output,
        verbose: opts.verbose,
        json: opts.json,
      });
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
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones doctor               verifica pandoc, motor LaTeX y permisos
  iteraciones doctor --info        además, muestra la configuración del proyecto
`,
    )
    .action(async (opts: { info?: boolean }) => {
      await runDoctor(projectRoot(), { info: opts.info });
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
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones list-filters    lista filters y preamble filters con su estado
`,
    )
    .action((options: { verbose?: boolean }) => runFilters(projectRoot(), options));

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

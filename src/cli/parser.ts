import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { runBuild, runClean, runDoctor, runFilters, runInfo, runInit, runNew, runValidate } from './dispatcher.js';

export function buildProgram(): Command {
  const program = new Command();

  program.name(packageJson.name.replace(/-cli$/, '')).description(packageJson.description).version(packageJson.version);
  program.option('--project-root <path>', 'directorio raíz del proyecto (por defecto: directorio actual)');

  /** Resuelve el directorio raíz del proyecto: --project-root global o el directorio actual. */
  const projectRoot = (): string => program.opts().projectRoot ?? process.cwd();

  program
    .command('build')
    .description('construye el sitio a partir de los archivos Markdown')
    .option('-c, --concurrency <n>', 'máximo de invocaciones pandoc simultáneas (por defecto: CPU − 1)')
    .option('--no-cache', 'omite la caché incremental; siempre hace build completo')
    .option('--output <path>', 'directorio de salida (por defecto: dist/files)')
    .option('--no-css', 'omite la generación de CSS')
    .option('--no-export', 'solo actualiza la caché; no genera ni copia salidas a dist')
    .option('--dry-run', 'muestra los documentos que se procesarían sin generar salida')
    .option('--verbose', 'muestra información adicional de progreso')
    .option('--profile', 'muestra el tiempo de cada fase del pipeline al final del build')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones build                build incremental (solo archivos modificados)
  iteraciones build --no-cache     build completo sin caché
  iteraciones build --dry-run      muestra los documentos a procesar sin generar salida
  iteraciones build --verbose      muestra información adicional de progreso
`,
    )
    .action(
      async (opts: {
        concurrency?: string;
        cache: boolean;
        output?: string;
        css: boolean;
        export: boolean;
        dryRun?: boolean;
        verbose?: boolean;
        profile?: boolean;
      }) => {
        const raw = opts.concurrency;
        const concurrency = raw !== undefined ? Number.parseInt(raw, 10) : undefined;
        if (raw !== undefined && (!Number.isInteger(concurrency) || (concurrency as number) < 1)) {
          throw new Error(`--concurrency debe ser un entero positivo (recibido: "${raw}")`);
        }
        await runBuild(projectRoot(), {
          concurrency: concurrency ? concurrency : undefined,
          noCache: !opts.cache,
          outputDir: opts.output,
          noCss: !opts.css,
          noExport: !opts.export,
          dryRun: opts.dryRun,
          verbose: opts.verbose,
          profile: opts.profile,
        });
      },
    ),
    program
      .command('info')
      .description('muestra información del proyecto y configuración')
      .addHelpText(
        'after',
        `
Ejemplos:
  iteraciones info    muestra idioma, salida, pandoc y formatos activos
`,
      )
      .action(() => runInfo(projectRoot()));

  program
    .command('init')
    .description('crea iteraciones.config.yaml, README.md y bibliography.bib mínimos en el directorio actual')
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
    .option('--fix', 'intenta corregir automáticamente los problemas detectados')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones doctor         verifica pandoc, pdflatex, Tailwind y permisos
  iteraciones doctor --fix   intenta corregir los problemas automáticamente
`,
    )
    .action(async (opts: { fix?: boolean }) => {
      await runDoctor(projectRoot(), { fix: opts.fix });
    });

  program
    .command('new <path>')
    .description('crea un archivo Markdown con frontmatter mínimo')
    .addHelpText(
      'after',
      `
Ejemplos:
  iteraciones new posts/mi-articulo.md    crea el archivo con title, date y frontmatter
`,
    )
    .action(async (path: string) => {
      await runNew(projectRoot(), path);
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

  return program;
}

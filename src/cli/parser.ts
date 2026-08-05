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
    .option('--no-export', 'omite la exportación PDF/EPUB aunque esté configurada')
    .option('--dry-run', 'muestra los documentos que se procesarían sin generar salida')
    .option('--verbose', 'muestra información adicional de progreso')
    .action(
      async (opts: { concurrency?: string; cache: boolean; output?: string; css: boolean; export: boolean; dryRun?: boolean; verbose?: boolean }) => {
        const concurrency = opts.concurrency !== undefined ? Number.parseInt(opts.concurrency, 10) : undefined;
        await runBuild(projectRoot(), {
          concurrency: Number.isInteger(concurrency) ? concurrency : undefined,
          noCache: !opts.cache,
          outputDir: opts.output,
          noCss: !opts.css,
          noExport: !opts.export,
          dryRun: opts.dryRun,
          verbose: opts.verbose,
        });
      },
    ),
    program
      .command('info')
      .description('muestra información del proyecto y configuración')
      .action(() => runInfo(projectRoot()));

  program
    .command('init')
    .description('crea iteraciones.config.yaml y README.md mínimos en el directorio actual')
    .action(async () => {
      await runInit(projectRoot());
    });

  program
    .command('validate')
    .description('valida iteraciones.config.yaml y el frontmatter de todos los documentos Markdown')
    .action(async () => {
      await runValidate(projectRoot());
    });

  program
    .command('doctor')
    .description('verifica el entorno de build')
    .action(async () => {
      await runDoctor(projectRoot());
    });

  program
    .command('new <path>')
    .description('crea un archivo Markdown con frontmatter mínimo')
    .action(async (path: string) => {
      await runNew(projectRoot(), path);
    });

  program
    .command('clean')
    .description('elimina el directorio de salida (dist/) y la caché (.iteraciones)')
    .action(async () => {
      await runClean(projectRoot());
    });

  program
    .command('filters')
    .description('lista los filtros Lua disponibles y su estado')
    .action(() => runFilters(projectRoot()));

  return program;
}

import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { runBuild, runClean, runDoctor, runInfo, runInit, runNew, runTranspilers, runValidate } from './dispatcher.js';

export function buildProgram(): Command {
  const program = new Command();

  program.name(packageJson.name.replace(/-cli$/, '')).description(packageJson.description).version(packageJson.version);
  program.option('--project-root <path>', 'directorio raíz del proyecto (por defecto: directorio actual)');

  /** Resuelve el directorio raíz del proyecto: --project-root global o el directorio actual. */
  const projectRoot = (): string => program.opts().projectRoot ?? process.cwd();

  program
    .command('build')
    .description('construye el sitio a partir de los archivos Markdown')
    .option('-c, --concurrency <n>', 'máximo de invocaciones pandoc simultáneas', '4')
    .option('--no-cache', 'omite la caché incremental; siempre hace build completo')
    .option('--output <path>', 'directorio de salida (por defecto: dist/www si html.generate:true, dist/documents si no)')
    .option('--no-tailwind', 'omite la generación de CSS con Tailwind')
    .option('--no-export', 'omite la exportación PDF/EPUB aunque esté configurada')
    .option('--dry-run', 'muestra los documentos que se procesarían sin generar salida')
    .option('--verbose', 'muestra información adicional de progreso')
    .action(
      async (opts: {
        concurrency: string;
        cache: boolean;
        output?: string;
        tailwind: boolean;
        export: boolean;
        dryRun?: boolean;
        verbose?: boolean;
      }) => {
        const concurrency = Number.parseInt(opts.concurrency, 10);
        await runBuild(projectRoot(), {
          concurrency: Number.isInteger(concurrency) ? concurrency : undefined,
          noCache: !opts.cache,
          outputDir: opts.output,
          noTailwind: !opts.tailwind,
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
    .description('crea _iteraciones.yaml y README.md mínimos en el directorio actual')
    .action(async () => {
      await runInit(projectRoot());
    });

  program
    .command('validate')
    .description('valida _iteraciones.yaml y el frontmatter de todos los documentos Markdown')
    .action(async () => {
      await runValidate(projectRoot());
    });

  program
    .command('doctor')
    .description('verifica el entorno de build y opcionalmente corrige problemas')
    .option('--fix', 'intenta corregir automáticamente los problemas detectados')
    .action(async (opts: { fix?: boolean }) => {
      await runDoctor(projectRoot(), { fix: opts.fix });
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
    .command('transpilers')
    .description('lista los transpilers disponibles con su tipo y descripción')
    .action(() => runTranspilers(projectRoot()));

  return program;
}

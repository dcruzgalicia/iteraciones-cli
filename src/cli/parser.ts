import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { runBuild, runClean, runInfo, runInit, runServe, runWatch } from './dispatcher.js';

export function buildProgram(): Command {
  const program = new Command();

  program.name(packageJson.name.replace(/-cli$/, '')).description(packageJson.description).version(packageJson.version);

  program
    .command('build')
    .description('construye el sitio a partir de los archivos Markdown')
    .option('-c, --concurrency <n>', 'máximo de invocaciones pandoc simultáneas', '4')
    .option('--no-cache', 'omite la caché incremental; siempre hace build completo')
    .option('--project-root <path>', 'directorio raíz del proyecto (por defecto: directorio actual)')
    .option('--no-tailwind', 'omite la generación de CSS con Tailwind')
    .option('--dry-run', 'muestra los documentos que se procesarían sin generar salida')
    .option('--verbose', 'muestra información adicional de progreso')
    .action(async (opts: { concurrency: string; cache: boolean; projectRoot?: string; tailwind: boolean; dryRun?: boolean; verbose?: boolean }) => {
      const concurrency = Number.parseInt(opts.concurrency, 10);
      if (!Number.isInteger(concurrency) || concurrency < 1) {
        process.stderr.write(`Error: --concurrency debe ser un entero positivo (recibido: "${opts.concurrency}")\n`);
        process.exitCode = 1;
        return;
      }
      await runBuild(opts.projectRoot ?? process.cwd(), {
        concurrency,
        noCache: !opts.cache,
        noTailwind: !opts.tailwind,
        dryRun: opts.dryRun,
        verbose: opts.verbose,
      });
    });

  program
    .command('clean')
    .description('elimina el directorio de salida y la caché')
    .action(() => runClean(process.cwd()));

  program
    .command('info')
    .description('muestra información del proyecto y configuración')
    .action(() => runInfo(process.cwd()));

  program
    .command('init')
    .description('crea _iteraciones.yaml y README.md mínimos en el directorio actual')
    .action(async () => {
      await runInit(process.cwd());
    });

  program
    .command('watch')
    .description('observa cambios y reconstruye el sitio sin servidor HTTP')
    .option('--verbose', 'muestra información adicional de progreso')
    .action(async (opts: { verbose?: boolean }) => {
      const stop = await runWatch(process.cwd(), { verbose: opts.verbose });
      const shutdown = (): void => {
        stop();
        process.exitCode = 0;
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });

  program
    .command('serve')
    .description('arranca un servidor HTTP con livereload automático')
    .option('-p, --port <n>', 'puerto del servidor', '3000')
    .action((opts: { port: string }) => {
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        process.stderr.write(`Error: el puerto debe ser un entero entre 1 y 65535 (recibido: "${opts.port}")\n`);
        process.exitCode = 1;
        return;
      }
      runServe(process.cwd(), port);
    });

  return program;
}

import { isAbsolute, normalize } from 'node:path';
import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { runBuild, runClean, runDoctor, runGraph, runInfo, runInit, runNew, runTranspilers, runValidate } from './dispatcher.js';

export function buildProgram(): Command {
  const program = new Command();

  program.name(packageJson.name.replace(/-cli$/, '')).description(packageJson.description).version(packageJson.version);

  program
    .command('build')
    .description('construye el sitio a partir de los archivos Markdown')
    .option('-c, --concurrency <n>', 'máximo de invocaciones pandoc simultáneas', '4')
    .option('--no-cache', 'omite la caché incremental; siempre hace build completo')
    .option('--project-root <path>', 'directorio raíz del proyecto (por defecto: directorio actual)')
    .option('--output <path>', 'directorio de salida (por defecto: dist/www si html.generate:true, dist/documents si no)')
    .option('--no-tailwind', 'omite la generación de CSS con Tailwind')
    .option('--no-export', 'omite la exportación PDF/EPUB aunque esté configurada')
    .option('--dry-run', 'muestra los documentos que se procesarían sin generar salida')
    .option('--verbose', 'muestra información adicional de progreso')
    .action(
      async (opts: {
        concurrency: string;
        cache: boolean;
        projectRoot?: string;
        output?: string;
        tailwind: boolean;
        export: boolean;
        dryRun?: boolean;
        verbose?: boolean;
      }) => {
        const concurrency = Number.parseInt(opts.concurrency, 10);
        if (!Number.isInteger(concurrency) || concurrency < 1) {
          process.stderr.write(`Error: --concurrency debe ser un entero positivo (recibido: "${opts.concurrency}")\n`);
          process.exitCode = 1;
          return;
        }
        if (opts.output !== undefined) {
          const normalized = normalize(opts.output);
          // Rechazar rutas relativas con escalada de directorio o la raíz absoluta.
          // clean() borra el directorio antes del build; un path incorrecto puede
          // eliminar el proyecto o directorios del sistema.
          if ((!isAbsolute(normalized) && normalized.startsWith('..')) || normalized === '/') {
            process.stderr.write(`Error: --output no puede apuntar fuera del proyecto o a la raíz del sistema (recibido: "${opts.output}")\n`);
            process.exitCode = 1;
            return;
          }
          // Rechazar rutas absolutas que sean igual o ancestro del directorio del proyecto.
          // clean() borra outputDir antes del build; apuntar a un ancestro del cwd
          // eliminaría los archivos fuente del proyecto.
          if (isAbsolute(normalized)) {
            const projectRoot = normalize(opts.projectRoot ?? process.cwd());
            if (projectRoot === normalized || projectRoot.startsWith(normalized + '/')) {
              process.stderr.write(
                `Error: --output "${opts.output}" es un directorio padre del proyecto; ejecutar clean() borraría los archivos fuente.\n`,
              );
              process.exitCode = 1;
              return;
            }
          }
        }
        await runBuild(opts.projectRoot ?? process.cwd(), {
          concurrency,
          noCache: !opts.cache,
          outputDir: opts.output,
          noTailwind: !opts.tailwind,
          noExport: !opts.export,
          dryRun: opts.dryRun,
          verbose: opts.verbose,
        });
      },
    );

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
    .command('validate')
    .description('valida _iteraciones.yaml y el frontmatter de todos los documentos Markdown')
    .option('--project-root <path>', 'directorio raíz del proyecto (por defecto: directorio actual)')
    .action(async (opts: { projectRoot?: string }) => {
      await runValidate(opts.projectRoot ?? process.cwd());
    });

  program
    .command('doctor')
    .description('verifica el entorno de build y opcionalmente corrige problemas')
    .option('--fix', 'intenta corregir automáticamente los problemas detectados')
    .action(async (opts: { fix?: boolean }) => {
      await runDoctor(process.cwd(), { fix: opts.fix });
    });

  program
    .command('new <type> <path>')
    .description('crea un archivo Markdown con el frontmatter mínimo para el tipo indicado')
    .option('--region <region>', 'región del bloque (solo para documentos de tipo bloque)')
    .action(async (type: string, path: string, opts: { region?: string }) => {
      await runNew(process.cwd(), type, path, { region: opts.region });
    });

  program
    .command('transpilers')
    .description('lista los transpilers disponibles con su tipo y descripción')
    .action(() => runTranspilers(process.cwd()));

  program
    .command('graph')
    .description('emite el grafo de relaciones entre documentos en formato JSON')
    .option('--output <path>', 'escribe el JSON en este archivo en lugar de stdout')
    .option('--project-root <path>', 'directorio raíz del proyecto (por defecto: directorio actual)')
    .action(async (opts: { output?: string; projectRoot?: string }) => {
      await runGraph(opts.projectRoot ?? process.cwd(), { output: opts.output });
    });

  return program;
}

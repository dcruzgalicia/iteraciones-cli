import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { runBuild, runClean, runInfo, runServe } from './dispatcher.js';

export function buildProgram(): Command {
  const program = new Command();

  program.name(packageJson.name.replace(/-cli$/, '')).description(packageJson.description).version(packageJson.version);

  program
    .command('build')
    .description('construye el sitio a partir de los archivos Markdown')
    .action(() => runBuild(process.cwd()));

  program.command('clean').description('elimina el directorio de salida y la caché').action(runClean);

  program.command('info').description('muestra información del proyecto y configuración').action(runInfo);

  program
    .command('serve')
    .description('arranca un servidor HTTP con livereload automático')
    .option('-p, --port <n>', 'puerto del servidor', '3000')
    .action((opts: { port: string }) => runServe(process.cwd(), Number(opts.port)));

  return program;
}

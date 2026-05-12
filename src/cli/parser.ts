import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };

export function buildProgram(): Command {
  const program = new Command();

  program.name(packageJson.name.replace(/-cli$/, '')).description(packageJson.description).version(packageJson.version);

  program
    .command('build')
    .description('construye el sitio a partir de los archivos Markdown')
    .action(() => {
      // stub: conectado al orchestrator en issue #32
    });

  program
    .command('clean')
    .description('elimina el directorio de salida y la caché')
    .action(() => {
      // stub: implementado en issue #60
    });

  program
    .command('info')
    .description('muestra información del proyecto y configuración')
    .action(() => {
      // stub: implementado en issue #60
    });

  return program;
}

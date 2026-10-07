import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { execPandoc } from '../../lib/pandoc-runner.js';

const FLAGS = join(import.meta.dir, '../../lib/resources/filters/internal/flags.lua');

let flagsTemplate = '';
let bib = '';

export function setFlagsContext(template: string, bibliography: string): void {
  flagsTemplate = template;
  bib = bibliography;
}

const PAGE_COMMAND = '--metadata=page-number-command:\\ofoot*{\\pagemark}';

interface FlagsWorld {
  markdown: string;
  output: string;
}

const world: FlagsWorld = { markdown: '', output: '' };

async function run(to: 'latex' | 'html5', extra: string[]): Promise<string> {
  return execPandoc({
    input: world.markdown,
    sourcePath: 'test.md',
    to,
    extraArgs: ['--template', flagsTemplate, '--lua-filter', FLAGS, ...extra],
  });
}

Given('un cuerpo con una cita a una clave de la bibliografía', () => {
  world.markdown = 'Cita [@key1].';
});

Given('un cuerpo sin citas', () => {
  world.markdown = 'Texto.';
});

Given('un cuerpo con una cita a una clave que no existe', () => {
  world.markdown = 'Cita rota [@no-existe-key].';
});

Given('un cuerpo que empieza con un título', () => {
  world.markdown = '# Título\n\nPrimer párrafo.';
});

Given('un cuerpo con un part, un chapter y un section seguidos', () => {
  world.markdown = '\\part{Uno}\n\\chapter{Dos}\n\\section{Tres}\n\nTexto.';
});

When('lo convierto con el filtro de flags y la bibliografía', async () => {
  world.output = await run('latex', ['--biblatex', '--bibliography', bib]);
});

When('lo convierto con el filtro de flags sin bibliografía', async () => {
  world.output = await run('latex', []);
});

When('lo convierto con el filtro de flags y el comando de página', async () => {
  world.output = await run('latex', [PAGE_COMMAND]);
});

When('lo convierto a HTML con el filtro de flags y la bibliografía', async () => {
  world.output = await run('html5', ['--citeproc', '--bibliography', bib]);
});

Then('el .tex imprime la bibliografía', () => {
  if (!world.output.includes('\\printbibliography[heading=bibintoc]')) {
    throw new Error('esperaba \\printbibliography[heading=bibintoc]');
  }
});

Then('el .tex no imprime la bibliografía', () => {
  if (world.output.includes('\\printbibliography')) throw new Error('el .tex no debía imprimir la bibliografía');
});

Then('el comando de página va después del encabezado', () => {
  const header = world.output.indexOf('\\section{Título}');
  const command = world.output.indexOf('\\ofoot*{\\pagemark}');
  if (header < 0) throw new Error('el .tex no tiene el encabezado del título');
  if (command < 0) throw new Error('el .tex no tiene el comando de página');
  if (command <= header) throw new Error(`el comando de página (${command}) debe ir después del encabezado (${header})`);
});

Then('el comando de página va entre el part y el section', () => {
  const part = world.output.indexOf('\\part{Uno}');
  const command = world.output.indexOf('\\ofoot*{\\pagemark}');
  const section = world.output.indexOf('\\section{Tres}');
  if (part < 0) throw new Error('el .tex no tiene el part');
  if (command <= part) throw new Error(`el comando (${command}) debe ir después del part (${part})`);
  if (section < 0) throw new Error('el .tex no tiene el section');
  if (command >= section) throw new Error(`el comando (${command}) debe ir antes del section (${section})`);
});

Then('el HTML trae el heading de referencias', () => {
  if (!world.output.includes('id="refs-heading"')) throw new Error('el HTML no trae el heading de referencias');
});

Then('el HTML no trae el heading de referencias', () => {
  if (world.output.includes('refs-heading')) throw new Error('el HTML no debía traer el heading de referencias');
});

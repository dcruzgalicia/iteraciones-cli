import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { execPandoc } from '../../lib/pandoc-runner.js';
import { world } from './cli-world.steps.ts';

const FILTER = join(import.meta.dir, '..', '..', 'lib', 'resources', 'filters', 'semantic', 'ast', '03-qr-url.lua');

const procesados = (): string[] => {
  try {
    return readdirSync(join(world.root, '.iteraciones', 'processed-images')).sort();
  } catch {
    return [];
  }
};

async function render(md: string): Promise<string> {
  return execPandoc({
    input: md,
    sourcePath: join(world.root, 'doc.md'),
    to: 'latex',
    extraArgs: ['--lua-filter', FILTER],
  });
}

Given('un QR cuya URL lleva &', () => {
  world.qrMarkdown = '[https://x.com/a?b=1&c=2]{.qr width="15mm"}\n';
});

Given('un QR cuya URL lleva un punto y coma', () => {
  world.marcadorPwned = join(world.root, 'pwned.txt');
  world.qrMarkdown = `[https://x.com/a;touch ${world.marcadorPwned}]{.qr width="15mm"}\n`;
});

When('renderizo el documento', async () => {
  world.texQr = await render(world.qrMarkdown as string);
});

When('vuelvo a renderizar el mismo documento', async () => {
  world.texQr = await render(world.qrMarkdown as string);
});

Given('dejo un sentinel en el JPG del QR', () => {
  const archivos = procesados();
  const jpg = join(world.root, '.iteraciones', 'processed-images', archivos[0] ?? '');
  writeFileSync(jpg, 'SENTINEL');
  world.rutaJpgQr = jpg;
});

Then('la carpeta de procesados tiene exactamente {int} archivo', (cuantos: number) => {
  const hay = procesados().length;
  if (hay !== cuantos) throw new Error(`hay ${hay} archivos y el escenario dice ${cuantos}: ${JSON.stringify(procesados())}`);
});

Then('el único archivo es un QR en JPG', () => {
  const unico = procesados()[0] ?? '';
  if (!unico.startsWith('qr-')) throw new Error(`el archivo es ${JSON.stringify(unico)} y no empieza por qr-`);
  if (!unico.endsWith('.jpg')) throw new Error(`el archivo es ${JSON.stringify(unico)} y no termina en .jpg`);
});

Then('el LaTeX apunta al JPG generado', () => {
  const unico = procesados()[0] ?? '';
  const ruta = join(world.root, '.iteraciones', 'processed-images', unico);
  if (!String(world.texQr).includes(ruta)) {
    throw new Error(`el LaTeX no apunta a ${ruta}:\n${String(world.texQr).slice(0, 300)}`);
  }
});

Then('el sentinel sigue intacto', () => {
  if (readFileSync(world.rutaJpgQr as string, 'utf8') !== 'SENTINEL') {
    throw new Error('el QR se regeneró: la caché por URL no está funcionando');
  }
});

Then('el marcador de inyección NO existe', () => {
  if (existsSync(world.marcadorPwned as string)) {
    throw new Error('la URL llegó al shell: el marcador se creó');
  }
});

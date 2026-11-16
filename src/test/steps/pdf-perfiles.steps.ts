import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { resolvePdfCheckBinary, validatePdfX1a } from '../../builder/pdfx-check.js';
import { runBuild } from '../../cli/dispatcher.js';
import { capture, escribirEnProyecto, raiz, world } from './cli-world.steps.js';

function pdfPath(): string {
  const dir = join(world.root, 'dist', 'files');
  const pdf = readdirSync(dir).find((archivo) => archivo.endsWith('.pdf'));
  if (pdf === undefined) throw new Error('el build no generó ningún PDF');
  return join(dir, pdf);
}

function imagenesPdf(): string[] {
  const dir = join(world.root, 'dist', 'files', 'assets', 'pdf', 'images');
  return readdirSync(dir).map((archivo) => join(dir, archivo));
}

Given('un proyecto con PDF y una imagen de 5 cm', () => {
  raiz();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    [
      'language: es-MX',
      'format:',
      '  latex:',
      '    generate: true',
      '  pdf:',
      '    generate: true',
      '    disabledPreambleFilters:',
      '      - 97-eso-pic',
      '      - 98-crop',
    ].join('\n'),
  );
  const creada = Bun.spawnSync(['magick', '-size', '1200x900', 'gradient:red-blue', join(world.root, 'foto.png')]);
  if (creada.exitCode !== 0) throw new Error('magick no pudo crear la imagen de prueba');
  escribirEnProyecto('doc.md', '---\ntitle: Prueba cm\n---\n\n![Foto](foto.png){width=5cm}\n');
});

Given('el proyecto desactiva PDFX', () => {
  const configPath = join(world.root, 'iteraciones.config.yaml');
  writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n      - 99-pdfx\n`);
});

When('compilo el proyecto PDF', async () => {
  await capture(() => runBuild(world.root, { full: true }));
  if (world.exitCode !== 0) throw new Error(`el build PDF falló: ${world.stderr}`);
});

Then('el PDF conserva la imagen a 300 dpi y 591 px de ancho', () => {
  const resultado = Bun.spawnSync(['pdfimages', '-list', pdfPath()]);
  if (resultado.exitCode !== 0) throw new Error(`pdfimages falló: ${resultado.stderr.toString()}`);
  const linea = resultado.stdout
    .toString()
    .split('\n')
    .find((fila) => /\simage\s/.test(fila));
  if (linea === undefined) throw new Error('el PDF no tiene imágenes');
  const campos = linea.trim().split(/\s+/);
  const ancho = Number(campos[3]);
  const xppi = Number(campos[12]);
  const yppi = Number(campos[13]);
  if (ancho !== 591 || xppi !== 300 || yppi !== 300) {
    throw new Error(`la imagen va a ${ancho}px y ${xppi}x${yppi} dpi; esperaba 591px y 300x300 dpi`);
  }
});

Then('el PDF pasa la validación PDFX-1a', async () => {
  const binario = await resolvePdfCheckBinary();
  if (binario === null) {
    if (!world.stdout.includes('Validación PDF/X-1a')) {
      throw new Error('no se encontró el binario de pdfcheck y el build no reportó la validación PDFX-1a');
    }
    return;
  }
  const check = await validatePdfX1a(pdfPath(), binario);
  if (!check.valid) throw new Error(`el PDF no certifica PDFX-1a: ${JSON.stringify(check)}`);
});

Then('las imágenes del PDF pesan menos de 25 KB', () => {
  const imagenes = imagenesPdf();
  if (imagenes.length === 0) throw new Error('el PDF no tiene imágenes en assets/pdf/images');
  for (const imagen of imagenes) {
    const bytes = statSync(imagen).size;
    if (bytes > 25 * 1024) throw new Error(`${imagen} pesa ${bytes} bytes y debía pesar menos de 25 KB`);
  }
});

Then('el PDF pesa menos de {int} KB', (kb: number) => {
  const bytes = statSync(pdfPath()).size;
  if (bytes >= kb * 1024) throw new Error(`el PDF pesa ${bytes} bytes y debía pesar menos de ${kb} KB`);
});

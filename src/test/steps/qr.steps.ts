import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { execPandoc } from '../../lib/pandoc-runner.js';
import { world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — la URL del QR ya no pasa por el shell (#2457).
 *
 * ## La regresión: `&` partía la línea y el QR desaparecía
 *
 * Antes la URL se interpolaba en `io.popen('echo ' .. url …)`. Un `&` —que es lo
 * normal en cualquier URL con más de un parámetro— partía la línea de shell y el
 * QR se iba en silencio. Sin imagen, sin error, sin aviso: el LaTeXVYcompilaba y
 * el QR no salía.
 *
 * ## Y el `;` era inyección de comandos
 *
 * La URL venía del frontmatter, o sea de quien escribe el documento. Con
 * `[https://x.com/a;touch /tmp/pwned.txt]` el `;` cierra el comando y el
 * segundo se ejecuta. Por eso la URL va por stdin a `pandoc.pipe`, nunca por el
 * shell, y este escenario lo comprueba dejando un marcador que, si se ejecutara
 * algo, existiría.
 *
 * ## La caché es por URL, no por documento
 *
 * El nombre es `qr-<md5(url)>.jpg`: el mismo QR en dos documentos se genera una
 * vez. Y si ya está, no se regenera — si se regenerara, se perdería el
 * `sentinel` del escenario, que es justo lo que se comprueba.
 */

const FILTER = join(import.meta.dir, '..', '..', 'lib', 'resources', 'filters', 'semantic', 'ast', '03-qr-url.lua');

const procesados = (): string[] => {
  try {
    return readdirSync(join(world.root, '.iteraciones', 'processed-images')).sort();
  } catch {
    return [];
  }
};

/** Renderiza el markdown con el filtro de QR, como lo hace el build. */
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
  // La URL lleva un comando detrás del `;`: si llegara al shell, el marcador
  // aparecería. Se construye aquí porque el texto del paso no admite `;`.
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

/** Si se regenerara, el sentinel se pisaría. */
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

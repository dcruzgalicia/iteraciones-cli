import { join } from 'node:path';
import { Then, When } from '@cucumber/cucumber';

let css = '';

const BREAKPOINTS: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

function bloque(utilidad: string): string {
  const inicio = css.indexOf(`@utility ${utilidad} {`);
  if (inicio === -1) throw new Error(`no se encontró @utility ${utilidad}`);
  const siguiente = css.indexOf('\n@utility', inicio + 1);
  return css.slice(inicio, siguiente === -1 ? undefined : siguiente);
}

function base(utilidad: string): string {
  const texto = bloque(utilidad);
  const media = texto.indexOf('@media');
  return media === -1 ? texto : texto.slice(0, media);
}

function media(utilidad: string, breakpoint: string): string {
  const texto = bloque(utilidad);
  let desde = 0;
  while (true) {
    const inicio = texto.indexOf(`@media (min-width: ${BREAKPOINTS[breakpoint]}px)`, desde);
    if (inicio === -1) return '';
    const siguiente = texto.indexOf('@media', inicio + 1);
    const bloqueMedia = texto.slice(inicio, siguiente === -1 ? undefined : siguiente);
    if (bloqueMedia.includes('grid-template-columns')) return bloqueMedia;
    desde = inicio + 1;
  }
}

function columnas(fragmento: string): number | undefined {
  return /grid-template-columns:\s*repeat\((\d+),/.exec(fragmento)?.[1] !== undefined
    ? Number(/grid-template-columns:\s*repeat\((\d+),/.exec(fragmento)?.[1])
    : undefined;
}

When('leo las utilidades de grid', async () => {
  css = await Bun.file(join(import.meta.dir, '../../lib/resources/styles.css')).text();
});

Then('{word} usa {int} columna base', (utilidad: string, cantidad: number) => {
  const leidas = columnas(base(utilidad));
  if (leidas !== cantidad) throw new Error(`${utilidad} usa ${leidas ?? 'sin columnas'} en base y debía usar ${cantidad}`);
});

Then('{word} usa {int} columna en {word}', (utilidad: string, cantidad: number, breakpoint: string) => {
  const leidas = columnas(media(utilidad, breakpoint));
  if (leidas !== cantidad) {
    throw new Error(`${utilidad} usa ${leidas ?? 'sin columnas'} en ${breakpoint} y debía usar ${cantidad}`);
  }
});

Then('{word} usa {int} columnas en {word}', (utilidad: string, cantidad: number, breakpoint: string) => {
  const leidas = columnas(media(utilidad, breakpoint));
  if (leidas !== cantidad) {
    throw new Error(`${utilidad} usa ${leidas ?? 'sin columnas'} en ${breakpoint} y debía usar ${cantidad}`);
  }
});

Then('{word} no define 3 columnas en {word}', (utilidad: string, breakpoint: string) => {
  const leidas = columnas(media(utilidad, breakpoint));
  if (leidas === 3) throw new Error(`${utilidad} usa 3 columnas en ${breakpoint} y no debería`);
});

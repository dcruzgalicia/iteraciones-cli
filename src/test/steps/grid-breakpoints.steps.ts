import { join } from 'node:path';
import { Then, When } from '@cucumber/cucumber';

let css = '';

const BREAKPOINTS: Record<string, number> = {
  sm: 640,
  md: 960,
  lg: 1280,
  xl: 1600,
};

function bloque(utilidad: string): string {
  const inicio = css.indexOf(`.${utilidad} {`);
  if (inicio === -1) throw new Error(`no se encontró .${utilidad}`);
  const siguiente = css.indexOf('\n.', inicio + 1);
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

function mediaFragment(utilidad: string, breakpoint: string): string {
  const texto = bloque(utilidad);
  const inicio = texto.indexOf(`@media (min-width: ${BREAKPOINTS[breakpoint]}px)`);
  if (inicio === -1) return '';
  const siguiente = texto.indexOf('@media', inicio + 1);
  return texto.slice(inicio, siguiente === -1 ? undefined : siguiente);
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

Then('la portada de la cabecera mide hasta {int}px y está centrada', (maximo: number) => {
  const fragmento = base('portada');
  if (!fragmento.includes(`max-width: ${maximo}px`)) {
    throw new Error(`la portada no se limita a ${maximo}px: ${fragmento}`);
  }
  if (!fragmento.includes('justify-self: center')) {
    throw new Error(`la portada no está centrada: ${fragmento}`);
  }
});

Then('la cabecera con portada tiene {int} columnas en {word}', (cantidad: number, breakpoint: string) => {
  const leidas = columnas(media('cabecera-cuerpo', breakpoint));
  if (leidas !== cantidad) {
    throw new Error(`la cabecera usa ${leidas ?? 'sin columnas'} en ${breakpoint} y debía usar ${cantidad}`);
  }
});

Then('la portada de la cabecera ocupa el 100% en {word}', (breakpoint: string) => {
  const fragmento = `${base('portada')}\n${mediaFragment('portada', breakpoint)}`;
  if (!fragmento.includes('width: 100%')) {
    throw new Error(`la portada no ocupa el 100% en ${breakpoint}: ${fragmento}`);
  }
  if (!fragmento.includes('max-width: none')) {
    throw new Error(`la portada conserva su límite en ${breakpoint}: ${fragmento}`);
  }
});

Then('el contenido de la cabecera ocupa {int} columnas en {word}', (cantidad: number, breakpoint: string) => {
  const fragmento = media('cabecera-cuerpo', breakpoint);
  if (!fragmento.includes('.cabecera-contenido') || !fragmento.includes(`grid-column: span ${cantidad}`)) {
    throw new Error(`el contenido de la cabecera no ocupa ${cantidad} columnas en ${breakpoint}: ${fragmento}`);
  }
});

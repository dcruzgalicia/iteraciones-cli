import { join } from 'node:path';
import { Then, When } from '@cucumber/cucumber';
import { bloqueDesde, reglaDe } from '../css.js';

let css = '';

const BREAKPOINTS: Record<string, number> = {
  sm: 640,
  '800': 800,
  md: 960,
  '1120': 1120,
  lg: 1280,
  xl: 1600,
};

function breakpointPx(breakpoint: string): number {
  const px = BREAKPOINTS[breakpoint];
  if (px === undefined) throw new Error(`breakpoint desconocido: ${breakpoint}`);
  return px;
}

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
    const inicio = texto.indexOf(`@media (min-width: ${breakpointPx(breakpoint)}px)`, desde);
    if (inicio === -1) return '';
    const siguiente = texto.indexOf('@media', inicio + 1);
    const bloqueMedia = texto.slice(inicio, siguiente === -1 ? undefined : siguiente);
    if (bloqueMedia.includes('grid-template-columns')) return bloqueMedia;
    desde = inicio + 1;
  }
}

function mediaFragment(utilidad: string, breakpoint: string): string {
  const texto = bloque(utilidad);
  const inicio = texto.indexOf(`@media (min-width: ${breakpointPx(breakpoint)}px)`);
  if (inicio === -1) return '';
  const siguiente = texto.indexOf('@media', inicio + 1);
  return texto.slice(inicio, siguiente === -1 ? undefined : siguiente);
}

function mediaRango(min: number, max: number, selector: string): string {
  const needle = `@media (min-width: ${min}px) and (max-width: ${max}px)`;
  let desde = 0;
  while (true) {
    const inicio = css.indexOf(needle, desde);
    if (inicio === -1) return '';
    const bloqueMedia = bloqueDesde(css, inicio);
    if (bloqueMedia.contenido.includes(selector)) return bloqueMedia.contenido;
    desde = bloqueMedia.fin;
  }
}

function mediaGlobal(px: number, selector: string): string {
  let desde = 0;
  while (true) {
    const inicio = css.indexOf(`@media (min-width: ${px}px)`, desde);
    if (inicio === -1) return '';
    const bloqueMedia = bloqueDesde(css, inicio);
    if (bloqueMedia.contenido.includes(selector)) return bloqueMedia.contenido;
    desde = bloqueMedia.fin;
  }
}

function mediaHasta(px: number, selector: string): string {
  for (const candidato of [1600, 1280, 960, 640]) {
    if (candidato > px) continue;
    const encontrado = mediaGlobal(candidato, selector);
    if (encontrado !== '') return encontrado;
  }
  return '';
}

function columnas(fragmento: string): number | undefined {
  return /grid-template-columns:\s*repeat\((\d+),/.exec(fragmento)?.[1] !== undefined
    ? Number(/grid-template-columns:\s*repeat\((\d+),/.exec(fragmento)?.[1])
    : undefined;
}

When('leo las utilidades de grid', async () => {
  css = await Bun.file(join(import.meta.dir, '../../lib/resources/styles.css')).text();
});

Then('content-grid usa una columna base', () => {
  const regla = base('content-grid');
  if (!regla.includes('grid-template-columns: minmax(0, 1fr)')) {
    throw new Error(`content-grid no usa una columna base: ${regla}`);
  }
});

Then('content-grid reserva el ancho del sidebar desde sm', () => {
  const bloque = mediaFragment('content-grid', 'sm');
  if (!bloque.includes('minmax(0, 1fr) minmax(0, min(50% - 0.625rem, 350px))')) {
    throw new Error(`content-grid no reserva el ancho del sidebar desde sm: ${bloque}`);
  }
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

Then('la portada de la cabecera se limita a {int}px en {word}', (maximo: number, breakpoint: string) => {
  const fragmento = `${base('portada')}\n${mediaFragment('portada', breakpoint)}`;
  if (!fragmento.includes('width: 100%')) {
    throw new Error(`la portada no usa el ancho de su columna en ${breakpoint}: ${fragmento}`);
  }
  if (!fragmento.includes(`max-width: ${maximo}px`)) {
    throw new Error(`la portada no se limita a ${maximo}px en ${breakpoint}: ${fragmento}`);
  }
  if (fragmento.includes('max-width: none')) {
    throw new Error(`la portada pierde el límite en ${breakpoint}: ${fragmento}`);
  }
});

Then('el contenido de la cabecera ocupa {int} columnas en {word}', (cantidad: number, breakpoint: string) => {
  const fragmento = media('cabecera-cuerpo', breakpoint);
  if (!fragmento.includes('.cabecera-contenido') || !fragmento.includes(`grid-column: span ${cantidad}`)) {
    throw new Error(`el contenido de la cabecera no ocupa ${cantidad} columnas en ${breakpoint}: ${fragmento}`);
  }
});

Then('la pareja de portadas usa dos columnas de 320px', () => {
  const regla = base('cabecera-portadas');
  if (!regla.includes('grid-template-columns: repeat(2, minmax(0, 320px))')) {
    throw new Error(`la pareja de portadas no usa dos columnas de 320px: ${regla}`);
  }
});

Then('la contraportada va antes que la portada', () => {
  const regla = base('cabecera-portadas .portada--back');
  if (!regla.includes('order: -1')) {
    throw new Error(`la contraportada no va a la izquierda: ${regla}`);
  }
});

Then('las páginas con sidebar usan una columna en sm', () => {
  const texto = mediaRango(640, 959, '.content-grid.page-file');
  const tiene = ['.content-grid.page-file', '.content-grid.page-collection', '.content-grid.page-creator'].every((selector) =>
    texto.includes(selector),
  );
  if (!tiene || !texto.includes('grid-template-columns: minmax(0, 1fr)')) {
    throw new Error(`las páginas con sidebar no usan una columna en sm: ${texto}`);
  }
});

Then('el aside usa dos columnas internas en sm', () => {
  const texto = mediaRango(640, 959, '.content-grid.page-file .page-aside');
  if (!texto.includes('grid-template-columns: repeat(2, minmax(0, 1fr))')) {
    throw new Error(`el aside no usa dos columnas internas en sm: ${texto}`);
  }
});

Then('la cabecera con dos portadas deja el resto al contenido en {word}', (breakpoint: string) => {
  const regla = reglaDe(
    mediaHasta(breakpointPx(breakpoint), '.cabecera-cuerpo:has(.cabecera-portadas) {'),
    '.cabecera-cuerpo:has(.cabecera-portadas)',
  );
  if (!regla.includes('grid-template-columns: max-content minmax(0, 1fr)')) {
    throw new Error(`la cabecera con dos portadas no deja el resto al contenido en ${breakpoint}: ${regla}`);
  }
});

Then('el contenido de la cabecera con dos portadas ocupa la segunda columna en {word}', (breakpoint: string) => {
  const regla = reglaDe(
    mediaHasta(breakpointPx(breakpoint), '.cabecera-cuerpo:has(.cabecera-portadas) > .cabecera-contenido {'),
    '.cabecera-cuerpo:has(.cabecera-portadas) > .cabecera-contenido',
  );
  if (!regla.includes('grid-column: 2;')) {
    throw new Error(`el contenido con dos portadas no ocupa la segunda columna en ${breakpoint}: ${regla}`);
  }
});

function reglaEnMedia(px: number, selector: string): string {
  const bloque = mediaGlobal(px, selector);
  return bloque === '' ? '' : reglaDe(bloque, selector);
}

Then('la cabecera con una portada alinea el contenido en {word}', (breakpoint: string) => {
  const selector = '.cabecera-cuerpo:not(.cabecera-cuerpo--creador):has(> .portada) > .cabecera-contenido > :first-child';
  const regla = reglaEnMedia(breakpointPx(breakpoint), selector);
  if (!regla.includes('margin-top: 0')) throw new Error(`la cabecera con una portada no alinea el contenido en ${breakpoint}: ${regla}`);
});

Then('la cabecera con dos portadas alinea el contenido en {word}', (breakpoint: string) => {
  const selector = '.cabecera-cuerpo:has(> .cabecera-portadas) > .cabecera-contenido > :first-child';
  const regla = reglaEnMedia(breakpointPx(breakpoint), selector);
  if (!regla.includes('margin-top: 0')) throw new Error(`la cabecera con dos portadas no alinea el contenido en ${breakpoint}: ${regla}`);
});

Then('la cabecera de creadora alinea el contenido en {word}', (breakpoint: string) => {
  const selector = '.cabecera-cuerpo--creador:has(> .portada) > .cabecera-contenido > :first-child';
  const regla = reglaEnMedia(breakpointPx(breakpoint), selector);
  if (!regla.includes('margin-top: 0')) throw new Error(`la cabecera de creadora no alinea el contenido en ${breakpoint}: ${regla}`);
});

Then('el título de la página conserva su margen superior', () => {
  const regla = base('titulo-pagina');
  if (!regla.includes('margin-top: 0.75rem')) throw new Error(`el título no conserva su margen superior: ${regla}`);
});

Then('la cabecera de creadora apila la foto y el contenido', () => {
  const selector = 'cabecera-cuerpo.cabecera-cuerpo--creador:has(.portada)';
  const regla = base(selector);
  if (!regla.includes('grid-template-columns: minmax(0, 1fr)')) {
    throw new Error(`la cabecera de creadora no apila la foto y el contenido: ${regla}`);
  }
});

Then('la cabecera de creadora usa la foto y el resto en lg', () => {
  const selector = '.cabecera-cuerpo.cabecera-cuerpo--creador:has(.portada)';
  const regla = reglaEnMedia(1280, selector);
  if (!regla.includes('grid-template-columns: minmax(0, 320px) minmax(0, 1fr)')) {
    throw new Error(`la cabecera de creadora no usa foto y resto en lg: ${regla}`);
  }
});

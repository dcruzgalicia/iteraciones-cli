import { join } from 'node:path';
import { Then, When } from '@cucumber/cucumber';

let css = '';

const BREAKPOINTS: Record<string, number> = {
  sm: 640,
  md: 960,
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

function bloqueDesde(inicio: number): { contenido: string; fin: number } {
  const abre = css.indexOf('{', inicio);
  if (abre === -1) return { contenido: '', fin: css.length };
  let profundidad = 1;
  let i = abre + 1;
  while (i < css.length && profundidad > 0) {
    if (css[i] === '{') profundidad += 1;
    else if (css[i] === '}') profundidad -= 1;
    i += 1;
  }
  return { contenido: css.slice(abre + 1, i - 1), fin: i };
}

function mediaGlobal(px: number, selector: string): string {
  let desde = 0;
  while (true) {
    const inicio = css.indexOf(`@media (min-width: ${px}px)`, desde);
    if (inicio === -1) return '';
    const bloqueMedia = bloqueDesde(inicio);
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

function reglaDe(bloqueMedia: string, selector: string): string {
  const inicio = bloqueMedia.indexOf(selector);
  if (inicio === -1) return '';
  const abre = bloqueMedia.indexOf('{', inicio);
  const cierra = bloqueMedia.indexOf('}', abre);
  return abre === -1 || cierra === -1 ? '' : bloqueMedia.slice(abre + 1, cierra);
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

Then('la pareja de portadas usa una columna base', () => {
  const regla = base('cabecera-portadas');
  if (!regla.includes('grid-template-columns: minmax(0, 1fr)')) {
    throw new Error(`la pareja de portadas no se apila en una columna: ${regla}`);
  }
});

Then('la pareja de portadas tiene {int} columnas en {word}', (cantidad: number, breakpoint: string) => {
  const regla = reglaDe(mediaHasta(breakpointPx(breakpoint), '.cabecera-portadas {'), '.cabecera-portadas');
  const leidas = columnas(regla);
  if (leidas !== cantidad) {
    throw new Error(`la pareja de portadas usa ${leidas ?? 'sin columnas'} en ${breakpoint} y debía usar ${cantidad}`);
  }
});

Then('la contraportada va antes que la portada en {word}', (breakpoint: string) => {
  const regla = reglaDe(mediaHasta(breakpointPx(breakpoint), '.cabecera-portadas .portada--back {'), '.cabecera-portadas .portada--back');
  if (!regla.includes('order: -1')) {
    throw new Error(`la contraportada no va a la izquierda en ${breakpoint}: ${regla}`);
  }
});

Then('el retrato de la bio se limita a {int}px y se centra', (maximo: number) => {
  const regla = base('contenido-retrato');
  if (!regla.includes(`max-width: ${maximo}px`)) {
    throw new Error(`el retrato de la bio no se limita a ${maximo}px: ${regla}`);
  }
  if (!regla.includes('align-self: center')) {
    throw new Error(`el retrato de la bio no está centrado: ${regla}`);
  }
});

Then('el retrato y el contenido de la bio van lado a lado en {word}', (breakpoint: string) => {
  const regla = reglaDe(mediaGlobal(breakpointPx(breakpoint), '.contenido-flex {'), '.contenido-flex');
  if (!regla.includes('flex-direction: row')) {
    throw new Error(`el retrato y el contenido no van lado a lado en ${breakpoint}: ${regla}`);
  }
});

Then('el retrato de la bio no tiene ancho fijo en {word}', (breakpoint: string) => {
  const regla = reglaDe(mediaGlobal(breakpointPx(breakpoint), '.contenido-retrato {'), '.contenido-retrato');
  if (regla !== '') {
    throw new Error(`el retrato de la bio tiene un ancho fijo en ${breakpoint}: ${regla}`);
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

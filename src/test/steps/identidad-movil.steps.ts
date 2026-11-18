import { join } from 'node:path';
import { Then, When } from '@cucumber/cucumber';

let css = '';

function bloqueMovil(): string {
  const inicio = css.indexOf('@media (max-width: 639px)');
  if (inicio === -1) return '';
  const siguiente = css.indexOf('@media', inicio + 1);
  return css.slice(inicio, siguiente === -1 ? undefined : siguiente);
}

function declaraciones(selector: string): string {
  const bloque = bloqueMovil();
  const inicio = bloque.indexOf(selector);
  if (inicio === -1) throw new Error(`el bloque móvil no incluye ${selector}`);
  const abre = bloque.indexOf('{', inicio);
  const cierra = bloque.indexOf('}', abre);
  if (abre === -1 || cierra === -1) throw new Error(`no se pudo leer la regla de ${selector}`);
  return bloque.slice(abre + 1, cierra);
}

const BREAKPOINTS: Record<string, number> = { sm: 640, md: 960, lg: 1280, xl: 1600 };

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

function mediaCon(px: number, selector: string): string {
  let desde = 0;
  while (true) {
    const inicio = css.indexOf(`@media (min-width: ${px}px)`, desde);
    if (inicio === -1) return '';
    const bloque = bloqueDesde(inicio);
    if (bloque.contenido.includes(`${selector} {`)) return bloque.contenido;
    desde = bloque.fin;
  }
}

function reglaDe(bloque: string, selector: string): string {
  const inicio = bloque.indexOf(`${selector} {`);
  if (inicio === -1) return '';
  const abre = bloque.indexOf('{', inicio);
  const cierra = bloque.indexOf('}', abre);
  return abre === -1 || cierra === -1 ? '' : bloque.slice(abre + 1, cierra);
}

function reglaIdentidad(selector: string, breakpoint: string): string {
  if (breakpoint === 'móvil') return reglaDe(css, selector);
  const px = BREAKPOINTS[breakpoint];
  if (px === undefined) throw new Error(`breakpoint desconocido: ${breakpoint}`);
  return reglaDe(mediaCon(px, selector), selector);
}

When('leo el CSS de identidad', async () => {
  css = await Bun.file(join(import.meta.dir, '../../lib/resources/styles.css')).text();
});

Then('el bloque móvil centra la marca de cabecera y pie', () => {
  for (const selector of ['.sitio-marca__fila', '.sitio-marca__texto', '.sitio-pie__identidad', '.sitio-marca--derecha']) {
    const regla = declaraciones(selector);
    if (!regla.includes('justify-content: center') && !regla.includes('align-items: center') && !regla.includes('text-align: center')) {
      throw new Error(`la regla móvil de ${selector} no centra: ${regla}`);
    }
  }
  for (const selector of ['.sitio-marca__fila', '.sitio-marca__texto']) {
    const regla = declaraciones(selector);
    if (!regla.includes('align-items: center') || !regla.includes('text-align: center')) {
      throw new Error(`la marca ${selector} no queda centrada: ${regla}`);
    }
  }
});

Then('el bloque móvil centra las acciones de cabecera y pie', () => {
  const regla = declaraciones('.sitio-acciones');
  if (!regla.includes('justify-content: center')) throw new Error(`las acciones no quedan centradas: ${regla}`);
});

Then('el título de la identidad mide {word} en {word}', (medida: string, breakpoint: string) => {
  const regla = reglaIdentidad('.sitio-titulo', breakpoint);
  if (!regla.includes(`font-size: ${medida}`)) {
    throw new Error(`el título de la identidad no mide ${medida} en ${breakpoint}: ${regla}`);
  }
});

Then('el lema de la identidad mide {word} en {word}', (medida: string, breakpoint: string) => {
  const regla = reglaIdentidad('.sitio-lema', breakpoint);
  if (!regla.includes(`font-size: ${medida}`)) {
    throw new Error(`el lema de la identidad no mide ${medida} en ${breakpoint}: ${regla}`);
  }
});

import { join } from 'node:path';
import { Then, When } from '@cucumber/cucumber';
import { bloqueDesde, reglaDe } from '../css.js';

let css = '';

function bloqueMovil(): string {
  const inicio = css.indexOf('@media (max-width: 639px)');
  if (inicio === -1) return '';
  const siguiente = css.indexOf('@media', inicio + 1);
  return css.slice(inicio, siguiente === -1 ? undefined : siguiente);
}

function bloqueSm(): string {
  const marker = '@media (min-width: 640px) and (max-width: 959px)';
  let desde = 0;
  while (true) {
    const inicio = css.indexOf(marker, desde);
    if (inicio === -1) return '';
    const bloque = bloqueDesde(css, inicio);
    const texto = css.slice(inicio, bloque.fin);
    if (texto.includes('.identidad-grid')) return texto;
    desde = bloque.fin;
  }
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

function mediaCon(px: number, selector: string): string {
  let desde = 0;
  while (true) {
    const inicio = css.indexOf(`@media (min-width: ${px}px)`, desde);
    if (inicio === -1) return '';
    const bloque = bloqueDesde(css, inicio);
    if (bloque.contenido.includes(`${selector} {`)) return bloque.contenido;
    desde = bloque.fin;
  }
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

Then('el bloque sm centra la marca y las acciones', () => {
  const bloque = bloqueSm();
  if (!bloque.includes('.identidad-grid') || !bloque.includes('grid-template-columns: minmax(0, 1fr)')) {
    throw new Error(`el bloque sm no apila la identidad: ${bloque}`);
  }
  for (const selector of ['.sitio-marca__fila', '.sitio-acciones', '.sitio-pie__identidad', '.sitio-marca--derecha']) {
    const regla = reglaDe(bloque, selector);
    if (!regla.includes('justify-content: center')) {
      throw new Error(`el bloque sm no centra ${selector}: ${regla}`);
    }
  }
  const regla = reglaDe(bloque, '.sitio-acciones.sitio-acciones--pie');
  if (!regla.includes('justify-content: center')) {
    throw new Error(`el bloque sm no centra las acciones del pie: ${regla}`);
  }
});

Then('el título de la identidad mide {word} en {word}', (medida: string, breakpoint: string) => {
  const regla = reglaIdentidad('.sitio-titulo', breakpoint);
  const patron = new RegExp(`font-size: (?:calc\\()?${medida.replaceAll('.', '\\.')}\\b`);
  if (!patron.test(regla)) {
    throw new Error(`el título de la identidad no mide ${medida} en ${breakpoint}: ${regla}`);
  }
});

Then('el lema de la identidad mide {word} en {word}', (medida: string, breakpoint: string) => {
  const regla = reglaIdentidad('.sitio-lema', breakpoint);
  if (!regla.includes(`font-size: ${medida}`)) {
    throw new Error(`el lema de la identidad no mide ${medida} en ${breakpoint}: ${regla}`);
  }
});

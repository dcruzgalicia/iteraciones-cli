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

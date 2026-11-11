import { Then, When } from '@cucumber/cucumber';
import { docProducesFormat } from '../../builder/output-layout.js';
import type { FormatKey } from '../../config/site-config.js';

let produce = false;

When('pregunto si el type {string} produce {string}', (type: string, formato: string) => {
  produce = docProducesFormat(type, formato as FormatKey);
});

Then('la respuesta es {string}', (esperada: string) => {
  const querida = esperada.trim().toLocaleLowerCase('es');
  const real = produce ? 'sí' : 'no';
  if (real !== querida) throw new Error(`la respuesta es "${real}" y debía ser "${querida}"`);
});

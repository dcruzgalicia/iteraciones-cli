import { Then, When } from '@cucumber/cucumber';
import { postProcessHtml } from '../../builder/html-postprocess.js';

const BASE =
  '<div class="main-grid"><div id="slot-main"><p>Texto</p></div><div id="slot-related" class="min-w-0">%CONTENIDO%</div></div>';

let resultado = '';

When('postproceso un HTML con la columna relacionada vacía', () => {
  resultado = postProcessHtml(BASE.replace('%CONTENIDO%', '\n    \n'), '');
});

When('postproceso un HTML con la columna relacionada llena', () => {
  resultado = postProcessHtml(BASE.replace('%CONTENIDO%', '<div id="card-indice">Índice</div>'), '');
});

Then('el HTML no contiene el slot relacionado', () => {
  if (resultado.includes('id="slot-related"')) throw new Error('el slot relacionado no se eliminó');
});

Then('el HTML contiene el slot relacionado', () => {
  if (!resultado.includes('id="slot-related"')) throw new Error('el slot relacionado se eliminó y debía conservarse');
});

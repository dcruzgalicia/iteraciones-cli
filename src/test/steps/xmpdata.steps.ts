import { Given, Then, When } from '@cucumber/cucumber';
import { buildPdfInfoBlock, buildXmpdataContent, injectXmpMetadataIntoLatex } from '../../builder/xmpdata.js';
import { world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — los metadatos del PDF: XMP e Info dict.
 *
 * ## Son dos formatos con dos reglas opuestas
 *
 * El **Info dict** es un diccionario de PostScript: los bytes acentuados crudos
 * se rompen (#2085). `Muñoz` tiene que salir `Mu\~{n}oz`. Cero bytes UTF-8 sin
 * convertir.
 *
 * El **XMP** es XML: ahí el UTF-8 real es lo correcto y convertirlo a comandos
 * LaTeX lo ROMPE. `Año del jalapeño` tiene que salir tal cual.
 *
 * El mismo autor, dos reglas opuestas según el destino. Por eso los dos
 * escenarios del final son la pareja que hay que leer junta: si alguien "unifica"
 * el escaping se rompe uno de los dos.
 *
 * ## Sólo se emite lo que hay
 *
 * `\Title{}` vacío es peor que nada: un lector de PDF ve un título en blanco y
 * lo prefiere a no ver ninguno. De ahí que sin campos no haya bloque.
 */

type Campos = Parameters<typeof buildXmpdataContent>[0];

const COMO = { true: true, false: false };

/** Campos que son lista siempre: un solo elemento sigue siendo lista de uno. */
const LISTAS = new Set(['authors', 'keywords', 'publishers', 'creator']);

/** Los campos del escenario: `title=… ;; authors=A ;; B`. */
function campos(texto: string): Campos {
  const salida: Record<string, unknown> = {};
  for (const par of texto.split(';;')) {
    const limpio = par.trim();
    if (!limpio) continue;
    const [clave, valor] = limpio.split('=');
    if (!clave) continue;
    const bruto = (valor ?? '').trim();
    if (bruto === '') continue;
    if (bruto in COMO) {
      salida[clave] = COMO[bruto as keyof typeof COMO];
    } else if (bruto.includes('|') || LISTAS.has(clave)) {
      salida[clave] = bruto
        .split('|')
        .map((v) => v.trim())
        .filter(Boolean);
    } else {
      salida[clave] = bruto;
    }
  }
  return salida as unknown as Campos;
}

Given('los metadatos son:', (tabla: string) => {
  world.camposXmp = campos(tabla.replace(/<br>/g, '\n')) as unknown as Record<string, unknown>;
});

When('construyo el contenido XMP', () => {
  world.xmp = buildXmpdataContent(world.camposXmp as Campos);
});

When('construyo el bloque Info', () => {
  world.infoPdf = buildPdfInfoBlock(world.camposXmp as Campos);
});

Then('el XMP es exactamente:', (esperado: string) => {
  const leido = String(world.xmp).replace(/<br>/g, '\n');
  const querido = esperado.replace(/<br>/g, '\n');
  if (leido !== querido) {
    throw new Error(`el XMP es\n${leido}\ny debía ser\n${querido}`);
  }
});

Then('el XMP está vacío', () => {
  if (world.xmp !== '') throw new Error(`el XMP no debía decir nada y dice ${JSON.stringify(world.xmp)}`);
});

Then('el bloque Info es exactamente:', (esperado: string) => {
  const leido = String(world.infoPdf).replace(/<br>/g, '\n');
  const querido = esperado.replace(/<br>/g, '\n');
  if (leido !== querido) {
    throw new Error(`el bloque Info es\n${leido}\ny debía ser\n${querido}`);
  }
});

Then('el bloque Info está vacío', () => {
  if (world.infoPdf !== '') {
    throw new Error(`el bloque Info no debía decir nada y dice ${JSON.stringify(world.infoPdf)}`);
  }
});

/**
 * El fragmento va en un docstring y SIN comillas: una Cucumber Expression
 * trata `{`, `}`, `(` y `)` como sintaxis, así que un paso que dijera
 * `lleva \\pdfescapestring{Mu\\~{n}oz}` ni siquiera parsea.
 */
Then('el bloque Info lleva el fragmento:', (fragmento: string) => {
  const leido = String(world.infoPdf);
  if (!leido.includes(fragmento.trim())) {
    throw new Error(`el bloque no lleva ${JSON.stringify(fragmento.trim())}. Llama:\n${leido}`);
  }
});

Then('el bloque Info NO lleva bytes acentuados crudos', () => {
  const crudos = String(world.infoPdf).match(/[ñáéíóúÑÁÉÍÓÚ]/g);
  if (crudos !== null) {
    throw new Error(`lleva bytes UTF-8 sin convertir: ${JSON.stringify(crudos)}`);
  }
});

Then('el XMP conserva el UTF-8 real', () => {
  const xmp = String(world.xmp);
  // Es XML: convertir a comandos LaTeX aquí lo rompe.
  if (!/[ñáéíóúÑÁÉÍÓÚ]/.test(xmp)) {
    throw new Error(`el XMP no conserva los acentos: ${JSON.stringify(xmp)}`);
  }
});

// ── La inyección en el .tex ────────────────────────────────────────────────

const TEX_BASICO = '\\documentclass{article}\n\\begin{document}\nHola\n\\end{document}\n';

Given('un .tex mínimo con ancla de documento', () => {
  world.texXmp = TEX_BASICO;
});

Given('un .tex sin ancla de documento', () => {
  world.texXmp = '\\section{sin documento}\n';
});

When('inyecto los metadatos', () => {
  world.texInyectado = injectXmpMetadataIntoLatex(String(world.texXmp), world.camposXmp as Campos);
});

Then('el .tex lleva el fragmento:', (fragmento: string) => {
  const leido = String(world.texInyectado).replace(/<br>/g, '\n');
  const querido = fragmento.replace(/<br>/g, '\n');
  if (!leido.includes(querido)) {
    throw new Error(`el .tex no lleva\n${querido}\nque es lo que se esperaba. Llama:\n${leido}`);
  }
});

/** El orden importa: si el `filecontents` va después, el PDF sale sin metadatos. */
Then('el filecontents va antes del ancla de documento', () => {
  const leido = String(world.texInyectado);
  const antes = leido.indexOf('\\begin{filecontents}');
  const despues = leido.indexOf('\\begin{document}');
  if (antes < 0) throw new Error('no se insertó el bloque filecontents');
  if (despues < 0) throw new Error('el .tex ya no tiene su \\begin{document}');
  if (antes >= despues) {
    throw new Error('el filecontents va después de \\begin{document}: el PDF saldría sin metadatos');
  }
});

Then('el .tex queda igual', () => {
  if (world.texInyectado !== world.texXmp) {
    throw new Error(`el .tex cambió:\n${world.texInyectado}`);
  }
});

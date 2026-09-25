import type { SiteConfig } from '../config/config-schema.js';
import { computeActiveFormats, type FormatKey, resolveDisabledPreambleConfig, toActiveFormats } from '../config/site-config.js';
import { detectPageSize } from './latex-preamble.js';
import { loadPreambleFilters, resolveEffectiveDisabledPreamble } from './preamble-loader.js';

/**
 * Los flags del build que solo cambian los bytes de las imágenes, nunca sus
 * rutas: página, recorte y PDF/X. Los necesitan igual `iteraciones merge` e
 * `iteraciones markdown`, para no reescribir las imágenes de assets/images con
 * medidas distintas a las con las que corrió la fase de imágenes del build.
 */
export async function printFlags(siteConfig: SiteConfig, cwd: string) {
  const active = toActiveFormats(computeActiveFormats(siteConfig.format) as FormatKey[]);
  if (!active.pdf && !active.latex) return { pageDimensions: detectPageSize([]), cropActive: false, pdfxActive: false };
  const preamble = await loadPreambleFilters(resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(siteConfig)), cwd, 'file');
  return {
    pageDimensions: detectPageSize(preamble),
    cropActive: preamble.some((f) => f.name === '98-crop'),
    pdfxActive: preamble.some((f) => f.name === '99-pdfx'),
  };
}

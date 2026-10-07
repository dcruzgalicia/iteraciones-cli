import type { SiteConfig } from '../config/config-schema.js';
import { computeActiveFormats, resolveDisabledPreambleConfig, toActiveFormats } from '../config/site-config.js';
import { detectPageSize } from './latex-preamble.js';
import { loadPreambleFilters, resolveEffectiveDisabledPreamble } from './preamble-loader.js';

export async function printFlags(siteConfig: SiteConfig, cwd: string) {
  const active = toActiveFormats(computeActiveFormats(siteConfig.format));
  if (!active.pdf && !active.latex) return { pageDimensions: detectPageSize([]), cropActive: false, pdfxActive: false };
  const preamble = await loadPreambleFilters(resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(siteConfig)), cwd, 'file');
  return {
    pageDimensions: detectPageSize(preamble),
    cropActive: preamble.some((f) => f.name === '98-crop'),
    pdfxActive: preamble.some((f) => f.name === '99-pdfx'),
  };
}

import type { AccentColor } from './accent-palettes.js';

export const HTML_STYLES = ['clasico', 'expresivo', 'editorial', 'institucional'] as const;

export type HtmlStyle = (typeof HTML_STYLES)[number];

export const DEFAULT_HTML_STYLE: HtmlStyle = 'clasico';

export const HTML_STYLE_COLORS: Record<HtmlStyle, AccentColor> = {
  clasico: 'lime',
  expresivo: 'amber',
  editorial: 'stone',
  institucional: 'blue',
};

export interface HtmlFont {
  family: string;
  source: string;
  destination: string;
  weight: string;
  license: string;
  licenseDestination: string;
}

export const STYLE_FONTS: Record<HtmlStyle, HtmlFont[]> = {
  clasico: [],
  expresivo: [
    {
      family: 'Caveat',
      source: 'caveat/Caveat-latin.woff2',
      destination: 'caveat-latin.woff2',
      weight: '400 700',
      license: 'caveat/OFL.txt',
      licenseDestination: 'caveat-OFL.txt',
    },
    {
      family: 'Lora',
      source: 'lora/Lora-latin.woff2',
      destination: 'lora-latin.woff2',
      weight: '400 700',
      license: 'lora/OFL.txt',
      licenseDestination: 'lora-OFL.txt',
    },
  ],
  editorial: [
    {
      family: 'Source Serif 4',
      source: 'source-serif-4/SourceSerif4-latin.woff2',
      destination: 'source-serif-4-latin.woff2',
      weight: '200 900',
      license: 'source-serif-4/OFL.txt',
      licenseDestination: 'source-serif-4-OFL.txt',
    },
  ],
  institucional: [
    {
      family: 'Public Sans',
      source: 'public-sans/PublicSans-latin.woff2',
      destination: 'public-sans-latin.woff2',
      weight: '100 900',
      license: 'public-sans/OFL.txt',
      licenseDestination: 'public-sans-OFL.txt',
    },
  ],
};

export function htmlStyle(style: string | undefined): HtmlStyle {
  return HTML_STYLES.includes(style as HtmlStyle) ? (style as HtmlStyle) : DEFAULT_HTML_STYLE;
}

export function htmlStyleColor(style: string | undefined, color: string | undefined): string {
  return color ?? HTML_STYLE_COLORS[htmlStyle(style)];
}

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
  style?: string;
  license: string;
  licenseDestination: string;
}

export const STYLE_FONTS: Record<HtmlStyle, HtmlFont[]> = {
  clasico: [
    {
      family: 'Space Grotesk',
      source: 'space-grotesk/SpaceGrotesk-latin.woff2',
      destination: 'space-grotesk-latin.woff2',
      weight: '400',
      license: 'space-grotesk/OFL.txt',
      licenseDestination: 'space-grotesk-OFL.txt',
    },
    {
      family: 'Chakra Petch',
      source: 'chakra-petch/ChakraPetch-600-latin.woff2',
      destination: 'chakra-petch-600-latin.woff2',
      weight: '600',
      license: 'chakra-petch/OFL.txt',
      licenseDestination: 'chakra-petch-OFL.txt',
    },
  ],
  expresivo: [
    {
      family: 'Caveat',
      source: 'caveat/Caveat-latin.woff2',
      destination: 'caveat-latin.woff2',
      weight: '700',
      license: 'caveat/OFL.txt',
      licenseDestination: 'caveat-OFL.txt',
    },
    {
      family: 'Kalam',
      source: 'kalam/Kalam-400-latin.woff2',
      destination: 'kalam-400-latin.woff2',
      weight: '400',
      license: 'kalam/OFL.txt',
      licenseDestination: 'kalam-OFL.txt',
    },
  ],
  editorial: [
    {
      family: 'Libre Baskerville',
      source: 'libre-baskerville/LibreBaskerville-Regular-latin.woff2',
      destination: 'libre-baskerville-regular-latin.woff2',
      weight: '400',
      license: 'libre-baskerville/OFL.txt',
      licenseDestination: 'libre-baskerville-OFL.txt',
    },
  ],
  institucional: [
    {
      family: 'Public Sans',
      source: 'public-sans/PublicSans-latin.woff2',
      destination: 'public-sans-latin.woff2',
      weight: '400',
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

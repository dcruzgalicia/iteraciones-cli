import type { AccentColor } from './accent-palettes.js';

export const HTML_STYLES = ['radar', 'notebook', 'press', 'modern'] as const;

export type HtmlStyle = (typeof HTML_STYLES)[number];

export const DEFAULT_HTML_STYLE: HtmlStyle = 'radar';

export const HTML_STYLE_ALIASES: Record<string, HtmlStyle> = {
  clasico: 'radar',
  expresivo: 'notebook',
  editorial: 'press',
  institucional: 'modern',
};

export const HTML_STYLE_INPUTS = [...HTML_STYLES, ...Object.keys(HTML_STYLE_ALIASES)] as const;

export const HTML_STYLE_COLORS: Record<HtmlStyle, AccentColor> = {
  radar: 'lime',
  notebook: 'amber',
  press: 'stone',
  modern: 'blue',
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
  radar: [
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
  notebook: [
    {
      family: 'Caveat',
      source: 'caveat/Caveat-latin.woff2',
      destination: 'caveat-latin.woff2',
      weight: '700',
      license: 'caveat/OFL.txt',
      licenseDestination: 'caveat-OFL.txt',
    },
    {
      family: 'Nunito',
      source: 'nunito/Nunito-latin.woff2',
      destination: 'nunito-latin.woff2',
      weight: '400',
      license: 'nunito/OFL.txt',
      licenseDestination: 'nunito-OFL.txt',
    },
  ],
  press: [
    {
      family: 'Playfair Display',
      source: 'playfair-display/PlayfairDisplay-latin.woff2',
      destination: 'playfair-display-latin.woff2',
      weight: '700',
      license: 'playfair-display/OFL.txt',
      licenseDestination: 'playfair-display-OFL.txt',
    },
    {
      family: 'Libre Baskerville',
      source: 'libre-baskerville/LibreBaskerville-Regular-latin.woff2',
      destination: 'libre-baskerville-regular-latin.woff2',
      weight: '400',
      license: 'libre-baskerville/OFL.txt',
      licenseDestination: 'libre-baskerville-OFL.txt',
    },
  ],
  modern: [
    {
      family: 'Public Sans',
      source: 'public-sans/PublicSans-latin.woff2',
      destination: 'public-sans-latin.woff2',
      weight: '400',
      license: 'public-sans/OFL.txt',
      licenseDestination: 'public-sans-OFL.txt',
    },
    {
      family: 'Source Sans 3',
      source: 'source-sans-3/SourceSans3-latin.woff2',
      destination: 'source-sans-3-latin.woff2',
      weight: '400',
      license: 'source-sans-3/OFL.txt',
      licenseDestination: 'source-sans-3-OFL.txt',
    },
  ],
};

export function htmlStyle(style: string | undefined): HtmlStyle {
  if (style !== undefined && Object.hasOwn(HTML_STYLE_ALIASES, style)) return HTML_STYLE_ALIASES[style] as HtmlStyle;
  return HTML_STYLES.includes(style as HtmlStyle) ? (style as HtmlStyle) : DEFAULT_HTML_STYLE;
}

export function htmlStyleColor(style: string | undefined, color: string | undefined): string {
  return color ?? HTML_STYLE_COLORS[htmlStyle(style)];
}

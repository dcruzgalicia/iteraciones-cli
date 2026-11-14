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

export function htmlStyle(style: string | undefined): HtmlStyle {
  return HTML_STYLES.includes(style as HtmlStyle) ? (style as HtmlStyle) : DEFAULT_HTML_STYLE;
}

export function htmlStyleColor(style: string | undefined, color: string | undefined): string {
  return color ?? HTML_STYLE_COLORS[htmlStyle(style)];
}

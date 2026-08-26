import { describe, expect, it } from 'bun:test';
import type { z } from 'zod';
import type {
  Camelize,
  EpubFormatSchema,
  HtmlFormatSchema,
  LatexFormatSchema,
  MarkdownFormatSchema,
  PdfFormatSchema,
} from '../config/config-schema.js';
import type { EpubFormatConfig, HtmlFormatConfig, LatexFormatConfig, MarkdownFormatConfig, PdfFormatConfig } from '../config/site-config.js';

/**
 * Paridad tipo-nivel entre los schemas Zod crudos (claves kebab-case) y las
 * sub-interfaces documentadas de site-config.ts (#2072). Si alguien agrega,
 * renombra o cambia el tipo de un campo en un solo lado, estas aserciones
 * fallan en compilación.
 */
type Expect<T extends true> = T;

type CamLatex = Camelize<z.infer<typeof LatexFormatSchema>>;
type CamHtml = Camelize<z.infer<typeof HtmlFormatSchema>>;
type CamPdf = Camelize<z.infer<typeof PdfFormatSchema>>;
type CamEpub = Camelize<z.infer<typeof EpubFormatSchema>>;
type CamMarkdown = Camelize<z.infer<typeof MarkdownFormatSchema>>;

describe('paridad schema Zod ↔ interfaces de site-config (#2072)', () => {
  it('las cinco secciones de formato cumplen la paridad en ambos sentidos', () => {
    // Forward: la salida camelizada del schema satisface la interfaz documentada.
    type _latexFwd = Expect<CamLatex extends LatexFormatConfig ? true : false>;
    type _htmlFwd = Expect<CamHtml extends HtmlFormatConfig ? true : false>;
    type _pdfFwd = Expect<CamPdf extends PdfFormatConfig ? true : false>;
    type _epubFwd = Expect<CamEpub extends EpubFormatConfig ? true : false>;
    type _mdFwd = Expect<CamMarkdown extends MarkdownFormatConfig ? true : false>;
    // Reverse: cada clave de la interfaz existe en la salida camelizada.
    type _latexRev = Expect<keyof LatexFormatConfig extends keyof CamLatex ? true : false>;
    type _htmlRev = Expect<keyof HtmlFormatConfig extends keyof CamHtml ? true : false>;
    type _pdfRev = Expect<keyof PdfFormatConfig extends keyof CamPdf ? true : false>;
    type _epubRev = Expect<keyof EpubFormatConfig extends keyof CamEpub ? true : false>;
    type _mdRev = Expect<keyof MarkdownFormatConfig extends keyof CamMarkdown ? true : false>;
    // Las comprobaciones viven en el sistema de tipos: el runtime solo confirma
    // que el archivo participa de la suite.
    expect(true).toBe(true);
  });

  it('Camelize resuelve claves multi-guion (disabled-preamble-filters → disabledPreambleFilters)', () => {
    type _multi = Expect<'disabledPreambleFilters' extends keyof CamPdf ? true : false>;
    expect(true).toBe(true);
  });
});

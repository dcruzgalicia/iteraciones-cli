import { describe, expect, it } from 'bun:test';
import type { z } from 'zod';
import type { EpubFormatSchema, HtmlFormatSchema, LatexFormatSchema, MarkdownFormatSchema, PdfFormatSchema } from '../config/config-schema.js';
import type { EpubFormatConfig, HtmlFormatConfig, LatexFormatConfig, MarkdownFormatConfig, PdfFormatConfig } from '../config/site-config.js';

/**
 * Paridad tipo-nivel entre los schemas Zod (claves camelCase) y las
 * sub-interfaces documentadas de site-config.ts (#2072). Si alguien agrega,
 * renombra o cambia el tipo de un campo en un solo lado, estas aserciones
 * fallan en compilación.
 */
type Expect<T extends true> = T;

type SchemaLatex = z.infer<typeof LatexFormatSchema>;
type SchemaHtml = z.infer<typeof HtmlFormatSchema>;
type SchemaPdf = z.infer<typeof PdfFormatSchema>;
type SchemaEpub = z.infer<typeof EpubFormatSchema>;
type SchemaMarkdown = z.infer<typeof MarkdownFormatSchema>;

describe('paridad schema Zod ↔ interfaces de site-config (#2072)', () => {
  it('las cinco secciones de formato cumplen la paridad en ambos sentidos', () => {
    // Forward: la salida del schema satisface la interfaz documentada.
    type _latexFwd = Expect<SchemaLatex extends LatexFormatConfig ? true : false>;
    type _htmlFwd = Expect<SchemaHtml extends HtmlFormatConfig ? true : false>;
    type _pdfFwd = Expect<SchemaPdf extends PdfFormatConfig ? true : false>;
    type _epubFwd = Expect<SchemaEpub extends EpubFormatConfig ? true : false>;
    type _mdFwd = Expect<SchemaMarkdown extends MarkdownFormatConfig ? true : false>;
    // Reverse: cada clave de la interfaz existe en la salida del schema.
    type _latexRev = Expect<keyof LatexFormatConfig extends keyof SchemaLatex ? true : false>;
    type _htmlRev = Expect<keyof HtmlFormatConfig extends keyof SchemaHtml ? true : false>;
    type _pdfRev = Expect<keyof PdfFormatConfig extends keyof SchemaPdf ? true : false>;
    type _epubRev = Expect<keyof EpubFormatConfig extends keyof SchemaEpub ? true : false>;
    type _mdRev = Expect<keyof MarkdownFormatConfig extends keyof SchemaMarkdown ? true : false>;
    expect(true).toBe(true);
  });

  it('el schema de pdf incluye disabledPreambleFilters directamente', () => {
    type _check = Expect<'disabledPreambleFilters' extends keyof SchemaPdf ? true : false>;
    expect(true).toBe(true);
  });
});

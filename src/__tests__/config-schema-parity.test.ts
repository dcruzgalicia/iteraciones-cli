import type { z } from 'zod';
import type { EpubFormatSchema, HtmlFormatSchema, LatexFormatSchema, MarkdownFormatSchema, PdfFormatSchema } from '../config/config-schema.js';
import type { EpubFormatConfig, HtmlFormatConfig, LatexFormatConfig, MarkdownFormatConfig, PdfFormatConfig } from '../config/site-config.js';

/**
 * Paridad tipo-nivel entre los schemas Zod (claves camelCase) y las
 * sub-interfaces documentadas de site-config.ts (#2072). Si alguien agrega,
 * renombra o cambia el tipo de un campo en un solo lado, esto falla en
 * compilación.
 *
 * #2542: aquí no hay ningún `it()`. La comprobación ocurre en `tsc --noEmit`:
 * los alias de tipo se evalúan aunque no se referencien (verificado: un
 * `Expect<false>` sin referencias da TS2344 igual). El `bun test` que antes
 * envolvía esto reportaba dos ✓ sin haber comprobado nada en runtime.
 */
type Expect<T extends true> = T;

type SchemaLatex = z.infer<typeof LatexFormatSchema>;
type SchemaHtml = z.infer<typeof HtmlFormatSchema>;
type SchemaPdf = z.infer<typeof PdfFormatSchema>;
type SchemaEpub = z.infer<typeof EpubFormatSchema>;
type SchemaMarkdown = z.infer<typeof MarkdownFormatSchema>;

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

type _pdfHasDisabledPreamble = Expect<'disabledPreambleFilters' extends keyof SchemaPdf ? true : false>;

import type { BuildDocument, SourceDocument } from '../types.js';
import { inferKind } from './infer-kind.js';
import { inferType } from './infer-type.js';
import { resolveTemplatePath } from './resolve-template.js';

/**
 * Clasifica un SourceDocument asignando type, kind y templatePath.
 * Los campos del pipeline aún no procesados (htmlFragment, templateContext,
 * outputHtml, outputPath) permanecen undefined hasta sus respectivos pasos.
 */
export function classify(doc: SourceDocument, theme?: string, cwd?: string): BuildDocument {
  const type = inferType(doc.frontmatter);
  const kind = inferKind(doc.frontmatter);
  const templatePath = resolveTemplatePath(type, theme, cwd);
  return { ...doc, type, kind, templatePath };
}

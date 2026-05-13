import type { TemplateContext } from '../../../template/render/context.js';

/**
 * Fusiona dos TemplateContext planos. Las claves de `override` tienen precedencia.
 */
export function mergeContexts(base: TemplateContext, override: TemplateContext): TemplateContext {
  return { ...base, ...override };
}

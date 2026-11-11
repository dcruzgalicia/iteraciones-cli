import { BLOG } from './blog.js';
import { type ProjectTemplate, writeTemplate } from './engine.js';
import { LIBRO } from './libro.js';

export const TEMPLATE_NAMES = ['blog', 'libro'] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

const TEMPLATES: Record<TemplateName, ProjectTemplate> = { blog: BLOG, libro: LIBRO };

export function isTemplateName(value: string): value is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(value);
}

export async function initTemplate(cwd: string, name: TemplateName): Promise<void> {
  await writeTemplate(cwd, name, TEMPLATES[name]);
}

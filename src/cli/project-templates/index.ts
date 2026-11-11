import { BLOG } from './blog.js';
import { type ProjectTemplate, writeTemplate } from './engine.js';

export const TEMPLATE_NAMES = ['blog'] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

const TEMPLATES: Record<TemplateName, ProjectTemplate> = { blog: BLOG };

export function isTemplateName(value: string): value is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(value);
}

export async function initTemplate(cwd: string, name: TemplateName): Promise<void> {
  await writeTemplate(cwd, name, TEMPLATES[name]);
}

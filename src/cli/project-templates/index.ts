import { type ProjectTemplate, writeTemplate } from './engine.js';

export const TEMPLATE_NAMES: readonly string[] = [];

export type TemplateName = string;

const TEMPLATES: Record<string, ProjectTemplate> = {};

export function isTemplateName(value: string): value is TemplateName {
  return Object.hasOwn(TEMPLATES, value);
}

export async function initTemplate(cwd: string, name: TemplateName): Promise<void> {
  await writeTemplate(cwd, name, TEMPLATES[name] as ProjectTemplate);
}

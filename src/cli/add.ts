import { ConfigError } from '../lib/errors.js';
import { addSveltia, type SveltiaWorkflow } from './add-sveltia.js';
import { createPrompter, isInteractive } from './prompts.js';

export interface AddOptions {
  prompt?: boolean;
  workflow?: string;
}

export const SVELTIA_WORKFLOWS: SveltiaWorkflow[] = ['simple', 'editorial', 'open-authoring'];

export function parseWorkflow(raw: string): SveltiaWorkflow {
  const workflow = raw.trim().toLowerCase();
  if (!SVELTIA_WORKFLOWS.includes(workflow as SveltiaWorkflow)) {
    throw new ConfigError(`flujo desconocido: "${raw}"; los flujos son: ${SVELTIA_WORKFLOWS.join(', ')}`, '');
  }
  return workflow as SveltiaWorkflow;
}

async function promptWorkflow(): Promise<SveltiaWorkflow> {
  if (!isInteractive()) {
    throw new ConfigError('add necesita una terminal para preguntar; usa --no-prompt y --workflow', '');
  }
  const prompter = createPrompter();
  try {
    const index = await prompter.choice('Flujo de Sveltia', ['simple', 'editorial workflow', 'open authoring'], 0);
    return SVELTIA_WORKFLOWS[index] ?? 'simple';
  } finally {
    prompter.close();
  }
}

export async function addExtension(cwd: string, extension: string, options: AddOptions = {}): Promise<void> {
  if (extension !== 'sveltia') {
    throw new ConfigError(`extensión desconocida: "${extension}"; la única extensión disponible es sveltia`, '');
  }

  let workflow = options.workflow === undefined ? undefined : parseWorkflow(options.workflow);
  if (workflow === undefined) {
    workflow = options.prompt === false ? 'simple' : await promptWorkflow();
  }
  await addSveltia(cwd, workflow);
}

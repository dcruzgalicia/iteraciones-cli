import { ConfigError } from '../lib/errors.js';
import {
  addSveltia,
  DEFAULT_APP_ID,
  DEFAULT_BRANCH,
  DEFAULT_REPO,
  DEFAULT_SITE_URL,
  type SveltiaWorkflow,
  siteUrlFromDomain,
} from './add-sveltia.js';
import { createPrompter, isInteractive, type Prompter } from './prompts.js';

export interface AddOptions {
  prompt?: boolean;
  workflow?: string;
  repo?: string;
  branch?: string;
  siteUrl?: string;
  siteDomain?: string;
  appId?: string;
  buildImage?: string;
  deploy?: string;
}

export const SVELTIA_WORKFLOWS: SveltiaWorkflow[] = ['simple', 'editorial', 'open-authoring'];

export function parseWorkflow(raw: string): SveltiaWorkflow {
  const workflow = raw.trim().toLowerCase();
  if (!SVELTIA_WORKFLOWS.includes(workflow as SveltiaWorkflow)) {
    throw new ConfigError(`flujo desconocido: "${raw}"; los flujos son: ${SVELTIA_WORKFLOWS.join(', ')}`, '');
  }
  return workflow as SveltiaWorkflow;
}

async function preguntar(prompt: Prompter | undefined, question: string, fallback: string): Promise<string> {
  return prompt === undefined ? fallback : prompt.ask(question, fallback);
}

function validarExtension(extension: string): void {
  if (extension !== 'sveltia') {
    throw new ConfigError(`extensión desconocida: "${extension}"; la única extensión disponible es sveltia`, '');
  }
}

function validarDeploy(deploy: string | undefined): void {
  if (deploy !== undefined && deploy.trim().toLowerCase() !== 'gitlab-pages') {
    throw new ConfigError(`destino de deploy desconocido: "${deploy}"; usa gitlab-pages`, '');
  }
}

async function elegirWorkflow(options: AddOptions, prompt: Prompter | undefined): Promise<SveltiaWorkflow> {
  if (options.workflow !== undefined) return parseWorkflow(options.workflow);
  if (prompt === undefined) return 'simple';
  const index = await prompt.choice('Flujo de Sveltia', ['simple', 'editorial workflow', 'open authoring'], 0);
  return SVELTIA_WORKFLOWS[index] ?? 'simple';
}

async function elegirDatos(
  options: AddOptions,
  prompt: Prompter | undefined,
): Promise<{ repo: string; branch: string; siteUrl: string; appId: string }> {
  const repo = options.repo ?? (await preguntar(prompt, 'Repositorio de GitLab (OWNER/REPO)', DEFAULT_REPO));
  const branch = options.branch ?? (await preguntar(prompt, 'Rama de GitLab', DEFAULT_BRANCH));
  const siteUrl = options.siteUrl ?? siteUrlFromDomain(options.siteDomain) ?? (await preguntar(prompt, 'URL pública del sitio', DEFAULT_SITE_URL));
  const appId = options.appId ?? (await preguntar(prompt, 'Application ID de GitLab', DEFAULT_APP_ID));
  return { repo, branch, siteUrl, appId };
}

export async function addExtension(cwd: string, extension: string, options: AddOptions = {}): Promise<void> {
  validarExtension(extension);
  validarDeploy(options.deploy);
  if (options.prompt !== false && !isInteractive()) {
    throw new ConfigError('add necesita una terminal para preguntar; usa --no-prompt y las opciones', '');
  }

  const prompt = options.prompt === false ? undefined : createPrompter();
  try {
    const workflow = await elegirWorkflow(options, prompt);
    const datos = await elegirDatos(options, prompt);
    await addSveltia(cwd, { workflow, ...datos, buildImage: options.buildImage });
  } finally {
    prompt?.close();
  }
}

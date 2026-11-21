import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path';
import { stringify } from 'yaml';
import { LICENSE_IDS, type LicenseId } from '../builder/licenses.js';
import { writeExclusive } from '../builder/pipeline-io.js';
import { ACCENT_COLORS, type AccentColor } from '../lib/accent-palettes.js';
import { ConfigError } from '../lib/errors.js';
import { HTML_STYLE_INPUTS, type HtmlStyle, htmlStyle } from '../lib/html-styles.js';
import { logInfo, logSuccess, logWarning } from '../lib/logger.js';
import { addSveltia, type SveltiaWorkflow } from './add-sveltia.js';
import { ensureGitignore, report } from './project-files.js';
import { createProjectTemplate, isTemplateName, TEMPLATE_NAMES } from './project-templates/index.js';
import { createPrompter, isInteractive, type Prompter } from './prompts.js';

const FORMATS = ['html', 'pdf', 'epub', 'latex', 'markdown'] as const;
const WORKFLOWS: SveltiaWorkflow[] = ['simple', 'editorial', 'open-authoring'];
const DEFAULT_LICENSE: LicenseId = 'CC-BY-NC-ND-4.0';

type Formato = (typeof FORMATS)[number];

export interface CreateOptions {
  prompt?: boolean;
  template?: string;
  title?: string;
  description?: string;
  format?: string;
  license?: string;
  bibliography?: string;
  theme?: string;
  style?: string;
  color?: string;
  sveltia?: boolean;
  editorialWorkflow?: boolean;
  openAuthoring?: boolean;
  git?: boolean;
  remote?: string;
}

interface ResolvedProject {
  title: string;
  description: string;
  formats: Formato[];
  license: LicenseId | undefined;
  bibliography: string | undefined;
  theme: 'light' | 'dark';
  style: HtmlStyle;
  color: AccentColor;
  sveltia: boolean;
  workflow: SveltiaWorkflow;
  useGit: boolean;
  remote: string | undefined;
}

function configError(message: string): ConfigError {
  return new ConfigError(message, '');
}

function parseFormats(raw: string): Formato[] {
  const formatos = raw
    .split(',')
    .map((formato) => formato.trim().toLowerCase())
    .filter(Boolean);
  if (formatos.length === 0) throw configError('--format necesita al menos un formato');
  for (const formato of formatos) {
    if (!FORMATS.includes(formato as Formato)) {
      throw configError(`formato desconocido: "${formato}"; los formatos son: ${FORMATS.join(', ')}`);
    }
  }
  return [...new Set(formatos)] as Formato[];
}

function parseLicense(raw: string): LicenseId | undefined {
  const licencia = raw.trim();
  if (licencia === '' || licencia.toLowerCase() === 'ninguna' || licencia.toLowerCase() === 'none') return undefined;
  if (!(LICENSE_IDS as readonly string[]).includes(licencia)) {
    throw configError(`licencia desconocida: "${raw}"; las licencias son: ${LICENSE_IDS.join(', ')}, ninguna`);
  }
  return licencia as LicenseId;
}

function parseTheme(raw: string): 'light' | 'dark' {
  const tema = raw.trim().toLowerCase();
  if (tema !== 'light' && tema !== 'dark') throw configError(`tema desconocido: "${raw}"; los temas son: light, dark`);
  return tema;
}

function parseStyle(raw: string): HtmlStyle {
  const estilo = raw.trim().toLowerCase();
  if (!(HTML_STYLE_INPUTS as readonly string[]).includes(estilo)) {
    throw configError(`estilo desconocido: "${raw}"; los estilos son: ${HTML_STYLE_INPUTS.join(', ')}`);
  }
  return htmlStyle(estilo);
}

function parseColor(raw: string): AccentColor {
  const color = raw.trim().toLowerCase();
  if (!(ACCENT_COLORS as readonly string[]).includes(color)) {
    throw configError(`color desconocido: "${raw}"; los colores son: ${ACCENT_COLORS.join(', ')}`);
  }
  return color as AccentColor;
}

function workflowFromFlags(options: CreateOptions): SveltiaWorkflow {
  if (options.openAuthoring === true) return 'open-authoring';
  if (options.editorialWorkflow === true) return 'editorial';
  return 'simple';
}

function projectConfig(options: ResolvedProject): string {
  const format: Record<string, unknown> = {};
  for (const nombre of FORMATS) {
    format[nombre] =
      nombre === 'html'
        ? {
            generate: options.formats.includes('html'),
            site: {
              title: options.title,
              description: options.description,
              style: options.style,
              theme: options.theme,
              color: options.color,
            },
          }
        : { generate: options.formats.includes(nombre) };
  }

  return stringify(
    {
      language: 'es-MX',
      toc: false,
      showDate: true,
      ...(options.license === undefined ? {} : { license: options.license }),
      ...(options.bibliography === undefined ? {} : { bibliography: options.bibliography }),
      format,
    },
    { lineWidth: 0 },
  );
}

function projectIndex(title: string): string {
  const frontmatter = stringify({ title }, { defaultKeyType: 'PLAIN', defaultStringType: 'QUOTE_DOUBLE' }).trimEnd();
  return `---\n${frontmatter}\n---\n\nEscribe aquí el contenido de tu proyecto.\n`;
}

function validateBibliography(bibliography: string): string {
  if (isAbsolute(bibliography) || normalize(bibliography).startsWith('..')) {
    throw configError(`--bibliography debe ser una ruta relativa al proyecto (recibido: "${bibliography}")`);
  }
  return bibliography;
}

function git(cwd: string, args: string[]): boolean {
  const proc = Bun.spawnSync(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' });
  return proc.exitCode === 0;
}

async function initGit(root: string, remote: string | undefined): Promise<void> {
  if (!git(root, ['rev-parse', '--is-inside-work-tree'])) {
    if (!git(root, ['init'])) throw configError('no se pudo inicializar el repositorio Git');
    logSuccess('inicializado repositorio Git', 'create');
  }
  if (remote === undefined) return;
  if (git(root, ['remote', 'get-url', 'origin'])) {
    logWarning('ya existe el remoto origin; no se reemplazó', 'create');
    return;
  }
  if (!git(root, ['remote', 'add', 'origin', remote])) throw configError(`no se pudo agregar el remoto "${remote}"`);
  logSuccess(`agregado remoto origin ${remote}`, 'create');
}

async function escribirBibliografia(root: string, bibliography: string): Promise<void> {
  const ruta = resolve(root, bibliography);
  if (existsSync(ruta)) return;
  await mkdir(dirname(ruta), { recursive: true });
  report(await writeExclusive(ruta, '% Agrega aquí tus referencias BibTeX.\n'), bibliography);
}

function defaultTitle(root: string): string {
  const nombre = basename(root);
  return nombre === '' || nombre === '.' ? 'Mi proyecto' : nombre;
}

function defaultDescription(): string {
  return 'escribir, compartir, re-existir';
}

function validateTemplateOptions(options: CreateOptions): void {
  const conflictivas: Array<[string, unknown]> = [
    ['--title', options.title],
    ['--description', options.description],
    ['--format', options.format],
    ['--license', options.license],
    ['--bibliography', options.bibliography],
    ['--theme', options.theme],
    ['--style', options.style],
    ['--color', options.color],
  ];
  const usadas = conflictivas.filter(([, valor]) => valor !== undefined).map(([nombre]) => nombre);
  if (usadas.length > 0) throw configError(`--template no se combina con ${usadas.join(', ')}`);
}

async function elegirTexto(option: string | undefined, prompt: Prompter | undefined, question: string, fallback: string): Promise<string> {
  if (option !== undefined) return option;
  if (prompt === undefined) return fallback;
  return prompt.ask(question, fallback);
}

async function elegirFormatos(option: string | undefined, prompt: Prompter | undefined): Promise<Formato[]> {
  if (option !== undefined) return parseFormats(option);
  if (prompt === undefined) return ['html'];
  return parseFormats(await prompt.ask('Formatos (html, pdf, epub, latex, markdown)', 'html'));
}

async function elegirBibliografia(option: string | undefined, prompt: Prompter | undefined, formats: Formato[]): Promise<string | undefined> {
  let bibliography = option;
  if (bibliography === undefined && prompt !== undefined && (formats.includes('pdf') || formats.includes('latex'))) {
    bibliography = await prompt.ask('Bibliografía .bib (vacío = ninguna)', '');
    if (bibliography === '') bibliography = undefined;
  }
  return bibliography === undefined ? undefined : validateBibliography(bibliography);
}

async function elegirLicencia(option: string | undefined, prompt: Prompter | undefined): Promise<LicenseId | undefined> {
  if (option !== undefined) return parseLicense(option);
  if (prompt === undefined) return DEFAULT_LICENSE;
  return parseLicense(await prompt.ask('Licencia (CC-BY-NC-ND-4.0, PF-AC-PR-FA-1.0, ninguna)', DEFAULT_LICENSE));
}

async function elegirHtml(
  options: CreateOptions,
  prompt: Prompter | undefined,
  formats: Formato[],
): Promise<{ theme: 'light' | 'dark'; style: HtmlStyle; color: AccentColor }> {
  if (!formats.includes('html')) return { theme: 'light', style: 'notebook', color: 'lime' };
  const theme =
    options.theme !== undefined
      ? parseTheme(options.theme)
      : prompt === undefined
        ? 'light'
        : parseTheme(await prompt.ask('Tema HTML (light, dark)', 'light'));
  const style =
    options.style !== undefined
      ? parseStyle(options.style)
      : prompt === undefined
        ? 'notebook'
        : parseStyle(await prompt.ask('Estilo HTML (radar, notebook, press, modern)', 'notebook'));
  const color =
    options.color !== undefined ? parseColor(options.color) : prompt === undefined ? 'lime' : parseColor(await prompt.ask('Color de acento', 'lime'));
  return { theme, style, color };
}

async function elegirSveltia(options: CreateOptions, prompt: Prompter | undefined): Promise<{ sveltia: boolean; workflow: SveltiaWorkflow }> {
  let sveltia = options.sveltia === true || options.editorialWorkflow === true || options.openAuthoring === true;
  if (prompt !== undefined && options.sveltia === undefined && !sveltia) sveltia = await prompt.yesNo('¿Agregar el admin de Sveltia?', false);

  let workflow = workflowFromFlags(options);
  if (prompt !== undefined && sveltia && options.editorialWorkflow !== true && options.openAuthoring !== true) {
    const index = await prompt.choice('Flujo de Sveltia', ['simple', 'editorial workflow', 'open authoring'], 0);
    workflow = WORKFLOWS[index] ?? 'simple';
  }
  return { sveltia, workflow };
}

async function elegirGit(options: CreateOptions, prompt: Prompter | undefined): Promise<{ useGit: boolean; remote: string | undefined }> {
  let remote = options.remote;
  let useGit = options.git === true || remote !== undefined;
  if (prompt !== undefined && options.git === undefined && remote === undefined) useGit = await prompt.yesNo('¿Inicializar Git?', false);
  if (prompt !== undefined && useGit && remote === undefined) {
    remote = await prompt.ask('Remoto Git (vacío = ninguno)', '');
    if (remote === '') remote = undefined;
  }
  return { useGit, remote };
}

async function resolverOpciones(root: string, prompt: Prompter | undefined, options: CreateOptions): Promise<ResolvedProject> {
  const title = await elegirTexto(options.title, prompt, 'Título del sitio', defaultTitle(root));
  const description = await elegirTexto(options.description, prompt, 'Descripción del sitio', defaultDescription());
  const formats = await elegirFormatos(options.format, prompt);
  const bibliography = await elegirBibliografia(options.bibliography, prompt, formats);
  const license = await elegirLicencia(options.license, prompt);
  const html = await elegirHtml(options, prompt, formats);
  const sveltia = await elegirSveltia(options, prompt);
  const git = await elegirGit(options, prompt);
  return { title, description, formats, bibliography, license, ...html, ...sveltia, ...git };
}

async function confirmar(root: string, resolved: ResolvedProject, prompt: Prompter): Promise<boolean> {
  const resumen = [
    `directorio: ${root}`,
    `formatos: ${resolved.formats.join(', ')}`,
    `licencia: ${resolved.license ?? 'ninguna'}`,
    `Sveltia: ${resolved.sveltia ? resolved.workflow : 'no'}`,
    `Git: ${resolved.useGit ? 'sí' : 'no'}`,
  ];
  logInfo(resumen.join('; '), 'create');
  if (await prompt.yesNo('¿Crear el proyecto?', true)) return true;
  logInfo('cancelado', 'create');
  return false;
}

async function resolverProyecto(
  cwd: string,
  directory: string | undefined,
  options: CreateOptions,
): Promise<{ root: string; resolved: ResolvedProject | undefined }> {
  if (options.prompt !== false && !isInteractive()) {
    throw configError('create necesita una terminal para preguntar; usa --no-prompt y las opciones');
  }
  const prompt = options.prompt === false ? undefined : createPrompter();
  try {
    const root =
      directory !== undefined
        ? resolve(cwd, directory)
        : prompt === undefined
          ? cwd
          : resolve(cwd, await prompt.ask('¿Dónde crear el proyecto?', '.'));
    const resolved = await resolverOpciones(root, prompt, options);
    if (prompt !== undefined && !(await confirmar(root, resolved, prompt))) return { root, resolved: undefined };
    return { root, resolved };
  } finally {
    prompt?.close();
  }
}

async function escribirProyecto(root: string, resolved: ResolvedProject): Promise<void> {
  await mkdir(root, { recursive: true });
  await ensureGitignore(root, 'create');
  report(await writeExclusive(resolve(root, 'iteraciones.config.yaml'), projectConfig(resolved)), 'iteraciones.config.yaml');
  report(await writeExclusive(resolve(root, 'index.md'), projectIndex(resolved.title)), 'index.md');
  if (resolved.bibliography !== undefined) await escribirBibliografia(root, resolved.bibliography);
  if (resolved.useGit) await initGit(root, resolved.remote);
  if (resolved.sveltia) await addSveltia(root, resolved.workflow);
  logSuccess(`proyecto creado en ${root}. Ejecuta 'iteraciones build'.`, 'create');
}

async function crearDesdePlantilla(cwd: string, directory: string | undefined, options: CreateOptions): Promise<void> {
  validateTemplateOptions(options);
  const template = options.template ?? '';
  if (!isTemplateName(template)) {
    throw configError(`plantilla desconocida: "${options.template}"; las plantillas son: ${TEMPLATE_NAMES.join(', ')}`);
  }
  const root = directory === undefined ? cwd : resolve(cwd, directory);
  await mkdir(root, { recursive: true });
  await createProjectTemplate(root, template);
  if (options.sveltia === true || options.editorialWorkflow === true || options.openAuthoring === true) {
    await addSveltia(root, workflowFromFlags(options));
  }
  if (options.git === true || options.remote !== undefined) await initGit(root, options.remote);
}

export async function createProject(cwd: string, directory: string | undefined, options: CreateOptions = {}): Promise<void> {
  if (options.template !== undefined) {
    await crearDesdePlantilla(cwd, directory, options);
    return;
  }
  const { root, resolved } = await resolverProyecto(cwd, directory, options);
  if (resolved !== undefined) await escribirProyecto(root, resolved);
}

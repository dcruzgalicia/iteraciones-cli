import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { logWarning } from '../lib/logger.js';
import { run } from '../lib/run.js';
import { buildLatexPreamble } from './latex-preamble.js';
import { loadStateFile, saveStateFile } from './state.js';
import type { DiscoveryEntry } from './types.js';

// ── Assets (CSS, fonts, logo) ──────────────────────────────────────────────

const PKG_ROOT = join(import.meta.dir, '../..');
const CSS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'styles.css');
const FONTS_SRC = join(PKG_ROOT, 'src', 'lib', 'resources', 'fonts');

export async function buildAssets(outputDir: string, cwd: string, siteConfig: SiteConfig, options: { noTailwind?: boolean } = {}): Promise<string> {
  const tasks: Promise<void>[] = [copyFonts(outputDir), copyLogo(outputDir, cwd, siteConfig)];
  if (!options.noTailwind) tasks.push(generateCss(outputDir, cwd, siteConfig.format?.html?.accent ?? 'lime'));
  await Promise.all(tasks);
  return options.noTailwind ? '' : '/css/styles.css';
}

async function generateCss(outputDir: string, cwd: string, accent: string): Promise<void> {
  const targetCssDir = join(outputDir, 'css');
  await mkdir(targetCssDir, { recursive: true });
  const targetCssPath = join(targetCssDir, 'styles.css');

  // Verificar si es necesario regenerar:
  // - Si _iteraciones.yaml cambió y el accent es distinto al previo
  // - O si styles.css (del paquete) cambió
  const targetExists = await Bun.file(targetCssPath).exists();
  if (targetExists) {
    try {
      const targetMtime = (await Bun.file(targetCssPath).stat()).mtimeMs;

      // ¿_iteraciones.yaml cambió?
      const configPath = join(cwd, '_iteraciones.yaml');
      const configMtime = await Bun.file(configPath)
        .stat()
        .then((s) => s.mtimeMs)
        .catch(() => 0);
      if (configMtime > targetMtime) {
        // Leer state.json para saber si el accent cambió
        const state = await loadStateFile(cwd);
        if (state?.cssAccent === accent) {
          return; // el accent no cambió, no hay nada que hacer
        }
      } else {
        // _iteraciones.yaml no cambió → el accent es el mismo.
        // Solo regenerar si styles.css (del paquete) cambió
        const cssMtime = (await Bun.file(CSS_SRC).stat()).mtimeMs;
        if (cssMtime < targetMtime) {
          return; // nada relevante cambió
        }
      }
    } catch {
      // Si falla la verificación, regenerar por las dudas
    }
  }

  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const accentTheme = shades.map((s) => `  --color-accent-${s}: var(--color-${accent}-${s});`).join('\n');
  await buildCssWithTailwind(targetCssPath, cwd, accentTheme);

  // Persistir el accent actual en state.json para el próximo build
  const state = (await loadStateFile(cwd)) ?? { startedAt: 0, activeFormats: [], entries: {} };
  state.cssAccent = accent;
  state.activeFormats = state.activeFormats ?? [];
  state.entries = state.entries ?? {};
  await saveStateFile(cwd, state);
}

async function buildCssWithTailwind(targetCssPath: string, cwd: string, accentTheme: string): Promise<void> {
  const tempInputPath = join(tmpdir(), `_iteraciones-${crypto.randomUUID()}.css`);
  const tempContent = [
    `@import "${CSS_SRC}";`,
    `@source "${PKG_ROOT}";`,
    `@source "${PKG_ROOT}/src/lib/resources";`,
    `@source "${cwd}";`,
    `@theme {`,
    accentTheme,
    `}`,
  ].join('\n');
  await writeFile(tempInputPath, tempContent, 'utf8');
  try {
    const result = await run('bun', ['x', '--bun', '@tailwindcss/cli', '-i', tempInputPath, '-o', targetCssPath, '--minify']);
    if (result.exitCode !== 0) throw new Error(`Tailwind CSS falló:\n${result.stderr}`);
  } finally {
    await rm(tempInputPath, { force: true });
  }
}

async function copyFonts(outputDir: string): Promise<void> {
  const target = join(outputDir, 'fonts');
  await cp(FONTS_SRC, target, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

async function copyLogo(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  const logo = siteConfig.logo?.trim();
  if (!logo) {
    const defaultSrc = join(PKG_ROOT, 'src', 'lib', 'resources', 'logo.svg');
    const dest = join(outputDir, 'logo.svg');
    await mkdir(dirname(dest), { recursive: true });
    await cp(defaultSrc, dest).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') logWarning(`logo por defecto no encontrado en "${defaultSrc}"`, 'assets');
      else {
        logWarning(`No se pudo copiar el logo por defecto: ${err.message}`, 'assets');
        process.exitCode = 1;
      }
    });
    return;
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    logWarning(`logo: ruta inválida "${logo}" — debe ser relativa al proyecto`, 'assets');
    process.exitCode = 1;
    return;
  }
  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') logWarning(`logo no encontrado: "${logo}"`, 'assets');
    else {
      logWarning(`No se pudo copiar el logo "${logo}": ${err.message}`, 'assets');
      process.exitCode = 1;
    }
  });
}

// ── HTML template ─────────────────────────────────────────────────────────

export interface HtmlTemplateVars {
  title: string;
  siteTitle: string;
  tagline?: string;
  lang: string;
  logoInline?: string;
  baseUrl?: string;
  theme?: string;
  accent?: string;
  css?: string;
  author?: string[];
}

const VAR_RE = /[\w-]+/;
const VAR_PATTERN = new RegExp(`\\$(${VAR_RE.source})\\$`, 'g');
const IF_PATTERN = new RegExp(`\\$if\\((${VAR_RE.source})\\)\\$([\\s\\S]*?)\\$endif\\$`, 'g');

export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  let result = template.replace(IF_PATTERN, (_match: string, name: string, content: string) => {
    const val = vars[name];
    if (val !== undefined && val !== '') return content.replace(VAR_PATTERN, (_m: string, n: string) => vars[n] ?? '');
    return '';
  });
  result = result.replace(VAR_PATTERN, (_match: string, name: string) => vars[name] ?? '');
  return result;
}

export async function renderHtmlPage(fragment: string, vars: HtmlTemplateVars): Promise<string> {
  const templatePath = join(import.meta.dir, '../../src/lib/resources/template.html');
  const template = await readFile(templatePath, 'utf-8');
  const theme = vars.theme ?? 'dark';
  const accent = vars.accent ?? 'lime';
  const templateVars: Record<string, string | undefined> = {
    body: fragment,
    title: vars.title,
    'site-title': vars.siteTitle,
    tagline: vars.tagline,
    lang: vars.lang,
    'logo-inline': vars.logoInline,
    'base-url': vars.baseUrl ?? '',
    theme,
    accent,
    css: vars.css,
    'author-meta': vars.author?.join(', '),
  };
  return renderTemplate(template, templateVars);
}

// ── LaTeX preamble generator ──────────────────────────────────────────────

export async function generateLatexPreamble(
  cwd: string,
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
  recentFiles: string[],
): Promise<void> {
  const pdfActive = siteConfig.format?.pdf?.generate === true || siteConfig.format?.latex === true;
  if (!pdfActive) return;
  const cacheBase = join(cwd, '.iteraciones');
  for (const relPath of recentFiles) {
    const entry = discoveryIndex.get(relPath);
    if (!entry) continue;
    const slug = entry.slug ?? basename(relPath, '.md');
    const dir = dirname(relPath);
    const texBodyPath = join(cacheBase, 'tex', dir, `${slug}.tex`);
    let texBody: string;
    try {
      texBody = await Bun.file(texBodyPath).text();
      texBody = texBody.replace(/\n+$/, '');
    } catch {
      continue;
    }
    // Flags de preámbulo: desde flags.json (calculados del AST en render.ts).
    // Fallback: caché anterior al cambio — detectar con regex y persistir el
    // flags.json para que el siguiente build ya use el camino del AST.
    const flagsPath = join(cacheBase, 'tex', dir, `${slug}.flags.json`);
    let flags: { hasTocEntries: boolean; skipNoIndent: boolean; skipParagraphSpace: boolean };
    try {
      flags = JSON.parse(await Bun.file(flagsPath).text()) as typeof flags;
    } catch {
      flags = detectFlagsFromLatex(texBody);
      await Bun.write(flagsPath, JSON.stringify(flags));
    }
    const { hasTocEntries, skipNoIndent, skipParagraphSpace } = flags;
    // Si el primer bloque es un parrafo, anteponer \noindent
    if (!skipNoIndent) {
      texBody = '\\noindent ' + texBody.trimStart();
    }
    const preamble = await buildLatexPreamble(
      siteConfig.format?.pdf,
      {
        title: entry.title,
        subtitle: entry.subtitle,
        author: entry.author,
        date: entry.date,
        filePath: join(cwd, relPath),
        cwd,
        hasTocEntries,
        skipNoIndent,
        skipParagraphSpace,
      },
      siteConfig.disabledPreambleTranspilers,
    );
    const fullTex = [...preamble, '', texBody, '', '\\end{document}'].join('\n');
    const pdfDir = join(cacheBase, 'formats', 'pdf', dir);
    await mkdir(pdfDir, { recursive: true });
    await Bun.write(join(pdfDir, `${slug}.tex`), fullTex);
  }
}

/**
 * Fallback transitorio de migración: detecta los flags de preámbulo con
 * regex/startsWith sobre el LaTeX (mecanismo anterior a #1041). Solo se usa
 * cuando flags.json no existe (caché generado antes del cambio); el resultado
 * se persiste para que el siguiente build use el camino del AST.
 * Se eliminará junto con #982 (AST canónico).
 */
function detectFlagsFromLatex(texBody: string): { hasTocEntries: boolean; skipNoIndent: boolean; skipParagraphSpace: boolean } {
  const hasTocEntries = /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\{/.test(texBody);
  const trimmed = texBody.trimStart();
  const isSectionStart =
    trimmed.startsWith('\\chapter{') ||
    trimmed.startsWith('\\section{') ||
    trimmed.startsWith('\\subsection{') ||
    trimmed.startsWith('\\subsubsection{') ||
    trimmed.startsWith('\\paragraph{') ||
    trimmed.startsWith('\\subparagraph{');
  const isDictumStart = trimmed.startsWith('\\dictum[') || trimmed.startsWith('\\dictum{') || trimmed.startsWith('\\vspace*{');
  return {
    hasTocEntries,
    skipNoIndent: isSectionStart || isDictumStart,
    skipParagraphSpace: isSectionStart,
  };
}

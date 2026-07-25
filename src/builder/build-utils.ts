import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { run } from '../lib/run.js';
import type { BuildReport } from './discover.js';
import { buildLatexPreamble } from './latex-preamble.js';
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
  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const accentTheme = shades.map((s) => `  --color-accent-${s}: var(--color-${accent}-${s});`).join('\n');

  await buildCssWithTailwind(targetCssPath, cwd, accentTheme);
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
      if (err.code === 'ENOENT') process.stderr.write(`\r\x1b[K⚠ logo por defecto no encontrado en "${defaultSrc}"\n`);
      else {
        process.stderr.write(`\n⚠ No se pudo copiar el logo por defecto: ${err.message}\n`);
        process.exitCode = 1;
      }
    });
    return;
  }
  if (logo.split('/').includes('..') || logo.startsWith('/')) {
    process.stderr.write(`\n⚠ logo: ruta inválida "${logo}" — debe ser relativa al proyecto\n`);
    process.exitCode = 1;
    return;
  }
  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') process.stderr.write(`\r\x1b[K⚠ logo no encontrado: "${logo}"\n`);
    else {
      process.stderr.write(`\n⚠ No se pudo copiar el logo "${logo}": ${err.message}\n`);
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
  description?: string;
}

const VAR_RE = /[\w-]+/;
const VAR_PATTERN = new RegExp(`\\$(${VAR_RE.source})\\$`, 'g');
const IF_PATTERN = new RegExp(`\\$if\\((${VAR_RE.source})\\)\\$([\\s\\S]*?)\\$endif\\$`, 'g');

function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
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
    'description-meta': vars.description,
  };
  return renderTemplate(template, templateVars);
}

// ── LaTeX preamble generator ──────────────────────────────────────────────

export async function generateLatexPreamble(
  cwd: string,
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
  diff: BuildReport,
): Promise<void> {
  const pdfActive = siteConfig.format?.pdf?.generate === true || siteConfig.format?.latex === true;
  if (!pdfActive) return;
  const cacheBase = join(cwd, '.iteraciones');
  for (const relPath of diff.recentFiles) {
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
    const preamble = await buildLatexPreamble(
      siteConfig.format?.pdf,
      { title: entry.title, author: entry.author, filePath: join(cwd, relPath), cwd },
      siteConfig.disabledPreambleTranspilers,
    );
    const fullTex = [...preamble, '', texBody, '', '\\end{document}'].join('\n');
    const pdfDir = join(cacheBase, 'formats', 'pdf', dir);
    await mkdir(pdfDir, { recursive: true });
    await Bun.write(join(pdfDir, `${slug}.tex`), fullTex);
  }
}

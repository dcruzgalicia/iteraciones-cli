import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PKG_ROOT = join(import.meta.dir, '../..');

export interface ThemePaths {
  layoutPath: string;
  pandocTemplatePath: string;
  templatesDir: string;
}

const KNOWN_THEMES = new Set(['light', 'dark']);

export function resolveThemePaths(theme: string | undefined): ThemePaths {
  const name = theme ?? 'light';
  if (name === 'dark') {
    const root = join(PKG_ROOT, 'themes/dark');
    return {
      layoutPath: join(root, 'layouts/default.html'),
      pandocTemplatePath: join(root, 'pandoc/template.html'),
      templatesDir: join(root, 'templates'),
    };
  }
  if (theme !== undefined && !KNOWN_THEMES.has(name)) {
    console.warn(`[iteraciones] Tema desconocido: "${theme}". Usando el tema claro por defecto.`);
  }
  return {
    layoutPath: join(PKG_ROOT, 'layouts/default.html'),
    pandocTemplatePath: join(PKG_ROOT, 'pandoc/template.html'),
    templatesDir: join(PKG_ROOT, 'templates'),
  };
}

/**
 * Resuelve los paths efectivos con prioridad de tres niveles:
 * 1. Proyecto (cwd/layouts/default.html, cwd/pandoc/template.html)
 * 2. Tema built-in (themes/dark/ o raíz del paquete según theme)
 * Los overrides de templates individuales se resuelven en resolveTemplatePath.
 */
export function resolveEffectivePaths(theme: string | undefined, cwd: string): ThemePaths {
  const base = resolveThemePaths(theme);
  const projectLayout = join(cwd, 'layouts/default.html');
  const projectPandoc = join(cwd, 'pandoc/template.html');
  return {
    layoutPath: existsSync(projectLayout) ? projectLayout : base.layoutPath,
    pandocTemplatePath: existsSync(projectPandoc) ? projectPandoc : base.pandocTemplatePath,
    templatesDir: base.templatesDir,
  };
}

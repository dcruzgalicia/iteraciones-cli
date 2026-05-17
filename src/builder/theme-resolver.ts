import { join } from 'node:path';

const PKG_ROOT = join(import.meta.dir, '../..');

export interface ThemePaths {
  layoutPath: string;
  pandocTemplatePath: string;
  templatesDir: string;
}

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
  return {
    layoutPath: join(PKG_ROOT, 'layouts/default.html'),
    pandocTemplatePath: join(PKG_ROOT, 'pandoc/template.html'),
    templatesDir: join(PKG_ROOT, 'templates'),
  };
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSiteConfig } from '../../config/config-loader.js';
import { ConfigError } from '../../errors.js';
import type { CheckResult } from './system-checks.js';

const PKG_ROOT = join(import.meta.dir, '../../..');

export async function checkSiteConfig(cwd: string): Promise<CheckResult> {
  try {
    await loadSiteConfig(cwd);
    return { label: '_iteraciones.yaml', ok: true };
  } catch (err) {
    if (err instanceof ConfigError) {
      return { label: '_iteraciones.yaml', ok: false, detail: err.message };
    }
    return { label: '_iteraciones.yaml', ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export function checkTemplates(cwd: string): CheckResult {
  // Los templates del paquete CLI se envían junto con el binario; siempre accesibles.
  // Si el proyecto tiene una carpeta local templates/ también es válido.
  const pkgTemplates = join(PKG_ROOT, 'templates');
  const localTemplates = join(cwd, 'templates');

  if (existsSync(join(localTemplates, 'page.html'))) {
    return { label: 'templates/', ok: true, detail: `locales: ${localTemplates}` };
  }
  if (existsSync(join(pkgTemplates, 'page.html'))) {
    return { label: 'templates/', ok: true, detail: `del paquete CLI: ${pkgTemplates}` };
  }
  return { label: 'templates/', ok: false, detail: 'no se encontró page.html ni en templates/ local ni en el paquete CLI' };
}

import { loadSiteConfig } from '../../config/config-loader.js';
import { ConfigError } from '../../errors.js';
import type { CheckResult } from './system-checks.js';

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

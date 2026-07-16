import { getBuiltinTranspilerInfos } from '../builder/pipeline/render.js';
import { loadSiteConfig } from '../config/config-loader.js';

/**
 * Muestra la lista de transpilers disponibles y su estado (activo/inactivo).
 */
export async function runTranspilers(cwd: string): Promise<void> {
  const config = await loadSiteConfig(cwd);
  const disabled = new Set(config.disabledTranspilers ?? []);
  const allInfos = getBuiltinTranspilerInfos();
  const hasDisabled = config.disabledTranspilers !== undefined && config.disabledTranspilers.length > 0;

  process.stdout.write('Transpilers disponibles (orden de ejecución):\n\n');

  for (const info of allInfos) {
    const active = !disabled.has(info.name);
    const status = active ? 'activo' : 'desactivado';
    const typeLabel = info.type === 'string' ? 'string' : 'ast    ';
    process.stdout.write(`  ${info.name}  ${typeLabel}  ${info.description}  [${status}]\n`);
  }

  process.stdout.write('\n');
  if (hasDisabled) {
    process.stdout.write('Para reactivar uno, elimínalo de la lista `disabled-transpilers:` en _iteraciones.yaml.\n');
  } else {
    process.stdout.write('Para desactivar uno, agrégalo a la lista `disabled-transpilers:` en _iteraciones.yaml.\n');
  }
  process.stdout.write('Para sobrescribir un transpiler, crea `<proyecto>/transpilers/<nombre>.ts`.\n');
}

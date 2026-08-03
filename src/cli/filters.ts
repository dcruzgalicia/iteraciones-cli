import { getBuiltinPreambleTranspilerInfos, validateDisabledPreambleTranspilers } from '../builder/preamble-loader.js';
import { getBuiltinLuaTranspilerInfos, validateDisabledTranspilers } from '../builder/render.js';
import { loadSiteConfig } from '../config/config-loader.js';

/**
 * Muestra la lista de filtros (transpilers) disponibles y su estado (activo/inactivo).
 */
export async function runFilters(cwd: string): Promise<void> {
  const config = await loadSiteConfig(cwd);
  // Advertir sobre nombres desconocidos antes de listar el estado
  validateDisabledTranspilers(config.disabledTranspilers);
  validateDisabledPreambleTranspilers(config.disabledPreambleTranspilers);
  const disabled = new Set(config.disabledTranspilers ?? []);
  const allInfos = await getBuiltinLuaTranspilerInfos();
  const hasDisabled = config.disabledTranspilers !== undefined && config.disabledTranspilers.length > 0;

  process.stdout.write('Filtros disponibles (orden de ejecución):\n\n');

  for (const info of allInfos) {
    const active = !disabled.has(info.name);
    const status = active ? 'activo' : 'desactivado';
    process.stdout.write(`  ${info.name}  lua     ${info.description}  [${status}]\n`);
  }

  process.stdout.write('\n');
  if (hasDisabled) {
    process.stdout.write('Para reactivar uno, elimínalo de la lista `disabled-transpilers:` en iteraciones.config.yaml.\n');
  } else {
    process.stdout.write('Para desactivar uno, agrégalo a la lista `disabled-transpilers:` en iteraciones.config.yaml.\n');
  }
  process.stdout.write(
    'Para sobrescribir un filtro, crea `<proyecto>/transpilers/<grupo>/<nombre>.lua` (p. ej. `transpilers/latex/02-dictum.lua`).\n',
  );

  // Preamble transpilers
  const preambleInfos = getBuiltinPreambleTranspilerInfos();
  if (preambleInfos.length > 0) {
    const preambleDisabled = new Set(config.disabledPreambleTranspilers ?? []);
    const hasPreambleDisabled = config.disabledPreambleTranspilers !== undefined && config.disabledPreambleTranspilers.length > 0;

    process.stdout.write('\nFiltros de preámbulo (orden de ejecución):\n\n');

    for (const info of preambleInfos) {
      const active = !preambleDisabled.has(info.name);
      const status = active ? 'activo' : 'desactivado';
      process.stdout.write(`  ${info.name}  ${info.description}  [${status}]\n`);
    }

    process.stdout.write('\n');
    if (hasPreambleDisabled) {
      process.stdout.write('Para reactivar uno, elimínalo de la lista `disabled-preamble-transpilers:` en iteraciones.config.yaml.\n');
    } else {
      process.stdout.write('Para desactivar uno, agrégalo a la lista `disabled-preamble-transpilers:` en iteraciones.config.yaml.\n');
    }
    process.stdout.write('Para sobrescribir un filtro de preámbulo, crea `<proyecto>/preamble/<nombre>.tex` con contenido LaTeX.\n');
  }
}

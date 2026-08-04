import { getBuiltinPreambleFilterInfos, validateDisabledPreambleFilters } from '../builder/preamble-loader.js';
import { getBuiltinLuaFilterInfos, validateDisabledFilters } from '../builder/render.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { logInfo } from '../lib/logger.js';

/**
 * Muestra la lista de filtros (filters) disponibles y su estado (activo/inactivo).
 */
export async function runFilters(cwd: string): Promise<void> {
  const config = await loadSiteConfig(cwd);
  // Advertir sobre nombres desconocidos antes de listar el estado
  validateDisabledFilters(config.disabledFilters);
  validateDisabledPreambleFilters(config.disabledPreambleFilters);
  const disabled = new Set(config.disabledFilters ?? []);
  const allInfos = await getBuiltinLuaFilterInfos();
  const hasDisabled = config.disabledFilters !== undefined && config.disabledFilters.length > 0;

  logInfo('Filtros disponibles (orden de ejecución):');
  logInfo('');

  for (const info of allInfos) {
    const active = !disabled.has(info.name);
    const status = active ? 'activo' : 'desactivado';
    logInfo(`  ${info.name}  lua     ${info.description}  [${status}]`);
  }

  logInfo('');
  if (hasDisabled) {
    logInfo('Para reactivar uno, elimínalo de la lista `disabled-filters:` en iteraciones.config.yaml.');
  } else {
    logInfo('Para desactivar uno, agrégalo a la lista `disabled-filters:` en iteraciones.config.yaml.');
  }
  logInfo('Para sobrescribir un filtro, crea `<proyecto>/filters/<grupo>/<nombre>.lua` (p. ej. `filters/latex/02-dictum.lua`).');

  // Preamble filters
  const preambleInfos = getBuiltinPreambleFilterInfos();
  if (preambleInfos.length > 0) {
    const preambleDisabled = new Set(config.disabledPreambleFilters ?? []);
    const hasPreambleDisabled = config.disabledPreambleFilters !== undefined && config.disabledPreambleFilters.length > 0;

    logInfo('');
    logInfo('Filtros de preámbulo (orden de ejecución):');
    logInfo('');

    for (const info of preambleInfos) {
      const active = !preambleDisabled.has(info.name);
      const status = active ? 'activo' : 'desactivado';
      logInfo(`  ${info.name}  ${info.description}  [${status}]`);
    }

    logInfo('');
    if (hasPreambleDisabled) {
      logInfo('Para reactivar uno, elimínalo de la lista `disabled-preamble-filters:` en iteraciones.config.yaml.');
    } else {
      logInfo('Para desactivar uno, agrégalo a la lista `disabled-preamble-filters:` en iteraciones.config.yaml.');
    }
    logInfo('Para sobrescribir un filtro de preámbulo, crea `<proyecto>/preamble/<nombre>.tex` con contenido LaTeX.');
  }
}

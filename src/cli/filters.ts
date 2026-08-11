import { getBuiltinLuaFilterInfos, LUA_GROUP_ORDER, validateDisabledFilters } from '../builder/filter-resolver.js';
import { getBuiltinPreambleFilterInfos, validateDisabledPreambleFilters } from '../builder/preamble-loader.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { logInfo } from '../lib/logger.js';

function sortLuaInfos(infos: Awaited<ReturnType<typeof getBuiltinLuaFilterInfos>>) {
  return infos.sort((a, b) => {
    const groupA = a.name.split('/').slice(0, -1).join('/');
    const groupB = b.name.split('/').slice(0, -1).join('/');
    const orderA = LUA_GROUP_ORDER.indexOf(groupA);
    const orderB = LUA_GROUP_ORDER.indexOf(groupB);
    if (orderA !== orderB) return orderA - orderB;
    // Dentro del mismo grupo, el orden se mantiene (viene del nombre del archivo)
    return a.name.localeCompare(b.name);
  });
}

/**
 * Muestra la lista de filtros (filters) disponibles y su estado (activo/inactivo).
 */
export async function runFilters(cwd: string): Promise<void> {
  const config = await loadSiteConfig(cwd);
  // Advertir sobre nombres desconocidos antes de listar el estado
  validateDisabledFilters(config.disabledFilters);
  validateDisabledPreambleFilters(config.format?.pdf?.disabledPreambleFilters);
  const disabled = new Set(config.disabledFilters ?? []);
  const allInfos = sortLuaInfos(await getBuiltinLuaFilterInfos());
  const hasDisabled = config.disabledFilters !== undefined && config.disabledFilters.length > 0;

  logInfo('Filtros disponibles (orden de ejecución):');
  logInfo('');

  // Columna de nombres alineada (padEnd sobre el ancho máximo)
  const nameWidth = Math.max(...allInfos.map((info) => info.name.length));
  for (const info of allInfos) {
    const active = !disabled.has(info.name);
    const status = active ? 'activo' : 'desactivado';
    logInfo(`  ${info.name.padEnd(nameWidth)}  lua  ${info.description}  [${status}]`);
  }

  logInfo('');
  if (hasDisabled) {
    logInfo('Para reactivar uno, elimínalo de la lista `disabled-filters:` en iteraciones.config.yaml.');
  } else {
    logInfo('Para desactivar uno, agrégalo a la lista `disabled-filters:` en iteraciones.config.yaml.');
  }
  logInfo('Para sobrescribir un filtro, crea `<proyecto>/filters/<grupo>/<nombre>.lua` (p. ej. `filters/latex/02-dictum.lua`).');

  // Preamble filters
  const preambleInfos = await getBuiltinPreambleFilterInfos();
  if (preambleInfos.length > 0) {
    const preambleDisabled = new Set(config.format?.pdf?.disabledPreambleFilters ?? []);
    const hasPreambleDisabled = config.format?.pdf?.disabledPreambleFilters !== undefined && config.format?.pdf?.disabledPreambleFilters.length > 0;

    logInfo('');
    logInfo('Filtros de preámbulo (orden de ejecución):');
    logInfo('');

    const preambleWidth = Math.max(...preambleInfos.map((info) => info.name.length));
    for (const info of preambleInfos) {
      const active = !preambleDisabled.has(info.name);
      const status = active ? 'activo' : 'desactivado';
      logInfo(`  ${info.name.padEnd(preambleWidth)}  ${info.description}  [${status}]`);
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

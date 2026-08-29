import { getBuiltinLuaFilterInfos, LUA_GROUP_ORDER, validateDisabledFilters } from '../builder/filter-resolver.js';
import { getBuiltinPreambleFilterInfos, resolveEffectiveDisabledPreamble, validateDisabledPreambleFilters } from '../builder/preamble-loader.js';
import { loadSiteConfigIfPresent } from '../config/config-loader.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
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

/** Primera oración de la descripción, con tope de 100 caracteres (#2027). */
function shortDescription(description: string): string {
  const sentence = description.split(/(?<=\.)\s/, 1)[0] ?? description;
  return sentence.length <= 100 ? sentence : `${sentence.slice(0, 99)}…`;
}

export interface RunFiltersOptions {
  /** Stream de salida (inyectable en tests; por defecto stdout). */
  stream?: NodeJS.WriteStream;
  /** Descripción completa por filtro (por defecto: primera oración, ≤100 chars). */
  verbose?: boolean;
  /** Ancho de terminal fijo (inyectable en tests; por defecto se consulta el stream). */
  columns?: number;
  /** Imprime JSON estructurado en stdout (consumo programático). */
  json?: boolean;
}

/**
 * Ancho de terminal disponible (solo TTY). En pipes no hay ancho conocido:
 * las descripciones se muestran completas (el usuario puede desplazarse).
 * El stream y el ancho son inyectables: la suite fija un ancho conocido y no
 * depende del terminal real (patrón del constructor de ProgressTracker).
 */
function terminalColumns(stream: NodeJS.WriteStream, fixedColumns?: number): number | undefined {
  if (fixedColumns !== undefined) return fixedColumns > 0 ? fixedColumns : undefined;
  return stream.isTTY === true && stream.columns ? stream.columns : undefined;
}

/** Trunca un texto con elipsis al ancho dado (nunca corta a media palabra). */
function truncateWithEllipsis(text: string, width: number): string {
  if (text.length <= width) return text;
  const cut = Math.max(0, width - 1);
  // Cortar en el último espacio antes del límite: sin palabras partidas
  const lastSpace = text.lastIndexOf(' ', cut);
  const end = lastSpace > 0 ? lastSpace : cut;
  return `${text.slice(0, end)}…`;
}

/**
 * Muestra la lista de filtros (filters) disponibles y su estado (activo/inactivo).
 * Las filas se imprimen sin prefijo (formato tabla); solo los encabezados de
 * sección y las pistas usan el prefijo ℹ del logger.
 */
export async function listFilters(cwd: string, options: RunFiltersOptions = {}): Promise<void> {
  const stream = options.stream ?? process.stdout;
  // list-filters tolera proyectos sin config: muestra el estado por defecto.
  const config = (await loadSiteConfigIfPresent(cwd))?.config ?? DEFAULT_SITE_CONFIG;
  // Advertir sobre nombres desconocidos antes de listar el estado
  validateDisabledFilters(config.disabledFilters);
  // Resolver dependencias implícitas (08-hyperref se desactiva con 99-pdfx)
  const effectiveDisabledPreamble = resolveEffectiveDisabledPreamble(config.format?.pdf?.disabledPreambleFilters);
  validateDisabledPreambleFilters(effectiveDisabledPreamble);
  const disabled = new Set(config.disabledFilters ?? []);
  const allInfos = sortLuaInfos(await getBuiltinLuaFilterInfos());
  const hasDisabled = config.disabledFilters !== undefined && config.disabledFilters.length > 0;

  if (options.json) {
    const filters = allInfos.map((info) => ({
      name: info.name,
      type: 'lua' as const,
      description: info.description,
      active: !disabled.has(info.name),
    }));
    const preambleInfos = await getBuiltinPreambleFilterInfos();
    const preambleDisabled = new Set(effectiveDisabledPreamble);
    const preamble = preambleInfos.map((info) => ({
      name: info.name,
      type: 'preamble' as const,
      description: info.description,
      active: !preambleDisabled.has(info.name),
    }));
    process.stdout.write(`${JSON.stringify({ filters, preamble })}
`);
    return;
  }

  logInfo('Filtros disponibles (orden de ejecución):');
  logInfo('');

  // Columna de nombres alineada (padEnd sobre el ancho máximo)
  const nameWidth = Math.max(...allInfos.map((info) => info.name.length));
  // 2 (indent) + nameWidth + 2 + 'lua' (3) + 2 + desc + 2 + '[estado]' (8)
  const columns = terminalColumns(stream, options.columns);
  const descWidth = columns === undefined ? undefined : Math.max(10, columns - 2 - nameWidth - 2 - 3 - 2 - 8);
  for (const info of allInfos) {
    const active = !disabled.has(info.name);
    const status = active ? 'activo' : 'desactivado';
    const full = options.verbose === true ? info.description : shortDescription(info.description);
    const description = descWidth !== undefined && !options.verbose ? truncateWithEllipsis(full, descWidth) : full;
    stream.write(`  ${info.name.padEnd(nameWidth)}  lua  ${description}  [${status}]\n`);
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
    const preambleDisabled = new Set(effectiveDisabledPreamble);
    const hasPreambleDisabled = effectiveDisabledPreamble.length > 0;

    logInfo('');
    logInfo('Filtros de preámbulo (orden de ejecución):');
    logInfo('');

    const preambleWidth = Math.max(...preambleInfos.map((info) => info.name.length));
    const preambleDescWidth = columns === undefined ? undefined : Math.max(10, columns - 2 - preambleWidth - 2 - 2 - 8);
    for (const info of preambleInfos) {
      const active = !preambleDisabled.has(info.name);
      const status = active ? 'activo' : 'desactivado';
      const full = options.verbose === true ? info.description : shortDescription(info.description);
      const description = preambleDescWidth !== undefined && !options.verbose ? truncateWithEllipsis(full, preambleDescWidth) : full;
      stream.write(`  ${info.name.padEnd(preambleWidth)}  ${description}  [${status}]\n`);
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

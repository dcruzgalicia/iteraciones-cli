import { getBuiltinLuaFilterInfos, LUA_GROUP_ORDER, validateDisabledFilters } from '../builder/filter-resolver.js';
import {
  disableBibliographyWithoutBibFiles,
  getBuiltinPreambleFilterInfos,
  projectPreambleDirs,
  resolveEffectiveDisabledPreamble,
  validateDisabledPreambleFilters,
} from '../builder/preamble-loader.js';
import { resolveBibOptions } from '../builder/state-bib.js';
import { loadSiteConfigIfPresent } from '../config/config-loader.js';
import { DEFAULT_SITE_CONFIG, resolveDisabledPreambleConfig } from '../config/site-config.js';
import { logInfo } from '../lib/logger.js';

function sortLuaInfos(infos: Awaited<ReturnType<typeof getBuiltinLuaFilterInfos>>) {
  return infos.sort((a, b) => {
    const groupA = a.name.split('/').slice(0, -1).join('/');
    const groupB = b.name.split('/').slice(0, -1).join('/');
    const orderA = LUA_GROUP_ORDER.indexOf(groupA);
    const orderB = LUA_GROUP_ORDER.indexOf(groupB);
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

function shortDescription(description: string): string {
  const sentence = description.split(/(?<=\.)\s/, 1)[0] ?? description;
  return sentence.length <= 100 ? sentence : `${sentence.slice(0, 99)}…`;
}

export interface RunFiltersOptions {
  stream?: NodeJS.WriteStream;
  verbose?: boolean;
  columns?: number;
  json?: boolean;
}

function terminalColumns(stream: NodeJS.WriteStream, fixedColumns?: number): number | undefined {
  if (fixedColumns !== undefined) return fixedColumns > 0 ? fixedColumns : undefined;
  return stream.isTTY === true && stream.columns ? stream.columns : undefined;
}

function truncateWithEllipsis(text: string, width: number): string {
  if (text.length <= width) return text;
  const cut = Math.max(0, width - 1);
  const lastSpace = text.lastIndexOf(' ', cut);
  const end = lastSpace > 0 ? lastSpace : cut;
  return `${text.slice(0, end)}…`;
}

async function emitJsonOutput(
  allInfos: Awaited<ReturnType<typeof getBuiltinLuaFilterInfos>>,
  disabled: Set<string>,
  effectiveDisabledPreamble: string[],
): Promise<void> {
  const filters = allInfos.map((info) => ({
    name: info.name,
    type: 'lua' as const,
    description: info.description,
    active: !disabled.has(info.name),
  }));
  const preambleDisabled = new Set(effectiveDisabledPreamble);
  const preambleInfos = await getBuiltinPreambleFilterInfos();
  const preamble = preambleInfos.map((info) => ({
    name: info.name,
    type: 'preamble' as const,
    description: info.description,
    active: !preambleDisabled.has(info.name),
  }));
  process.stdout.write(`${JSON.stringify({ filters, preamble })}\n`);
}

function emitBlock(
  stream: NodeJS.WriteStream,
  infos: { name: string; description: string }[],
  disabled: Set<string>,
  options: RunFiltersOptions,
  columns: number | undefined,
  typeCol: string,
): void {
  const nameWidth = Math.max(...infos.map((info) => info.name.length));
  const descWidth = columns === undefined ? undefined : Math.max(10, columns - 2 - nameWidth - 2 - typeCol.length - 2 - 8);
  const type = typeCol === '' ? '' : `${typeCol}  `;
  for (const info of infos) {
    const active = !disabled.has(info.name);
    const status = active ? 'activo' : 'desactivado';
    const full = options.verbose === true ? info.description : shortDescription(info.description);
    const description = descWidth !== undefined && !options.verbose ? truncateWithEllipsis(full, descWidth) : full;
    stream.write(`  ${info.name.padEnd(nameWidth)}  ${type}${description}  [${status}]\n`);
  }
}

async function emitPreambleBlock(
  stream: NodeJS.WriteStream,
  effectiveDisabledPreamble: string[],
  options: RunFiltersOptions,
  columns: number | undefined,
): Promise<void> {
  const preambleInfos = await getBuiltinPreambleFilterInfos();
  if (preambleInfos.length === 0) return;
  const preambleDisabled = new Set(effectiveDisabledPreamble);
  const hasPreambleDisabled = effectiveDisabledPreamble.length > 0;
  logInfo('');
  logInfo('Filtros de preámbulo (orden de ejecución):');
  logInfo('');
  emitBlock(stream, preambleInfos, preambleDisabled, options, columns, '');
  logInfo('');
  if (hasPreambleDisabled) {
    logInfo('Para reactivar uno, elimínalo de la lista `disabledPreambleFilters:` en iteraciones.config.yaml.');
  } else {
    logInfo('Para desactivar uno, agrégalo a la lista `disabledPreambleFilters:` en iteraciones.config.yaml.');
  }
  logInfo(
    `Para sobrescribir un filtro de preámbulo, crea \`<proyecto>/<dir>/<nombre>.tex\` con contenido LaTeX, donde <dir> es ${projectPreambleDirs().join(', ')} (el de tu tipo de documento).`,
  );
}

export async function listFilters(cwd: string, options: RunFiltersOptions = {}): Promise<void> {
  const stream = options.stream ?? process.stdout;
  const config = (await loadSiteConfigIfPresent(cwd))?.config ?? DEFAULT_SITE_CONFIG;
  validateDisabledFilters(config.disabledFilters);

  const bibFiles = await resolveBibOptions(cwd, config)
    .then((r) => r.bibFiles)
    .catch(() => undefined);
  const effectiveDisabledPreamble = disableBibliographyWithoutBibFiles(
    resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(config)),
    bibFiles,
  );
  validateDisabledPreambleFilters(effectiveDisabledPreamble);
  const disabled = new Set(config.disabledFilters ?? []);
  const allInfos = sortLuaInfos(await getBuiltinLuaFilterInfos());
  const hasDisabled = config.disabledFilters !== undefined && config.disabledFilters.length > 0;

  if (options.json) {
    await emitJsonOutput(allInfos, disabled, effectiveDisabledPreamble);
    return;
  }

  logInfo('Filtros disponibles (orden de ejecución):');
  logInfo('');
  emitBlock(stream, allInfos, disabled, options, terminalColumns(stream, options.columns), 'lua');
  logInfo('');
  if (hasDisabled) {
    logInfo('Para reactivar uno, elimínalo de la lista `disabledFilters:` en iteraciones.config.yaml.');
  } else {
    logInfo('Para desactivar uno, agrégalo a la lista `disabledFilters:` en iteraciones.config.yaml.');
  }
  logInfo('Para sobrescribir un filtro, crea `<proyecto>/filters/<grupo>/<nombre>.lua` (p. ej. `filters/latex/02-dictum.lua`).');
  await emitPreambleBlock(stream, effectiveDisabledPreamble, options, terminalColumns(stream, options.columns));
}

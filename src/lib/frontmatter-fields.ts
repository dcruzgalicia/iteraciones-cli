export function fmString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

export function fmBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function fmTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function fmStringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return value.trim() ? [value] : undefined;
  if (Array.isArray(value)) {
    const items = value
      .filter((v): v is string => typeof v === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

type MetadataValue = string | string[];

type CfgMap = Record<string, unknown>;

function candidatos(fm: CfgMap, formatCfg: CfgMap | undefined, rootCfg: CfgMap, field: string): unknown[] {
  return [fm[field], formatCfg?.[field], rootCfg[field]];
}

function resolveField(fm: CfgMap, formatCfg: CfgMap | undefined, rootCfg: CfgMap, field: string): unknown {
  return candidatos(fm, formatCfg, rootCfg, field).find((c) => c !== undefined);
}

export function resolveMetadataField(fm: CfgMap, formatCfg: CfgMap | undefined, rootCfg: CfgMap, field: string): MetadataValue | undefined {
  const value = resolveField(fm, formatCfg, rootCfg, field);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value as string[];
  return undefined;
}

export function resolveStringField(fm: CfgMap, formatCfg: CfgMap | undefined, rootCfg: CfgMap, field: string): string | undefined {
  const value = resolveField(fm, formatCfg, rootCfg, field);
  return typeof value === 'string' ? value : undefined;
}

export function resolveBooleanField(fm: CfgMap, formatCfg: CfgMap | undefined, rootCfg: CfgMap, field: string): boolean | undefined {
  // A diferencia de los otros dos, un valor que no es booleano no corta la
  // búsqueda: salta al siguiente nivel (regla de precedencia del frontmatter).
  for (const value of candidatos(fm, formatCfg, rootCfg, field)) {
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

export function trimmedStringValue(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

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

function metadataValue(value: unknown): MetadataValue | undefined {
  if (typeof value === 'string' || Array.isArray(value)) return value;
  return undefined;
}

export function resolveMetadataField(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  rootCfg: Record<string, unknown>,
  field: string,
): MetadataValue | undefined {
  const fmValue = fm[field];
  if (fmValue !== undefined) return metadataValue(fmValue);
  if (formatCfg) {
    const fmtValue = formatCfg[field];
    if (fmtValue !== undefined) return metadataValue(fmtValue);
  }
  return metadataValue(rootCfg[field]);
}

export function resolveStringField(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  rootCfg: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = resolveMetadataField(fm, formatCfg, rootCfg, field);
  return typeof value === 'string' ? value : undefined;
}

export function resolveListField(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  rootCfg: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = resolveMetadataField(fm, formatCfg, rootCfg, field);
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined;
}

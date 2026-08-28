/**
 * Lectura de campos del frontmatter crudo: único contrato del proyecto para
 * resolver valores de metadatos (#2073). Antes existían cinco implementaciones
 * locales con sutilezas distintas (trim sí/no, listas, jerarquía); todas
 * consumen estas funciones.
 *
 * Semántica decidida:
 * - `fmString`: string NO vacío tal cual (sin trim) o fallback.
 * - `fmBool`: boolean real o fallback.
 * - `fmTrimmedString`: string con contenido tras trim, recortado, o undefined.
 * - `fmStringList`: string único → lista de uno; lista homogénea de strings
 *   recortada sin huecos; undefined si no hay valores útiles.
 * - `resolve*Field`: precedencia frontmatter > config de formato > config
 *   raíz, con una sola evaluación por campo.
 */

/** Valor string recortado (undefined si vacío o no es string). Compartido por
 * los consumidores de campos de portada (#2193: antes duplicado en
 * latex-composer e image-processor).
 */
export function trimmedStringValue(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

/** String efectivo: valor no vacío del frontmatter o fallback. */
export function fmString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

/** Boolean efectivo: valor booleano del frontmatter o fallback. */
export function fmBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** String recortado con contenido, o undefined si está ausente/vacío. */
export function fmTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Normaliza string | string[] a lista recortada sin huecos; undefined si no hay valores útiles. */
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

/** Resuelve un campo con precedencia frontmatter > format > raíz (una evaluación). */
export function resolveMetadataField(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  rootCfg: Record<string, unknown>,
  field: string,
): MetadataValue | undefined {
  // 1. Frontmatter tiene prioridad
  const fmValue = fm[field];
  if (fmValue !== undefined) return metadataValue(fmValue);
  // 2. Config por formato
  if (formatCfg) {
    const fmtValue = formatCfg[field];
    if (fmtValue !== undefined) return metadataValue(fmtValue);
  }
  // 3. Config raíz
  return metadataValue(rootCfg[field]);
}

/** Variante string de la jerarquía (los arrays se descartan). */
export function resolveStringField(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  rootCfg: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = resolveMetadataField(fm, formatCfg, rootCfg, field);
  return typeof value === 'string' ? value : undefined;
}

/** Variante lista-de-strings de la jerarquía (los strings sueltos se descartan). */
export function resolveListField(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  rootCfg: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = resolveMetadataField(fm, formatCfg, rootCfg, field);
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined;
}

/**
 * Meses en español para el formato legible de fecha.
 */
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Convierte una fecha ISO `yyyy-mm-dd` a formato legible en español:
 * `2026-04-13` → `13 de abril de 2026`.
 *
 * Si el valor no matchea el formato ISO, se devuelve el original sin
 * cambios (para no romper fechas escritas de otra forma).
 *
 * El parseo es manual (regex) a propósito: `new Date('yyyy-mm-dd')`
 * interpreta la fecha en UTC y puede desplazarse un día según la zona
 * horaria del sistema.
 */
export function formatHumanDate(iso?: string): string | undefined {
  if (!iso) return iso;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  const [, year, month, day] = match;
  const monthName = MONTHS_ES[Number(month) - 1];
  if (!monthName) return iso;
  return `${Number(day)} de ${monthName} de ${year}`;
}

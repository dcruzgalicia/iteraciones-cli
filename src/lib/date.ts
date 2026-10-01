/** La fecha de hoy en ISO (`YYYY-MM-DD`), local. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function formatHumanDate(iso?: string): string | undefined {
  if (!iso) return iso;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  const [, year, month, day] = match;
  const monthName = MONTHS_ES[Number(month) - 1];
  if (!monthName) return iso;
  return `${Number(day)} de ${monthName} de ${year}`;
}

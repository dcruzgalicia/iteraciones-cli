/** La fecha de hoy en ISO (`YYYY-MM-DD`), local. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** `timeZone: 'UTC'` es lo que evita que una fecha cerca de medianoche salte de día. */
const HUMAN_DATE = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatHumanDate(iso?: string): string | undefined {
  if (!iso) return iso;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  const [, , month, day] = match;
  const date = new Date(`${iso.trim()}T00:00:00Z`);
  // Una fecha que no existe (2026-02-29) saldría desplazada al día siguiente;
  // se devuelve tal cual para que el error se vea en el frontmatter.
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) {
    return iso;
  }
  return HUMAN_DATE.format(date);
}

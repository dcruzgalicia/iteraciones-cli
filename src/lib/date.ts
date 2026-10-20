export function todayIso(): string {
  return Temporal.Now.plainDateISO().toString();
}

const HUMAN_DATE = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatHumanDate(iso?: string): string | undefined {
  if (!iso) return iso;
  try {
    return HUMAN_DATE.format(new Date(Temporal.PlainDate.from(iso.trim()).toString()));
  } catch {
    return iso;
  }
}

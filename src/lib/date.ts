export function todayIso(): string {
  return Temporal.Now.plainDateISO().toString();
}

export function formatHumanDate(iso?: string): string | undefined {
  if (!iso) return iso;
  try {
    return Temporal.PlainDate.from(iso.trim()).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * Pluraliza un sustantivo en español: vocal → +s, consonante → +es.
 * Acepta una forma plural explícita para extranjerismos (p. ej. "filter").
 * Ej: 1 error, 2 errores; 1 documento, 2 documentos; 1 filter, 2 filters.
 */
export function plural(n: number, singular: string, pluralForm?: string): string {
  if (n === 1) return `${n} ${singular}`;
  const pluralWord = pluralForm ?? (/[aeiouáéíóú]$/.test(singular) ? `${singular}s` : `${singular}es`);
  return `${n} ${pluralWord}`;
}

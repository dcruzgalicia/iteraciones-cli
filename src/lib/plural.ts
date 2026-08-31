export function plural(n: number, singular: string, pluralForm?: string): string {
  if (n === 1) return `${n} ${singular}`;
  const pluralWord = pluralForm ?? (/[aeiouáéíóú]$/.test(singular) ? `${singular}s` : `${singular}es`);
  return `${n} ${pluralWord}`;
}

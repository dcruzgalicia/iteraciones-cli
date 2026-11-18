export function bloqueDesde(css: string, inicio: number): { contenido: string; fin: number } {
  const abre = css.indexOf('{', inicio);
  if (abre === -1) return { contenido: '', fin: css.length };
  let profundidad = 1;
  let i = abre + 1;
  while (i < css.length && profundidad > 0) {
    if (css[i] === '{') profundidad += 1;
    else if (css[i] === '}') profundidad -= 1;
    i += 1;
  }
  return { contenido: css.slice(abre + 1, i - 1), fin: i };
}

export function reglaDe(bloque: string, selector: string): string {
  const inicio = bloque.indexOf(`${selector} {`);
  if (inicio === -1) return '';
  const abre = bloque.indexOf('{', inicio);
  const cierra = bloque.indexOf('}', abre);
  return abre === -1 || cierra === -1 ? '' : bloque.slice(abre + 1, cierra);
}

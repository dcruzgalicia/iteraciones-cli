const PDF_STRING_ESCAPE = /[()\\]/g;

export function pdfDePaginas(paginas: string[][]): Uint8Array {
  const total = paginas.length;
  const objetos: string[] = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${paginas.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}]/Count ${total}>>`,
  ];
  for (let i = 0; i < total; i++) {
    objetos.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 ${3 + total * 2} 0 R>>>>/Contents ${4 + i * 2} 0 R>>`);
    objetos.push('');
  }
  objetos.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
  for (const [indice, lineas] of paginas.entries()) {
    const contenido = lineas
      .map((linea, renglon) => `BT /F1 12 Tf 72 ${700 - renglon * 16} Td (${linea.replace(PDF_STRING_ESCAPE, '\\$&')}) Tj ET`)
      .join('\n');
    objetos[3 + indice * 2] = `<</Length ${contenido.length}>>\nstream\n${contenido}\nendstream`;
  }

  let cuerpo = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objetos.length; i++) {
    offsets.push(cuerpo.length);
    cuerpo += `${i + 1} 0 obj\n${objetos[i]}\nendobj\n`;
  }
  const inicioXref = cuerpo.length;
  cuerpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) cuerpo += `${String(offset).padStart(10, '0')} 00000 n \n`;
  cuerpo += `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF\n`;

  return new TextEncoder().encode(cuerpo);
}

export function pdfDeUnaPagina(texto: string): Uint8Array {
  return pdfDePaginas([[texto]]);
}

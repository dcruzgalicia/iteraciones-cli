export function pdfDeUnaPagina(texto: string): Uint8Array {
  const objetos = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    null,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  const contenido = `BT /F1 24 Tf 72 700 Td (${texto.replace(/[()\\]/g, '')}) Tj ET`;
  objetos[3] = `<</Length ${contenido.length}>>\nstream\n${contenido}\nendstream`;

  let cuerpo = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objetos.length; i++) {
    offsets.push(cuerpo.length);
    cuerpo += `${i + 1} 0 obj\n${objetos[i] as string}\nendobj\n`;
  }
  const inicioXref = cuerpo.length;
  cuerpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) cuerpo += `${String(offset).padStart(10, '0')} 00000 n \n`;
  cuerpo += `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF\n`;

  return new TextEncoder().encode(cuerpo);
}

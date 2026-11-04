import { After, Given, Then, When } from '@cucumber/cucumber';
import { analyzeBoxes, type PageBox, parseBboxLayout, type WordBox } from '../../lib/pdf-spacing.js';
import type { TypographyIncidence } from '../../lib/pdf-typography.js';

type Estado = { paginas: PageBox[]; incidencias: string[] };

const estado: Estado = { paginas: [], incidencias: [] };

After(() => {
  estado.paginas = [];
  estado.incidencias = [];
});

function paginaDe(lineas: Array<{ words: Array<[string, number, number]> }>): PageBox {
  const page: PageBox = { page: 1, width: 100, height: 100, lines: [] };
  page.lines = lineas.map((spec, indice) => {
    const yMin = indice * 15;
    const yMax = yMin + 5;
    const words: WordBox[] = spec.words.map(([text, xMin, xMax]) => ({ text, xMin, xMax, yMin, yMax }));
    return {
      page: 1,
      index: indice + 1,
      line: indice + 1,
      text: words.map((word) => word.text).join(' '),
      xMin: words[0]?.xMin ?? 0,
      xMax: words.at(-1)?.xMax ?? 0,
      yMin,
      yMax,
      words,
    };
  });
  return page;
}

function describe(incidencia: TypographyIncidence): string {
  if (incidencia.type === 'stretched-line' || incidencia.type === 'shrunk-line') {
    return `${incidencia.type} ;; pág ${incidencia.page} ;; línea ${incidencia.line} ;; ratio ${incidencia.ratio.toFixed(2)} ;; gap ${incidencia.gapPt.toFixed(1)} ;; ${incidencia.text.trim()}`;
  }
  if (incidencia.type === 'river') {
    return `river ;; pág ${incidencia.page} ;; líneas ${incidencia.from}-${incidencia.to} ;; x ${incidencia.xPt.toFixed(1)} ;; canal ${incidencia.channelPt.toFixed(1)} ;; ${incidencia.text.trim()} || ${incidencia.lastText.trim()}`;
  }
  return `${incidencia.type} ;; pág ${incidencia.page} ;; línea ${incidencia.line} ;; ${incidencia.text.trim()}`;
}

Given('una página de cajas con estas líneas:', (json: string) => {
  estado.paginas = [paginaDe(JSON.parse(json) as Array<{ words: Array<[string, number, number]> }>)];
});

function analiza(reglas: string[]): void {
  estado.incidencias = analyzeBoxes(estado.paginas, { reglas }).map(describe);
}

When('analizo el espaciado', () => {
  analiza(['stretched-line', 'shrunk-line', 'river']);
});

When('analizo el espaciado de {string}', (reglas: string) => {
  analiza(reglas.split(',').map((regla) => regla.trim()));
});

Then('las incidencias de espaciado son:', (esperado: string) => {
  const leido = estado.incidencias.join('\n');
  const pedido = esperado
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean)
    .join('\n');
  if (leido !== pedido) throw new Error(`las incidencias son\n${leido}\ny debían ser\n${pedido}`);
});

Then('no hay incidencias de espaciado', () => {
  if (estado.incidencias.length > 0) throw new Error(`hay incidencias: ${estado.incidencias.join(' / ')}`);
});

Given('un XML de cajas:', (xml: string) => {
  estado.paginas = parseBboxLayout(xml);
});

Then('la primera línea de la primera página dice {string}', (texto: string) => {
  const line = estado.paginas[0]?.lines[0];
  if (line === undefined) throw new Error('no hay ninguna línea en la primera página');
  if (line.text !== texto) throw new Error(`la línea dice ${JSON.stringify(line.text)} y debía decir ${JSON.stringify(texto)}`);
});

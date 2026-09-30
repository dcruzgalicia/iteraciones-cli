import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { docProducesFormat } from '../builder/output-layout.js';
import { TEMPLATE_KINDS } from '../builder/pipeline-setup.js';
import { KNOWN_FRONTMATTER_FIELDS } from '../builder/project-validator.js';

const REF_PATH = join(import.meta.dir, '..', '..', 'docs', 'frontmatter-reference.md');
const ARQ_PATH = join(import.meta.dir, '..', '..', 'docs', 'architecture.md');
const TYPES = ['file', 'collection', 'creator', 'intervention'] as const;
const FORMATS = ['latex', 'html', 'epub', 'markdown', 'pdf'] as const;

const ref = readFileSync(REF_PATH, 'utf8');
const filas = (): string[] => ref.split('\n');
const celdas = (linea: string): string[] =>
  linea
    .split('|')
    .slice(1, -1)
    .map((celda) => celda.trim());

/**
 * #2486 — la referencia declara cuatro types y una matriz de formatos por type.
 * Los tests la atan al código: los cuatro valores de `type` a lo que acepta el
 * validador, la matriz a `docProducesFormat`, y las plantillas de cada type a
 * `TEMPLATE_KINDS`. Así la documentación no se puede desincronizar sin que falle
 * la suite.
 */
describe('la referencia documenta los cuatro types (#2486)', () => {
  it('la fila de `type` declara los cuatro valores y el default', () => {
    const fila = filas().find((linea) => linea.startsWith('| `type` |'));
    expect(fila, 'la fila de type está en la tabla de campos').toBeDefined();
    for (const type of TYPES) expect(fila, `declara ${type}`).toContain(type);
    expect(fila, 'y el valor por defecto').toContain("`'file'`");
  });

  it('la matriz por type tiene una columna para cada uno, y su intervention es la del código', () => {
    // la matriz de la referencia tiene los types como columnas: la única fila con
    // la primera celda vacía y los cuatro types es su cabecera
    const cabecera = filas().find((linea) => linea.startsWith('| |') && TYPES.every((type) => linea.includes(`\`${type}\``)));
    expect(cabecera, 'la cabecera de la matriz').toBeDefined();
    const columnas = celdas(cabecera ?? '').map((celda) => celda.replaceAll('`', '').trim());
    const col = columnas.indexOf('intervention');
    expect(columnas.filter((c) => TYPES.includes(c as (typeof TYPES)[number])).sort()).toEqual([...TYPES].sort());
    const celdaDe = (etiquetaFila: string): string => {
      const fila = filas().find((linea) => linea.trim().startsWith(`| ${etiquetaFila} |`));
      expect(fila, `fila ${etiquetaFila} de la matriz`).toBeDefined();
      return celdas(fila ?? '')[col] ?? '';
    };
    // la intervention solo se imprime: la matriz tiene que decirlo
    expect(celdaDe('PDF / LaTeX'), 'intervention: solo en PDF/LaTeX').toContain('solo este');
    expect(celdaDe('EPUB'), 'intervention: no en EPUB').toContain('no');
    expect(celdaDe('HTML'), 'intervention: no en HTML').toContain('no');
    expect(celdaDe('Markdown'), 'intervention: sí en markdown').toContain('markdown');
    // y los otros tres emiten todo
    for (const fila of ['PDF / LaTeX', 'EPUB', 'HTML']) {
      const completa = filas().find((linea) => linea.trim().startsWith(`| ${fila} |`));
      for (const type of ['file', 'collection', 'creator'] as const) {
        const valor = celdas(completa ?? '')[columnas.indexOf(type)] ?? '';
        expect(valor, `${type}/${fila}`).not.toContain('no');
      }
    }
  });

  it('cada type tiene su sección', () => {
    for (const type of TYPES) {
      const seccion = `## Type: ${type}`;
      expect(ref, `sección ${seccion}`).toContain(seccion);
    }
  });

  it('los campos propios de cada type están en la tabla y marcados con su type', () => {
    const porType: Partial<Record<(typeof TYPES)[number], string[]>> = {
      collection: ['files', 'collectionCreator', 'collectionCreatorPrefix'],
      creator: ['name', 'links'],
      intervention: ['pages', 'lineLength'],
    };
    for (const [type, campos] of Object.entries(porType)) {
      for (const campo of campos) {
        expect(KNOWN_FRONTMATTER_FIELDS, `${campo} lo acepta la CLI`).toContain(campo);
        const fila = filas().find((linea) => linea.startsWith(`| \`${campo}\` |`));
        expect(fila, `${campo} está en la tabla de campos`).toBeDefined();
        expect(fila, `${campo} dice para qué type es`).toContain(`type: ${type}`);
      }
    }
  });

  it('el diseño HTML por type: tres copias y una plantilla por type con HTML', () => {
    expect(ref, 'menciona las tres copias').toContain('html/{file,collection,creator}/');
    expect(ref, 'y que no hay ramas de type').toContain('$if(type)$');
    const htmlKinds = TEMPLATE_KINDS.filter((kind) => kind.startsWith('html'));
    expect(htmlKinds.sort(), 'una plantilla de HTML por type con HTML').toEqual(['html', 'html-collection', 'html-creator']);
    expect(ref, 'y el cuadro nombra las tres').toContain('`html-collection.html`');
  });
});

/**
 * La misma matriz, atada a `docProducesFormat`: si un type empieza o deja de
 * emitir un formato, la tabla de la referencia tiene que decirlo.
 */
describe('la matriz de formatos coincide con docProducesFormat (#2486)', () => {
  it('los cuatro types emiten lo que dice el código', () => {
    // lo que el código dice, para dejar la expectativa explícita
    const esperado: Record<(typeof TYPES)[number], Record<string, boolean>> = {
      file: { latex: true, html: true, epub: true, markdown: true, pdf: true },
      collection: { latex: true, html: true, epub: true, markdown: true, pdf: true },
      creator: { latex: true, html: true, epub: true, markdown: true, pdf: true },
      intervention: { latex: true, html: false, epub: false, markdown: true, pdf: true },
    };
    for (const type of TYPES) {
      for (const formato of FORMATS) {
        const segunTipo: Record<string, boolean> = esperado[type];
        expect(docProducesFormat(type, formato), `${type}/${formato}`).toBe(segunTipo[formato] ?? true);
      }
    }
  });
});

describe('los cuatro ámbitos de preamble, en la referencia y en architecture.md (#2486)', () => {
  it('los dos docs nombran los cuatro ámbitos', () => {
    for (const ambito of ['preamble/', 'preamble-collection/', 'preamble-creator/', 'preamble-intervention/']) {
      expect(ref, `la referencia nombra ${ambito}`).toContain(ambito);
      expect(readFileSync(ARQ_PATH, 'utf8'), `architecture.md nombra ${ambito}`).toContain(ambito);
    }
  });
});

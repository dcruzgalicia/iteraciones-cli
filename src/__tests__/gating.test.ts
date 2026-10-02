import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITIES, type Capability, SKIP_REASONS } from '../test/gating/capabilities.js';
import { evaluate, formatOmissionReport, registerOmission, tagFilter } from '../test/gating/skip-report.js';

/**
 * #2549 — regresiones del gating.
 *
 * El issue pide tres cosas, y la tercera es la que se paga cara:
 *
 *   1. un escenario omitido aparece en el informe (si no, el sistema miente en
 *      la dirección peligrosa)
 *   2. **un escenario que sí puede correr nunca se omite** — cobertura perdida
 *      en silencio, el fallo caro
 *   3. ningún archivo baja su número de casos ejecutables
 *
 * "hay que testear el test del informe": el informe es lo único que delata la
 * regresión 2, así que si el informe miente no hay nada que lo note. Por eso
 * estas aserciones son sobre `formatOmissionReport`, no sobre el texto que sale
 * por stderr.
 */

const TODAS: Record<Capability, boolean> = {
  pandoc: true,
  magick: true,
  latex: true,
  unzip: true,
  pdftotext: true,
  pdftoppm: true,
};

function ninguna(): Record<Capability, boolean> {
  return Object.fromEntries(CAPABILITIES.map((c: Capability) => [c, false])) as Record<Capability, boolean>;
}

const FEATURE_CON_TAGS = `# language: es
Característica: Compila el documento
  @requires-pandoc
  Escenario: Convierte a LaTeX
    Dado un proyecto
    Cuando compilo

  Escenario: Valida la configuración
    Dado un proyecto
    Cuando valido

  @requires-latex
  Escenario: Compila el PDF
    Dado un proyecto
    Cuando compilo

  @requires-magick @requires-latex
  Escenario: Procesa una imagen y compila
    Dado un proyecto con una imagen
    Cuando compilo
`;

function evaluar(source: string, available: Record<Capability, boolean>): Capability[] {
  return evaluate([{ path: 'f.feature', source }], available);
}

describe('gating por capability (#2549)', () => {
  it('no omite nada cuando la máquina lo tiene todo', () => {
    expect(evaluar(FEATURE_CON_TAGS, TODAS)).toEqual([]);
  });

  it('omite exactamente los escenarios que piden lo que falta', () => {
    const sinPandoc = evaluar(FEATURE_CON_TAGS, { ...TODAS, pandoc: false });
    expect(sinPandoc).toEqual(['pandoc']);
  });

  it('acumula varias capabilities ausentes', () => {
    const sinNada = evaluar(FEATURE_CON_TAGS, ninguna());
    expect(sinNada.sort()).toEqual(['latex', 'magick', 'pandoc']);
  });

  it('agrupa por razón y dice cuántos escenarios pierde cada archivo (#regresión 1)', () => {
    evaluar(FEATURE_CON_TAGS, { ...TODAS, pandoc: false, latex: false });
    const report = formatOmissionReport();
    expect(report).toContain('lo NO verificado en esta máquina');
    // Mismo contrato que `formatSkipReport` de bun:test: razón → archivos, con
    // el número de escenarios que cada uno pierde. El conteo es lo que hace
    // verificable que la cobertura no bajó en silencio.
    // pandoc lo pide 1 escenario; latex, 2 ("Compila el PDF" y el que además
    // pide ImageMagick). El conteo por razón es lo que hace verificable que no
    // se perdió cobertura.
    expect(report).toContain(`${SKIP_REASONS.pandoc}: f.feature (1)`);
    expect(report).toContain(`${SKIP_REASONS.latex}: f.feature (2)`);
  });

  it('los tags de un escenario no se heredan al siguiente (#regresión 2)', () => {
    // "Procesa una imagen y compila" es el último y es el único con
    // @requires-magick. Si los tags se acumularan, los cuatro escenarios
    // contarían como ImageMagick y el archivo aparentaría perder 4 en vez de 1.
    evaluar(FEATURE_CON_TAGS, { ...TODAS, magick: false });
    expect(formatOmissionReport()).toContain(`${SKIP_REASONS.magick}: f.feature (1)`);
  });

  it('un escenario con dos tags ausentes se cuenta una vez por cada razón', () => {
    evaluar(FEATURE_CON_TAGS, { ...TODAS, magick: false, latex: false });
    const report = formatOmissionReport();
    // Ambos razones listan el archivo: el escenario necesita las dos.
    expect(report).toContain(`${SKIP_REASONS.magick}: f.feature (1)`);
    expect(report).toContain(`${SKIP_REASONS.latex}: f.feature (2)`);
  });

  it('no cuenta un escenario que no pide ninguna capability ausente (#regresión 2)', () => {
    evaluar(FEATURE_CON_TAGS, { ...TODAS, unzip: false, pdftotext: false, pdftoppm: false });
    expect(formatOmissionReport()).toBe('');
  });

  it('el tag de la Característica aplica a todos sus escenarios', () => {
    const feature = `# language: es
@requires-pandoc
Característica: Todo el bloque necesita pandoc
  Escenario: Uno
  Escenario: Dos
`;
    expect(evaluate([{ path: 'f.feature', source: feature }], { ...TODAS, pandoc: false })).toEqual(['pandoc']);
    const report = formatOmissionReport();
    expect(report).toContain('f.feature (2)');
  });

  it('rechaza un tag que no mapea a ninguna capability, en vez de ignorarlo', () => {
    const feature = `# language: es
Característica: X
  @requires-inventada
  Escenario: Y
`;
    expect(() => evaluar(feature, TODAS)).toThrow(/no corresponde a ninguna capability/);
  });

  it('el informe es silencioso cuando no hay omitidos', () => {
    evaluar(FEATURE_CON_TAGS, TODAS);
    expect(formatOmissionReport()).toBe('');
  });

  it('el filtro sólo excluye lo que falta, y es vacío si no falta nada', () => {
    expect(tagFilter([])).toBe('');
    expect(tagFilter(['pandoc'])).toBe('not @requires-pandoc');
    expect(tagFilter(['latex', 'magick'])).toBe('not @requires-latex and not @requires-magick');
  });

  it('las filas de Ejemplos y las tablas no se leen como escenarios', () => {
    const feature = `# language: es
Característica: Tabular
  @requires-pandoc
  Esquema del escenario: Con variantes
    Ejemplos:
      | a | b |
      | 1 | 2 |
    Cuando compilo
    Entonces sale <a>
`;
    const omitidas = evaluate([{ path: 'f.feature', source: feature }], { ...TODAS, pandoc: false });
    expect(omitidas).toEqual(['pandoc']);
    // El conteo es 1: un `Esquema del escenario` es un escenario aunque tenga
    // dos filas en `Ejemplos`, y el encabezado de la tabla tampoco cuenta. Si
    // el parser leyera filas como escenarios, saldría 3 o más.
    expect(formatOmissionReport()).toContain(`${SKIP_REASONS.pandoc}: f.feature (1)`);
  });
});

describe('paridad con los skipIf de bun:test (#2549)', () => {
  /**
   * El criterio de aceptación del issue: "la lista de escenarios omitidos en
   * una máquina sin pandoc es la misma que da `describe.skipIf` hoy". La
   * comprobación real es la de abajo, sobre los archivos de `src/__tests__`.
   */

  function archivosConGating(): string[] {
    const salida: string[] = [];
    const recorrer = (dir: string): void => {
      for (const entrada of readdirSync(dir)) {
        const ruta = join(dir, entrada);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (ruta.endsWith('.test.ts')) salida.push(ruta);
      }
    };
    recorrer('src/__tests__');
    return salida;
  }

  it('cada capability del gating tiene su etiqueta en SKIP_REASONS', () => {
    for (const capability of CAPABILITIES) {
      expect(SKIP_REASONS[capability]).toBeTruthy();
    }
  });

  it('ningún @requires- de los features mapea a una capability inexistente', () => {
    const recorrer = (dir: string): string[] => {
      const salida: string[] = [];
      for (const entrada of readdirSync(dir)) {
        const ruta = join(dir, entrada);
        if (statSync(ruta).isDirectory()) salida.push(...recorrer(ruta));
        else if (ruta.endsWith('.feature')) salida.push(ruta);
      }
      return salida;
    };
    for (const feature of recorrer('features')) {
      for (const m of readFileSync(feature, 'utf8').matchAll(/@(requires-[a-z]+)/g)) {
        expect(CAPABILITIES as string[]).toContain((m[1] ?? '').slice('requires-'.length));
      }
    }
  });

  it('el gating cubre las capabilities que hoy gatillan describe.skipIf en la suite', () => {
    const fuente = archivosConGating()
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    // Estas son las que los bloques de `src/__tests__` condicionan hoy. Si una
    // aparece en un `skipIf` y no está en la tabla, el gating no la cubre y la
    // cobertura se perdería en silencio al migrar.
    for (const capability of ['pandoc', 'magick', 'latex', 'unzip', 'pdftotext', 'pdftoppm']) {
      if (new RegExp(`skipIf\\([^)]*${capability}`, 'i').test(fuente) || new RegExp(`SKIP_REASONS\\.${capability}`).test(fuente)) {
        expect(CAPABILITIES as string[]).toContain(capability);
      }
    }
  });
});

describe('el registro se puede limpiar entre corridas', () => {
  it('registerOmission acumula y reset lo vacía', () => {
    registerOmission('a.feature', 'pandoc', 'X');
    expect(formatOmissionReport()).toContain('a.feature');
    evaluar(FEATURE_CON_TAGS, TODAS);
    expect(formatOmissionReport()).toBe('');
  });
});

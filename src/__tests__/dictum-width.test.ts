import { describe, expect, it } from 'bun:test';
import { dictumWidthWarnings, dictumWidthWarningsInYaml } from '../builder/project-validator.js';

/**
 * El escáner de anchos de dictum tiene dos modos y se distinction por un solo
 * parámetro: el body de un documento trae cercas de código que hay que saltar,
 * el fragmento YAML que se le pasa ya viene limpio y las cuenta todas.
 * `#2500` unificó los dos escáneres, así que la distinción queda en un `bool`.
 */
const CON_CERCA = ['::: {.dictum width=5}', 'primero', '```', '::: {.dictum width=9}', 'dentro de la cerca', '```', '::: {.dictum width=0.5}'].join(
  '\n',
);

describe('ancho de dictum fuera de rango', () => {
  it('el body salta las cercas de código', () => {
    expect(dictumWidthWarnings(CON_CERCA)).toEqual([{ line: 1, value: 5 }]);
  });

  it('el fragmento YAML no salta nada', () => {
    expect(dictumWidthWarningsInYaml(CON_CERCA)).toEqual([
      { line: 1, value: 5 },
      { line: 4, value: 9 },
    ]);
  });

  it('acepta los anchos dentro del rango (0.1 a 1.0)', () => {
    expect(dictumWidthWarnings('::: {.dictum width=0.5}\n::: {.dictum width=0.1}\n::: {.dictum width=1}')).toEqual([]);
    expect(dictumWidthWarnings('::: {.dictum width=0.05}\n::: {.dictum width=1.5}')).toEqual([
      { line: 1, value: 0.05 },
      { line: 2, value: 1.5 },
    ]);
  });

  it('desplaza el número de línea con lineOffset', () => {
    expect(dictumWidthWarnings(CON_CERCA, 10)).toEqual([{ line: 11, value: 5 }]);
  });

  it('acepta otras clases dentro de la valla', () => {
    expect(dictumWidthWarnings('::: {#d .dictum width=7}')).toEqual([{ line: 1, value: 7 }]);
  });

  it('un ancho entrecomillado no se detecta (comportamiento actual de la regex)', () => {
    // La regex exige dígitos justo después del `=`, así que `width="7"` escapa
    // del escáner. Se fija aquí para que un cambio de regex sea deliberado.
    expect(dictumWidthWarnings('::: {#d .dictum width="7"}')).toEqual([]);
  });
});

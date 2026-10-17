import { describe, expect, test } from 'bun:test';
import { remplazaEspacioPosterior } from '../cli/typography.ts';

describe('caracteres que el PDF dibuja distinto', () => {
  test('iguala la ligadura «hĳa» del PDF con «hija» del markdown', () => {
    const md = 'Yo llevaba semanas en la locura: contener los llantos de mi hija, trabajar, limpiar, cuidar.\n';
    expect(remplazaEspacioPosterior(md, 'contener los llantos de mi hĳa,')).toBe(
      'Yo llevaba semanas en la locura: contener los llantos de mi hija,&nbsp;trabajar, limpiar, cuidar.\n',
    );
  });

  test('iguala los puntos suspensivos espaciados del PDF («. . .») con los del markdown («...»)', () => {
    const md = 'Mis textos aparecen en las antologías *El feminismo me jodió la vida... y luego me salvó* (2022),\n';
    expect(remplazaEspacioPosterior(md, 'El feminismo me jodió la vida. . .')).toBe(
      'Mis textos aparecen en las antologías *El feminismo me jodió la vida...&nbsp;y luego me salvó* (2022),\n',
    );
  });
});

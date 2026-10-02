#!/usr/bin/env bun
/**
 * #2542 — un test que no comprueba nada es peor que ninguno: reporta un ✓ que
 * nunca se ganó. La forma más común es una aserción sobre un literal, que
 * siempre es cierta y por tanto nunca falla.
 *
 * Contrapeso mecánico: si alguien reintroduce `expect(true).toBe(true)` (o
 * `expect(1).toBe(1)`, o `expect([]).toEqual([])`), el commit se detiene aquí.
 * Corre en `pre-commit`, sin dependencias.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(import.meta.dir, '..', 'src', '__tests__');
const LITERAL = /\bexpect\(\s*(?:true|false|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|\[\s*\]|\{\s*\})\s*\)\.(?:toBe|toEqual|toStrictEqual)\s*\(/;

const ofensas: string[] = [];
for (const archivo of readdirSync(RAIZ)) {
  if (!archivo.endsWith('.ts')) continue;
  readFileSync(join(RAIZ, archivo), 'utf8')
    .split('\n')
    .forEach((linea, i) => {
      if (LITERAL.test(linea)) ofensas.push(`${archivo}:${i + 1}  ${linea.trim()}`);
    });
}

if (ofensas.length > 0) {
  console.error(`✖ [tautologias] ${ofensas.length} aserción(es) sobre un literal:\n`);
  for (const o of ofensas) console.error(`  ${o}`);
  console.error('\nO se comprueba algo, o el test no existe. Ver #2542.');
  process.exit(1);
}
console.log(`✔ [tautologias] ninguna aserción tautológica`);

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

const ROOT = join(import.meta.dir, '..', 'src', '__tests__');
const LITERAL = /\bexpect\(\s*(?:true|false|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|\[\s*\]|\{\s*\})\s*\)\.(?:toBe|toEqual|toStrictEqual)\s*\(/;

const offenses: string[] = [];
for (const file of readdirSync(ROOT)) {
  if (!file.endsWith('.ts')) continue;
  readFileSync(join(ROOT, file), 'utf8')
    .split('\n')
    .forEach((linea, i) => {
      if (LITERAL.test(linea)) offenses.push(`${file}:${i + 1}  ${linea.trim()}`);
    });
}

if (offenses.length > 0) {
  console.error(`✖ [tautologias] ${offenses.length} aserción(es) sobre un literal:\n`);
  for (const offense of offenses) console.error(`  ${offense}`);
  console.error('\nO se comprueba algo, o el test no existe. Ver #2542.');
  process.exit(1);
}
console.log(`✔ [tautologias] ninguna aserción tautológica`);

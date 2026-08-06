// Análisis heurístico de exports sin uso: para cada símbolo exportado en src/,
// verifica si se importa/usar desde otro archivo. Reporta los huérfanos.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dir, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const contents = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

// Extraer símbolos exportados por archivo
const exportsByFile = new Map<string, string[]>();
for (const file of files) {
  const content = contents.get(file)!;
  const symbols: string[] = [];
  const re = /export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of content.matchAll(re)) symbols.push(m[1]!);
  const re2 = /export\s*\{([^}]+)\}/g;
  for (const m of content.matchAll(re2)) {
    for (const part of m[1]!.split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) symbols.push(name);
    }
  }
  if (symbols.length > 0) exportsByFile.set(file, symbols);
}

// Para cada export, buscar uso fuera de su archivo
const testFiles = readdirSync(join(SRC, '__tests__')).filter((e) => e.endsWith('.test.ts'));
const testContents = testFiles.map((f) => readFileSync(join(SRC, '__tests__', f), 'utf8'));

for (const [file, symbols] of exportsByFile) {
  for (const sym of symbols) {
    const usedElsewhere = files.some((f) => f !== file && (contents.get(f) ?? '').includes(sym));
    const usedInTests = testContents.some((c) => c.includes(sym));
    if (!usedElsewhere && !usedInTests) {
      console.log(`${relative(SRC, file)}: export sin uso fuera del módulo → ${sym}`);
    }
  }
}
console.log('--- fin ---');

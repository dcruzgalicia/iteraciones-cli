import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isIgnoredByRules, parseGitignore } from '../builder/gitignore.js';
import { run } from '../lib/run.js';

/**
 * Paridad de isIgnoredByRules contra la semántica real de git (git check-ignore).
 *
 * El descubrimiento de documentos usa una reimplementación propia de las reglas
 * de .gitignore (src/builder/gitignore.ts) con límites documentados en
 * docs/architecture.md ("¿Cómo se excluyen documentos del build?"). Este test
 * compara contra git los casos del alcance soportado, sobre archivos reales
 * (el matcher no hace stat: las rutas que verifica discovery siempre son
 * archivos .md existentes).
 *
 * Las divergencias conocidas se listan en KNOWN_DIVERGENCES: si el matcher
 * mejora y una divergencia desaparece, el test falla y la lista debe
 * actualizarse; si aparece una divergencia NUEVA, el test falla.
 */

/** Un caso: reglas .gitignore + archivos que existen en el repo de prueba. */
interface ParityCase {
  name: string;
  gitignore: string;
  files: string[];
}

const CASES: ParityCase[] = [
  {
    name: 'negación: la última regla gana',
    gitignore: '*.md\n!README.md\n',
    files: ['a.md', 'README.md', 'sub/b.md', 'sub/README.md'],
  },
  {
    name: 'anclaje a la raíz con / inicial',
    gitignore: '/raiz.md\n',
    files: ['raiz.md', 'sub/raiz.md'],
  },
  {
    name: 'anclaje por barra interior',
    gitignore: 'sub/oculto.md\n',
    files: ['sub/oculto.md', 'oculto.md', 'a/sub/oculto.md'],
  },
  {
    name: 'directorio con barra final (contenido ignorado en cualquier nivel)',
    gitignore: 'node_modules/\n',
    files: ['node_modules/x.js', 'a/node_modules/y.js', 'src/main.ts'],
  },
  {
    name: 'wildcard *',
    gitignore: '*.log\n',
    files: ['a.log', 'sub/b.log', 'a.txt'],
  },
  {
    name: '**/ prefijo (cualquier profundidad)',
    gitignore: '**/tmp/x\n',
    files: ['tmp/x', 'a/tmp/x', 'a/b/tmp/x', 'tmp/y'],
  },
  {
    name: '? y clases [..]',
    gitignore: 'file?.txt\n[abc].md\n',
    files: ['file1.txt', 'file12.txt', 'a.md', 'd.md', 'b.md'],
  },
  {
    name: '! literal (no negación)',
    gitignore: '\\!importante.md\n',
    files: ['!importante.md', 'importante.md'],
  },
  {
    name: 'patrón sin anclaje matchea en cualquier nivel',
    gitignore: 'config.yml\n',
    files: ['config.yml', 'a/config.yml', 'a/b/config.yml'],
  },
  {
    name: 'dir/ anclado a la raíz',
    gitignore: '/build/\n',
    files: ['build/x', 'a/build/x'],
  },
];

/**
 * Divergencias conocidas (límite documentado en architecture.md): el matcher
 * no distingue archivos de directorios (no hace stat), así que un patrón
 * `dir/` no ignora el directorio en sí cuando aparece como segmento final de
 * un path de varios niveles ('a/node_modules' con 'node_modules/'). Discovery
 * nunca verifica directorios (solo archivos .md existentes), por lo que la
 * divergencia no afecta al descubrimiento real.
 */
const KNOWN_DIVERGENCES: Array<{ gitignore: string; path: string }> = [{ gitignore: 'node_modules/\n', path: 'a/node_modules' }];

describe('paridad de .gitignore con git check-ignore', () => {
  for (const c of CASES) {
    it(`[${c.name}] coincide con git check-ignore`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gi-parity-'));
      try {
        for (const f of c.files) {
          mkdirSync(join(dir, f.split('/').slice(0, -1).join('/')) || dir, { recursive: true });
          writeFileSync(join(dir, f), 'x', 'utf8');
        }
        writeFileSync(join(dir, '.gitignore'), c.gitignore, 'utf8');
        const init = await run('git', ['init', '-q'], { cwd: dir });
        expect(init.exitCode).toBe(0);

        const rules = parseGitignore(c.gitignore);
        for (const file of c.files) {
          const ours = isIgnoredByRules(file, rules);
          const git = await run('git', ['check-ignore', '-q', '--no-index', file], { cwd: dir });
          expect(ours, `${file} (ours=${ours}, git=${git.exitCode === 0})`).toBe(git.exitCode === 0);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('las divergencias conocidas son exactamente las documentadas (si el matcher mejora, actualizar la lista)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gi-parity-'));
    try {
      for (const d of KNOWN_DIVERGENCES) {
        const parents = d.path.split('/').slice(0, -1).join('/');
        if (parents) mkdirSync(join(dir, parents), { recursive: true });
        mkdirSync(join(dir, d.path), { recursive: true });
        writeFileSync(join(dir, '.gitignore'), d.gitignore, 'utf8');
        await run('git', ['init', '-q'], { cwd: dir });
        const rules = parseGitignore(d.gitignore);
        const ours = isIgnoredByRules(d.path, rules);
        const git = await run('git', ['check-ignore', '-q', '--no-index', d.path], { cwd: dir });
        // La divergencia debe seguir existiendo: si desaparece, el matcher ya
        // distingue directorios y la lista debe vaciarse.
        expect(ours).not.toBe(git.exitCode === 0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

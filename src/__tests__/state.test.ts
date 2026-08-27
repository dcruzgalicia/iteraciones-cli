import { describe, expect, it, spyOn } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BuildState,
  clearStateFile,
  computeBibHash,
  computeConfigHashes,
  computeFiltersHash,
  computeSchemaSourceHash,
  discoverBibFiles,
  loadStateFile,
  persistCompletedState,
  resolveBibOptions,
  saveStateFile,
  stateUsableForBuild,
} from '../builder/state.js';
import type { DiscoveryEntry } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { ConfigError } from '../lib/errors.js';
import { withTempDir } from './helpers.js';

function makeState(entries: Record<string, unknown> = {}): BuildState {
  return {
    schemaVersion: 2,
    startedAt: 1000,
    activeFormats: ['html'],
    entries: new Map(Object.entries(entries)) as Map<string, DiscoveryEntry>,
  };
}

const statePath = (cwd: string): string => join(cwd, '.iteraciones', 'state.json');

describe('loadStateFile', () => {
  it('retorna null sin state.json', async () => {
    await withTempDir(async (dir) => {
      expect(await loadStateFile(dir)).toBeNull();
    });
  });

  it('carga el estado con entries como Map', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, '.iteraciones'), { recursive: true });
      await writeFile(
        statePath(dir),
        JSON.stringify({ schemaVersion: 2, startedAt: 42, activeFormats: ['pdf'], entries: { 'a.md': { title: 'A', slug: 'a' } } }),
        'utf8',
      );
      const state = await loadStateFile(dir);
      expect(state?.startedAt).toBe(42);
      expect(state?.activeFormats).toEqual(['pdf']);
      expect(state?.entries.get('a.md')?.title).toBe('A');
    });
  });

  it('con state.json corrupto degrada a null con warning (build completo)', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, '.iteraciones'), { recursive: true });
      await writeFile(statePath(dir), '{ json roto', 'utf8');
      const stderrSpy = spyOn(process.stderr, 'write');
      try {
        const state = await loadStateFile(dir);
        expect(state).toBeNull();
      } finally {
        const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
        expect(output).toContain('no se pudo leer state.json');
      }
    });
  });
});

describe('saveStateFile (atomicidad)', () => {
  it('persiste el estado y no deja el archivo temporal', async () => {
    await withTempDir(async (dir) => {
      await saveStateFile(dir, makeState({ 'a.md': { title: 'A' } }));
      const raw = await Bun.file(statePath(dir)).text();
      const parsed = JSON.parse(raw) as { startedAt: number; entries: Record<string, unknown> };
      expect(parsed.startedAt).toBe(1000);
      expect(parsed.entries['a.md']).toEqual({ title: 'A' });
      expect(await Bun.file(`${statePath(dir)}.tmp`).exists()).toBe(false);
    });
  });

  it('sobreescribe el estado previo (round-trip load → save → load)', async () => {
    await withTempDir(async (dir) => {
      await saveStateFile(dir, makeState({ 'a.md': { title: 'A' } }));
      const loaded = await loadStateFile(dir);
      expect(loaded).not.toBeNull();
      loaded?.entries.set('b.md', { title: 'B' } as never);
      if (loaded) await saveStateFile(dir, loaded);
      const again = await loadStateFile(dir);
      expect(again?.entries.get('b.md')?.title).toBe('B');
      expect(again?.entries.get('a.md')?.title).toBe('A');
    });
  });
});

describe('clearStateFile y persistCompletedState (#2025)', () => {
  it('clearStateFile elimina el estado sin fallar si no existe', async () => {
    await withTempDir(async (dir) => {
      await saveStateFile(dir, makeState());
      await clearStateFile(dir);
      expect(await Bun.file(statePath(dir)).exists()).toBe(false);
      await clearStateFile(dir); // idempotente
    });
  });

  it('persistCompletedState persiste el cssHash acumulado y marca completado', async () => {
    await withTempDir(async (dir) => {
      const pending = { ...makeState(), cssHash: 'hash-1' };
      await persistCompletedState(dir, pending);
      const state = await loadStateFile(dir);
      expect(state?.cssHash).toBe('hash-1');
      expect(state?.completed).toBe(true);
    });
  });

  it('persistCompletedState sin pendiente no escribe; con pendiente ya completo tampoco', async () => {
    await withTempDir(async (dir) => {
      // Sin pendiente: nada que escribir y sin error
      await persistCompletedState(dir, null);

      // Pendiente ya completo: no reescribe (mtime intacto)
      const done = { ...makeState({ 'a.md': {} as never }), completed: true };
      await saveStateFile(dir, done);
      const mtime1 = (await Bun.file(statePath(dir)).stat()).mtimeMs;
      await Bun.sleep(5);
      await persistCompletedState(dir, done);
      const mtime2 = (await Bun.file(statePath(dir)).stat()).mtimeMs;
      expect(mtime2).toBe(mtime1);
    });
  });

  it('round-trip: el estado escrito por un build lo lee correctamente el siguiente', async () => {
    await withTempDir(async (dir) => {
      const pending = { ...makeState({ 'a.md': { title: 'A', creator: [], date: '', mtime: 1, size: 2, hash: 'h' } }) };
      await persistCompletedState(dir, pending);
      const state = await loadStateFile(dir);
      expect(state?.schemaVersion).toBe(2);
      expect(state?.completed).toBe(true);
      expect(state?.entries.get('a.md')?.title).toBe('A');
    });
  });
});

describe('stateUsableForBuild (integridad de caché)', () => {
  it('solo acepta estados con completed:true', () => {
    expect(stateUsableForBuild(null)).toBeNull();
    expect(stateUsableForBuild(makeState())).toBeNull(); // sin flag = interrumpido
    const complete = makeState();
    complete.completed = false;
    expect(stateUsableForBuild(complete)).toBeNull();
    complete.completed = true;
    expect(stateUsableForBuild(complete)).toBe(complete);
  });
});

describe('computeSchemaSourceHash (versiones de esquema por contenido)', () => {
  it('el hash cambia cuando cambia el contenido de un archivo fuente', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'gen.ts'), 'export const a = 1;', 'utf8');
      const hash1 = await computeSchemaSourceHash(['gen.ts'], dir);
      await writeFile(join(dir, 'gen.ts'), 'export const a = 2;', 'utf8');
      const hash2 = await computeSchemaSourceHash(['gen.ts'], dir);
      expect(hash1).not.toBe(hash2);
    });
  });

  it('el hash es estable para contenido y orden dados', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'a.ts'), 'x', 'utf8');
      await writeFile(join(dir, 'b.ts'), 'y', 'utf8');
      const hash1 = await computeSchemaSourceHash(['a.ts', 'b.ts'], dir);
      const hash2 = await computeSchemaSourceHash(['a.ts', 'b.ts'], dir);
      expect(hash1).toBe(hash2);
    });
  });

  it('un archivo ilegible no rompe el hash (se hashea como vacío)', async () => {
    await withTempDir(async (dir) => {
      const hash = await computeSchemaSourceHash(['no-existe.ts'], dir);
      expect(hash).toBeTypeOf('string');
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  it('los archivos de esquema incluyen la lógica de fecha, HTML, LaTeX y export Markdown (contrato)', async () => {
    // Contrato del criterio "cambiar date.ts invalida sin tocar nada más": si
    // un área deja de participar en los hashes de esquema, este test falla.
    const { SCHEMA_SOURCE_FILES } = await import('../builder/state-hash.js');
    const files = SCHEMA_SOURCE_FILES.join('\n');
    expect(files).toContain('../lib/date.ts');
    expect(files).toContain('./pipeline.ts');
    expect(files).toContain('./render.ts');
    expect(files).toContain('./html-composer.ts');
    expect(files).toContain('./latex-preamble.ts');
    expect(files).toContain('./export/runner.ts');
    expect(files).toContain('./export/assemble.ts');
  });
});

describe('computeFiltersHash', () => {
  it('cambia con el contenido de un filter del proyecto y con disabled-filters', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'filters', 'latex'), { recursive: true });
      await writeFile(join(dir, 'filters', 'latex', '99-test.lua'), '-- v1\n', 'utf8');
      await writeFile(join(dir, 'iteraciones.config.yaml'), '', 'utf8');
      const config = await loadSiteConfig(dir);
      const h1 = await computeFiltersHash(dir, config);
      await writeFile(join(dir, 'filters', 'latex', '99-test.lua'), '-- v2\n', 'utf8');
      const h2 = await computeFiltersHash(dir, config);
      expect(h1.hash).not.toBe(h2.hash);
      const h3 = await computeFiltersHash(dir, { ...config, disabledFilters: ['latex/02-dictum'] });
      expect(h3.hash).not.toBe(h2.hash);
    });
  });

  it('el caché retorna hash estables con prevCache (mtime+size iguales)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), '', 'utf8');
      const config = await loadSiteConfig(dir);
      const first = await computeFiltersHash(dir, config);
      expect(Object.keys(first.cache).length).toBeGreaterThan(0);
      // Con el caché previo (mtime+size iguales), el hash no cambia
      const second = await computeFiltersHash(dir, config, first.cache);
      expect(second.hash).toBe(first.hash);
    });
  });
});

describe('computeConfigHashes', () => {
  it('el hash pdf incluye language (contrato language → PDF)', async () => {
    const base = { ...DEFAULT_SITE_CONFIG, format: { ...DEFAULT_SITE_CONFIG.format } };
    const { hashes: h1 } = await computeConfigHashes('/tmp', base);
    const { hashes: h2 } = await computeConfigHashes('/tmp', { ...base, language: 'en' });
    expect(h1.pdf).not.toBe(h2.pdf);
  });

  it('el hash html cambia con el acento configurado', async () => {
    const base = { ...DEFAULT_SITE_CONFIG, format: { ...DEFAULT_SITE_CONFIG.format } };
    const { hashes: h1 } = await computeConfigHashes('/tmp', base);
    const { hashes: h2 } = await computeConfigHashes('/tmp', {
      ...base,
      format: { ...base.format, html: { ...base.format.html, site: { ...base.format.html?.site, color: 'blue' } } },
    });
    expect(h1.html).not.toBe(h2.html);
  });
});

describe('discoverBibFiles y computeBibHash', () => {
  it('descubre .bib y .csl excluyendo directorios ignorados', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'refs'), { recursive: true });
      await mkdir(join(dir, 'node_modules', 'x'), { recursive: true });
      await writeFile(join(dir, 'refs', 'libro.bib'), '@book{k1}\n', 'utf8');
      await writeFile(join(dir, 'refs', 'estilo.csl'), '<style/>', 'utf8');
      await writeFile(join(dir, 'node_modules', 'x', 'oculto.bib'), '@book{k2}\n', 'utf8');
      const files = await discoverBibFiles(dir);
      expect(files.length).toBe(2);
      expect(files.some((f) => f.endsWith('libro.bib'))).toBe(true);
      expect(files.some((f) => f.endsWith('estilo.csl'))).toBe(true);
      expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    });
  });

  it('propaga errores no-ENOENT del escaneo (política ENOENT-only, #2078)', async () => {
    await withTempDir(async (dir) => {
      // cwd que es un archivo: el escaneo falla con ENOTDIR (no ENOENT)
      await writeFile(join(dir, 'archivo'), 'x', 'utf8');
      await expect(discoverBibFiles(join(dir, 'archivo'))).rejects.toMatchObject({ code: 'ENOTDIR' });
    });
  });

  it('un cwd inexistente equivale a sin bibliografía (ENOENT tolerado)', async () => {
    await withTempDir(async (dir) => {
      await expect(discoverBibFiles(join(dir, 'no-existe'))).resolves.toEqual([]);
    });
  });

  it('invariante #2166: editar el .bib descubierto (sin configurar) invalida el hash', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'refs.bib'), '@book{k1, title={Original}}\n', 'utf8');
      // Sin `bibliography` configurada el pipeline usa el primer .bib descubierto
      const h1 = (await computeBibHash(await resolveBibOptions(dir))).hash;
      await writeFile(join(dir, 'refs.bib'), '@book{k1, title={Editado}}\n', 'utf8');
      const h2 = (await computeBibHash(await resolveBibOptions(dir))).hash;
      expect(h1).not.toBe(h2);
    });
  });

  it('invariante #2166: sin bibliografía no hay citas y el CSL no participa en el hash', async () => {
    await withTempDir(async (dir) => {
      const sinBib = await computeBibHash(await resolveBibOptions(dir));
      // Sin citas el CSL empaquetado no se hashea: sin entradas en el caché
      expect(Object.keys(sinBib.cache)).toHaveLength(0);
      const sinBibOtraVez = await computeBibHash(await resolveBibOptions(dir));
      expect(sinBib.hash).toBe(sinBibOtraVez.hash);
    });
  });

  it('computeBibHash con bibliography configurada solo hashea esa ruta', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'libro.bib'), '@book{k1}\n', 'utf8');
      await writeFile(join(dir, 'otro.bib'), '@book{k2}\n', 'utf8');
      const config = { ...DEFAULT_SITE_CONFIG, bibliography: 'libro.bib' };
      const result = await computeBibHash(await resolveBibOptions(dir, config));
      // libro.bib + el APA-7 empaquetado que participa en la invalidación (#2024)
      expect(Object.keys(result.cache).length).toBe(2);
      const h1 = result.hash;
      await writeFile(join(dir, 'libro.bib'), '@book{k1, title={Cambio}}\n', 'utf8');
      const h2 = (await computeBibHash(await resolveBibOptions(dir, config))).hash;
      expect(h1).not.toBe(h2);
    });
  });

  it('con bibliography inexistente lanza ConfigError (contrato único sin fallback, D1) — el hash no se computa sobre rutas ausentes', async () => {
    await withTempDir(async (dir) => {
      const config = { ...DEFAULT_SITE_CONFIG, bibliography: 'no-existe.bib' };
      try {
        await computeBibHash(await resolveBibOptions(dir, config));
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as Error).message).toContain('bibliography: "no-existe.bib" no encontrado');
      }
    });
  });
});

describe('resolveBibOptions', () => {
  it('con bibliography configurada y existente usa esa ruta y el CSL por defecto', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'libro.bib'), '@book{k1}\n', 'utf8');
      const result = await resolveBibOptions(dir, { ...DEFAULT_SITE_CONFIG, bibliography: 'libro.bib' });
      expect(result.bibFiles).toEqual([join(dir, 'libro.bib')]);
      expect(result.bibOptions?.bibliography).toBe(join(dir, 'libro.bib'));
      expect(result.bibOptions?.csl?.endsWith('apa-7.csl')).toBe(true);
    });
  });

  it('con bibliography inexistente lanza ConfigError (contrato único sin fallback, D1)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'libro.bib'), '@book{k1}\n', 'utf8');
      try {
        await resolveBibOptions(dir, { ...DEFAULT_SITE_CONFIG, bibliography: 'no-existe.bib' });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as Error).message).toContain('bibliography: "no-existe.bib" no encontrado en el proyecto');
      }
    });
  });

  it('sin configuración usa el primer .bib del proyecto', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'b.bib'), '@book{k2}\n', 'utf8');
      await writeFile(join(dir, 'a.bib'), '@book{k1}\n', 'utf8');
      const result = await resolveBibOptions(dir);
      // bibFiles incluye todos los .bib (la capa LaTeX los referencia todos);
      // bibOptions usa el primero (orden alfabético)
      expect(result.bibFiles).toEqual([join(dir, 'a.bib'), join(dir, 'b.bib')]);
      expect(result.bibOptions?.bibliography).toBe(join(dir, 'a.bib'));
    });
  });
});

describe('núcleo content-addressed: hashFileCached (#2020)', () => {
  it('archivo desaparecido ⇒ null (política única de ENOENT)', async () => {
    await withTempDir(async (dir) => {
      const { join } = await import('node:path');
      const { hashFileCached } = await import('../builder/state-hash.js');
      const out: Record<string, { mtime: number; size: number; hash: string }> = {};
      const result = await hashFileCached(join(dir, 'no-existe.bib'), 'k', undefined, out);
      expect(result).toBeNull();
      expect(Object.keys(out).length).toBe(0);
    });
  });

  it('error no-ENOENT se propaga (directorio leído como texto)', async () => {
    await withTempDir(async (dir) => {
      const { join } = await import('node:path');
      const { mkdir } = await import('node:fs/promises');
      const { hashFileCached } = await import('../builder/state-hash.js');
      await mkdir(join(dir, 'subdir'));
      // stat() tiene éxito sobre un directorio; text() falla con EISDIR
      await expect(hashFileCached(join(dir, 'subdir'), 'k', undefined, {})).rejects.toThrow();
    });
  });

  it('hit de caché reutiliza la entrada previa sin releer; miss recalcula y persiste', async () => {
    await withTempDir(async (dir) => {
      const { join } = await import('node:path');
      const { writeFile } = await import('node:fs/promises');
      const { hashFileCached } = await import('../builder/state-hash.js');
      const file = join(dir, 'f.lua');
      await writeFile(file, '-- contenido\n', 'utf8');
      const prev = { [file]: { mtime: 0, size: 999, hash: 'viejo' } };
      const out: Record<string, { mtime: number; size: number; hash: string }> = {};
      const first = await hashFileCached(file, file, prev, out);
      expect(first).not.toBeNull();
      expect(first).not.toBe('viejo');
      expect(out[file]?.hash).toBe(first as string);

      // Hit exacto: la entrada previa (con hash correcto) se reutiliza tal cual
      const prevEntry = out[file];
      if (prevEntry === undefined) throw new Error('entrada de caché esperada');
      const prevOk = { [file]: prevEntry };
      const out2: typeof out = {};
      const second = await hashFileCached(file, file, prevOk, out2);
      expect(second).toBe(prevEntry.hash);
      expect(out2[file]).toBe(prevOk[file]);
    });
  });
});

describe('caché mtime de recursos de config (#2091)', () => {
  it('segunda pasada con caché intacta: hashes idénticos y sin releer contenido', async () => {
    const base = { ...DEFAULT_SITE_CONFIG, format: { ...DEFAULT_SITE_CONFIG.format } };
    const prev: Record<string, { mtime: number; size: number; hash: string }> = {};
    const out1: typeof prev = {};
    const first = await computeConfigHashes('/tmp', base, prev, out1);
    // Los recursos empaquetados quedaron cacheados
    expect(Object.keys(out1).some((k) => k.startsWith('html-res:'))).toBe(true);
    const captured = out1;
    // Segunda pasada con la caché recién poblada (mtime+size idénticos):
    // el hash debe provenir de la caché (idéntico) sin releer contenido.
    const second = await computeConfigHashes('/tmp', base, captured, {});
    expect(second.hashes).toEqual(first.hashes);
    expect(second.cache).toEqual(captured);
  });
});

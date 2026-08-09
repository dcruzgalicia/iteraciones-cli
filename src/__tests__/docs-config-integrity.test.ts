import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { DEFAULT_HTML_BLOCKS, DEFAULT_SITE_CONFIG } from '../config/site-config.js';

const DOCS_FILES = ['docs/configuration.md', 'README.md'];

/**
 * Extrae todos los bloques de código yaml de un documento.
 * Cada bloque documentado debe ser una configuración válida: un campo
 * documentado que el schema rechaza (o que no existe) rompe el test — es el
 * patrón "campos fantasma" que ya ocurrió una vez y se corrigió a mano.
 */
function extractYamlBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const re = /```yaml\n([\s\S]*?)\n```/g;
  for (const m of markdown.matchAll(re)) {
    if (m[1] !== undefined) blocks.push(m[1]);
  }
  return blocks;
}

/** Convierte camelCase a kebab-case (showDate → show-date). */
function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Aplana los campos de la configuración (DEFAULT_SITE_CONFIG + bloques). */
function expectedKeys(): string[] {
  const keys = new Set<string>();
  const walk = (obj: unknown, prefix: string): void => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const full = prefix ? `${prefix}.${kebab(key)}` : kebab(key);
      keys.add(full);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) walk(value, full);
    }
  };
  walk(DEFAULT_SITE_CONFIG, '');
  walk(DEFAULT_HTML_BLOCKS, 'format.html.blocks');
  return [...keys];
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-cli-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('integridad docs ↔ schema de configuración', () => {
  it('todo bloque YAML documentado es una configuración válida (sin campos fantasma)', async () => {
    await withTempDir(async (dir) => {
      for (const file of DOCS_FILES) {
        const markdown = await Bun.file(file).text();
        const blocks = extractYamlBlocks(markdown);
        expect(blocks.length).toBeGreaterThan(0);
        for (const block of blocks) {
          await writeFile(join(dir, 'iteraciones.config.yaml'), block, 'utf8');
          // mode validate: cualquier clave sin efecto (o inválida) lanza ConfigError
          await loadSiteConfig(dir, { mode: 'validate' });
        }
      }
    });
  });

  it('todo campo del schema está documentado en configuration.md o README.md', async () => {
    const docs = (await Promise.all(DOCS_FILES.map((f) => Bun.file(f).text()))).join('\n');
    // Los sub-bloques (p. ej. header) se documentan con la clave simple dentro
    // de su bloque YAML; el resto con la ruta completa (format.html.theme).
    const missing = expectedKeys().filter((key) => {
      const bare = key.split('.').pop();
      return !docs.includes(key) && (bare === undefined || !docs.includes(bare));
    });
    expect(missing).toEqual([]);
  });
});

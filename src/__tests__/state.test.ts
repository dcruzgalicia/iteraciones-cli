import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLegacyCache } from '../builder/state.js';

/**
 * Migración del caché de versiones anteriores (migrateLegacyCache):
 * - elimina .iteraciones/ast/, changes/ y formats/ (recursivo, en cada build)
 * - conserva el resto del árbol (.iteraciones/state.json)
 * - idempotente: una segunda llamada no falla ni elimina nada nuevo
 */

function makeLegacyProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iteraciones-state-'));
  for (const legacy of ['ast', 'changes', 'formats']) {
    mkdirSync(join(dir, '.iteraciones', legacy), { recursive: true });
  }
  writeFileSync(join(dir, '.iteraciones', 'ast', 'doc.json'), '{}');
  writeFileSync(join(dir, '.iteraciones', 'changes', 'state.json'), '{}');
  writeFileSync(join(dir, '.iteraciones', 'formats', 'doc.html'), '<html></html>');
  writeFileSync(join(dir, '.iteraciones', 'state.json'), '{"entries":{}}');
  return dir;
}

describe('migrateLegacyCache', () => {
  it('elimina los tres directorios del flujo anterior (ast, changes, formats)', async () => {
    const cwd = makeLegacyProject();
    try {
      await migrateLegacyCache(cwd);
      for (const legacy of ['ast', 'changes', 'formats']) {
        expect(existsSync(join(cwd, '.iteraciones', legacy))).toBe(false);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('conserva state.json (caché del flujo actual)', async () => {
    const cwd = makeLegacyProject();
    try {
      await migrateLegacyCache(cwd);
      expect(existsSync(join(cwd, '.iteraciones', 'state.json'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('es idempotente: una segunda llamada no falla ni elimina nada nuevo', async () => {
    const cwd = makeLegacyProject();
    try {
      await migrateLegacyCache(cwd);
      await migrateLegacyCache(cwd);
      expect(existsSync(join(cwd, '.iteraciones', 'state.json'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('proyecto sin caché legado no falla y conserva el árbol', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iteraciones-state-'));
    try {
      writeFileSync(join(dir, 'doc.md'), 'contenido');
      await migrateLegacyCache(dir);
      expect(existsSync(join(dir, 'doc.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

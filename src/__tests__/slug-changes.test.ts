import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../builder/discover.js';

/**
 * Detección de cambios de slug por metadatos (discover → slug-resolver):
 * slugChangedEntries alimenta la limpieza de archivos del slug anterior
 * en dist y en la caché (cleanupSlugChanges del orchestrator).
 * La comparación contra el slug final debe cubrir los casos donde el
 * slug nuevo es prefijo del viejo: quitar author, acortar título, -dN.
 */

function makeProject(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'iteraciones-slug-'));
  writeFileSync(join(dir, 'doc.md'), content);
  return dir;
}

/** Fuerza mtime futuro para detectar cambios de mismo tamaño (misma resolución de ms). */
function touchFuture(file: string): void {
  utimesSync(file, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
}

describe('discover (cambios de slug por metadatos)', () => {
  it('registra el slug anterior al quitar author', async () => {
    const cwd = makeProject('---\ntitle: Prueba\nauthor: Juan Pérez\n---\n\nContenido');
    try {
      await discover(cwd);
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\n---\n\nContenido');
      const result = await discover(cwd);
      expect(result.slugChangedEntries.get('doc.md')).toBe('prueba-by-juan-perez');
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('registra el slug anterior al agregar author', async () => {
    const cwd = makeProject('---\ntitle: Prueba\n---\n\nContenido');
    try {
      await discover(cwd);
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\nauthor: Juan Pérez\n---\n\nContenido');
      const result = await discover(cwd);
      expect(result.slugChangedEntries.get('doc.md')).toBe('prueba');
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba-by-juan-perez');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('registra el slug anterior al acortar el título', async () => {
    const cwd = makeProject('---\ntitle: Guía Completa\n---\n\nContenido');
    try {
      await discover(cwd);
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Guía\n---\n\nContenido');
      const result = await discover(cwd);
      expect(result.slugChangedEntries.get('doc.md')).toBe('guia-completa');
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('guia');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('registra el slug anterior al cambiar de author', async () => {
    const cwd = makeProject('---\ntitle: Prueba\nauthor: Autor A\n---\n\nContenido');
    try {
      await discover(cwd);
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\nauthor: Autor B\n---\n\nContenido');
      touchFuture(join(cwd, 'doc.md'));
      const result = await discover(cwd);
      expect(result.slugChangedEntries.get('doc.md')).toBe('prueba-by-autor-a');
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba-by-autor-b');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('registra el slug anterior en cada paso de cambiar author y luego quitarlo', async () => {
    const cwd = makeProject('---\ntitle: Prueba\nauthor: Autor A\n---\n\nContenido');
    try {
      await discover(cwd);
      // Cambiar de author: limpia el slug del author anterior
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\nauthor: Autor B\n---\n\nContenido');
      touchFuture(join(cwd, 'doc.md'));
      const pasoCambio = await discover(cwd);
      expect(pasoCambio.slugChangedEntries.get('doc.md')).toBe('prueba-by-autor-a');
      // Quitar el author: limpia el slug del author actual
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\n---\n\nContenido');
      const pasoQuitar = await discover(cwd);
      expect(pasoQuitar.slugChangedEntries.get('doc.md')).toBe('prueba-by-autor-b');
      expect(pasoQuitar.discoveryIndex.get('doc.md')?.slug).toBe('prueba');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('no registra cambios de slug cuando el archivo cambia sin cambiar metadatos', async () => {
    const cwd = makeProject('---\ntitle: Prueba\nauthor: Juan Pérez\n---\n\nContenido');
    try {
      await discover(cwd);
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\nauthor: Juan Pérez\n---\n\nOtro contenido');
      const result = await discover(cwd);
      expect(result.changedPaths.has('doc.md')).toBe(true);
      expect(result.slugChangedEntries.size).toBe(0);
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba-by-juan-perez');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('conserva el sufijo -dN de un duplicado al modificar solo el body', async () => {
    const cwd = makeProject('---\ntitle: Prueba\n---\n\nContenido');
    try {
      await discover(cwd);
      // Segundo archivo con el mismo título: entra al grupo de duplicados
      writeFileSync(join(cwd, 'otro.md'), '---\ntitle: Prueba\n---\n\nOtro contenido');
      await discover(cwd);
      // Modificar el body de doc.md sin cambiar metadatos: conserva su -dN
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\n---\n\nContenido modificado');
      const result = await discover(cwd);
      expect(result.slugChangedEntries.size).toBe(0);
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba-d1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

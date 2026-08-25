import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover, loadPrevState, noPrevState } from '../builder/discover.js';
import { markStateCompleted } from '../builder/state.js';

/**
 * Detección de cambios de slug por metadatos (discover → slug-resolver):
 * slugChangedEntries alimenta la limpieza de archivos del slug anterior
 * en dist y en la caché (cleanupSlugChanges del orchestrator).
 * La comparación contra el slug final debe cubrir los casos donde el
 * slug nuevo es prefijo del viejo: quitar creator, acortar título, -dN.
 */

function makeProject(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'iteraciones-slug-'));
  writeFileSync(join(dir, 'doc.md'), content);
  return dir;
}

/** Proyecto con dos documentos (a.md y b.md) con el contenido dado. */
function makeTwoDocProject(contentA: string, contentB: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'iteraciones-slug-'));
  writeFileSync(join(dir, 'a.md'), contentA);
  writeFileSync(join(dir, 'b.md'), contentB);
  return dir;
}

/** Fuerza mtime futuro para detectar cambios de mismo tamaño (misma resolución de ms). */
function touchFuture(file: string): void {
  utimesSync(file, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
}

describe('discover (cambios de slug por metadatos)', () => {
  it('registra el slug anterior al quitar creator', async () => {
    const cwd = makeProject('---\ntitle: Prueba\ncreator: Juan Pérez\n---\n\nContenido');
    try {
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\n---\n\nContenido');
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const result = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(result.slugChangedEntries.get('doc.md')).toBe('prueba-por-juan-perez');
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('registra el slug anterior al agregar creator', async () => {
    const cwd = makeProject('---\ntitle: Prueba\n---\n\nContenido');
    try {
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\ncreator: Juan Pérez\n---\n\nContenido');
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const result = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(result.slugChangedEntries.get('doc.md')).toBe('prueba');
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba-por-juan-perez');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('registra el slug anterior al acortar el título', async () => {
    const cwd = makeProject('---\ntitle: Guía Completa\n---\n\nContenido');
    try {
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Guía\n---\n\nContenido');
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const result = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(result.slugChangedEntries.get('doc.md')).toBe('guia-completa');
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('guia');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('registra el slug anterior al cambiar de creator', async () => {
    const cwd = makeProject('---\ntitle: Prueba\ncreator: Autor A\n---\n\nContenido');
    try {
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\ncreator: Autor B\n---\n\nContenido');
      touchFuture(join(cwd, 'doc.md'));
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const result = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(result.slugChangedEntries.get('doc.md')).toBe('prueba-por-autor-a');
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba-por-autor-b');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('registra el slug anterior en cada paso de cambiar creator y luego quitarlo', async () => {
    const cwd = makeProject('---\ntitle: Prueba\ncreator: Autor A\n---\n\nContenido');
    try {
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      // Cambiar de creator: limpia el slug del creator anterior
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\ncreator: Autor B\n---\n\nContenido');
      touchFuture(join(cwd, 'doc.md'));
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const pasoCambio = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(pasoCambio.slugChangedEntries.get('doc.md')).toBe('prueba-por-autor-a');
      // Quitar el creator: limpia el slug del creator actual
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\n---\n\nContenido');
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const pasoQuitar = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(pasoQuitar.slugChangedEntries.get('doc.md')).toBe('prueba-por-autor-b');
      expect(pasoQuitar.discoveryIndex.get('doc.md')?.slug).toBe('prueba');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('no registra cambios de slug cuando el archivo cambia sin cambiar metadatos', async () => {
    const cwd = makeProject('---\ntitle: Prueba\ncreator: Juan Pérez\n---\n\nContenido');
    try {
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\ncreator: Juan Pérez\n---\n\nOtro contenido');
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const result = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(result.changedPaths.has('doc.md')).toBe(true);
      expect(result.slugChangedEntries.size).toBe(0);
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba-por-juan-perez');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('conserva el sufijo -dN de un duplicado que queda único', async () => {
    const cwd = makeProject('---\ntitle: Prueba\n---\n\nContenido');
    try {
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      // Segundo archivo con el mismo título: entra al grupo de duplicados
      writeFileSync(join(cwd, 'otro.md'), '---\ntitle: Prueba\n---\n\nOtro contenido');
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const conDuplicado = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(conDuplicado.discoveryIndex.get('doc.md')?.slug).toBe('prueba-d1');
      // Eliminar el duplicado: doc.md queda único y conserva su -d1
      rmSync(join(cwd, 'otro.md'));
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const sinDuplicado = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(sinDuplicado.discoveryIndex.get('doc.md')?.slug).toBe('prueba-d1');
      expect(sinDuplicado.slugChangedEntries.size).toBe(0);
      expect(sinDuplicado.changedPaths.has('doc.md')).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('asigna el slug limpio sin estado previo (full)', async () => {
    const cwd = makeProject('---\ntitle: Prueba\n---\n\nContenido');
    try {
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      const result = await discover(cwd, { full: true, prevState: noPrevState() });
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('conserva el sufijo -dN de un duplicado al modificar solo el body', async () => {
    const cwd = makeProject('---\ntitle: Prueba\n---\n\nContenido');
    try {
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      // Segundo archivo con el mismo título: entra al grupo de duplicados
      writeFileSync(join(cwd, 'otro.md'), '---\ntitle: Prueba\n---\n\nOtro contenido');
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      await discover(cwd, { prevState: await loadPrevState(cwd) });
      // Modificar el body de doc.md sin cambiar metadatos: conserva su -dN
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\n---\n\nContenido modificado');
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const result = await discover(cwd, { prevState: await loadPrevState(cwd) });
      expect(result.slugChangedEntries.size).toBe(0);
      expect(result.discoveryIndex.get('doc.md')?.slug).toBe('prueba-d1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('resuelve la colisión expandiendo autores (resolveByCreatorExpansion) sin -dN', async () => {
    // Dos documentos con el mismo título y creators distintos: la expansión
    // de creators produce slugs únicos sin recurrir al sufijo -dN
    const cwd = makeTwoDocProject(
      '---\ntitle: Mismo Título\ncreator: [Ana García]\n---\n\nContenido',
      '---\ntitle: Mismo Título\ncreator: [Luis Pérez]\n---\n\nContenido',
    );
    try {
      await markStateCompleted(cwd); // build exitoso: la caché pasa a válida
      const result = await discover(cwd, { prevState: await loadPrevState(cwd) });
      const slugA = result.discoveryIndex.get('a.md')?.slug;
      const slugB = result.discoveryIndex.get('b.md')?.slug;
      expect(slugA).toBe('mismo-titulo-por-ana-garcia');
      expect(slugB).toBe('mismo-titulo-por-luis-perez');
      expect(slugA).not.toBe(slugB);
      // Ninguno usa el sufijo -dN (la expansión de creators lo resolvió)
      expect(slugA).not.toMatch(/-d\d+$/);
      expect(slugB).not.toMatch(/-d\d+$/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

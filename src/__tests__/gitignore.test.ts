import { describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discover } from '../builder/discover.js';
import { isIgnoredByRules, isInsideIgnoredDir, loadGitignoreRules, parseGitignore } from '../builder/gitignore.js';
import { withTempDir } from './helpers.js';

describe('parseGitignore', () => {
  it('ignora líneas vacías y comentarios', () => {
    const rules = parseGitignore('\n# comentario\n\n*.md\n');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.pattern).toBe('*.md');
  });

  it('distingue negación con !', () => {
    const rules = parseGitignore('*.md\n!importante.md');
    expect(rules[0]?.negated).toBe(false);
    expect(rules[1]?.negated).toBe(true);
  });

  it('marca directorios con / final', () => {
    const rules = parseGitignore('borradores/');
    expect(rules[0]?.dirOnly).toBe(true);
    expect(rules[0]?.pattern).toBe('borradores');
  });

  it('marca patrones anclados con /', () => {
    const rules = parseGitignore('/docs/privado.md\nnotas.md');
    expect(rules[0]?.anchored).toBe(true);
    expect(rules[1]?.anchored).toBe(false);
  });

  it('escapa ! literal con backslash', () => {
    const rules = parseGitignore('\\!importante.md');
    expect(rules[0]?.negated).toBe(false);
    expect(rules[0]?.pattern).toBe('!importante.md');
  });
});

describe('isIgnoredByRules', () => {
  it('ignora un archivo por nombre en cualquier nivel', () => {
    const rules = parseGitignore('AGENTS.md');
    expect(isIgnoredByRules('AGENTS.md', rules)).toBe(true);
    expect(isIgnoredByRules('docs/AGENTS.md', rules)).toBe(true);
    expect(isIgnoredByRules('normal.md', rules)).toBe(false);
  });

  it('ignora un directorio y todo su contenido', () => {
    const rules = parseGitignore('borradores/');
    expect(isIgnoredByRules('borradores/x.md', rules)).toBe(true);
    expect(isIgnoredByRules('a/borradores/x.md', rules)).toBe(true);
    expect(isIgnoredByRules('publico.md', rules)).toBe(false);
  });

  it('soporta wildcards * y **', () => {
    const rules = parseGitignore('*.tmp.md\n**/privado/*.md');
    expect(isIgnoredByRules('a.tmp.md', rules)).toBe(true);
    expect(isIgnoredByRules('x/y.tmp.md', rules)).toBe(true);
    expect(isIgnoredByRules('carpeta/privado/nota.md', rules)).toBe(true);
    expect(isIgnoredByRules('nota.md', rules)).toBe(false);
  });

  it('aplica la negación: la última regla gana', () => {
    const rules = parseGitignore('*.md\n!importante.md');
    expect(isIgnoredByRules('normal.md', rules)).toBe(true);
    expect(isIgnoredByRules('importante.md', rules)).toBe(false);
  });

  it('los patrones anclados solo matchean desde la raíz', () => {
    const rules = parseGitignore('/docs/privado.md');
    expect(isIgnoredByRules('docs/privado.md', rules)).toBe(true);
    expect(isIgnoredByRules('sub/docs/privado.md', rules)).toBe(false);
  });

  it('retorna false sin reglas', () => {
    expect(isIgnoredByRules('cualquiera.md', [])).toBe(false);
  });
});

describe('discover respeta .gitignore', () => {
  it('excluye documentos listados en .gitignore', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.gitignore'), 'AGENTS.md\nborradores/\n', 'utf8');
      await writeFile(join(dir, 'normal.md'), '# Normal\n', 'utf8');
      await writeFile(join(dir, 'AGENTS.md'), '# Agents\n', 'utf8');
      await mkdir(join(dir, 'borradores'), { recursive: true });
      await writeFile(join(dir, 'borradores', 'secreto.md'), '# Secreto\n', 'utf8');
      await writeFile(join(dir, 'borradores', 'interno.md'), '# Interno\n', 'utf8');

      const { relativePaths } = await discover(dir);
      expect(relativePaths).toEqual(['normal.md']);
    });
  });

  it('la negación ! re-incluye un archivo', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.gitignore'), '*.md\n!publicado.md\n', 'utf8');
      await writeFile(join(dir, 'privado.md'), '# Privado\n', 'utf8');
      await writeFile(join(dir, 'publicado.md'), '# Público\n', 'utf8');

      const { relativePaths } = await discover(dir);
      expect(relativePaths).toEqual(['publicado.md']);
    });
  });

  it('sin .gitignore no excluye nada adicional', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'a.md'), '# A\n', 'utf8');
      await mkdir(join(dir, 'sub'), { recursive: true });
      await writeFile(join(dir, 'sub', 'b.md'), '# B\n', 'utf8');

      const { relativePaths } = await discover(dir);
      expect(relativePaths.sort()).toEqual(['a.md', 'sub/b.md']);
    });
  });
});

describe('isInsideIgnoredDir', () => {
  it('detecta directorios ignorados en la raíz', () => {
    expect(isInsideIgnoredDir('node_modules/paquete/leeme.md')).toBe(true);
    expect(isInsideIgnoredDir('dist/files/x.html')).toBe(true);
    expect(isInsideIgnoredDir('.iteraciones/ast/x.json')).toBe(true);
  });

  it('detecta directorios ignorados en cualquier profundidad', () => {
    expect(isInsideIgnoredDir('docs/node_modules/x.md')).toBe(true);
    expect(isInsideIgnoredDir('a/b/c/dist/x.md')).toBe(true);
  });

  it('no marca archivos normales', () => {
    expect(isInsideIgnoredDir('normal.md')).toBe(false);
    expect(isInsideIgnoredDir('docs/normal.md')).toBe(false);
    expect(isInsideIgnoredDir('node-modules-falso/x.md')).toBe(false);
  });
});

describe('discover excluye dotfiles', () => {
  it('excluye archivos y carpetas con prefijo .', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'normal.md'), '# Normal\n', 'utf8');
      await writeFile(join(dir, '.oculto.md'), '# Oculto\n', 'utf8');
      await mkdir(join(dir, 'visible'), { recursive: true });
      await writeFile(join(dir, 'visible', 'normal.md'), '# Visible\n', 'utf8');
      await writeFile(join(dir, 'visible', '.privado.md'), '# Privado\n', 'utf8');
      await mkdir(join(dir, 'visible', '.oculto'), { recursive: true });
      await writeFile(join(dir, 'visible', '.oculto', 'nota.md'), '# Nota\n', 'utf8');

      const { relativePaths } = await discover(dir);
      expect(relativePaths.sort()).toEqual(['normal.md', 'visible/normal.md']);
    });
  });
});

describe('loadGitignoreRules', () => {
  it('retorna lista vacía si no existe el archivo', async () => {
    await withTempDir(async (dir) => {
      const rules = await loadGitignoreRules(dir);
      expect(rules).toHaveLength(0);
    });
  });

  it('carga el .gitignore del proyecto', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.gitignore'), 'notas.md\n', 'utf8');
      const rules = await loadGitignoreRules(dir);
      expect(rules).toHaveLength(1);
    });
  });
});

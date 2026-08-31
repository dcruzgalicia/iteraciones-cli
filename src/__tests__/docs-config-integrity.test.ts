import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { KNOWN_FRONTMATTER_FIELDS } from '../builder/project-validator.js';
import { buildProgram } from '../cli/parser.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { DEFAULT_HTML_BLOCKS, DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { withTempDir } from './helpers.js';

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

describe('integridad docs ↔ schema de configuración', () => {
  it('todo bloque YAML documentado es una configuración válida (sin campos fantasma)', async () => {
    await withTempDir(async (dir) => {
      for (const file of DOCS_FILES) {
        const markdown = await Bun.file(file).text();
        const blocks = extractYamlBlocks(markdown);
        expect(blocks.length).toBeGreaterThan(0);
        for (const block of blocks) {
          await writeFile(join(dir, 'iteraciones.config.yaml'), block, 'utf8');
          // Cualquier clave sin efecto (o inválida) lanza ConfigError, igual en
          // build y validate.
          await loadSiteConfig(dir);
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

function collectFlags(options: readonly { long?: string; short?: string }[]): Set<string> {
  const flags = new Set<string>();
  for (const opt of options) {
    if (opt.long) flags.add(opt.long.slice(2));
    if (opt.short) flags.add(opt.short.slice(1));
  }
  return flags;
}

describe('integridad docs ↔ CLI (comandos, flags y API)', () => {
  function realCliSurface(): { commands: Set<string>; flags: Set<string> } {
    const program = buildProgram();
    const commands = new Set(program.commands.map((c) => c.name()));
    const helpCommand = (program as { _helpCommand?: Command })._helpCommand;
    if (helpCommand?.name()) commands.add(helpCommand.name());
    const flags = new Set<string>();
    const helpOption = (program as { _helpOption?: { short?: string; long?: string } })._helpOption;
    if (helpOption?.long) flags.add(helpOption.long.slice(2));
    if (helpOption?.short) flags.add(helpOption.short.slice(1));
    for (const flag of collectFlags(program.options)) flags.add(flag);
    for (const cmd of program.commands) {
      for (const flag of collectFlags(cmd.options)) flags.add(flag);
    }
    return { commands, flags };
  }

  it('todo comando y flag documentado en README.md y quickstart.md existe en la CLI', async () => {
    const docs = (await Promise.all(['README.md', 'docs/quickstart.md'].map((f) => Bun.file(f).text()))).join('\n');
    const { commands: realCommands, flags: realFlags } = realCliSurface();

    // Comandos: cada invocación `iteraciones <comando>` debe existir. El token
    // debe empezar por letra (excluye `iteraciones --version`).
    for (const m of docs.matchAll(/iteraciones\s+([a-z][a-z0-9-]*)/g)) {
      const name = m[1];
      if (name !== undefined) expect(realCommands.has(name), `comando documentado \`${name}\` no existe`).toBe(true);
    }

    // Flags: solo los tokens backtick que son exactamente un flag (las tablas
    // de opciones y los ejemplos envuelven los flags en backticks). Evita los
    // guiones de la prosa ("KOMA-Script"), los separadores de tabla y el `--to`
    // del diagrama del pipeline de pandoc.
    const documentedFlags = new Set<string>();
    for (const m of docs.matchAll(/`(--[a-zA-Z][a-z0-9-]*|-[A-Za-z])`/g)) {
      if (m[1]) documentedFlags.add(m[1].replace(/^-+/, ''));
    }
    for (const flag of documentedFlags) {
      expect(realFlags.has(flag), `flag documentado \`--${flag}\` no existe`).toBe(true);
    }
  });

  it('las opciones de build() documentadas en architecture.md son exactamente BuildOptions', async () => {
    const arch = await Bun.file('docs/architecture.md').text();
    // Tabla "Opciones (BuildOptions):" — desde el encabezado hasta la siguiente
    // sección; primera celda de cada fila
    const start = arch.indexOf('Opciones (`BuildOptions`)');
    const end = arch.indexOf('###', start);
    const section = arch.slice(start, end);
    const documented = new Set<string>();
    for (const m of section.matchAll(/^\|\s*`([a-zA-Z]+)`/gm)) {
      if (m[1] !== undefined) documented.add(m[1]);
    }
    // Superficie real de BuildOptions (orchestrator.ts). Lista explícita: si la
    // API cambia, el test obliga a actualizar la lista y la doc a la vez.
    const real = new Set(['outputDir', 'full', 'verbose', 'json']);
    expect(documented).toEqual(real);
  });

  it('todo campo de frontmatter documentado en frontmatter-reference.md existe en KNOWN_FRONTMATTER_FIELDS', async () => {
    const doc = await Bun.file('docs/frontmatter-reference.md').text();
    const known = new Set(KNOWN_FRONTMATTER_FIELDS);
    // Primera celda de cada fila de tabla (\`campo\`), anclada al inicio de línea
    // para no capturar las columnas de tipo: las dos tablas de campos
    for (const m of doc.matchAll(/^\|\s*`([a-z][a-z0-9-]*)`/gm)) {
      const field = m[1];
      if (field !== undefined && field !== 'Campo') {
        expect(known.has(field), `campo de frontmatter documentado \`${field}\` no existe en KNOWN_FRONTMATTER_FIELDS`).toBe(true);
      }
    }
  });
});

describe('guard schema↔uso: hojas de configuración de formato (#2016)', () => {
  it('toda clave de format.html.site tiene consumidor en builder/cli', async () => {
    // Extraer las claves del bloque HtmlSiteSchema directamente del fuente:
    // una clave añadida al schema sin consumidor rompe este guard (patrón
    // "opción fantasma" que ya ocurrió con site.css).
    const schemaSrc = await Bun.file('src/config/config-schema.ts').text();
    const block = schemaSrc.match(/const HtmlSiteSchema = z\s*\.object\(\{([\s\S]*?)\n {2}\}\)/)?.[1];
    expect(block).toBeDefined();
    const keys = [...(block ?? '').matchAll(/^\s{4}(?:'([a-z-]+)'|([a-z][a-z0-9]*)):/gm)].map((m) => m[1] ?? m[2]);
    expect(keys.length).toBeGreaterThanOrEqual(4);

    const dirs = ['src/builder', 'src/cli'];
    let consumers = '';
    for (const dir of dirs) {
      for (const f of await Array.fromAsync(new Bun.Glob('**/*.ts').scan({ cwd: dir }))) {
        consumers += await Bun.file(join(dir, f)).text();
      }
    }
    const consumed = (key: string | undefined): boolean => key !== undefined && (consumers.includes(`.${key}`) || consumers.includes(`'${key}'`));
    for (const key of keys) {
      expect(consumed(key), `clave de format.html.site sin consumidor: "${key}"`).toBe(true);
    }
  });
});

describe('guard tablas derivables del filesystem (#2035)', () => {
  it('la tabla de filters de architecture.md coincide exactamente con los recursos', async () => {
    const doc = await Bun.file('docs/architecture.md').text();
    const documented = new Set(
      [...doc.matchAll(/^\| `([a-z]+(?:\/[a-z]+)*\/\d{2}-[a-z0-9-]+)` \|/gm)].map((m) => m[1]).filter((s): s is string => s !== undefined),
    );
    expect(documented.size).toBeGreaterThan(10);

    const real = new Set<string>();
    for (const group of ['latex', 'html']) {
      for await (const f of new Bun.Glob('*.lua').scan({ cwd: `src/lib/resources/filters/${group}` })) {
        real.add(`${group}/${f.replace(/\.lua$/, '')}`);
      }
    }
    for await (const f of new Bun.Glob('**/*.lua').scan({ cwd: 'src/lib/resources/filters/semantic' })) {
      real.add(`semantic/${f.replace(/\.lua$/, '')}`);
    }

    const extra = [...documented].filter((d) => !real.has(d));
    const missing = [...real].filter((r) => !documented.has(r));
    expect(extra, `filters documentados que NO existen: ${extra.join(', ')}`).toEqual([]);
    expect(missing, `filters reales sin documentar: ${missing.join(', ')}`).toEqual([]);
  });

  it('la tabla de preamble filters de architecture.md coincide con los recursos', async () => {
    const doc = await Bun.file('docs/architecture.md').text();
    const section = doc.slice(doc.indexOf('### Preamble filters integrados'), doc.indexOf('### Extensibilidad'));
    const documented = new Set([...section.matchAll(/^\| (\d{2}-[a-z0-9-]+) \|/gm)].map((m) => m[1]).filter((s): s is string => s !== undefined));
    expect(documented.size).toBeGreaterThan(20);

    const real = new Set<string>();
    for await (const f of new Bun.Glob('*.tex').scan({ cwd: 'src/lib/resources/preamble' })) {
      real.add(f.replace(/\.tex$/, ''));
    }
    const extra = [...documented].filter((d) => !real.has(d));
    const missing = [...real].filter((r) => !documented.has(r));
    expect(extra, `preamble filters documentados que NO existen: ${extra.join(', ')}`).toEqual([]);
    expect(missing, `preamble filters reales sin documentar: ${missing.join(', ')}`).toEqual([]);
  });
});

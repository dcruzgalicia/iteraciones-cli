import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LuaFilterGroup } from '../builder/filter-resolver.js';
import { markdownToLatex } from '../builder/latex-composer.js';
import { htmlPageFromMarkdown } from '../builder/render.js';
import * as pandocRunner from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS } from './helpers.js';

/**
 * Tests de composición sobre FIXTURES de salida de pandoc (issue #2031, PR 1):
 * se verifica NUESTRA lógica (contrato de argumentos, orden de filters,
 * post-procesado) sin invocar el binario. Los fixtures se regeneran con
 * `bun tools/record-pandoc-fixtures.ts` tras actualizar pandoc.
 */

const NO_FILTERS: LuaFilterGroup = {
  semantic: [],
  latex: [],
  html: [],
  flags: [],
  user: [],
  resolvedNames: new Set(),
};

/** Directorio de fixtures del major más alto disponible (corre sin pandoc). */
async function fixturesDir(): Promise<string | null> {
  const base = join(import.meta.dir, 'fixtures/pandoc');
  const versions = (await readdir(base).catch(() => [] as string[])).sort();
  const latest = versions.at(-1);
  return latest === undefined ? null : join(base, latest);
}

const DOC = {
  filePath: '/proyecto/doc.md',
  relativePath: 'doc.md',
  frontmatter: { title: 'Documento', creator: [], date: '' },
};

const SITE_CONFIG = {
  language: 'es-MX',
  toc: false,
  format: {},
} as never;

describe('composers sobre fixtures de pandoc (#2031 PR1)', () => {
  let fixtureLatex = '';
  let fixtureHtml = '';
  let fixtureHtmlRefs = '';

  beforeEach(async () => {
    const dir = await fixturesDir();
    if (dir === null) {
      registerSkip('composers-fixtures.test.ts', SKIP_REASONS.fixtures);
      fixtureLatex = '';
      fixtureHtml = '';
      fixtureHtmlRefs = '';
      return;
    }
    fixtureLatex = await Bun.file(join(dir, 'sample.latex')).text();
    fixtureHtml = await Bun.file(join(dir, 'sample.html')).text();
    fixtureHtmlRefs = await Bun.file(join(dir, 'sample-refs.html')).text();
  });

  function spyPandoc(latexFixture: string) {
    const calls: Parameters<typeof pandocRunner.execPandoc>[0][] = [];
    const spy = spyOn(pandocRunner, 'execPandoc').mockImplementation(async (options) => {
      calls.push(options);
      return latexFixture;
    });
    return { calls, restore: () => spy.mockRestore() };
  }

  it('markdownToLatex pasa a pandoc el contrato completo de argumentos (#2031)', async () => {
    if (fixtureLatex === '') return; // sin fixtures en este entorno
    const warnedLangs = new Set<string>();
    const { calls, restore } = spyPandoc(fixtureLatex);
    try {
      const result = await markdownToLatex(
        'Contenido',
        DOC,
        NO_FILTERS,
        ['refs/biblio.bib'],
        '/build/template.tex',
        { title: 'Documento' },
        SITE_CONFIG,
        true,
        warnedLangs,
      );
      expect(result.tex).toBe(fixtureLatex); // passthrough del writer
      expect(result.processedImages).toEqual([]);
      expect(calls.length).toBe(1);

      const call = calls[0];
      if (call === undefined) throw new Error('execPandoc no fue invocado');
      expect(call.from).toBe('markdown+auto_identifiers+mark'); // MD_READER
      expect(call.to).toBe('latex');
      expect(call.env?.ITERACIONES_MBOX_HELPERS).toBeDefined();

      const args = call.extraArgs ?? [];
      // Template y estructura de headings
      expect(args).toContain('--template');
      expect(args[args.indexOf('--template') + 1]).toBe('/build/template.tex');
      expect(args).toContain('--top-level-division');
      expect(args).toContain('section');
      expect(args).toContain('--shift-heading-level-by=2');
      // babel por config (no por frontmatter): es-MX ⇒ spanish,mexico,...
      expect(args).toContain('--metadata=babel-lang:spanish,mexico,es-noshorthands,es-noindentfirst');
      expect(args).toContain('--metadata=biblatex-available:true');
      // Número de página por defecto header-right
      expect(args).toContain('--metadata=page-number-command:\\ohead*{\\pagemark}');
      // Bibliografía: --biblatex + cada .bib
      expect(args).toContain('--biblatex');
      expect(args.filter((a) => a === '--bibliography').length).toBe(1);
      expect(args[args.indexOf('--bibliography') + 1]).toBe('refs/biblio.bib');
      // Metadatos DC
      expect(args).toContain('--metadata=title:Documento');
      expect(args.join('\n')).not.toContain('--metadata=subtitle:');
    } finally {
      restore();
    }
  });

  it('el orden de --lua-filter es semantic → user → flags → latex (#2031)', async () => {
    if (fixtureLatex === '') return;
    const group: LuaFilterGroup = {
      semantic: ['/f/semantic.lua'],
      user: ['/f/user.lua'],
      flags: ['/f/flags.lua'],
      latex: ['/f/latex.lua'],
      html: [],
      resolvedNames: new Set(),
    };
    const { calls, restore } = spyPandoc(fixtureLatex);
    try {
      await markdownToLatex('Contenido', DOC, group, [], '/t.tex', {}, SITE_CONFIG, true, new Set());
      const args = calls[0]?.extraArgs ?? [];
      const positions = ['/f/semantic.lua', '/f/user.lua', '/f/flags.lua', '/f/latex.lua'].map((p) => args.indexOf(p));
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1] ?? -1);
      }
    } finally {
      restore();
    }
  });

  it('title-image inexistente lanza BuildError con la ruta resuelta (sin pandoc)', async () => {
    if (fixtureLatex === '') return;
    const { BuildError } = await import('../lib/errors.js');
    const { calls, restore } = spyPandoc(fixtureLatex);
    try {
      await expect(
        markdownToLatex('Contenido', DOC, NO_FILTERS, [], '/t.tex', { title: 'D', 'title-image': 'no-existe.png' }, SITE_CONFIG, true, new Set()),
      ).rejects.toThrow(BuildError);
      expect(calls.length).toBe(0); // falla ANTES de invocar pandoc
    } finally {
      restore();
    }
  });

  it('htmlPageFromMarkdown aplica el post-procesado al fixture html5 (#2031)', async () => {
    if (fixtureHtmlRefs === '') return;
    const cardTemplate = '<section class="refs-card">{{refs-list}}</section>';
    const { calls, restore } = spyPandoc(fixtureHtmlRefs);
    try {
      const html = await htmlPageFromMarkdown(
        'Contenido',
        DOC as never,
        '/proyecto',
        { title: 'T', siteTitle: 'S', lang: 'es-MX' },
        SITE_CONFIG,
        '/build/template.html',
        cardTemplate,
        {},
      );
      // Post-procesado sobre la SALIDA del fixture:
      // 1) el ítem del TOC hacia #refs-heading se elimina
      expect(html).not.toContain('<a href="#refs-heading">');
      // 2) el marcador se sustituye por la tarjeta con la lista extraída
      expect(html).toContain('<section class="refs-card">');
      expect(html).toContain('csl-entry');
      expect(html).not.toContain('<!-- block:referencias -->');
      // 3) el h1 sintético NO queda en el article: la tarjeta aporta su propio encabezado
      expect(html).not.toContain('id="refs-heading"');
      // El contrato de args del HTML también queda registrado
      const call = calls[0];
      if (call === undefined) throw new Error('execPandoc no fue invocado');
      expect(call.to).toBe('html5');
      expect(call.extraArgs).toContain('--metadata=lang:es-MX');
      expect(call.extraArgs).toContain('--metadata=link-citations:true');
    } finally {
      restore();
    }
  });

  it('htmlPageFromMarkdown sin bloque de referencias devuelve el html intacto', async () => {
    if (fixtureHtml === '') return;
    const { calls, restore } = spyPandoc(fixtureHtml);
    try {
      const html = await htmlPageFromMarkdown(
        'Contenido',
        DOC as never,
        '/proyecto',
        { title: 'T', siteTitle: 'S', lang: 'es-MX' },
        SITE_CONFIG,
        '/t.html',
        '<section>{{refs-list}}</section>',
        {},
      );
      expect(html).toBe(fixtureHtml);
      expect(calls.length).toBe(1);
    } finally {
      restore();
    }
  });

  it('citeproc solo con bibliografía efectiva; csl y bib viajan juntos', async () => {
    if (fixtureHtml === '') return;
    const { calls, restore } = spyPandoc(fixtureHtml);
    try {
      await htmlPageFromMarkdown(
        'Contenido',
        DOC as never,
        '/proyecto',
        { title: 'T', siteTitle: 'S', lang: 'es-MX' },
        SITE_CONFIG,
        '/t.html',
        '<section>{{refs-list}}</section>',
        {},
        { bibliography: '/abs/refs.bib', csl: '/abs/apa.csl' },
      );
      const args = calls[0]?.extraArgs ?? [];
      expect(args).toContain('--citeproc');
      const bibIdx = args.indexOf('--bibliography');
      expect(args[bibIdx + 1]).toBe('/abs/refs.bib');
      const cslIdx = args.indexOf('--csl');
      expect(args[cslIdx + 1]).toBe('/abs/apa.csl');

      // Sin bibOptions: nada de citeproc
      await htmlPageFromMarkdown(
        'Contenido',
        DOC as never,
        '/proyecto',
        { title: 'T', siteTitle: 'S', lang: 'es-MX' },
        SITE_CONFIG,
        '/t.html',
        '<section>{{refs-list}}</section>',
        {},
        undefined,
      );
      expect(calls[1]?.extraArgs ?? []).not.toContain('--citeproc');
    } finally {
      restore();
    }
  });
});

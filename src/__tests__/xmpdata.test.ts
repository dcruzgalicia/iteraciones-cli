import { describe, expect, it } from 'bun:test';
import { buildPdfInfoBlock, buildXmpdataContent, injectXmpMetadataIntoLatex } from '../builder/xmpdata.js';

describe('buildXmpdataContent', () => {
  it('emite solo los campos presentes, con \\sep para listas y escapando TeX', () => {
    expect(
      buildXmpdataContent({
        title: 'Pan {casero} & más',
        authors: ['Ana', 'Bet'],
        lang: 'es-MX',
        dateIso: '2026-08-08',
        subject: 'Cocina',
        publishers: ['Editorial X', 'Otra'],
      }),
    ).toBe(
      '\\Title{Pan \\{casero\\} \\& más}\n\\Author{Ana\\sep Bet}\n\\Language{es-MX}\n\\Subject{Cocina}\n\\Date{2026-08-08}\n\\Publisher{Editorial X\\sep Otra}\n',
    );
  });

  it('incluye \\Keywords si hay keywords', () => {
    expect(buildXmpdataContent({ keywords: ['uno', 'dos'] })).toBe('\\Keywords{uno\\sep dos}\n');
  });

  it('devuelve vacío sin campos (el template omite los vacíos)', () => {
    expect(buildXmpdataContent({})).toBe('');
  });
});

describe('buildPdfInfoBlock', () => {
  it('añade /Author y /Keywords con \\pdfescapestring (pdfx cubre Title/Subject)', () => {
    expect(buildPdfInfoBlock({ title: 'T', authors: ['Ana', 'Bet'], subject: 'S', keywords: ['k'] })).toBe(
      '\\AtBeginDocument{%\n' +
        '  \\pdfinfo{%\n' +
        '    /Author (\\pdfescapestring{Ana; Bet})%\n' +
        '    /Keywords (\\pdfescapestring{k})%\n' +
        '  }%\n' +
        '}%\n',
    );
  });

  it('omite el bloque sin autores (pdfx ya cubre title/subject)', () => {
    expect(buildPdfInfoBlock({ title: 'T' })).toBe('');
  });

  it('devuelve vacío sin campos', () => {
    expect(buildPdfInfoBlock({})).toBe('');
  });
});

describe('injectXmpMetadataIntoLatex', () => {
  it('inserta filecontents y pdfinfo antes de \\begin{document}', () => {
    const tex = '\\documentclass{article}\n\\begin{document}\nHola\n\\end{document}\n';
    const out = injectXmpMetadataIntoLatex(tex, { title: 'T', authors: ['Ana', 'Bet'] });
    expect(out).toContain('\\begin{filecontents}[overwrite]{\\jobname.xmpdata}\n\\Title{T}\n\\Author{Ana\\sep Bet}\n\\end{filecontents}\n');
    expect(out).toContain('/Author (\\pdfescapestring{Ana; Bet})%');
    expect(out.indexOf('\\begin{filecontents}')).toBeLessThan(out.indexOf('\\begin{document}'));
  });

  it('devuelve el tex sin cambios sin campos', () => {
    const tex = '\\begin{document}\n';
    expect(injectXmpMetadataIntoLatex(tex, {})).toBe(tex);
  });

  it('devuelve el tex sin cambios sin el ancla \\begin{document}', () => {
    const tex = '\\section{sin documento}\n';
    expect(injectXmpMetadataIntoLatex(tex, { title: 'T' })).toBe(tex);
  });
});

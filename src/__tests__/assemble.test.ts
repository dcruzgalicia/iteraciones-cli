import { describe, expect, it } from 'bun:test';
import { assembleExportDocument } from '../builder/export/assemble.js';
import type { BuildDocument } from '../builder/types.js';

function makeDoc(frontmatter: Record<string, unknown>): BuildDocument {
  return {
    filePath: '/proyecto/doc.md',
    relativePath: 'doc.md',
    frontmatter: { title: 'Título', date: '', author: [], keywords: [], ...frontmatter },
    processedBody: '\\noindent cuerpo',
    slug: 'titulo',
  };
}

describe('assembleExportDocument — dictum del frontmatter', () => {
  it('escapa backslash sin re-escapar las llaves de textbackslash', () => {
    const doc = makeDoc({ dictum: [{ text: '\\texto' }] });
    const exp = assembleExportDocument(doc, 'es', '/proyecto');
    expect(exp?.metadata.dictum?.[0]?.text).toBe('\\textbackslash{}texto');
  });

  it('escapa llaves, porcentajes y otros caracteres especiales', () => {
    const doc = makeDoc({ dictum: [{ text: '100% {real} & #1_$~^' }] });
    const exp = assembleExportDocument(doc, 'es', '/proyecto');
    expect(exp?.metadata.dictum?.[0]?.text).toBe('100\\% \\{real\\} \\& \\#1\\_\\$\\textasciitilde{}\\textasciicircum{}');
  });

  it('convierte negritas y cursivas del dictum', () => {
    const doc = makeDoc({ dictum: [{ text: '**negrita** y *cursiva*' }] });
    const exp = assembleExportDocument(doc, 'es', '/proyecto');
    expect(exp?.metadata.dictum?.[0]?.text).toBe('\\textbf{negrita} y \\textit{cursiva}');
  });
});

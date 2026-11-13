import { MENU, type ProjectTemplate } from './engine.js';

const CONFIG = `# Libro: índice activo y fechas ocultas.
# Portada: frontCover, backCover y startpaper se declaran en el frontmatter de index.md.
# Formatos: pdf y epub se generan; el HTML de la portada enlaza las descargas.
# Descargas: los enlaces a PDF y EPUB aparecen en el HTML de index.md.
language: es-MX
toc: true
showDate: false
format:
  html:
    generate: true
    site:
      theme: light
  pdf:
    generate: true
  epub:
    generate: true
`;

export const LIBRO: ProjectTemplate = {
  config: CONFIG,
  dirs: ['paginas', 'capitulos'],
  files: {
    'index.md': '---\ntitle: Mi libro\ntype: collection\nfiles:\n  - capitulos/00-inicio.md\n---\n',
    'menu.md': MENU([{ name: 'Inicio', url: './index.html' }]),
    'paginas/.gitkeep': '',
    'capitulos/00-inicio.md': '---\ntitle: Inicio\n---\n\n<!-- Escribe aquí el contenido del libro. -->\n',
  },
};

import { MENU, type ProjectTemplate } from './engine.js';

const CONFIG = `# Blog: fechas visibles, orden cronológico y sin índice.
language: es-MX
toc: false
showDate: true
format:
  html:
    generate: true
    pageSize: 10
    site:
      title: Mi blog
      description: Notas y ensayos
      theme: light
`;

export const BLOG: ProjectTemplate = {
  config: CONFIG,
  dirs: ['paginas', 'textos', 'creadoras', 'palabras-clave', 'listas'],
  files: {
    'index.md': '---\ntitle: Publicaciones\ntype: list\norder: date-desc\nfilter:\n  path: textos/\n---\n\nTodas las publicaciones del blog.\n',
    'menu.md': MENU([{ name: 'Inicio', url: './index.html' }]),
    'paginas/.gitkeep': '',
    'textos/.gitkeep': '',
    'creadoras/.gitkeep': '',
    'palabras-clave/.gitkeep': '',
    'listas/.gitkeep': '',
  },
};

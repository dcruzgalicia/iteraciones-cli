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
  dirs: ['textos', 'autoras', 'palabras-clave'],
  files: {
    'index.md': '---\ntitle: Publicaciones\ntype: list\norder: date-desc\n---\n',
    'menu.md': MENU([{ name: 'Inicio', url: './index.html' }]),
    'textos/.gitkeep': '',
    'autoras/.gitkeep': '',
    'palabras-clave/.gitkeep': '',
  },
};

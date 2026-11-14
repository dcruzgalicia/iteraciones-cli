import { MENU, type ProjectTemplate } from './engine.js';

const CONFIG = `language: es-MX
toc: true
showDate: false
format:
  html:
    generate: true
    site:
      style: editorial
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
    'capitulos/00-inicio.md': '---\ntitle: Inicio\n---\n\nEscribe aquí el contenido del libro.\n',
  },
};

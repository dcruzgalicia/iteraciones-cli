import { MENU, type ProjectTemplate } from './engine.js';

const CONFIG = `# Colectiva: portada, autoras, palabras clave, colecciones y convocatorias.
language: es-MX
toc: false
showDate: true
license: PF-AC-PR-FA-1.0
format:
  html:
    generate: true
    pageSize: 10
    site:
      title: Mi colectiva
      description: Publicaciones de la colectiva
`;

export const COLECTIVA: ProjectTemplate = {
  config: CONFIG,
  dirs: ['textos', 'creadoras', 'colecciones', 'convocatorias', 'anuncios', 'palabras-clave'],
  files: {
    'index.md': '---\ntitle: Mi colectiva\n---\n\n<!-- Presenta aquí a la colectiva. -->\n',
    'convocatorias.md': '---\ntitle: Convocatorias\ntype: list\nfilter:\n  path: convocatorias/\norder: date-desc\n---\n',
    'menu.md': MENU([
      { name: 'Inicio', url: './index.html' },
      { name: 'Convocatorias', url: './convocatorias.html' },
    ]),
    'textos/.gitkeep': '',
    'creadoras/.gitkeep': '',
    'colecciones/.gitkeep': '',
    'convocatorias/.gitkeep': '',
    'anuncios/.gitkeep': '',
    'palabras-clave/.gitkeep': '',
  },
};

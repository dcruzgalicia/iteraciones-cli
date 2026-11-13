import { MENU, type ProjectTemplate } from './engine.js';

const CONFIG = `# Repositorio: metadatos, licencias y catálogo ordenado por título.
# ponytail: la búsqueda y las facetas dependen de #2817/#2818
# (format.html.site.search); no se activan aquí hasta que el schema las acepte.
language: es-MX
toc: false
showDate: true
license: CC-BY-NC-ND-4.0
publisher: Mi repositorio
rights: Consulta la licencia de cada documento.
format:
  html:
    generate: true
    pageSize: 20
    site:
      title: Mi repositorio
      description: Documentos, metadatos y licencias
      style: institucional
`;

export const REPOSITORIO: ProjectTemplate = {
  config: CONFIG,
  dirs: ['paginas', 'documentos', 'creadoras', 'palabras-clave', 'listas'],
  files: {
    'index.md': '---\ntitle: Catálogo\ntype: list\norder: title-asc\nfilter:\n  path: documentos/\n---\n\nCatálogo de documentos del repositorio.\n',
    'menu.md': MENU([{ name: 'Inicio', url: './index.html' }]),
    'paginas/.gitkeep': '',
    'documentos/.gitkeep': '',
    'creadoras/.gitkeep': '',
    'palabras-clave/.gitkeep': '',
    'listas/.gitkeep': '',
  },
};

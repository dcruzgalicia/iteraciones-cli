import { DEFAULT_HTML_BLOCKS, DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { ACCENT_PALETTES } from '../lib/accent-palettes.js';

const colores = Object.keys(ACCENT_PALETTES).join(' | ');

export function configHelp(): string {
  const d = DEFAULT_SITE_CONFIG;
  const html = d.format.html;
  return `
iteraciones.config.yaml — todo se pone aquí (un archivo vacío vale todos los defaults):

  language: ${d.language}                   código BCP 47 del documento
  toc: ${d.toc}                            índice en PDF, LaTeX, HTML y EPUB
  script: ${d.script}                       escribe build.sh, portable y numerado
  bundle: ${d.bundle}                       replica config, preamble* y filters en la salida
  showDate                                 muestra la fecha en la portada
  pageNumber                               posición del folio en el PDF: header-left | header-center | header-right | footer-left | footer-center | footer-right
  coverImage                               la portada del PDF sale en PNG
  courtesyPage                             página de cortesía con el título
  bibliography                             ruta a un .bib (o varios)
  csl                                      ruta a un .csl (por defecto: APA 7)
  disabledFilters: []                      filtros Lua del paquete que se apagan
  disabledPreambleFilters: []              filtros de preámbulo que se apagan
  luaFilters: []                           filtros Lua propios del proyecto

  format.html.generate: ${html.generate}                 HTML
    format.html.site.title: ${html.site?.title}
    format.html.site.description: ${html.site?.description}
    format.html.site.theme: ${html.site?.theme}                     light | dark
    format.html.site.color: ${html.site?.color}                     ${colores}
    format.html.site.logo: ${html.site?.logo || "''"}
    format.html.blocks: []            orden de las tarjetas del masonry
                                   (${DEFAULT_HTML_BLOCKS.join(', ')})

  format.latex.generate: ${d.format.latex.generate}               .tex
  format.pdf.generate: ${d.format.pdf.generate}                   PDF (necesita LaTeX)
  format.epub.generate: ${d.format.epub.generate}                 EPUB
  format.markdown.generate: ${d.format.markdown.generate}         .md de dist
  format.markdown.merge: ${d.format.markdown.merge}           fusiona los miembros de una collection

Metadatos del documento (frontmatter) y de la portada:
  title, creator, subject, description, publisher, contributor, date,
  identifier, source, relation, coverage, rights, license, doi, isbn, abstract,
  subtitle, extratitle, frontispiece, titlehead, collectionCreatorPrefix,
  dedication, uppertitleback, lowertitleback, colophon,
  titleImage, publisherImage, startpaper
`;
}

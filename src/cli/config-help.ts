import { DEFAULT_LICENSE, LICENSE_IDS } from '../builder/licenses.js';
import { PAGE_NUMBER_OPTIONS } from '../config/config-schema.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { ACCENT_COLORS } from '../lib/accent-palettes.js';
import { HTML_STYLES } from '../lib/html-styles.js';

const colores = ACCENT_COLORS.join(' | ');

export function configHelp(): string {
  const d = DEFAULT_SITE_CONFIG;
  const html = d.format.html;
  return `
iteraciones.config.yaml — opcional; sólo pon aquí lo que quieras sobrescribir.
Si no existe, se usan estos valores por defecto:

  language: ${d.language}                   código BCP 47 del documento
  toc: ${d.toc}                            índice en PDF, LaTeX, HTML y EPUB
  script: ${d.script}                       escribe build.sh, portable y numerado
  bundle: ${d.bundle}                       replica config, preamble* y filters en la salida
  showDate                                 muestra la fecha en la portada
  pageNumber                               posición del folio en el PDF: ${PAGE_NUMBER_OPTIONS.join(' | ')}
  coverImage                               la portada del PDF sale en PNG
  courtesyPage                             página de cortesía con el título
  coverColor                               las guardas (frontCover y backCover) salen en color, no en grises
  bibliography                             ruta a un .bib (o varios)
  csl                                      ruta a un .csl (por defecto: APA 7)
  disabledFilters: []                      filtros Lua del paquete que se apagan
  disabledPreambleFilters: []              filtros de preámbulo que se apagan
  luaFilters: []                           filtros Lua propios del proyecto
  license: ${DEFAULT_LICENSE}                  licencia del proyecto: ${DEFAULT_LICENSE} (por defecto) | ${LICENSE_IDS.filter((id) => id !== DEFAULT_LICENSE).join(' | ')}

  format.html.generate: ${html.generate}                 HTML
    format.html.site.title: ${html.site?.title}
    format.html.site.description: ${html.site?.description}
    format.html.site.theme: ${html.site?.theme}                     light | dark
    format.html.site.style: ${html.site?.style}                 ${HTML_STYLES.join(' | ')}
    format.html.site.color: ${html.site?.color ?? '(según style)'}                     ${colores}
    format.html.site.logo: ${html.site?.logo || "''"}
    format.html.site.logoSize: ${html.site?.logoSize}           tamaño del logo (px, rem, em…)
    format.html.site.showDates: ${html.site?.showDates}         muestra las fechas en tarjetas y páginas
    format.html.site.rss: ${html.site?.rss}               genera feed.xml con los contenidos con fecha
    format.html.pageSize: ${html.pageSize}              tarjetas por página en las colecciones
    format.html.site.license: ${html.site.license ?? '(por defecto)'}   ${LICENSE_IDS.join(' | ')} (hereda del nivel superior)

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
  titleImage, publisherImage, startpaper, frontCover, backCover
    frontCover y backCover van antes del startpaper: con los tres, las páginas
    1, 2 y 3 del PDF son las tres portadas.
`;
}

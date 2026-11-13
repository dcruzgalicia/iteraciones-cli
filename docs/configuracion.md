# Configuración

`iteraciones.config.yaml` es opcional. Si no existe, se usan los valores por
defecto que muestra `iteraciones --help`. Solo declara lo que quieras cambiar.

El archivo se valida con un esquema estricto: una clave desconocida es un
error, no se ignora.

## Ejemplo completo

```yaml
language: es-MX
toc: true
script: false
bundle: false

# bibliography: refs/libro.bib
# csl: styles/apa.csl
license: CC-BY-NC-ND-4.0

# Metadatos por defecto para todos los documentos
title: Proyecto de ejemplo
creator: Equipo editorial
description: Publicaciones del proyecto.
publisher: Editorial de ejemplo
date: 2026-01-01
rights: Algunos derechos reservados.

# Portada y páginas de título
subtitle: Publicaciones reunidas
titleImage: assets/images/titulo.jpg
publisherImage: assets/images/editorial.svg
frontCover: assets/images/portada.jpg
backCover: assets/images/contraportada.jpg
startpaper: assets/images/guarda.jpg
showDate: true
pageNumber: footer-center
coverImage: true
courtesyPage: true
coverColor: true

format:
  html:
    generate: true
    pageSize: 10
    site:
      title: Proyecto de ejemplo
      description: Publicaciones del proyecto.
      url: https://ejemplo.org/proyecto
      logo: assets/images/logo.svg
      logoSize: 50px
      theme: dark
      style: clasico
      color: lime
      license: CC-BY-NC-ND-4.0
      links:
        - name: Mastodon
          url: https://ejemplo.example/@proyecto
        - name: GitHub
          url: https://github.com/OWNER/REPO
  pdf:
    generate: true
    showDate: true
    pageNumber: footer-center
    coverImage: true
    courtesyPage: true
    coverColor: true
    # disabledPreambleFilters: []
  epub:
    generate: true
  latex:
    generate: false
  markdown:
    generate: true
    merge: false
```

## Raíz

| Clave | Tipo | Por defecto | Qué hace |
|---|---|---|---|
| `language` | texto | `es-MX` | Código BCP 47 del documento. Alimenta `lang` en HTML, EPUB y Markdown, y Babel en el PDF. |
| `toc` | booleano | `false` | Índice en PDF, LaTeX, HTML y EPUB. |
| `script` | booleano | `false` | Escribe `build.sh` con los comandos externos del build. |
| `bundle` | booleano | `false` | Replica en la salida la configuración, los preamble, los filtros y la bibliografía. |
| `bibliography` | ruta o rutas | — | Archivo `.bib` del proyecto. |
| `csl` | ruta | APA 7 incluido | Estilo de citas CSL. |
| `license` | texto o `false` | `CC-BY-NC-ND-4.0` | Licencia del proyecto. `false` la apaga en todos los formatos. |
| `showDate` | booleano | — | Muestra la fecha en la portada del PDF. |
| `pageNumber` | enum | — | `header-left`, `header-center`, `header-right`, `footer-left`, `footer-center` o `footer-right`. |
| `coverImage` | booleano | — | Deja un PNG de la primera página del PDF. |
| `courtesyPage` | booleano | — | Agrega la página de cortesía en el PDF a doble página. |
| `coverColor` | booleano | — | Conserva el color de `frontCover` y `backCover`; sin esto van en grises. |
| `disabledPreambleFilters` | lista | `97-eso-pic`, `98-crop`, `99-pdfx` | Filtros del preámbulo LaTeX que se desactivan. |
| `disabledFilters` | lista | — | Filtros Lua del paquete que se desactivan. |
| `luaFilters` | lista | — | Filtros Lua propios del proyecto. |
| `title`, `creator`, `subject`, `description`, `publisher`, `contributor`, `date`, `identifier`, `source`, `relation`, `coverage`, `rights`, `doi`, `isbn`, `abstract` | metadatos | — | Valores Dublin Core por defecto para todos los documentos. |
| `subtitle`, `extratitle`, `frontispiece`, `titlehead`, `collectionCreatorPrefix`, `dedication`, `uppertitleback`, `lowertitleback`, `colophon` | texto | — | Campos de la portada y las páginas de título. |
| `titleImage`, `publisherImage`, `startpaper`, `frontCover`, `backCover` | ruta o rutas | — | Imágenes de portada, guardas y logo de la editorial. En la configuración son relativas al proyecto; en el frontmatter, al documento. |

Los campos de metadatos y de portada también se pueden declarar en el
frontmatter de cada documento y en `format.pdf`. La precedencia es:

```text
frontmatter > format.pdf > raíz
```

## `format`

### `format.html`

| Clave | Tipo | Por defecto | Qué hace |
|---|---|---|---|
| `generate` | booleano | `true` | Genera el sitio. |
| `pageSize` | entero | `10` | Tarjetas por página en colecciones y listas. |
| `site.title` | texto | `iteraciones` | Nombre del sitio. |
| `site.description` | texto | `escribir, compartir, re-existir` | Descripción o lema. |
| `site.logo` | ruta | — | Logo relativo al proyecto. No admite `/` inicial ni `..`. |
| `site.logoSize` | medida | `50px` | Tamaño del logo: `px`, `rem`, `em`, `vw`, `vh` o `%`. |
| `site.theme` | `light` o `dark` | `dark` | Modo visual: claro u oscuro. |
| `site.style` | `clasico`, `expresivo`, `editorial` o `institucional` | `clasico` | Identidad visual: tipografía, bordes, sombras, fondo y acento por defecto. |
| `site.color` | color | según `style` | Color de acento: `slate`, `gray`, `zinc`, `neutral`, `stone`, `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`, `taupe`, `mauve`, `mist`, `olive`. |
| `site.license` | texto o `false` | hereda de la raíz | Licencia que se muestra en el sitio. |
| `site.links` | lista | — | Enlaces de redes: `name` y `url`. Se muestran en el header y el footer. |
| `site.url` | URL absoluta | — | Necesaria para canonical, sitemap y RSS. Sin ella no se generan feed ni sitemap. |
| `site.home` | objeto | — | Hero opcional solo en `index.html`: `title`, `text`, `image`, `alt`, `url`, `label`. |
| `site.search` | booleano | `false` | Genera `buscar.html` y `buscar.json` con búsqueda y filtros por type, autora, palabra clave y año. |
| `site.labels` | objeto | `{}` | Sobrescribe etiquetas de interfaz: `menu`, `recientes`, `palabras-clave`, `formatos`, `indice`, `referencias`, `texto`, `contenido`, `colaboradora` y `leer-texto-completo`. |
| `site.oai` | booleano | `false` | Genera `oai.xml` estático con un `ListRecords` Dublin Core. No es un endpoint OAI-PMH dinámico. |

El frontmatter puede sobrescribir algunos valores del sitio con `site-title`,
`tagline`, `theme`, `accent` y `css`.

Ejemplo de etiquetas:

```yaml
format:
  html:
    site:
      labels:
        menu: Navegar
        recientes: Novedades
        palabras-clave: Temas
        formatos: Descargas
        indice: Contenido
        referencias: Bibliografía
        texto: Publicación
        contenido: Contenido
        colaboradora: Autora
        leer-texto-completo: Abrir
```

El idioma de la interfaz sale de `language`; no se mezcla con el `language`
del frontmatter de cada documento.

### Estilos visuales

`site.style` elige una identidad visual. `site.theme` sigue controlando el modo
claro/oscuro y `site.color` el acento. Si no declaras `color`, cada estilo usa
su acento por defecto.

| Estilo | Para | Acento por defecto | Rasgos |
|---|---|---|---|
| `clasico` | Sitios mixtos y compatibilidad | `lime` | Neobrutalismo en tonos del acento: papel milimétrico, bordes gruesos, sombras duras, esquinas rectas y Space Grotesk + Chakra Petch. |
| `expresivo` | Personal, diario, colectiva, taller | `amber` | Papel milimétrico cálido, Kalam para el cuerpo y Caveat para los títulos; bordes irregulares y sombras desplazadas. |
| `editorial` | Libro, antología, revista | `stone` | Libre Baskerville, papel milimétrico crema, líneas finas y portada protagonista. |
| `institucional` | Proyecto, centro, repositorio | `blue` | Public Sans, papel milimétrico neutro, tarjetas discretas y metadatos legibles. |

```yaml
format:
  html:
    site:
      style: expresivo
      theme: light
      color: amber
```

Todos los estilos comparten un fondo de papel milimétrico; cambia el tono de
las líneas según el acento y el modo. No hay gradientes ni figuras de fondo.

Los cuatro estilos sirven sus fuentes desde `assets/fonts/`, con una copia
local en `src/lib/resources/fonts/`. Se precargan en el `<head>` y usan
`font-display: fallback` para bloquear el texto un instante y evitar el parpadeo. No hay peticiones a
Google Fonts.

### `format.pdf`

Acepta `generate` y los mismos metadatos y opciones de portada de la raíz:
`showDate`, `pageNumber`, `coverImage`, `courtesyPage`, `coverColor`,
`disabledPreambleFilters`, los campos Dublin Core, los de páginas de título y
las imágenes. Sirve para dar valores distintos al PDF sin cambiar el resto de
los formatos.

Por defecto el PDF no se certifica PDF/X-1a porque los filtros `97-eso-pic`,
`98-crop` y `99-pdfx` están desactivados. Para activar la certificación, deja
la lista vacía y revisa los requisitos en `iteraciones doctor`.

### `format.epub`, `format.latex` y `format.markdown`

| Clave | Tipo | Por defecto | Qué hace |
|---|---|---|---|
| `format.epub.generate` | booleano | `false` | Genera EPUB 3. |
| `format.latex.generate` | booleano | `false` | Genera el `.tex`. |
| `format.markdown.generate` | booleano | `false` | Genera el Markdown procesado. |
| `format.markdown.merge` | booleano | `false` | Fusiona los miembros de una colección en un solo Markdown. |

## Frontmatter

El frontmatter es el bloque YAML entre `---` al inicio de cada archivo. Estos
son los campos que el pipeline reconoce:

| Campo | Tipo | Notas |
|---|---|---|
| `title` | texto | Título. Si falta, se usa «Sin título» y el slug del archivo. |
| `subtitle` | texto | Subtítulo. |
| `creator` | texto o lista | Autoría. No se usa en `type: collection`; ahí va `collectionCreator`. |
| `date` | fecha ISO | `YYYY-MM-DD`. Se muestra según `showDate` y ordena las listas. |
| `slug` | texto | Fija la URL. Solo minúsculas, números y guiones. |
| `type` | enum | `file`, `collection`, `creator`, `intervention`, `list`, `menu` o `announcement`. |
| `language` | texto | Cambia HTML, EPUB y Markdown; el PDF usa el de la configuración. |
| `toc` | booleano | Sobrescribe `toc` del proyecto para ese documento. |
| `keywords` | texto o lista | Palabras clave; alimentan el índice de palabras clave. |
| `license` | texto o `false` | Licencia del documento. `false` la apaga. |
| `description`, `subject`, `publisher`, `contributor`, `identifier`, `source`, `relation`, `coverage`, `rights`, `doi`, `isbn`, `abstract` | metadatos | Campos Dublin Core. |
| `files` | lista de rutas | Obligatorio en `type: collection`. |
| `collectionCreator` | texto o lista | Editora o antologadora de una colección. |
| `collectionCreatorPrefix` | texto | Rol de la editora: «Edición», «Traducción», etc. |
| `extratitle`, `frontispiece`, `titlehead`, `dedication`, `uppertitleback`, `lowertitleback`, `colophon` | texto | Campos de la portada y las páginas de título. |
| `name` | texto | Obligatorio en `type: creator`; si falta, se usa `title`. |
| `links` | lista `name`/`url` | Enlaces de la ficha de creadora. |
| `image` | ruta | Retrato de la creadora. |
| `pages` | entero | Páginas de una `intervention`. |
| `lineLength` | número | Longitud de la regla de una `intervention`, entre 0 y 1. |
| `letterhead`, `letterheadHeight` | lista y medida | Membrete de una `intervention`. |
| `filter`, `order` | objeto y enum | Filtro y orden de una `list`. |
| `placement` | `top` o `bottom` | Ubicación de un `announcement`. |
| `frontCover`, `backCover`, `startpaper`, `titleImage`, `publisherImage` | ruta | Imágenes de portada y guardas. |
| `showDate`, `pageNumber`, `coverImage`, `courtesyPage`, `coverColor` | opciones | Sobrescriben la configuración para ese documento. |
| `site-title`, `tagline`, `theme`, `accent`, `css` | opciones HTML | Sobrescriben el sitio en esa página. |

Los campos desconocidos no rompen el build, pero `iteraciones validate` avisa
que el pipeline los ignora.

## Comandos útiles

```bash
iteraciones --help                 # ayuda y valores por defecto
iteraciones doctor --info          # entorno y configuración efectiva
iteraciones validate               # configuración y frontmatter
iteraciones build --full           # build sin caché
iteraciones build --json           # resultado para consumo programático
iteraciones list-filters           # filtros Lua disponibles
```


## Imágenes y formatos

- Cada estilo incluye solo los archivos de su fuente en `assets/fonts/`, con
  su licencia OFL. Las fuentes están subconjuntadas a latín y signos comunes
  para reducir el peso.
- Las imágenes web se procesan a `webp` con variantes de 200, 320, 640 y 960
  px; el HTML usa `srcset`/`sizes` y declara dimensiones.
- Los retratos usan `sizes="100px"`.
- Las imágenes de contenido usan `sizes` según la columna principal; las que
  quedan bajo el pliegue llevan `loading="lazy"` y `decoding="async"`.
- `frontCover` y `backCover` son opcionales; si se declaran y el archivo no
  existe, el build avisa. La ruta es relativa al Markdown que las declara.

### Formatos por type

| Type | Formatos no-HTML | Metadatos y portadas |
|---|---|---|
| `file` | PDF, EPUB, LaTeX y Markdown | Todos los campos Dublin Core; portada con `frontCover`/`backCover`. |
| `collection` | PDF, EPUB, LaTeX y Markdown | `collectionCreator`, `files`, resumen, identificadores y portadas. |
| `intervention` | PDF, LaTeX y Markdown | Páginas, membrete y longitud de línea. No genera HTML. |
| `creator`, `list`, `menu`, `announcement` | Ninguno | Solo HTML. |

Para PDF y EPUB, llena al menos `title`, `creator`, `date`, `publisher`,
`identifier` (o `doi`/`isbn`), `abstract`, `keywords` y `license`. Los campos
vacíos se omiten del documento y de `oai.xml`.

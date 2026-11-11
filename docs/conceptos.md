# Conceptos

## El proyecto

Un proyecto de `iteraciones` es un directorio con archivos Markdown y, si hace
falta, una configuración y assets. El build descubre los documentos, los
renderiza y escribe las salidas en `dist/files/`.

```text
mi-proyecto/
  iteraciones.config.yaml   # opcional
  index.md                  # opcional: home
  textos/                   # contenido
  creadoras/                # fichas de autoras
  colecciones/              # libros, antologías, números
  assets/images/            # imágenes del contenido y portadas
  admin/                    # opcional: Sveltia
```

`iteraciones init sveltia` crea el layout editorial y el admin. `iteraciones
init` solo prepara el `.gitignore`; no crea contenido.

## Types

El campo `type` del frontmatter decide qué es un documento. Si falta, el
documento es `type: file`.

| Type | Qué es | Formatos que produce hoy |
|---|---|---|
| `file` | Un texto: artículo, ensayo, nota, capítulo suelto. | HTML, PDF, EPUB, LaTeX y Markdown. |
| `collection` | Varios archivos fusionados en un solo documento: libro, antología, número de revista. | HTML, PDF, EPUB, LaTeX y Markdown. |
| `creator` | La ficha de una autora o autor, con semblanza, retrato y enlaces. | HTML, PDF, EPUB, LaTeX y Markdown. |
| `intervention` | Un recurso de imprenta: páginas en blanco, una regla, un membrete. | PDF, LaTeX y Markdown; no genera HTML ni EPUB. |
| `list` | Una página que se arma sola con documentos que cumplen un filtro. | Solo HTML. |
| `menu` | El menú del sitio. Solo puede existir uno. | Solo HTML. |
| `announcement` | Un aviso que se muestra en el header o en el footer. | Solo HTML. |

La lista de formatos sale de `docProducesFormat`: un `list`, `menu` o
`announcement` no genera PDF; una `intervention` no genera HTML ni EPUB. Los
demás types generan todos los formatos activos en la configuración.

### `file`

Es el caso normal. El título y el autor vienen del frontmatter; el cuerpo es
el Markdown que sigue al bloque `---`.

```markdown
---
title: Un texto
creator: Ana Ejemplo
date: 2026-01-15
---

Contenido.
```

### `collection`

Una colección tiene una lista `files[]` con rutas a otros Markdown. Es la
forma de hacer un libro o un número completo sin crear un type nuevo.

```markdown
---
title: Libro de ejemplo
type: collection
files:
  - ./capitulos/01.md
  - ./capitulos/02.md
---

Introducción del libro.
```

Las rutas se resuelven primero desde el directorio de la colección y, si no
existen ahí, desde la raíz del proyecto. Los miembros pueden ser `file` o
`intervention`; una colección formada solo por interventions no se puede
construir.

### `creator`

La ficha de una autora o autor. Usa `name` (o `title`) y puede llevar `image`
y `links`.

```markdown
---
type: creator
name: Ana Ejemplo
image: assets/images/ana.jpg
links:
  - name: Sitio
    url: https://ejemplo.example
---

Semblanza.
```

Los textos que declaran `creator: Ana Ejemplo` enlazan a esta ficha.

### `intervention`

Sirve para describir una regla de imprenta sin escribir un párrafo. Acepta
`pages`, `lineLength`, `letterhead` y `letterheadHeight`. No aparece en el
HTML ni en el EPUB; sí en el PDF, el LaTeX y el Markdown exportado.

### `list`

Una lista se calcula en cada build. Acepta `filter` y `order`.

```markdown
---
title: Publicaciones
type: list
filter:
  type: file
order: date-desc
---
```

Los filtros disponibles son `type`, `creator`, `date` (`from` y `to`),
`keyword` y `path`. Los órdenes son `date-desc`, `date-asc`, `title-asc`,
`title-desc` y `creator-asc`.

### `menu` y `announcement`

`menu` declara los enlaces del sitio. El header lleva al menú y el footer
muestra los primeros enlaces. Solo puede haber un `menu`.

`announcement` es un aviso con `placement: top` o `placement: bottom`.

## Formatos

| Formato | Clave | Qué produce |
|---|---|---|
| HTML | `format.html.generate` | El sitio en `dist/files/`. Activado por defecto. |
| PDF | `format.pdf.generate` | Un PDF por documento con LaTeX. |
| EPUB | `format.epub.generate` | Un EPUB 3 por documento. |
| LaTeX | `format.latex.generate` | El `.tex` editable. |
| Markdown | `format.markdown.generate` | El Markdown procesado de `dist`. |

El PDF necesita LaTeX y, si hay bibliografía, Biber. Las portadas necesitan
Poppler. ImageMagick y Pandoc son obligatorios para cualquier build.

`format.markdown.merge: true` fusiona los miembros de una colección en un
solo Markdown. Con `false`, cada miembro conserva su archivo.

## Descubrimiento y `.gitignore`

El build recorre el proyecto y toma todos los `.md` que no estén ignorados por
`.gitignore`. Ese archivo decide qué se publica: si una nota de trabajo está
ignorada, no se compila.

`index.md` es especial: es la home del sitio. Si no existe y hay documentos,
el build crea `index.html` con una lista de publicaciones. También genera
páginas de listado por type cuando hay más de un documento de ese type
(`texto.html`, `creadora.html`, `coleccion.html`, `lista.html`,
`anuncio.html`). Si hay un solo documento, no crea la lista.

## Salida

La salida por defecto es `dist/files/`. La estructura de carpetas se conserva:

```text
dist/files/
  index.html
  textos/
    primer-texto.html
    primer-texto.pdf
    primer-texto.epub
  assets/
    css/styles.css
    images/
```

Cada documento produce su propio archivo con el mismo slug. Una colección
produce el archivo de la colección completa y, además, cada miembro sigue
produciendo el suyo. Los enlaces de descarga de la tarjeta «Formatos» apuntan
al archivo que está junto al HTML del documento.

## Índice y portadas

- `toc: true` activa el índice en PDF, LaTeX, HTML y EPUB. En una colección, el
  índice HTML lista a sus miembros; en un `file`, el índice es el de sus
  encabezados. En PDF y EPUB el índice sale de los encabezados.
- `frontCover` y `backCover` son imágenes a página completa en el PDF y
  tarjetas en el HTML. `startpaper` es la guarda. Si están las tres, el PDF
  empieza con portada, contraportada y guarda, en ese orden.
- En el EPUB, `frontCover` es la portada del libro.
- `coverColor: true` conserva el color de las guardas; sin esa opción se
  convierten a escala de grises.
- `coverImage: true` deja un PNG de la primera página del PDF junto al PDF.

## Precedencia de metadatos

Para los metadatos y las opciones de portada, el primer nivel que declara el
campo gana:

```text
frontmatter del documento > format.pdf > raíz de iteraciones.config.yaml
```

`slug`, `type` y `files` son estructurales: solo se declaran en el
frontmatter. `bibliography`, `csl`, `luaFilters` y `disabledFilters` son del
proyecto y se declaran en la configuración.

El `language` del frontmatter cambia el HTML, el EPUB y el Markdown. El PDF
usa el `language` de la configuración para Babel, porque el preámbulo se
compone una sola vez para todo el proyecto.

## Sitio, libro y repositorio

- **Sitio o blog**: muchos `file` con fecha, autoras, palabras clave, menú y
  listas. La home puede ser un `index.md` propio o la lista automática.
- **Libro**: una `collection` con `files[]`, portada, índice y descargas. No
  hay un type `book`; el libro es una colección configurada como libro.
- **Repositorio**: un catálogo de fichas con metadatos Dublin Core, series y
  listados filtrados. Hoy se arma con `file`, `collection`, `creator` y
  `list`; la búsqueda con facetas y la exportación OAI-PMH/DSpace no forman
  parte de la CLI.

Las recetas concretas están en [blog](recetas/blog.md),
[libro](recetas/libro.md) y [repositorio](recetas/repositorio.md).

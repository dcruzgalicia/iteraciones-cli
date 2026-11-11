# Receta: libro en HTML, PDF y EPUB

Un libro en `iteraciones` es una `collection`: un documento que reúne varios
Markdown en un solo PDF, EPUB y HTML. No hay un type `book` ni hace falta
crearlo.

## 1. Estructura

```text
libro-de-ejemplo/
  iteraciones.config.yaml
  libro.md
  capitulos/
    01-apertura.md
    02-desarrollo.md
    03-cierre.md
  portada/
    frente.jpg
    contra.jpg
    guarda.jpg
```

`libro.md` es la colección. Los capítulos son archivos normales (`type:
file`) y también pueden construir su propia salida.

## 2. Configuración

```yaml
language: es-MX
toc: true
license: CC-BY-NC-ND-4.0

format:
  html:
    generate: true
    pageSize: 10
    site:
      title: Libro de ejemplo
      description: Un libro hecho con iteraciones.
      theme: dark
      color: amber
  pdf:
    generate: true
    showDate: true
    pageNumber: footer-center
    courtesyPage: true
    coverImage: true
    coverColor: true
  epub:
    generate: true
  latex:
    generate: true
  markdown:
    generate: true
    merge: false
```

- `toc: true` activa el índice en PDF, LaTeX, HTML y EPUB. También se puede
  poner en el frontmatter de la colección.
- `courtesyPage: true` agrega la página de cortesía del PDF a doble página.
- `coverImage: true` deja un PNG de la primera página junto al PDF.
- `coverColor: true` conserva el color de la portada y la contraportada. La
  guarda (`startpaper`) va en grises.
- `format.markdown.merge: false` conserva el Markdown de cada capítulo. Con
  `true`, el Markdown de la colección sale fusionado.

## 3. La colección

`libro.md`:

```markdown
---
title: Libro de ejemplo
subtitle: Una obra en tres capítulos
type: collection
slug: libro-de-ejemplo
collectionCreator: Equipo editorial
collectionCreatorPrefix: Edición
date: 2026-05-01
publisher: Editorial de ejemplo
description: Libro de ejemplo para probar portada, índice y descargas.
keywords: [libro, ejemplo]
license: CC-BY-NC-ND-4.0
frontCover: portada/frente.jpg
backCover: portada/contra.jpg
startpaper: portada/guarda.jpg
files:
  - ./capitulos/01-apertura.md
  - ./capitulos/02-desarrollo.md
  - ./capitulos/03-cierre.md
---

Texto de presentación del libro. Aparece antes de los capítulos.
```

`collectionCreator` es la editora o antologadora. En una colección no se
declara `creator`: el crédito de autoría se calcula con los `creator` de los
capítulos. Si necesitas un crédito editorial, usa `collectionCreator` y
`collectionCreatorPrefix`.

Las rutas de `files[]` se resuelven desde el directorio de la colección y
después desde la raíz del proyecto. Los miembros pueden ser `file` o
`intervention`.

## 4. Un capítulo

```markdown
---
title: Apertura
slug: 01-apertura
creator: Ana Ejemplo
date: 2026-05-01
---

## Primera sección

Contenido del capítulo.
```

El `slug` manual conserva el nombre del archivo en la salida. Si lo omites, el
slug se arma con el título y la autoría (`apertura-por-ana-ejemplo`).

Los encabezados del capítulo alimentan el índice del PDF y del EPUB. En el
HTML, el índice de la colección lista los capítulos, no cada encabezado.

## 5. Portada y guardas

| Campo | PDF | HTML | EPUB |
|---|---|---|---|
| `frontCover` | Primera página a sangre. | Tarjeta de portada antes del contenido. | Imagen de portada del EPUB. |
| `backCover` | Segunda página a sangre. | Tarjeta de contraportada. | No se usa como portada. |
| `startpaper` | Guarda. | Tarjeta de guarda. | No se usa como portada. |
| `titleImage` | Imagen dentro de la página de título. | No se muestra. | No se usa como portada. |
| `publisherImage` | Logo de la editorial. | No se muestra. | No se usa. |

Con `frontCover`, `backCover` y `startpaper`, las tres primeras páginas del
PDF son portada, contraportada y guarda, en ese orden. Si solo hay
`startpaper`, la primera página es la guarda.

Las imágenes se declaran con una ruta relativa al archivo de la colección. El
pipeline las procesa para HTML (WebP) y para PDF (CMYK).

## 6. Índice

`toc: true` en la configuración o en el frontmatter de la colección:

- En el PDF y el EPUB, el índice sale de los encabezados de los capítulos.
- En el HTML, la tarjeta «Índice» lista todos los miembros de la colección.
  Es el mismo índice en todas las páginas de la colección, no solo en la
  primera.
- El índice se omite si no hay entradas que mostrar.

En un `file` normal, `toc: true` genera el índice de sus encabezados.

## 7. Descargas

La tarjeta «Formatos» aparece cuando hay al menos un formato activo que el
documento produzca. En un libro con PDF, EPUB, LaTeX y Markdown, el HTML del
libro enlaza a:

```text
./libro-de-ejemplo.pdf
./libro-de-ejemplo.epub
./libro-de-ejemplo.tex
./libro-de-ejemplo.md
```

Los enlaces llevan `download` y abren en otra pestaña. Solo se muestran los
formatos activos en la configuración; no hay botón de «descargar todo».

La colección completa es el PDF/EPUB del libro. Cada capítulo sigue
produciendo sus propios archivos. Si solo quieres el libro completo, ignora
las salidas de los capítulos o espera la matriz de formatos por type; hoy la
CLI genera todas las salidas activas para cada miembro.

## 8. La cuadrícula HTML se queda

La página HTML del libro no imita un libro físico ni inventa un visor de
páginas. Conserva la cuadrícula de tarjetas del sitio: portadas, contenido,
índice, formatos y metadatos. No hay spread, page-flip ni maquetación de
doble página en HTML.

El PDF es el formato que lleva la maquetación de imprenta: páginas, folios,
portada, guardas, índice y capítulos.

## 9. Construir

```bash
bun run build
```

Salida:

```text
dist/files/
  libro-de-ejemplo.html
  libro-de-ejemplo.pdf
  libro-de-ejemplo.epub
  libro-de-ejemplo.tex
  libro-de-ejemplo.md
  libro-de-ejemplo.png
  capitulos/
    01-apertura.html
    01-apertura.pdf
    01-apertura.epub
    02-desarrollo.html
    ...
  assets/
    images/
      libro-de-ejemplo-frente.webp
      libro-de-ejemplo-contra.webp
      libro-de-ejemplo-guarda.webp
```

`iteraciones build --full` reconstruye todo sin caché. `iteraciones validate`
revisa el frontmatter y las rutas de `files[]` antes de publicar.

## Lista de comprobación

- [ ] `type: collection` y `files[]` con todos los capítulos.
- [ ] `toc: true` en la configuración o en la colección.
- [ ] `frontCover`, `backCover` y `startpaper` existen y son relativos a la
      colección.
- [ ] `coverColor` tiene el valor que quieres para las guardas.
- [ ] `format.pdf.generate`, `format.epub.generate` y `format.html.generate`
      están activos.
- [ ] `iteraciones validate` no reporta errores.
- [ ] El PDF abre con portada, índice y capítulos en el orden esperado.
- [ ] El EPUB abre con la portada y el índice.
- [ ] Los enlaces de descarga del HTML apuntan a archivos que existen.

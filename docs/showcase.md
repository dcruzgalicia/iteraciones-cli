# Showcase

Dos proyectos de ejemplo muestran lo que produce `iteraciones` mejor que una
lista de funciones: un sitio de textos y un libro. Los dos salen del mismo
Markdown, la misma configuración y el mismo build.

> **URLs de ejemplo:** este repositorio no incluye las direcciones reales de
> los dos proyectos. Los enlaces de abajo usan el dominio reservado
> `.example`; sustitúyelos por los que correspondan. No son sitios en línea.
>
> - Sitio: `https://SITIO-DE-EJEMPLO.example/`
> - Libro: `https://LIBRO-DE-EJEMPLO.example/`
> - Repositorios: `https://github.com/OWNER/sitio-de-ejemplo` y
>   `https://github.com/OWNER/libro-de-ejemplo`

## Los dos casos

| | Sitio de ejemplo | Libro de ejemplo |
|---|---|---|
| Qué es | Blog o sitio de textos de una comunidad. | Una colección con capítulos, portada y descargas. |
| Piezas | `file`, `creator`, `list`, `menu`, `announcement`. | Una `collection` con `files[]`, capítulos `file` y portadas. |
| Home | Lista de publicaciones o `index.md` propio. | Página de la colección con portada, índice y formatos. |
| Formatos | HTML, EPUB, PDF y Markdown. | HTML, PDF, EPUB, LaTeX y Markdown. |
| Navegación | Menú, autoras, palabras clave, listas filtradas. | Índice de capítulos y descargas del libro completo. |
| Sitio | `https://SITIO-DE-EJEMPLO.example/` | `https://LIBRO-DE-EJEMPLO.example/` |

## Sitio de ejemplo

Un proyecto editorial con textos fechados, fichas de autoras y un menú. La
home lista las publicaciones; cada texto tiene su página, su ficha de autoría
y sus descargas.

Lo que muestra:

- Una home generada o un `index.md` con `type: list`.
- Textos con `title`, `creator`, `date`, `keywords` y `license`.
- Fichas de creadoras con retrato y enlaces.
- Un menú con enlaces internos y externos.
- Tarjetas de formatos solo para los archivos que existen.
- Un admin de Sveltia para editar el contenido.

Configuración representativa:

```yaml
language: es-MX
toc: true
format:
  html:
    generate: true
    pageSize: 10
    site:
      title: Sitio de ejemplo
      description: Textos de la comunidad.
      theme: dark
      color: lime
  pdf:
    generate: true
  epub:
    generate: true
  markdown:
    generate: true
```

Salida:

```text
dist/files/
  index.html
  textos/
    primer-texto-por-ana-ejemplo.html
    primer-texto-por-ana-ejemplo.pdf
    primer-texto-por-ana-ejemplo.epub
    primer-texto-por-ana-ejemplo.md
  creadoras/
    ana-ejemplo.html
  menu.html
  assets/
  admin/
```

Muestra de una tarjeta de formatos:

```html
<h2>Formatos</h2>
<ul>
  <li><a download href="./primer-texto-por-ana-ejemplo.pdf">PDF</a></li>
  <li><a download href="./primer-texto-por-ana-ejemplo.epub">EPUB</a></li>
  <li><a download href="./primer-texto-por-ana-ejemplo.md">Markdown</a></li>
</ul>
```

Receta completa: [blog o sitio de textos](recetas/blog.md).

## Libro de ejemplo

Una colección que reúne capítulos en un solo PDF y EPUB, con portada,
contraportada, guarda, índice y descargas.

Lo que muestra:

- `type: collection` con `files[]`.
- Portada y contraportada a página completa en el PDF; tarjetas en el HTML.
- Guarda (`startpaper`) y opción de color (`coverColor`).
- Índice de capítulos en PDF, EPUB y HTML.
- Descargas del libro completo y de cada capítulo.
- La cuadrícula HTML del sitio, sin simular un libro físico.

Configuración representativa:

```yaml
language: es-MX
toc: true
format:
  html:
    generate: true
    pageSize: 10
    site:
      title: Libro de ejemplo
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
```

Colección:

```markdown
---
title: Libro de ejemplo
type: collection
collectionCreator: Equipo editorial
collectionCreatorPrefix: Edición
frontCover: portada/frente.jpg
backCover: portada/contra.jpg
startpaper: portada/guarda.jpg
files:
  - ./capitulos/01.md
  - ./capitulos/02.md
---
```

Salida:

```text
dist/files/
  libro-de-ejemplo.html
  libro-de-ejemplo.pdf
  libro-de-ejemplo.epub
  libro-de-ejemplo.tex
  libro-de-ejemplo.md
  capitulos/
    01.html
    01.pdf
    01.epub
    02.html
    02.pdf
    02.epub
```

Receta completa: [libro](recetas/libro.md).

## Capturas y muestras

Este repositorio no guarda capturas binarias de los sitios. Las muestras de
arriba son la estructura de salida y fragmentos del HTML generado; se pueden
reproducir con las recetas y con `iteraciones build`.

Para ver el sitio en local:

```bash
bun run build
python3 -m http.server 8000 --directory dist/files
```

Abre `http://localhost:8000/`. Para probar una ruta base tipo GitHub Pages,
sirve el contenido dentro de una carpeta:

```bash
mkdir -p /tmp/showcase/REPO
cp -R dist/files/. /tmp/showcase/REPO/
python3 -m http.server 8000 --directory /tmp/showcase
# http://localhost:8000/REPO/
```

## Cómo se relacionan

Los dos proyectos usan el mismo pipeline:

1. Markdown con frontmatter.
2. `iteraciones build` descubre, renderiza y escribe.
3. El HTML comparte plantilla y tarjetas; el PDF y el EPUB usan el mismo
   contenido.
4. Las portadas, el índice y las descargas son configuración, no código.

La diferencia es editorial: el sitio reparte textos en páginas; el libro los
reúne en una colección.

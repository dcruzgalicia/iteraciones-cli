# Documentación de iteraciones-cli

`iteraciones` toma archivos Markdown, los procesa con Pandoc y escribe un
sitio HTML y, si los activas, PDF, EPUB, LaTeX y Markdown. La configuración es
opcional: sin `iteraciones.config.yaml` se usan los valores por defecto.

Esta documentación es para quien publica un sitio, un libro o un repositorio.
La referencia exacta de comandos y opciones está en `iteraciones --help`.

## Requisitos

- Bun 1.4 o superior.
- Pandoc 3.0 o superior (`pandoc --version`).
- ImageMagick 7 con el comando `magick`.
- Opcional para PDF: LaTeX (`latexmk` y `pdflatex`), Biber si hay bibliografía
  y Poppler (`pdftoppm`) si usas portadas.
- Opcional para minificar HTML: `minify`.

`iteraciones doctor` revisa el entorno. `iteraciones validate` revisa la
configuración y el frontmatter antes de publicar.

## Instalación en un proyecto

La CLI todavía no se publica en npm. Cada proyecto guarda el tarball de la
versión que usa, para que el build sea reproducible.

En el repositorio de `iteraciones-cli`:

```bash
bun pm pack
```

En el proyecto nuevo:

```bash
mkdir -p vendor
cp ../iteraciones-cli/iteraciones-cli-*.tgz vendor/
```

`package.json`:

```json
{
  "private": true,
  "dependencies": {
    "iteraciones-cli": "file:vendor/iteraciones-cli-0.27.0.tgz"
  },
  "scripts": {
    "build": "iteraciones build",
    "dev": "iteraciones preview"
  }
}
```

```bash
bun install
```

Guarda `vendor/` y `bun.lock` en el repositorio. Para actualizar la CLI,
reemplaza el tarball, cambia la ruta en `package.json` y vuelve a ejecutar
`bun install`.

## Primer sitio en cinco minutos

```bash
bunx iteraciones init sveltia   # admin, layout de contenido y netlify.toml
bunx iteraciones new textos/primer-texto.md
bun run build
```

`init sveltia` crea `admin/`, las carpetas `textos/`, `creadoras/`,
`colecciones/`, `listas/`, `anuncios/`, `intervenciones/` y
`palabras-clave/`, además de `netlify.toml` y `Brewfile.netlify`. No crea
`index.md`: si falta, el build genera una página de inicio con las
publicaciones.

El resultado queda en `dist/files/`:

```text
dist/files/
  index.html
  primer-texto.html
  primer-texto.pdf        # si format.pdf.generate es true
  primer-texto.epub       # si format.epub.generate es true
  assets/
    css/styles.css
    images/
  admin/                  # si existe admin/ en el proyecto
```

`iteraciones preview` reconstruye al detectar cambios, pero no levanta un
servidor: abre los archivos de `dist/files/` con tu navegador.

## Conceptos

- [Conceptos](conceptos.md): qué es un type, qué formatos produce cada uno,
  cómo se descubre el contenido y cómo se resuelven los metadatos.
- [Configuración](configuracion.md): referencia de las claves de
  `iteraciones.config.yaml` y del frontmatter.

## Recetas

- [Blog o sitio de textos](recetas/blog.md): publicaciones, autoras, menú,
  palabras clave y listas.
- [Libro](recetas/libro.md): una colección con portada, índice, PDF, EPUB y
  descargas.
- [Repositorio](recetas/repositorio.md): fichas con metadatos, series y
  listados filtrados.

## Despliegue

- [Cabeceras de caché y seguridad](despliegue/cabeceras.md): qué va en el
  hosting y qué no va en el HTML.
- [GitHub Pages](despliegue/github-pages.md): ruta base, rama de publicación y
  límites de cabeceras.
- [Netlify](despliegue/netlify.md): lo que ya genera `init sveltia` y las
  cabeceras que faltan.
- [Cloudflare Pages](despliegue/cloudflare-pages.md): build, publish y
  `_headers`.

## Más

- [Showcase](showcase.md): los dos proyectos de ejemplo y lo que produce cada
  uno.
- [Piloto universitario](piloto-universitario.md): alcance, metadatos,
  accesibilidad, preservación y relación con OJS/DSpace.

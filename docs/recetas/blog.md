# Receta: blog o sitio de textos

Un blog en `iteraciones` es un proyecto con textos (`type: file`), fichas de
autoras (`type: creator`), palabras clave, un menú y listas que se arman solas.
No hace falta un type distinto: el sitio es el conjunto de documentos.

## 1. Crear el proyecto

```bash
mkdir mi-sitio
cd mi-sitio
# Copia el tarball de iteraciones-cli y declara la dependencia como en
# docs/README.md
bun install
bunx iteraciones init sveltia
```

`init sveltia` deja `admin/`, `textos/`, `creadoras/`, `colecciones/`,
`listas/`, `anuncios/`, `intervenciones/`, `palabras-clave/`, `netlify.toml`
y `Brewfile.netlify`. No sobrescribe archivos existentes. Incluye un
`textos/ejemplo.md`; bórralo cuando tengas tu primer texto.

## 2. Configurar el sitio

`iteraciones.config.yaml`:

```yaml
language: es-MX
toc: true
license: CC-BY-NC-ND-4.0

format:
  html:
    generate: true
    pageSize: 10
    site:
      title: Sitio de ejemplo
      description: Textos de la comunidad.
      theme: dark
      color: lime
      links:
        - name: Mastodon
          url: https://ejemplo.example/@sitio
        - name: GitHub
          url: https://github.com/OWNER/sitio-de-ejemplo
  epub:
    generate: true
  markdown:
    generate: true
```

`format.html.site.links` alimenta los botones de redes del header y del
footer. Los enlaces externos abren en otra pestaña.

## 3. La home

Si no existe `index.md`, el build crea `index.html` con la lista de todas las
publicaciones. Es la opción más rápida para empezar.

Si quieres una home con texto propio y la lista debajo, crea `index.md` como
`type: list`:

```markdown
---
title: Publicaciones
type: list
order: date-desc
---

Bienvenida al sitio. Aquí se reúnen los textos de la comunidad.
```

También puedes crear un `index.md` normal (`type: file`) con una bienvenida y
enlazar a `texto.html` desde el menú. En ese caso la home no lista las
publicaciones automáticamente.

## 4. Un texto

```markdown
---
title: Primer texto
subtitle: Una nota de ejemplo
slug: primer-texto
creator: Ana Ejemplo
date: 2026-01-15
keywords: [memoria, archivo]
license: CC-BY-NC-ND-4.0
---

Contenido del texto.
```

El slug se genera con el título y la autoría; si quieres fijar la URL, usa
`slug: primer-texto`, como en el ejemplo. Sin `slug`, el archivo saldría como
`primer-texto-por-ana-ejemplo.html`. El archivo puede vivir en `textos/` o en
una carpeta propia; la estructura se conserva en `dist/files/`.

`iteraciones new textos/segundo-texto.md` crea el archivo con un frontmatter
mínimo y una fecha.

## 5. Una autora

```markdown
---
type: creator
name: Ana Ejemplo
image: assets/images/ana.jpg
links:
  - name: Sitio
    url: https://ejemplo.example
  - name: ORCID
    url: https://orcid.org/0000-0000-0000-0000
---

Semblanza de Ana Ejemplo.
```

Los textos que declaran `creator: Ana Ejemplo` enlazan a su ficha. La ficha
aparece en la lista de colaboradoras y en las tarjetas de los textos.

## 6. Menú y palabras clave

`menu.md`:

```markdown
---
title: Menú
type: menu
links:
  - name: Inicio
    url: ./index.html
  - name: Textos
    url: ./texto.html
  - name: Autoras
    url: ./creadora.html
  - name: Convocatorias
    url: ./convocatorias.html
---

```

El menú es una página (`menu.html`) y también alimenta el header. El footer
muestra los primeros enlaces; el resto queda en la página del menú. Las rutas
se escriben desde la raíz del proyecto, no desde `menu.md`: una página en
`paginas/contacto.md` se enlaza como `./paginas/contacto.html`, y una lista en
`listas/publicaciones.md` como `./publicaciones.html`. Si un enlace da 404,
corrige la ruta en `menu.md`; no hay resolución automática.

Las páginas `texto.html`, `creadora.html` y `coleccion.html` solo se generan
cuando hay más de un documento de ese type. Si tu proyecto tiene uno solo,
agrega una lista propia o quita ese enlace hasta que haya más contenido.

Para las palabras clave puedes declararlas directamente en el frontmatter
(`keywords: [memoria, archivo]`) o usar la carpeta `palabras-clave/` con el
admin de Sveltia. La página `keyword.html` se genera cuando hay al menos dos
palabras clave con contenido.

## 7. Listas

Una lista filtra y ordena sin mantener archivos a mano:

```markdown
---
title: Textos sobre memoria
type: list
filter:
  type: file
  keyword: memoria
order: date-desc
---
```

Los filtros disponibles son `type`, `creator`, `date` (`from` y `to`),
`keyword` y `path`. Los órdenes son `date-desc`, `date-asc`, `title-asc`,
`title-desc` y `creator-asc`.

## 8. Construir y revisar

```bash
bun run build
bunx iteraciones validate
bunx iteraciones doctor
```

El sitio queda en `dist/files/`:

```text
dist/files/
  index.html
  textos/primer-texto.html
  textos/primer-texto.epub
  textos/primer-texto.md
  creadoras/ana-ejemplo.html
  texto.html
  keyword.html
  keywords/
    memoria.html
  menu.html
  assets/
  admin/
```

`iteraciones preview` reconstruye al detectar cambios. No levanta servidor:
abre `dist/files/index.html` en el navegador o publica el directorio en el
hosting.

## 9. Publicar

- [Netlify](../despliegue/netlify.md): `init sveltia` ya dejó el
  `netlify.toml`; solo faltan las cabeceras.
- [Cloudflare Pages](../despliegue/cloudflare-pages.md): build y `_headers`.
- [GitHub Pages](../despliegue/github-pages.md): límites de cabeceras y ruta
  base.

## Lista de comprobación

- [ ] `iteraciones validate` termina sin errores.
- [ ] La home existe (`index.html`) y enlaza a las publicaciones.
- [ ] Cada texto tiene `title`, `creator`, `date` y `license`.
- [ ] Las autoras tienen ficha y retrato si se publica imagen.
- [ ] El menú no apunta a páginas que no existen.
- [ ] Los enlaces de descarga abren el PDF, EPUB o Markdown correcto.

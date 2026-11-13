# Sveltia y layout de contenido

Sveltia administra carpetas. Para que el layout funcione, `index.md` y
`menu.md` viven en la raíz del proyecto; el resto del contenido va en carpetas.

```text
index.md                 # portada, fuera de la UI
menu.md                  # menú, colección de archivos en Sveltia
paginas/                 # páginas sueltas type: file
textos/                  # posts type: file
documentos/              # documentos de repositorio type: file
listas/                  # definiciones type: list
colecciones/             # libros, números, antologías type: collection
creadoras/               # perfiles type: creator
convocatorias/           # convocatorias type: file
anuncios/                # type: announcement
palabras-clave/          # vocabulario para relaciones
```

## Type, carpeta y colección

| Type | Carpeta | Colección en Sveltia | Formatos |
|---|---|---|---|
| `file` | `textos/`, `paginas/`, `documentos/` o `convocatorias/` | Textos, Páginas, Documentos o Convocatorias | HTML, PDF, EPUB, LaTeX y Markdown. |
| `collection` | `colecciones/` | Colecciones | HTML, PDF, EPUB, LaTeX y Markdown. |
| `creator` | `creadoras/` | Creadoras | Solo HTML. |
| `list` | `listas/` | Listas | Solo HTML. |
| `menu` | raíz (`menu.md`) | Menú | Solo HTML. |
| `announcement` | `anuncios/` | Anuncios | Solo HTML. |
| `intervention` | `intervenciones/` | Intervenciones | PDF, LaTeX y Markdown. |

Una página suelta va en `paginas/`; un texto de blog o una publicación va en
`textos/`; un documento de repositorio va en `documentos/`. Las listas viven
en `listas/` y su salida HTML queda en la raíz del sitio (`listas/todos.md`
produce `todos.html`).

## Reglas

- `index.md` puede ser `file`, `list`, `creator` o `collection`; no se edita
  desde Sveltia.
- `menu.md` se edita como un archivo de Sveltia. Sus URLs se escriben desde la
  raíz del proyecto (`./textos/mi-texto.html`, `./paginas/contacto.html`). Si
  una ruta está mal, se corrige en `menu.md`; no hay resolución automática.
- Las listas usan `filter.path` para separar carpetas:

```yaml
---
title: Publicaciones
type: list
order: date-desc
filter:
  path: textos/
---
```

- El repositorio usa `index.md` como único catálogo. No se crea `catalogo.md`.
- Las listas automáticas solo se generan con dos o más elementos.
- `frontCover` y `backCover` son opcionales. Si se declaran, la ruta es
  relativa al Markdown que los declara.

## `init sveltia`

`iteraciones init sveltia` genera `admin/`, `admin/config.yml`, el layout de
Sveltia y los archivos de Netlify. Las colecciones se incluyen según las
carpetas que existan en el proyecto: `textos`, `paginas`, `documentos`,
`creadoras`, `colecciones`, `convocatorias`, `anuncios`, `listas` y
`palabras-clave`. `index.md` queda fuera de la UI.

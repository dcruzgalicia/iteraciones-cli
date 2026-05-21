# Referencia de frontmatter

Todos los archivos Markdown del proyecto pueden declarar metadatos en un bloque YAML al inicio del archivo, delimitado por `---`. Este bloque se llama **frontmatter**.

```markdown
---
title: 'Mi artículo'
date: 2025-01-15
author:
  - Sofia García
keywords:
  - cultura
  - memoria
---

Contenido del artículo...
```

## Campos comunes

Todos los tipos de documento reconocen estos campos:

| Campo | Tipo | Por defecto | Descripción |
|-------|------|-------------|-------------|
| `title` | `string` | `''` | Título del documento. |
| `date` | `string` | `''` | Fecha en formato `YYYY-MM-DD`. |
| `author` | `string \| string[]` | `[]` | Uno o varios autores. |
| `keywords` | `string \| string[]` | `[]` | Palabras clave del documento. |
| `draft` | `boolean` | `false` | Si `true`, el documento se omite en el build. |
| `type` | `string` | `'file'` | Tipo de documento (ver sección siguiente). |

## Tipos de documento

El campo `type` determina qué template y contexto se usan. Si no se declara, el tipo inferido es `file`.

### `file` — Artículo o página

Tipo por defecto para cualquier documento de contenido.

```yaml
---
title: 'Primer artículo'
date: 2025-01-15
author:
  - Sofia García
keywords:
  - cultura
draft: false
---
```

### `collection` — Colección de ítems

Agrupa documentos relacionados. El campo `items` lista rutas relativas a otros documentos `.md`.

```yaml
---
title: 'Archivo 2024'
type: collection
items:
  - posts/articulo-a.md
  - posts/articulo-b.md
---
```

### `author` — Perfil de autor

Página de perfil de una persona. Los documentos de tipo `file` que declaran `author:` enlazan automáticamente a su página de autor.

```yaml
---
title: 'Sofia García'
type: author
---
```

### `authors` — Índice de autores

Lista paginada de todos los documentos de tipo `author`.

```yaml
---
title: 'Autores'
type: authors
---
```

### `event` — Evento

Documento con fecha de evento. Se diferencia de `file` en que su contexto incluye datos de ponentes.

```yaml
---
title: 'Coloquio anual'
type: event
date: 2025-03-20
speakers:
  - name: 'Sofia García'
    href: /personas/sofia.html
---
```

### `events` — Índice de eventos

Lista paginada de todos los documentos de tipo `event`.

```yaml
---
title: 'Eventos'
type: events
---
```

### `menu` — Menú de navegación

Define los enlaces del menú principal. Solo un documento de este tipo debe existir por proyecto; el primero encontrado tiene prioridad.

```yaml
---
title: 'Navegación'
type: menu
nav:
  - label: 'Inicio'
    href: /
  - label: 'Artículos'
    href: /posts.html
---
```

### `card` — Tarjeta

Fragmento reutilizable en formato tarjeta. Puede usarse como bloque (ver más abajo).

```yaml
---
title: 'Convocatoria'
type: card
---
```

### `list` — Lista general

Índice paginado de todos los documentos del sitio.

```yaml
---
title: 'Todos los artículos'
type: list
---
```

### `feed` — Feed acotado

Lista compacta y no paginada. Muestra un número limitado de documentos. Puede usarse como página standalone o como bloque en una región (ver más abajo).

```yaml
---
title: 'Últimas publicaciones'
type: feed
limit: 5
filters:
  keywords:
    - lectura
---
```

Como bloque en una región:

```yaml
---
title: 'Recientes'
type: feed
block: true
region: sidebar-primary
limit: 3
---
```

| Campo | Descripción | Default |
|-------|-------------|---------|
| `limit` | Número máximo de ítems a mostrar. Entero positivo. | `3` |
| `filters` | Igual que en `list`: `type`, `keywords`, `author` | — |

> **Nota:** cuando se usa como bloque, el pool de documentos disponibles está limitado a los tipos primarios (`file`, `author`, `event`) — la misma restricción que aplica a `list` en modo bloque.

## Bloques

Cualquier tipo de documento puede convertirse en **bloque** añadiendo `block: true` y `region:`. Los bloques se inyectan en el layout de todas las páginas; no generan su propio archivo HTML.

```yaml
---
title: 'Convocatoria permanente'
type: card
block: true
region: sidebar-primary
---
```

### Regiones disponibles

| Región | Descripción |
|--------|-------------|
| `content-before` | Antes del contenido principal |
| `content-after` | Después del contenido principal |
| `sidebar-primary` | Barra lateral principal |
| `sidebar-secondary` | Barra lateral secundaria |
| `footer-left` | Columna izquierda del pie de página |
| `footer-center` | Columna central del pie de página |
| `footer-right` | Columna derecha del pie de página |

## Campos avanzados

### `speakers` — Ponentes (solo `event`)

```yaml
speakers:
  # Texto simple:
  - 'Sofia García'
  # Objeto con enlace y cuerpo:
  - title: 'Rodrigo Mendez'
    href: /personas/rodrigo.html
    body: 'Investigador en lingüística'
```

### `filters` — Filtros de lista (solo `list`, `feed`, `events`)

Filtra los documentos que aparecen en el índice.

```yaml
filters:
  type:
    - event
  keywords:
    - cultura
  author:
    - Sofia García
```

### `items` — Ítems explícitos (solo `collection`)

Rutas relativas desde el directorio raíz del proyecto.

```yaml
items:
  - posts/articulo-a.md
  - posts/articulo-b.md
```

Las rutas se validan con `iteraciones validate`.

### `editorial` — Metadatos editoriales (tipos exportables)

El bloque `editorial` activa metadatos de publicación en los archivos PDF y EPUB generados por `iteraciones build`. Solo aplica a los tipos exportables: `file`, `event`, `author`, `collection` y `events`. Los campos son opcionales; se pueden combinar libremente.

```yaml
---
title: 'Antología de ensayos'
type: collection
items:
  - ensayos/primer-texto.md
  - ensayos/segundo-texto.md
editorial:
  isbn: 978-0-000-00000-0
  publisher: Editorial Iteraciones
  rights: CC BY-SA 4.0
  description: Una colección de textos sobre diseño y tecnología.
  cover: assets/portada.jpg          # ruta relativa al directorio raíz del proyecto
  bibliography: referencias.bib      # activa --citeproc; ruta relativa al directorio raíz
  csl: apa.csl                       # estilo de citas CSL; solo tiene efecto si bibliography está definido
---
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `isbn` | `string` | ISBN del documento. Se incluye en los metadatos del PDF y el EPUB. |
| `publisher` | `string` | Nombre de la editorial o institución publicadora. |
| `rights` | `string` | Licencia o nota de derechos (p. ej. `CC BY-SA 4.0`). |
| `description` | `string` | Descripción del documento. Visible en el EPUB como metadato de descripción. |
| `cover` | `string` | Ruta relativa a una imagen de portada. Se usa como portada en el EPUB. |
| `bibliography` | `string` | Ruta relativa a un archivo `.bib` de BibTeX. Activa el procesador de citas `--citeproc` de pandoc. |
| `csl` | `string` | Ruta relativa a un archivo de estilo CSL. Controla el formato de las citas cuando hay `bibliography`. |

Las rutas de `cover`, `bibliography` y `csl` se validan con `iteraciones validate` antes del build.

#### Citas bibliográficas

Cuando `editorial.bibliography` está declarado, el build activa el procesador de citas de pandoc. Las citas en el Markdown deben seguir el formato `[@clave]`:

```markdown
Este fenómeno ha sido ampliamente estudiado [@garcia2023; @mendez2024].
```

Si no se declara `csl`, pandoc usa el estilo por defecto (Chicago autor-fecha).

## Campos personalizados

El frontmatter acepta campos arbitrarios (`[key: string]: unknown`). Los campos no reconocidos se ignoran en el procesamiento estándar. En la implementación actual, los hooks de plugin (`beforeRender`, `afterRender`) no reciben el frontmatter completo; `beforeRender` solo expone `sourcePath` y un objeto `variables` vacío.

---

## Configuración de exportación en `_iteraciones.yaml`

La exportación PDF y EPUB se activa globalmente desde el archivo de configuración del proyecto. Si el campo `export:` no existe, no se genera ningún archivo de exportación y el build ignora las dependencias de LaTeX.

```yaml
export:
  formats: [pdf, epub]   # qué formatos generar; puede ser solo [pdf] o solo [epub]
  pdf-engine: xelatex    # xelatex (por defecto) o lualatex
```

| Campo | Tipo | Por defecto | Descripción |
|-------|------|-------------|-------------|
| `formats` | `('pdf' \| 'epub')[]` | — | Formatos a generar. Si el array está vacío o ausente, no se exporta nada. |
| `pdf-engine` | `'xelatex' \| 'lualatex'` | `xelatex` | Motor LaTeX para PDF. Requiere MacTeX full o TeX Live full. |

Para omitir la exportación en un build puntual (por ejemplo durante desarrollo), usar `iteraciones build --no-export`.

### Omitir exportación para un documento individual

Un documento puede excluirse de la exportación PDF/EPUB mientras sigue apareciendo normalmente como HTML en el sitio:

```yaml
---
title: Mi artículo
export:
  skip: true
---
```

Con `export: { skip: true }` en el frontmatter, el documento no genera ni PDF ni EPUB aunque `export.formats` esté configurado globalmente. El documento continúa siendo renderizado y publicado como HTML.

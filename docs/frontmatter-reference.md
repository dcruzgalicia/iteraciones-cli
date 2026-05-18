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

### `filters` — Filtros de lista (solo `list`, `events`)

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

## Campos personalizados

El frontmatter acepta campos arbitrarios (`[key: string]: unknown`). Los campos no reconocidos se ignoran en el procesamiento estándar. En la implementación actual, los hooks de plugin (`beforeRender`, `afterRender`) no reciben el frontmatter completo; `beforeRender` solo expone `sourcePath` y un objeto `variables` vacío.

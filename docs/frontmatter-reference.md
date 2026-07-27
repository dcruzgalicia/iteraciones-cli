# Referencia de frontmatter

Todos los archivos Markdown pueden declarar metadatos en un bloque YAML al inicio del archivo, delimitado por `---`. Este bloque se llama **frontmatter**.

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

| Campo | Tipo | Por defecto | Descripción |
|-------|------|-------------|-------------|
| `title` | `string` | `''` | Título del documento. |
| `date` | `string` | `''` | Fecha en formato `YYYY-MM-DD`. |
| `author` | `string \| string[]` | `[]` | Uno o varios autores. |
| `keywords` | `string \| string[]` | `[]` | Palabras clave del documento. |

## Omitir exportación para un documento individual

Un documento puede excluirse de la exportación PDF, EPUB y Markdown mientras sigue apareciendo normalmente en HTML:

```yaml
---
title: Mi artículo
export:
  skip: true
---
```

Con `export: { skip: true }` en el frontmatter, el documento no genera PDF, EPUB ni Markdown, pero continúa siendo renderizado como HTML.

## Metadatos editoriales

El bloque `editorial` activa metadatos de publicación en los archivos PDF y EPUB generados. Todos los campos son opcionales.

```yaml
---
title: 'Antología de ensayos'
editorial:
  isbn: 978-0-000-00000-0
  publisher: Editorial Iteraciones
  rights: CC BY-SA 4.0
  description: Una colección de textos sobre diseño y tecnología.
  cover: assets/portada.jpg          # ruta relativa al directorio raíz del proyecto
  bibliography: referencias.bib      # activa --citeproc; ruta relativa al directorio raíz
  csl: apa.csl                       # estilo de citas CSL
  abstract: Resumen del documento    # texto breve que aparece en metadatos
---
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `isbn` | `string` | ISBN del documento. Se incluye en los metadatos del PDF y EPUB. |
| `publisher` | `string` | Nombre de la editorial o institución publicadora. |
| `rights` | `string` | Licencia o nota de derechos (p. ej. `CC BY-SA 4.0`). |
| `description` | `string` | Descripción del documento. |
| `abstract` | `string` | Resumen o extracto breve. Se usa como meta description en HTML. |
| `cover` | `string` | Ruta relativa a una imagen de portada. Se usa como portada en EPUB. |
| `bibliography` | `string` | Ruta relativa a un archivo `.bib`. Activa `--citeproc` de pandoc en PDF y EPUB. |
| `csl` | `string` | Ruta relativa a un archivo CSL. Controla el formato de citas. Requiere `bibliography`. |

Las rutas de `cover`, `bibliography` y `csl` se validan con `iteraciones validate` antes del build.

### Citas bibliográficas

Cuando `editorial.bibliography` está declarado (o se encuentran archivos `.bib` en el proyecto), las citas en Markdown siguen el formato pandoc `[@clave]`:

```markdown
Este fenómeno ha sido ampliamente estudiado [@garcia2023; @mendez2024].

Según @ejemplo2024, el uso de citekeys facilita la gestión de referencias.
```

## Epígrafe (dictum)

Se puede declarar un epígrafe al inicio del documento usando el campo `dictum` en el frontmatter. Aplica solo a la exportación PDF.

```yaml
---
title: 'Mi artículo'
dictum:
  - text: 'Dios hizo los números enteros, el resto es obra del hombre.'
    author: 'Leopold Kronecker'
---
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `text` | `string` | Texto de la cita. |
| `author` | `string` | Autor de la cita (opcional). |

## Campos personalizados

El frontmatter acepta campos arbitrarios. Los campos no reconocidos se ignoran en el procesamiento estándar.

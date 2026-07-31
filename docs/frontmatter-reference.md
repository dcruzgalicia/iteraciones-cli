# Referencia de frontmatter

Todos los archivos Markdown pueden declarar metadatos en un bloque YAML al inicio del archivo, delimitado por `---`. Este bloque se llama **frontmatter**.

```markdown
---
title: 'Mi artículo'
subtitle: 'Subtítulo opcional'
date: 2025-01-15
author:
  - Sofia García
  - Juan Pérez
---

Contenido del artículo...
```

## Campos

El pipeline consume **4 campos** del frontmatter:

| Campo | Tipo | Por defecto | Descripción |
|-------|------|-------------|-------------|
| `title` | `string` | `''` | Título del documento. Se usa para el slug y el maketitle del PDF. |
| `subtitle` | `string` | — | Subtítulo del documento. Se muestra bajo el título en el maketitle del PDF. |
| `date` | `string` | — | Fecha en formato `YYYY-MM-DD`. Con `pdf.show-date: true` se muestra en el maketitle; si no se declara, se usa la fecha de creación del archivo. |
| `author` | `string \| string[]` | `[]` | Uno o varios autores. Hasta 3 participan en el slug (`title-by-author`). |

## Citas bibliográficas

Cuando se encuentran archivos `.bib` en el proyecto (auto-descubrimiento), las citas en Markdown siguen el formato pandoc `[@clave]`:

```markdown
Este fenómeno ha sido ampliamente estudiado [@garcia2023; @mendez2024].

Según @ejemplo2024, el uso de citekeys facilita la gestión de referencias.
```

## Campos personalizados

El frontmatter acepta campos arbitrarios. Los campos no reconocidos se ignoran en el procesamiento estándar.

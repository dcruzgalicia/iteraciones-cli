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

El pipeline consume **5 campos** del frontmatter:

| Campo | Tipo | Por defecto | Descripción |
|-------|------|-------------|-------------|
| `title` | `string` | `''` | Título del documento. Se usa para el slug y el maketitle del PDF. |
| `subtitle` | `string` | — | Subtítulo del documento. Se muestra bajo el título en el maketitle del PDF. |
| `date` | `string` | — | Fecha en formato `YYYY-MM-DD`. Con `pdf.show-date: true` se muestra en el maketitle; si no se declara, se usa la fecha de creación del archivo. |
| `author` | `string \| string[]` | `[]` | Uno o varios autores. El slug usa `title-por-author`: por defecto solo el primer autor; en caso de colisión se van añadiendo autores (`-y-`) y, si se agotan, se aplica un sufijo `-dN`. |
| `slug` | `string` | — | **Slug manual** (opcional): fija la URL del documento en lugar del esquema automático. Formato seguro: solo minúsculas, números y guiones simples (`^[a-z0-9]+(-[a-z0-9]+)*$`). Dos documentos con la misma salida (mismo directorio + slug) son un error de build y de `validate`. |

## Campos que fluyen a pandoc

El frontmatter completo se pasa a pandoc como metadata del documento. Los campos que el template y el pipeline consumen con efecto visible son:

| Campo | Efecto |
|-------|--------|
| `lang` | Idioma del documento (sobreescribe `lang` de la configuración) |
| `toc` | Activa/desactiva la tabla de contenidos de ese documento (sobreescribe `toc` de la configuración) |
| `description` | Meta description del HTML |
| `site-title`, `tagline`, `theme`, `accent`, `css` | Sobreescriben los valores de `format.html` para ese documento |

`validate` advierte sobre cualquier otro campo del frontmatter que no tenga efecto.

## Páginas de título internas (PDF)

Los campos `extratitle`, `dedication`, `uppertitleback` y `lowertitleback` definen las páginas de título internas del PDF (solo LaTeX/PDF; en HTML se ignoran). Son **metadatos multilinea**: se escriben con el bloque YAML literal (`|`), y el contenido se procesa como markdown normal:

- El **doble espacio al final de línea** produce un salto de línea (`\\`).
- Una línea con solo `::` produce un espacio vertical (`\vspace{\baselineskip}`).
- El texto se compone en `footnotesize` con interlineado 0.8 y sin indentación.

```yaml
---
title: 'Mi libro'
extratitle: 'Colección Editorial'
dedication: 'Para quienes sostienen la vida'
uppertitleback: |
  primera linea
  segunda linea

  ::

  tercera línea
lowertitleback: |
  Pie de portada con
  dos líneas
---
```

Orden de páginas en el PDF (flujo KOMA-Script): `extratitle` (primera página) → portada → `uppertitleback` (arriba) y `lowertitleback` (abajo) en el reverso de la portada → `dedication` (página impar siguiente, centrado). El cuerpo comienza en una página nueva; si hay titlebacks o dedication, se omite el espacio vertical post-portada.

## Citas bibliográficas

Cuando se encuentran archivos `.bib` en el proyecto (auto-descubrimiento), las citas en Markdown siguen el formato pandoc `[@clave]`:

```markdown
Este fenómeno ha sido ampliamente estudiado [@garcia2023; @mendez2024].

Según @ejemplo2024, el uso de citekeys facilita la gestión de referencias.
```

## Campos personalizados

El frontmatter acepta campos arbitrarios. Los campos no reconocidos se ignoran en el procesamiento estándar; `validate` advierte sobre ellos (ver la sección Campos).

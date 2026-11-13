# Receta: repositorio

Un repositorio es un catálogo de publicaciones con metadatos, series y
listados. En `iteraciones` se arma con los types existentes; no hay un type
`repository`. La búsqueda con facetas, la cosecha OAI-PMH y la integración
directa con DSpace no forman parte de la CLI.

Esta receta sirve para un repositorio pequeño o mediano: decenas o cientos de
fichas, no un repositorio institucional completo.

## 1. Modelo

| Pieza | Type | Uso |
|---|---|---|
| Registro | `file` | Un artículo, informe, tesis, capítulo o documento con metadatos. |
| Serie o número | `collection` | Agrupa registros en un número, una serie o un libro. |
| Autora | `creator` | Ficha de la persona, con enlaces e identificación. |
| Catálogo | `list` | Listado filtrado por type, autora, fecha, palabra clave o ruta. |
| Menú | `menu` | Navegación del sitio. |

## 2. Configuración

```yaml
language: es-MX
toc: true
license: CC-BY-NC-ND-4.0
publisher: Editorial de ejemplo

format:
  html:
    generate: true
    pageSize: 20
    site:
      title: Repositorio de ejemplo
      description: Publicaciones del proyecto.
      theme: light
      style: institucional
      color: blue
  pdf:
    generate: true
    showDate: true
    pageNumber: footer-center
  epub:
    generate: true
  markdown:
    generate: true
```

## 3. Un registro

```markdown
---
title: Informe de ejemplo
subtitle: Resultados del proyecto
creator: Ana Ejemplo
date: 2026-03-01
type: file
identifier: REP-2026-001
publisher: Editorial de ejemplo
description: Resumen del informe para el catálogo.
subject: [memoria, archivo]
keywords: [memoria, archivo, acceso abierto]
language: es-MX
license: CC-BY-NC-ND-4.0
rights: Algunos derechos reservados.
doi: 10.0000/ejemplo
source: Proyecto de ejemplo
relation: Serie de ejemplo
coverage: 2025-2026
abstract: |
  Resumen completo del documento.
---

Contenido del informe.
```

`identifier` no genera un DOI ni lo valida: es el número que use el proyecto.
`doi` es un texto informativo. La licencia sí se muestra en el sitio y en los
formatos exportados.

## 4. Una serie

```markdown
---
title: Serie de ejemplo, número 1
type: collection
collectionCreator: Equipo editorial
collectionCreatorPrefix: Edición
date: 2026-04-01
frontCover: assets/images/serie-01.jpg
backCover: assets/images/serie-01-contra.jpg
files:
  - ./registros/informe-01.md
  - ./registros/informe-02.md
---
```

La colección produce el PDF y el EPUB del número completo. Cada registro
conserva además su propia salida.

## 5. El catálogo

Una lista general:

```markdown
---
title: Catálogo
type: list
filter:
  type: file
order: date-desc
---
```

Y listas por autoría o palabra clave:

```markdown
---
title: Publicaciones de Ana Ejemplo
type: list
filter:
  creator: Ana Ejemplo
order: title-asc
---
```

El filtro `path` sirve para separar fondos o carpetas:

```yaml
filter:
  type: file
  path: registros/
```

## 6. Metadatos y Dublin Core

El pipeline reconoce estos campos Dublin Core en el frontmatter:

| Campo | Uso |
|---|---|
| `title` | Título del registro. |
| `creator` | Autoría. |
| `subject` | Materia o palabras clave temáticas. |
| `description` | Descripción breve. |
| `publisher` | Editorial o institución. |
| `contributor` | Colaboración. |
| `date` | Fecha ISO `YYYY-MM-DD`. |
| `identifier` | Identificador local. |
| `source` | Procedencia. |
| `relation` | Serie, número o relación. |
| `coverage` | Cobertura temporal o geográfica. |
| `rights` | Derechos. |
| `license` | Licencia. |
| `doi` | DOI como texto. |
| `isbn` | ISBN como texto. |
| `abstract` | Resumen. |

`iteraciones` no exporta un CSV ni un XML de Dublin Core. Para llevar el
catálogo a OJS o DSpace, el proyecto debe definir su mapeo y hacer la carga
manual o con un script propio. El [piloto universitario](../piloto-universitario.md)
propone un alcance y criterios para esa integración.

## 7. Preservación

- Versiona el Markdown, `iteraciones.config.yaml`, `bun.lock` y el tarball de
  la CLI en `vendor/`.
- Publica una etiqueta de Git por corte y guarda los archivos de
  `dist/files/`.
- Conserva el PDF y el Markdown fuente; el HTML es la vista de consulta.
- Si necesitas PDF para archivo, activa PDF/X-1a y verifica el resultado antes
  de declararlo.
- Documenta la versión de Pandoc y LaTeX usada en el build.

## Límites actuales

- No hay búsqueda full-text ni facetas interactivas.
- No hay OAI-PMH, API ni exportación DSpace.
- No hay flujo editorial, revisión por pares ni roles.
- No hay identificadores persistentes: `doi` e `identifier` son texto.

Para un repositorio institucional completo, usa DSpace u OJS y publica este
sitio como catálogo de consulta. La [receta de blog](blog.md) cubre la
navegación y las listas; la [receta de libro](libro.md), las series.

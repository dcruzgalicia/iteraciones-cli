# Configuración — `iteraciones.config.yaml`

El archivo `iteraciones.config.yaml` en la raíz del proyecto es la única fuente de configuración. `build` y `validate` exigen que exista: si falta, el comando falla y sugiere `iteraciones init`. Un archivo **vacío** equivale a todos los valores por defecto; crearlo vacío es la forma explícita de compilar sin personalización.

## Estructura completa

```yaml
language: es-MX                       # código de idioma BCP 47
toc: false                        # tabla de contenidos (PDF, LaTeX, HTML, EPUB)

# Metadatos Dublin Core (opcional; valores por defecto para todos los documentos)
# title: ''
# creator: ''
# subject: ''
# description: ''
# publisher: ''
# contributor: ''
# date: ''
# identifier: ''
# source: ''
# relation: ''
# coverage: ''
# rights: ''
# license: ''
# doi: ''
# isbn: ''
# abstract: ''
# keywords: ''

format:
  latex:
    generate: false               # genera archivos .tex

  pdf:
    generate: false               # genera PDF
    showDate: false               # muestra la fecha en la portada
    pageNumber: header-right      # posición del número de página
    coverImage: false             # genera PNG de la primera página junto al PDF
    # disabledPreambleFilters:   # preamble filters a desactivar (opcional)
    #   - 19-maketitle
    # Dublin Core por formato (sobreescribe los valores de la raíz para PDF)
    # creator: ''
    # publisher: ''
    # license: ''

  html:
    site:
      title: iteraciones             # título del sitio
      description: escribir, compartir, re-existir
      logo: ''                        # ruta al logo, relativa al proyecto
      theme: dark                   # tema: "light" o "dark"
      color: lime                  # color de acento (lime, blue, rose, etc.)
    generate: true                 # genera HTML
    # blocks: orden del masonry (ver format.html.blocks)

  epub:
    generate: false               # genera EPUB

  markdown:
    generate: false               # genera Markdown procesado

# disabledFilters:             # filters a desactivar (opcional)
#   - semantic/string/01-double-colon

bibliography: refs/mi-libro.bib  # archivo .bib (opcional; auto-descubierto si falta)
csl: styles/nature.csl           # estilo de citas CSL (opcional; APA-7 si falta)

# luaFilters:                      # filtros Lua de usuario (opcional)
#   - filters/mi-filtro.lua
```

## Campos

### `language`

**Tipo:** `string`
**Por defecto:** `'es-MX'`

Código de idioma BCP 47. Se usa como valor del atributo `lang` en el elemento `<html>`, en los metadatos de EPUB y Markdown, y en la configuración de `babel` para LaTeX (PDF).

```yaml
language: es-MX
```

El `language` del frontmatter de un documento sí sobreescribe el de la configuración en el HTML, el EPUB y el Markdown; **no** altera la configuración de `babel` del PDF, que se resuelve siempre desde el `language` de la configuración (o su valor por defecto).

> **Nota:** El campo se llama `language` tanto en la configuración como en el frontmatter. El nombre anterior `lang` ya no es válido.

### `format.latex`

**Tipo:** `object` con `generate`
**Por defecto:** `generate: false`

Genera archivos `.tex` (LaTeX) para cada documento procesado en el directorio de salida.

```yaml
format:
  latex:
    generate: true
```

### `format.pdf`

Configuración de la exportación a PDF. Se compila con `latexmk` + `pdflatex` + `biber` (para citas bibliográficas).

#### `format.pdf.generate`

**Tipo:** `boolean`
**Por defecto:** `false`

Habilita la generación de PDF.

#### `format.pdf.showDate`

**Tipo:** `boolean`
**Por defecto:** `false`

Muestra la fecha en la portada del PDF. Si es `true` y el frontmatter del documento no declara `date`, se usa la fecha de creación del archivo.

#### `format.pdf.coverImage`

**Tipo:** `boolean`
**Por defecto:** `false`

Genera, junto a cada PDF, una imagen PNG de su primera página (portada) para previsualizar, compartir o reutilizar el resultado. La extracción usa `pdftoppm` (poppler): si no está instalado, el build continúa con un aviso (la imagen es un extra, no bloquea el PDF) y `doctor` lo reporta como check opcional. La imagen se elimina al desactivar la opción o al cambiar el slug del documento.

```yaml
format:
  pdf:
    generate: true
    coverImage: true
```

### Configuración del preámbulo LaTeX

La configuración tipográfica del PDF (márgenes, fuentes, interlineado, idioma, penalizaciones, estilo de secciones, epígrafes, etc.) se gestiona mediante **preamble filters**: archivos `.tex` con contenido LaTeX puro que se insertan en el preámbulo antes de `\begin{document}`.

Los preamble filters se encuentran en `src/lib/resources/preamble/` del paquete y pueden sobrescribirse por proyecto creando archivos con el mismo nombre en `<proyecto>/preamble/`. Para desactivar uno, se usa `format.pdf.disabledPreambleFilters`.

Usa `iteraciones list-filters` para ver la lista completa con sus descripciones y estado.

### Personalizar la tipografía del PDF (override por proyecto)

Los valores tipográficos del PDF (papel, márgenes, fuente, interlineado, estilo de secciones...) viven en los archivos `.tex` de `src/lib/resources/preamble/` del paquete. Para personalizarlos, crea en tu proyecto un archivo con el **mismo nombre** en `<proyecto>/preamble/`: el tuyo reemplaza al del paquete por completo. Ejemplo — márgenes propios sobrescribiendo `04-margins.tex`:

```bash
mkdir -p preamble
cat > preamble/04-margins.tex << 'EOF'
% Márgenes propios (2cm en todos los lados)
\usepackage[margin=2cm]{geometry}
EOF
```

Consideraciones:
- El prefijo numérico del nombre (`04-`) define el orden dentro del preámbulo: úsalo igual que en el paquete.
- El override reemplaza el archivo **completo**: incluye todo lo que necesites (no hay herencia parcial).
- Algunos filters tienen dependencias entre sí (`16-toc-styling` requiere `05-language`; `99-pdfx` desactiva los enlaces por especificación PDF/X-1a). `validate` las comprueba y avisa; no las rompas sin revisarlas.
- Decisión de diseño (pre-1.0): **no** existe configuración dinámica para papel/márgenes/fuente en `iteraciones.config.yaml` — el mecanismo de override por `.tex` es la vía soportada (ver docs/architecture.md, Decisiones de diseño).

Los campos de configuración que sí son dinámicos (viajan desde `iteraciones.config.yaml`) son:

#### `format.pdf.pageNumber`

**Tipo:** `string`
**Por defecto:** `'header-right'`

Posición del número de página. Valores: `footer-left`, `footer-center`, `footer-right`, `header-left`, `header-center`, `header-right`.

### `toc`

**Tipo:** `boolean`
**Por defecto:** `false`

Genera una tabla de contenidos (TOC) en los formatos PDF, LaTeX, HTML y EPUB.

```yaml
toc: true
```

### `bibliography`

**Tipo:** `string` (ruta relativa al proyecto o absoluta)
**Por defecto:** auto-descubrimiento del primer archivo `.bib` del proyecto

Archivo de bibliografía para las citas pandoc (`[@clave]`). Sin configurar, se usa el primer `.bib` del proyecto (orden alfabético).

```yaml
bibliography: refs/mi-libro.bib
```

### `csl`

**Tipo:** `string` (ruta relativa al proyecto o absoluta)
**Por defecto:** estilo APA-7 empaquetado

Archivo de estilo de citas (CSL). Solo tiene efecto junto con `bibliography`.

```yaml
csl: styles/nature.csl
```

`validate` reporta un error si alguna de las dos rutas no existe. El mismo contrato aplica al construir: una ruta configurada inexistente es config inválida y el build falla con el mismo error (el auto-descubrimiento solo aplica cuando no se configuró nada).

### `format.html`

#### `format.html.site.title`

**Tipo:** `string`
**Por defecto:** `'iteraciones'`

Título del sitio. Se usa en el `<title>` de cada página HTML y en el encabezado.

```yaml
format:
  html:
    site:
      title: Mi sitio
```

#### `format.html.site.description`

**Tipo:** `string`
**Por defecto:** `'escribir, compartir, re-existir'`

Frase corta que acompaña al título en el encabezado HTML.

#### `format.html.site.logo`

**Tipo:** `string`
**Por defecto:** `''` (usa el logo integrado)

Ruta al archivo de logo, relativa al directorio raíz del proyecto. Si se omite o está vacío, se usa un logo SVG por defecto incluido en el paquete.

```yaml
format:
  html:
    site:
      logo: assets/mi-logo.svg
```

#### `format.html.generate`

**Tipo:** `boolean`
**Por defecto:** `true`

Habilita la generación de páginas HTML.

#### `format.html.site.theme`

**Tipo:** `'light' | 'dark'`
**Por defecto:** `'dark'`

Tema visual del HTML (atributo `data-theme` del `<html>`).

#### `format.html.site.color`

**Tipo:** `string`
**Por defecto:** `'lime'`

Color de acento del tema. Debe ser un color de la paleta Tailwind CSS v4 con escala completa (50–950). Colores válidos: `slate`, `gray`, `zinc`, `neutral`, `stone`, `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`, `taupe`, `mauve`, `mist`, `olive`.

La paleta vive en `src/lib/accent-palettes.ts` (valores oklch + reglas de opacidad por acento): para añadir un color nuevo de Tailwind basta con añadir ahí sus valores y reglas (regenerables con el pipeline de `scripts/generate-css.ts`).

#### `format.html.blocks`

**Tipo:** `string[]` (claves de bloque en orden)
**Por defecto:**

```yaml
format:
  html:
    blocks:
      - header        # tarjeta identidad inicial
      - contenido     # tarjeta de contenido
      - formatos      # tarjeta de formatos generados
      - indice        # tabla de contenidos
      - referencias   # citas bibliográficas
      - footer        # tarjeta identidad final
```

Orden de los bloques del masonry: **la posición en la lista ES el orden**. Es una lista completa: los bloques que no aparecen no se renderizan (p. ej. omitir `referencias` quita la tarjeta de citas aunque el documento las tenga). Los bloques de tarjetas ausentes por contenido (TOC sin `toc`, referencias sin citas, formatos sin formatos activos) tampoco se renderizan y no alteran el orden del resto.

### `format.epub`

#### `format.epub.generate`

**Tipo:** `boolean`
**Por defecto:** `false`

Habilita la generación de archivos EPUB.

### `format.markdown`

#### `format.markdown.generate`

**Tipo:** `boolean`
**Por defecto:** `false`

Habilita la exportación a Markdown procesado (con los filters aplicados).

### `disabledFilters`

**Tipo:** `string[]`
**Por defecto:** `undefined` (ninguno desactivado)

Lista de filters a desactivar. Cada elemento es el **nombre completo** del filter (ej: `semantic/string/01-double-colon`, `latex/02-dictum`). Usa `iteraciones list-filters` para ver la lista con sus nombres.

```yaml
disabledFilters:
  - semantic/string/01-double-colon
  - latex/02-dictum
```

### `format.pdf.disabledPreambleFilters`

**Tipo:** `string[]`
**Por defecto:** `['97-eso-pic', '98-crop', '99-pdfx']`

Lista de preamble filters a desactivar. Los defaults del paquete desactivan `97-eso-pic` (fondo de página), `98-crop` (marcas de corte) y `99-pdfx` (PDF/X-1a), la cola de imprenta — son siempre los últimos preámbulos, en ese orden; agrega nombres a la lista para desactivar más, o elimínalos para activarlos.

> **Validación PDF/X-1a.** Si activas `99-pdfx` (eliminándolo de la lista), el pipeline genera `PDF/X-1a:2001` estricto (identificación XMP `pdfxid:GTS_PDFXVersion` incluida) y el build valida en su fase final que los PDFs certifican con el binario `iteraciones-pdfcheck` (se compila con cargo si hace falta; `doctor` lo verifica como check opcional). Sin el binario, el build **no falla**: solo advierte que el PDF no se validó. Si algún PDF no certifica, el build **falla** con el detalle por PDF (archivo, código, página): el filter activo es la señal explícita de imprenta; para generar PDF sin certificación, desactiva `99-pdfx`. Ver `docs/architecture.md` → Validación PDF/X-1a del PDF generado.

```yaml
format:
  pdf:
    disabledPreambleFilters:
      - 19-maketitle
```

### `luaFilters`

**Tipo:** `string[]`
**Por defecto:** `undefined` (sin filtros de usuario)

Lista de filtros Lua de usuario. Cada elemento es una ruta relativa al proyecto (ej: `filters/nota.lua`). Los filtros corren en todas las invocaciones de pandoc (markdown → latex/html5/epub3/markdown), antes de los filters de la capa de formato y después de los filtros semánticos. La variable global `FORMAT` de pandoc permite ramificar el comportamiento por formato de salida (`latex`, `html5`, `epub3`, `markdown`). Si una ruta no existe, se muestra una advertencia y se omite.

```yaml
luaFilters:
  - filters/nota.lua
```

## Validación

El comando `iteraciones validate` verifica la sintaxis de `iteraciones.config.yaml` y el frontmatter de todos los documentos Markdown del proyecto:

```bash
iteraciones validate
```

Los errores se imprimen en `stderr`. El comando devuelve código de salida `1` si hay errores, `0` si todo es válido.

## Metadatos Dublin Core

Los metadatos Dublin Core (ISO 15836-1:2017) se pueden definir en **tres niveles** con la siguiente precedencia:

```
frontmatter > format config > root config
```

- **Root config** (`iteraciones.config.yaml`): valores por defecto para todos los documentos y formatos.
- **Format config** (`format.pdf`, etc.): sobreescribe la raíz solo para ese formato. Actualmente solo `format.pdf` acepta campos DC.
- **Frontmatter**: sobreescribe cualquier configuración para el documento individual.

### Campos disponibles

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `title` | `string` | Título del documento |
| `creator` | `string \| string[]` | Autor(es) del documento |
| `subject` | `string \| string[]` | Tema(s) del documento |
| `description` | `string` | Descripción del documento |
| `publisher` | `string \| string[]` | Editorial(es) |
| `contributor` | `string \| string[]` | Otros contribuidores |
| `date` | `string` | Fecha (ISO `YYYY-MM-DD`) |
| `identifier` | `string` | Identificador único (DOI, ISBN, URL) |
| `source` | `string` | Fuente del documento |
| `relation` | `string \| string[]` | Recursos relacionados |
| `coverage` | `string` | Cobertura espacial/temporal |
| `rights` | `string` | Información de derechos/licencia |
| `license` | `string` | URI del documento de licencia |
| `doi` | `string` | Digital Object Identifier |
| `isbn` | `string` | International Standard Book Number |
| `abstract` | `string` | Resumen del documento |
| `keywords` | `string \| string[]` | Palabras clave |

Los campos se admiten tanto en la raíz de la configuración como en `format.pdf`:

```yaml
# Raíz — valores por defecto globales
title: 'Mi Libro'
creator: 'Ana García'
publisher: 'Editorial Ejemplo'
license: 'https://creativecommons.org/licenses/by/4.0/'

format:
  pdf:
    # PDF — sobreescribe la raíz para exportación a PDF
    creator: 'Juan Pérez'
    publisher: 'Editorial PDF'
```

```markdown
---
# Frontmatter — sobreescribe cualquier configuración
title: 'Capítulo 1'
creator: 'María López'
---
```

Resultado efectivo:
- `title` → "Capítulo 1" (frontmatter)
- `creator` → "María López" (frontmatter)
- `publisher` → "Editorial PDF" (format.pdf)
- `license` → "https://creativecommons.org/licenses/by/4.0/" (raíz)

### Flujo a PDF

En la exportación a PDF, los campos DC se inyectan en el `.tex` compilado de dos formas:

1. **Archivo lateral `.xmpdata`** — para el paquete `pdfx`, que rellena los metadatos XMP del PDF (estándar ISO 19005).
2. **Bloque `\pdfinfo{}`** — el Info dict del PDF, visible en cualquier lector.

Los campos `doi` e `isbn` se emiten como valores adicionales de `dc:identifier` en el XMP (con prefijos `doi:` y `ISBN:`). El campo `abstract` no es soportado por `pdfx` y se omite del XMP.

### Nota sobre `keywords`

El campo `keywords` no es estrictamente Dublin Core, pero se comporta igual que los campos DC: se admite en frontmatter, `format.pdf` y raíz con la misma precedencia. Se emite como `pdf:Keywords` en el XMP y `/Keywords` en el Info dict.

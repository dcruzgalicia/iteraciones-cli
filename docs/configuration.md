# Configuración — `iteraciones.config.yaml`

El archivo `iteraciones.config.yaml` en la raíz del proyecto es la única fuente de configuración. Es opcional: si no existe, se usan todos los valores por defecto.

## Estructura completa

```yaml
lang: es-MX                       # código de idioma BCP 47
toc: false                        # tabla de contenidos (PDF, LaTeX, HTML, EPUB)

format:
  latex: false                     # genera archivos .tex

  pdf:
    generate: false               # genera PDF
    show-date: false               # muestra la fecha en la portada
    page-number: header-right      # posición del número de página
    disabled-preamble-filters:    # preamble filters a desactivar (opcional)
      # - 19-maketitle

  html:
    title: iteraciones             # título del sitio
    tagline: escribir, compartir, re-existir
    logo: ''                        # ruta al logo, relativa al proyecto
    theme: dark                   # tema: "light" o "dark"
    accent: lime                  # color de acento (lime, blue, rose, etc.)
    generate: true                 # genera HTML

  epub:
    generate: false               # genera EPUB

  markdown:
    generate: false               # genera Markdown procesado

disabled-filters:             # filters a desactivar (opcional)
  # - semantic/string/01-double-colon

lua-filters:                      # filtros Lua de usuario (opcional)
  # - filters/mi-filtro.lua
```

## Campos

### `lang`

**Tipo:** `string`
**Por defecto:** `'es-MX'`

Código de idioma BCP 47. Se usa como valor del atributo `lang` en el elemento `<html>` y en la configuración de `babel` para LaTeX.

```yaml
lang: es-MX
```

### `format.latex`

**Tipo:** `boolean`
**Por defecto:** `false`

Genera archivos `.tex` (LaTeX) para cada documento procesado en el directorio de salida.

### `format.pdf`

Configuración de la exportación a PDF. Se compila con `latexmk` + `pdflatex` + `biber` (para citas bibliográficas).

#### `format.pdf.generate`

**Tipo:** `boolean`
**Por defecto:** `false`

Habilita la generación de PDF.

### Configuración del preámbulo LaTeX

La configuración tipográfica del PDF (márgenes, fuentes, interlineado, idioma, penalizaciones, estilo de secciones, epígrafes, etc.) se gestiona mediante **preamble filters**: archivos `.tex` con contenido LaTeX puro que se insertan en el preámbulo antes de `\begin{document}`.

Los preamble filters se encuentran en `src/lib/resources/preamble/` del paquete y pueden sobrescribirse por proyecto creando archivos con el mismo nombre en `<proyecto>/preamble/`. Para desactivar uno, se usa `format.pdf.disabled-preamble-filters`.

Usa `iteraciones filters` para ver la lista completa con sus descripciones y estado.

Los campos de configuración que sí son dinámicos (viajan desde `iteraciones.config.yaml`) son:

#### `format.pdf.page-number`

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

#### `format.pdf.show-date`

**Tipo:** `boolean`
**Por defecto:** `false`

Muestra la fecha en la portada del PDF. Si es `true` y el frontmatter del documento no declara `date`, se usa la fecha de creación del archivo.

### `format.html`

#### `format.html.title`

**Tipo:** `string`
**Por defecto:** `'iteraciones'`

Título del sitio. Se usa en el `<title>` de cada página HTML y en el encabezado.

```yaml
format:
  html:
    title: Mi sitio
```

#### `format.html.tagline`

**Tipo:** `string`
**Por defecto:** `'escribir, compartir, re-existir'`

Frase corta que acompaña al título en el encabezado HTML.

#### `format.html.logo`

**Tipo:** `string`
**Por defecto:** `''` (usa el logo integrado)

Ruta al archivo de logo, relativa al directorio raíz del proyecto. Si se omite o está vacío, se usa un logo SVG por defecto incluido en el paquete.

```yaml
format:
  html:
    logo: assets/mi-logo.svg
```

#### `format.html.generate`

**Tipo:** `boolean`
**Por defecto:** `true`

Habilita la generación de páginas HTML.

#### `format.html.theme`

**Tipo:** `'light' | 'dark'`
**Por defecto:** `undefined` (dark)

Tema visual del HTML.

#### `format.html.accent`

**Tipo:** `string`
**Por defecto:** `'lime'`

Color de acento del tema. Debe ser un color de la paleta Tailwind CSS v4 con escala completa (50–950). Colores válidos: `slate`, `gray`, `zinc`, `neutral`, `stone`, `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`.

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

### `disabled-filters`

**Tipo:** `string[]`
**Por defecto:** `undefined` (todos activos)

Lista de filters a desactivar. Cada elemento es el **nombre completo** del filter (ej: `semantic/string/01-double-colon`, `latex/02-dictum`). Usa `iteraciones filters` para ver la lista con sus nombres.

```yaml
disabled-filters:
  - semantic/string/01-double-colon
  - latex/02-dictum
```

### `format.pdf.disabled-preamble-filters`

**Tipo:** `string[]`
**Por defecto:** `undefined` (todos activos)

Lista de preamble filters a desactivar. Los defaults del paquete `24-eso-pic`, `25-pdfx` y `26-crop` vienen desactivados por defecto.

```yaml
format:
  pdf:
    disabled-preamble-filters:
      - 19-maketitle
```

### `lua-filters`

**Tipo:** `string[]`
**Por defecto:** `undefined` (sin filtros de usuario)

Lista de filtros Lua de usuario. Cada elemento es una ruta relativa al proyecto (ej: `filters/nota.lua`). Los filtros corren en todas las invocaciones de pandoc: en las exportaciones (latex, html) antes de los filters del paquete; en la conversión markdown → AST, después de los filtros semánticos. La variable global `FORMAT` de pandoc permite ramificar el comportamiento por formato de salida (`latex`, `html5`, `epub3`, `markdown`, `json`). Si una ruta no existe, se muestra una advertencia y se omite.

```yaml
lua-filters:
  - filters/nota.lua
```

## Validación

El comando `iteraciones validate` verifica la sintaxis de `iteraciones.config.yaml` y el frontmatter de todos los documentos Markdown del proyecto:

```bash
iteraciones validate
```

Los errores se imprimen en `stderr`. El comando devuelve código de salida `1` si hay errores, `0` si todo es válido.

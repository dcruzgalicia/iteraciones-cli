# Configuración — `iteraciones.config.yaml`

El archivo `iteraciones.config.yaml` en la raíz del proyecto es la única fuente de configuración. Es opcional: si no existe, se usan todos los valores por defecto.

## Estructura completa

```yaml
site:
  title: iteraciones             # título del sitio
  tagline: escribir, compartir, re-existir
  lang: es-MX                     # código de idioma BCP 47
  logo: ''                        # ruta al logo, relativa al proyecto
  base-url: ''                    # URL base del sitio

format:
  latex: true                     # genera archivos .tex

  pdf:
    generate: false               # genera PDF
    documentclass:
      class: scrbook              # scrartcl | scrbook
      options:
        - 12pt
        - sfdefaults=false
        - paper=letter
        - twoside
    geometry:
      options:
        - top=2.54cm
        - bottom=2.54cm
        - left=2.54cm
        - right=2.54cm
    babel:
      options:
        - spanish
        - mexico
    hyperref:
      options:
        - hidelinks
    microtype:
      options:
        - activate={true,nocompatibility}
        - final
        - tracking=true
        - kerning=true
        - spacing=true
    enumitem: true
    font-family:
      - name: mathptmx
    setspace: true
    setstretch: 1.5
    raggedbottom: true
    pretolerance: 200
    tolerance: 400
    brokenpenalty: 1000000
    hyphenpenalty: 100
    finalhyphendemerits: 1000000
    doublehyphendemerits: 1000000
    widowpenalty: 1000000
    clubpenalty: 1000000
    setlist:
      - command: description
        options:
          - noitemsep
          - nosep
          - topsep=\baselineskip
    setcounter:
      secnumdepth: 1
      tocdepth: 1
    page-number: header-right
    toc: false
    show-date: false
    sectioning:
      part:
        beforeskip: 11\baselineskip
        afterskip: \baselineskip
        font: \normalsize\bfseries\MakeUppercase
        pagestyle: empty
      chapter:
        style: chapter
        beforeskip: 2\baselineskip
        afterskip: \baselineskip
        font: \normalsize\normalfont\scshape
        align: center
        pagestyle: plain
      section:
        style: section
        beforeskip: 2\baselineskip
        afterskip: 2\baselineskip
        font: \normalsize\bfseries\MakeUppercase
        align: center
        pagestyle: plain
      subsection:
        beforeskip: 2\baselineskip
        afterskip: 2\baselineskip
        font: \normalsize\normalfont\textit
        pagestyle: plain
    setkomafont:
      title: \normalsize\bfseries
      subtitle: \normalsize\normalfont\itshape
      author: \normalsize\normalfont
      date: \normalsize\normalfont
      publishers: \normalsize\normalfont
    dictum:
      width: 0.5\textwidth
      font: \normalsize\normalfont\itshape
    eso-pic: false
    pdfx: false
    crop: false

  html:
    theme: dark                   # tema: "light" o "dark"
    accent: lime                  # color de acento (lime, blue, rose, etc.)
    generate: false               # genera HTML

  epub:
    generate: false               # genera EPUB

  markdown:
    generate: false               # genera Markdown procesado

disabled-transpilers:             # transpilers a desactivar (opcional)
  # - semantic/string/01-double-colon

disabled-preamble-transpilers:    # preamble transpilers a desactivar (opcional)
  # - 01-maketitle-patches

lua-filters:                      # filtros Lua de usuario (opcional)
  # - filters/mi-filtro.lua
```

## Campos

### `site.title`

**Tipo:** `string`
**Por defecto:** `'iteraciones'`

Título del sitio. Se usa en el `<title>` de cada página HTML y en el encabezado.

```yaml
site:
  title: Mi sitio
```

### `site.tagline`

**Tipo:** `string`
**Por defecto:** `'escribir, compartir, re-existir'`

Frase corta que acompaña al título en el encabezado HTML.

### `site.lang`

**Tipo:** `string`
**Por defecto:** `'es-MX'`

Código de idioma BCP 47. Se usa como valor del atributo `lang` en el elemento `<html>`.

### `site.logo`

**Tipo:** `string`
**Por defecto:** `''` (usa el logo integrado)

Ruta al archivo de logo, relativa al directorio raíz del proyecto. Si se omite o está vacío, se usa un logo SVG por defecto incluido en el paquete.

```yaml
site:
  logo: assets/mi-logo.svg
```

### `site.base-url`

**Tipo:** `string`
**Por defecto:** `undefined` (sin prefijo)

URL base del sitio. Debe incluir el protocolo y no terminar en `/`.

```yaml
site:
  base-url: https://ejemplo.com
```

### `format.latex`

**Tipo:** `boolean`
**Por defecto:** `true`

Genera archivos `.tex` (LaTeX) para cada documento procesado en el directorio de salida.

### `format.pdf`

Configuración de la exportación a PDF. Se compila con `latexmk` + `pdflatex` + `biber` (para citas bibliográficas).

#### `format.pdf.generate`

**Tipo:** `boolean`
**Por defecto:** `false`

Habilita la generación de PDF.

#### `format.pdf.documentclass.class`

**Tipo:** `'scrartcl' | 'scrbook'`
**Por defecto:** `'scrbook'`

Clase KOMA-Script del documento LaTeX.

#### `format.pdf.documentclass.options`

**Tipo:** `string[]`
**Por defecto:** `['12pt', 'sfdefaults=false', 'paper=letter', 'twoside']`

Opciones de la clase del documento. Cada elemento es una opción que se pasa separada por coma a `\documentclass[]{}`.

#### `format.pdf.geometry.options`

**Tipo:** `string[]`
**Por defecto:** `['top=2.54cm', 'bottom=2.54cm', 'left=2.54cm', 'right=2.54cm', 'headheight=\\baselineskip', 'headsep=6pt', 'footskip=22pt']`

Opciones del paquete `geometry` para márgenes.

#### `format.pdf.babel.options`

**Tipo:** `string[]`
**Por defecto:** `['spanish', 'mexico', 'es-noshorthands', 'es-noindentfirst']`

Opciones del paquete `babel` para idioma.

#### `format.pdf.hyperref.options`

**Tipo:** `string[]`
**Por defecto:** `['hidelinks']`

Opciones del paquete `hyperref` para enlaces.

#### `format.pdf.microtype.options`

**Tipo:** `string[]`
**Por defecto:** `['activate={true,nocompatibility}', 'final', 'tracking=true', 'kerning=true', 'spacing=true', 'factor=1100', 'stretch=10', 'shrink=10']`

Opciones del paquete `microtype` para ajuste tipográfico.

#### `format.pdf.enumitem`

**Tipo:** `boolean`
**Por defecto:** `true`

Habilita el paquete `enumitem` para listas personalizadas.

#### `format.pdf.setlist`

**Tipo:** `Array<{ command: string; options: string[] }>`
**Por defecto:** `[{ command: 'description', options: ['noitemsep', 'nosep', 'topsep=\\baselineskip'] }]`

Configuración de listas vía `\setlist[]{...}`.

#### `format.pdf.setcounter`

**Tipo:** `Record<string, number>`
**Por defecto:** `{ secnumdepth: 1, tocdepth: 1 }`

Valores de contadores LaTeX vía `\setcounter{...}{...}`. `secnumdepth` controla hasta qué nivel se numeran las secciones; `tocdepth` hasta qué nivel aparece en el índice.

#### `format.pdf.font-family`

**Tipo:** `Array<{ name: string; options?: string[] }>`
**Por defecto:** sin fuente adicional

Lista de paquetes de fuente a cargar con `\usepackage[options]{name}`. El ejemplo clásico es `mathptmx` (Times New Roman):

```yaml
format:
  pdf:
    font-family:
      - name: mathptmx
```

#### `format.pdf.setspace`

**Tipo:** `boolean`
**Por defecto:** `true`

Habilita el paquete `setspace` para control de interlineado.

#### `format.pdf.setstretch`

**Tipo:** `number`
**Por defecto:** `1.5`

Factor de interlineado. Requiere `setspace: true`.

#### `format.pdf.raggedbottom`

**Tipo:** `boolean`
**Por defecto:** `true`

Evita que LaTeX estire el contenido verticalmente para llenar la página.

#### `format.pdf.pretolerance`

**Tipo:** `number`
**Por defecto:** `200`

Controla la tolerancia de partición de palabras en el primer pase de LaTeX.

#### `format.pdf.tolerance`

**Tipo:** `number`
**Por defecto:** `400`

Controla la tolerancia de partición de palabras en el segundo pase.

#### `format.pdf.brokenpenalty`

**Tipo:** `number`
**Por defecto:** `1000000`

Penalización por líneas huérfanas al final de página.

#### `format.pdf.hyphenpenalty`

**Tipo:** `number`
**Por defecto:** `100`

Penalización por partición de palabras. Valores altos reducen la partición.

#### `format.pdf.finalhyphendemerits`

**Tipo:** `number`
**Por defecto:** `1000000`

Penalización adicional por guión final en la última línea de un párrafo.

#### `format.pdf.doublehyphendemerits`

**Tipo:** `number`
**Por defecto:** `1000000`

Penalización adicional por guiones consecutivos en líneas adyacentes.

#### `format.pdf.widowpenalty`

**Tipo:** `number`
**Por defecto:** `1000000`

Penalización por líneas viudas (línea sola al inicio de página).

#### `format.pdf.clubpenalty`

**Tipo:** `number`
**Por defecto:** `1000000`

Penalización por líneas huérfanas (línea sola al final de página).

#### `format.pdf.page-number`

**Tipo:** `string`
**Por defecto:** `'header-right'`

Posición del número de página. Valores: `footer-left`, `footer-center`, `footer-right`, `header-left`, `header-center`, `header-right`.

#### `format.pdf.toc`

**Tipo:** `boolean`
**Por defecto:** `false`

Incluye una tabla de contenidos en el PDF.

#### `format.pdf.show-date`

**Tipo:** `boolean`
**Por defecto:** `false`

Muestra la fecha en la portada del PDF. Si es `true` y el frontmatter del documento no declara `date`, se usa la fecha de creación del archivo.

#### `format.pdf.sectioning`

Configuración de secciones LaTeX: `part`, `chapter`, `section`, `subsection`, `subsubsection`, `paragraph`, `subparagraph`. Cada nivel acepta los siguientes campos (según el nivel):

| Campo | Aplica a | Descripción |
|-------|----------|-------------|
| `style` | chapter, section | Estilo de la sección (`chapter`, `section`, etc.) |
| `beforeskip` | todos | Espacio vertical antes del título |
| `afterskip` | todos | Espacio vertical después del título |
| `font` | todos | Fuente del título |
| `align` | chapter, section | Alineación: `center` |
| `pagestyle` | todos | Estilo de página del nivel (`empty`, `plain`, `headings`) |

#### `format.pdf.setkomafont`

Configuración de fuentes KOMA-Script para elementos de la portada. Campos: `title`, `subtitle`, `author`, `date`, `publishers`.

#### `format.pdf.dictum`

Configuración de epígrafes. Campos: `width`, `font`, `rule`, `authorfont`, `authorformat`.

#### `format.pdf.eso-pic`

**Tipo:** `boolean | { options: string[] }`
**Por defecto:** `false`

Habilita el paquete `eso-pic` para añadir contenido gráfico al fondo de cada página.

#### `format.pdf.pdfx`

**Tipo:** `boolean`
**Por defecto:** `false`

Habilita la creación de PDF/X-1a para impresión profesional.

#### `format.pdf.crop`

**Tipo:** `boolean`
**Por defecto:** `false`

Añade marcas de corte al PDF. Las dimensiones se calculan automáticamente desde el tamaño de página + 15 mm.

### `format.html`

#### `format.html.generate`

**Tipo:** `boolean`
**Por defecto:** `false`

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

Habilita la exportación a Markdown procesado (con los transpilers aplicados).

### `disabled-transpilers`

**Tipo:** `string[]`
**Por defecto:** `undefined` (todos activos)

Lista de transpilers a desactivar. Cada elemento es el **nombre completo** del transpiler (ej: `semantic/string/01-double-colon`, `latex/02-dictum`). Usa `iteraciones filters` para ver la lista con sus nombres.

```yaml
disabled-transpilers:
  - semantic/string/01-double-colon
  - latex/02-dictum
```

### `disabled-preamble-transpilers`

**Tipo:** `string[]`
**Por defecto:** `undefined` (todos activos)

Lista de preamble transpilers a desactivar.

```yaml
disabled-preamble-transpilers:
  - 01-maketitle-patches
```

### `lua-filters`

**Tipo:** `string[]`
**Por defecto:** `undefined` (sin filtros de usuario)

Lista de filtros Lua de usuario. Cada elemento es una ruta relativa al proyecto (ej: `filters/nota.lua`). Los filtros corren en todas las invocaciones de pandoc: en las exportaciones (latex, html) antes de los transpilers del paquete; en la conversión markdown → AST, después de los filtros semánticos. La variable global `FORMAT` de pandoc permite ramificar el comportamiento por formato de salida (`latex`, `html5`, `epub3`, `markdown`, `json`). Si una ruta no existe, se muestra una advertencia y se omite.

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

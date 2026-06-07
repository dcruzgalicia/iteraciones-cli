# Configuración — `_iteraciones.yaml`

El archivo `_iteraciones.yaml` en la raíz del proyecto es la única fuente de configuración del sitio. Es opcional: si no existe, se usan todos los valores por defecto.

## Estructura completa

```yaml
site:
  title: Iteraciones
  tagline: escribir, compartir, re-existir
  lang: es
  logo: ''
  base-url: ''
  pagination:
    limit: 10

plugins: []

format:
  html:
    theme: light
    accent: lime
    math: ''
    toc: false
    toc-depth: 6
    hyphenation: false

  pdf:
    engine: xelatex
    concurrency: 2
    toc: true
    toc-depth: 3
    numbering: true
    hyphenation: true
    bibliography: ''
    csl: ''
    page-size: letter
    font-size: 10pt
    font-family: ''
    margins:
      - 2.5cm
      - 2.5cm
      - 2.5cm
      - 2.5cm
    line-spacing: 1.0
    page-number: footer-center
    sides: oneside

  epub:
    toc: true
    toc-depth: 3
    bibliography: ''
    csl: ''
```

## Campos

### `site.title`

**Tipo:** `string`
**Por defecto:** `'Iteraciones'`

Título del sitio. Aparece en el `<title>` de cada página HTML y en el encabezado del layout.

### `site.tagline`

**Tipo:** `string`
**Por defecto:** `'escribir, compartir, re-existir'`

Frase corta que acompaña al título en el encabezado.

### `site.lang`

**Tipo:** `string`
**Por defecto:** `'es'`

Código de idioma BCP 47. Se usa como valor del atributo `lang` en el elemento `<html>`.

### `site.logo`

**Tipo:** `string`
**Por defecto:** `''` (sin logo)

Ruta al archivo de logo relativa al directorio raíz del proyecto. Acepta SVG, PNG o cualquier formato de imagen que el navegador soporte.

```yaml
site:
  logo: 'assets/logo.svg'
```

### `site.base-url`

**Tipo:** `string`
**Por defecto:** `''` (sin prefijo)

URL base del sitio, usada para construir enlaces absolutos (sitemap, feeds). Debe incluir el protocolo y no terminar en `/`.

```yaml
site:
  base-url: 'https://ejemplo.com'
```

### `site.pagination.limit`

**Tipo:** `number` (entero positivo)
**Por defecto:** `10`

Número máximo de elementos por página en las listas paginadas (tipos `list`, `events`, `authors`, `collection`).

```yaml
site:
  pagination:
    limit: 5
```

### `plugins`

**Tipo:** `string[]`
**Por defecto:** `[]`

Lista de rutas relativas a módulos ESM que implementan la interfaz de plugin. Ver [docs/plugins.md](plugins.md).

```yaml
plugins:
  - plugins/mi-plugin.js
  - plugins/otro-plugin.js
```

### `format`

Configuración de los formatos de salida. La presencia de una sección habilita ese formato:

- HTML **siempre** se genera (con defaults si no se especifica `format.html`)
- `format.pdf` habilita la exportación a PDF
- `format.epub` habilita la exportación a EPUB

#### `format.html`

##### `format.html.theme`

**Tipo:** `string | undefined`
**Por defecto:** `undefined` (tema claro)

Tema visual del sitio. Valores disponibles: `light`, `dark`. Ver [docs/themes.md](themes.md).

```yaml
format:
  html:
    theme: dark
```

##### `format.html.accent`

**Tipo:** `string`
**Por defecto:** `'lime'`

Color de acento del tema. Debe ser un color de la paleta de Tailwind CSS v4 con escala completa (50–950). Colores válidos: `slate`, `gray`, `zinc`, `neutral`, `stone`, `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`.

Si se declara un color no reconocido, se usa `'lime'` con un aviso en `stderr`.

##### `format.html.math`

**Tipo:** `'katex' | 'mathjax' | undefined`
**Por defecto:** sin renderizado matemático

Motor de renderizado de fórmulas matemáticas. `katex` es más rápido y se carga desde CDN en el cliente; `mathjax` ofrece mayor cobertura de LaTeX pero es más pesado. Si se omite, no se inyecta ningún motor.

```yaml
format:
  html:
    math: katex
```

##### `format.html.toc`

**Tipo:** `boolean`
**Por defecto:** `false`

Genera una tabla de contenidos al inicio del `<body>` de cada página HTML cuando es `true`.

##### `format.html.toc-depth`

**Tipo:** `number` (entero, 1–6)
**Por defecto:** `6`

Profundidad máxima de encabezados en la tabla de contenidos HTML.

##### `format.html.hyphenation`

**Tipo:** `boolean`
**Por defecto:** `false`

Cuando es `true`, añade la clase CSS `hyphens-auto` al `<body>` para activar separación silábica automática en navegadores.

#### `format.pdf`

##### `format.pdf.engine`

**Tipo:** `'xelatex' | 'lualatex'`
**Por defecto:** `'xelatex'`

Motor LaTeX utilizado para generar PDF. `xelatex` tiene mayor compatibilidad con fuentes OpenType; `lualatex` ofrece soporte más completo de Unicode.

##### `format.pdf.concurrency`

**Tipo:** `integer >= 1`
**Por defecto:** `2`

Número máximo de documentos que se exportan a PDF en paralelo. xelatex no es multi-thread y consume memoria significativa (~300–600 MB por instancia).

Ajustar según la RAM disponible:

| RAM disponible | Valor recomendado |
|---------------|-------------------|
| 4 GB           | 1                 |
| 8 GB           | 2 (por defecto)   |
| 16 GB+         | 3–4               |

```yaml
format:
  pdf:
    engine: xelatex
    concurrency: 3
```

##### `format.pdf.toc`

**Tipo:** `boolean | undefined`
**Por defecto:** `undefined` (se deriva de `toc-depth` o de la clase LaTeX)

Incluye una tabla de contenidos en el PDF cuando es `true`. Si no se especifica, se habilita automáticamente cuando `toc-depth > 0` o cuando la clase del documento es `scrbook`.

##### `format.pdf.toc-depth`

**Tipo:** `number` (entero, 0–5)
**Por defecto:** `undefined` (usa el de la clase LaTeX)

Profundidad máxima de encabezados en la tabla de contenidos del PDF.

##### `format.pdf.numbering`

**Tipo:** `boolean | undefined`
**Por defecto:** `undefined` (LaTeX default: numeración visible)

Muestra u oculta la numeración de capítulos y secciones en el PDF.

##### `format.pdf.hyphenation`

**Tipo:** `boolean`
**Por defecto:** `true`

Controla la separación silábica en el PDF generado por LaTeX.

##### `format.pdf.bibliography`

**Tipo:** `string | undefined`
**Por defecto:** sin bibliografía global

Ruta relativa al proyecto a un archivo `.bib` de bibliografía BibTeX. Se aplica a todos los documentos exportados, salvo que el frontmatter del documento especifique la suya propia.

##### `format.pdf.csl`

**Tipo:** `string | undefined`
**Por defecto:** estilo por defecto de pandoc

Ruta relativa al proyecto a un archivo `.csl` de estilo de citas. Requiere que `bibliography` esté configurado.

##### `format.pdf.page-size`

**Tipo:** `string | undefined`
**Por defecto:** `undefined` (usa el de la clase LaTeX)

Tamaño de página del PDF. Valores estándar: `half-letter`, `letter`, `legal`, `executive`, `a3`, `a4`, `a5`, `b4`, `b5`, `tabloid`, `pocket`. También acepta tamaños personalizados en formato `"ancho,alto"` con unidades (`cm`, `mm`, `in`, `pt`), por ejemplo: `"15cm,23cm"`.

##### `format.pdf.font-size`

**Tipo:** `string | undefined`
**Por defecto:** `undefined` (usa el de la clase LaTeX)

Tamaño de fuente base del PDF. Debe incluir la unidad `pt`: `"10pt"`, `"11pt"`, `"12pt"`.

##### `format.pdf.font-family`

**Tipo:** `string | undefined`
**Por defecto:** `undefined` (usa la fuente por defecto de LaTeX)

Familia tipográfica principal del PDF. Se pasa a LaTeX como `mainfont` vía `fontspec`.

```yaml
format:
  pdf:
    font-family: "Libertinus Serif"
```

##### `format.pdf.margins`

**Tipo:** `[string, string, string, string] | undefined`
**Por defecto:** `undefined` (usa los márgenes por defecto de LaTeX)

Márgenes del PDF en orden `[superior, derecho, inferior, izquierdo]`. Cada valor debe incluir unidad (`cm`, `mm`, `in`, `pt`).

```yaml
format:
  pdf:
    margins:
      - 2.5cm
      - 2.5cm
      - 3cm
      - 3cm
```

##### `format.pdf.line-spacing`

**Tipo:** `number (positivo) | undefined`
**Por defecto:** `undefined` (interlineado simple de LaTeX)

Factor de interlineado. Se pasa a LaTeX como `setstretch`. `1.5` produce espacio y medio.

##### `format.pdf.page-number`

**Tipo:** `string | undefined`
**Por defecto:** `undefined`

Posición del número de página en el PDF. Valores válidos: `footer-left`, `footer-center`, `footer-right`, `header-left`, `header-center`, `header-right`.

##### `format.pdf.sides`

**Tipo:** `'oneside' | 'twoside' | undefined`
**Por defecto:** `undefined` (depende de la clase LaTeX)

Define si el PDF es a una cara (`oneside`) o a doble cara (`twoside`). Afecta márgenes alternos y posición de números de página.

#### `format.epub`

##### `format.epub.toc`

**Tipo:** `boolean | undefined`
**Por defecto:** `undefined`

Incluye una tabla de contenidos en el EPUB.

##### `format.epub.toc-depth`

**Tipo:** `number` (entero, 0–5) | `undefined`
**Por defecto:** `undefined`

Profundidad máxima de la tabla de contenidos del EPUB.

##### `format.epub.bibliography`

**Tipo:** `string | undefined`
**Por defecto:** sin bibliografía

Ruta relativa a un archivo `.bib` para el EPUB.

##### `format.epub.csl`

**Tipo:** `string | undefined`
**Por defecto:** estilo por defecto

Ruta relativa a un archivo `.csl` para el EPUB.

## Ejemplo mínimo

```yaml
site:
  title: 'Notas de campo'
  tagline: 'apuntes desde el margen'
  lang: 'es'
```

## Ejemplo con PDF

```yaml
site:
  title: 'Tesis doctoral'
  lang: 'es-MX'
  pagination:
    limit: 15

format:
  html:
    theme: dark
    toc: true
    toc-depth: 4
  pdf:
    engine: xelatex
    toc: true
    toc-depth: 5
    numbering: false
    hyphenation: false
    bibliography: ./referencias.bib
    page-size: letter
    font-size: 12pt
    font-family: "Times New Roman"
    margins:
      - 2.54cm
      - 2.54cm
      - 2.54cm
      - 2.54cm
    line-spacing: 1.5
    page-number: header-right
    sides: twoside
```

## Validación

El comando `iteraciones validate` verifica la sintaxis de `_iteraciones.yaml` y el frontmatter de todos los documentos Markdown del proyecto:

```bash
iteraciones validate
```

Los errores se imprimen en `stderr`. El comando devuelve código de salida `1` si hay errores, `0` si todo es válido.

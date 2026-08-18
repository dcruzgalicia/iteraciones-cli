# Configuración — `iteraciones.config.yaml`

El archivo `iteraciones.config.yaml` en la raíz del proyecto es la única fuente de configuración. Es opcional: si no existe, se usan todos los valores por defecto.

## Estructura completa

```yaml
lang: es-MX                       # código de idioma BCP 47
toc: false                        # tabla de contenidos (PDF, LaTeX, HTML, EPUB)

format:
  latex:
    generate: false               # genera archivos .tex

  pdf:
    generate: false               # genera PDF
    show-date: false               # muestra la fecha en la portada
    page-number: header-right      # posición del número de página
    cover-image: false             # genera PNG de la primera página junto al PDF
    # disabled-preamble-filters:   # preamble filters a desactivar (opcional)
    #   - 19-maketitle

  html:
    title: iteraciones             # título del sitio
    tagline: escribir, compartir, re-existir
    logo: ''                        # ruta al logo, relativa al proyecto
    theme: dark                   # tema: "light" o "dark"
    accent: lime                  # color de acento (lime, blue, rose, etc.)
    generate: true                 # genera HTML
    # blocks: orden del masonry (ver format.html.blocks)

  epub:
    generate: false               # genera EPUB

  markdown:
    generate: false               # genera Markdown procesado

# disabled-filters:             # filters a desactivar (opcional)
#   - semantic/string/01-double-colon

bibliography: refs/mi-libro.bib  # archivo .bib (opcional; auto-descubierto si falta)
csl: styles/nature.csl           # estilo de citas CSL (opcional; APA-7 si falta)

# lua-filters:                      # filtros Lua de usuario (opcional)
#   - filters/mi-filtro.lua
```

## Campos

### `lang`

**Tipo:** `string`
**Por defecto:** `'es-MX'`

Código de idioma BCP 47. Se usa como valor del atributo `lang` en el elemento `<html>`, en los metadatos de EPUB y Markdown, y en la configuración de `babel` para LaTeX (PDF).

```yaml
lang: es-MX
```

El `lang` del frontmatter de un documento sí sobreescribe el de la configuración en el HTML, el EPUB y el Markdown; **no** altera la configuración de `babel` del PDF, que se resuelve siempre desde el `lang` de la configuración (o su valor por defecto).

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

#### `format.pdf.show-date`

**Tipo:** `boolean`
**Por defecto:** `false`

Muestra la fecha en la portada del PDF. Si es `true` y el frontmatter del documento no declara `date`, se usa la fecha de creación del archivo.

#### `format.pdf.cover-image`

**Tipo:** `boolean`
**Por defecto:** `false`

Genera, junto a cada PDF, una imagen PNG de su primera página (portada) para previsualizar, compartir o reutilizar el resultado. La extracción usa `pdftoppm` (poppler): si no está instalado, el build continúa con un aviso (la imagen es un extra, no bloquea el PDF) y `doctor` lo reporta como check opcional. La imagen se elimina al desactivar la opción o al cambiar el slug del documento.

```yaml
format:
  pdf:
    generate: true
    cover-image: true
```

### Configuración del preámbulo LaTeX

La configuración tipográfica del PDF (márgenes, fuentes, interlineado, idioma, penalizaciones, estilo de secciones, epígrafes, etc.) se gestiona mediante **preamble filters**: archivos `.tex` con contenido LaTeX puro que se insertan en el preámbulo antes de `\begin{document}`.

Los preamble filters se encuentran en `src/lib/resources/preamble/` del paquete y pueden sobrescribirse por proyecto creando archivos con el mismo nombre en `<proyecto>/preamble/`. Para desactivar uno, se usa `format.pdf.disabled-preamble-filters`.

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
- Algunos filters tienen dependencias entre sí (`16-toc-styling` requiere `05-language`; `25-pdfx` desactiva los enlaces por especificación PDF/X-1a). `validate` las comprueba y avisa; no las rompas sin revisarlas.
- Decisión de diseño (pre-1.0): **no** existe configuración dinámica para papel/márgenes/fuente en `iteraciones.config.yaml` — el mecanismo de override por `.tex` es la vía soportada (ver docs/architecture.md, Decisiones de diseño).

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

`validate` reporta un error si alguna de las dos rutas no existe. Si una ruta configurada no existe al construir, se advierte y se vuelve al auto-descubrimiento (mismo comportamiento que `lua-filters`).

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
**Por defecto:** `'dark'`

Tema visual del HTML (atributo `data-theme` del `<html>`).

#### `format.html.accent`

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

### `disabled-filters`

**Tipo:** `string[]`
**Por defecto:** `undefined` (ninguno desactivado)

Lista de filters a desactivar. Cada elemento es el **nombre completo** del filter (ej: `semantic/string/01-double-colon`, `latex/02-dictum`). Usa `iteraciones list-filters` para ver la lista con sus nombres.

```yaml
disabled-filters:
  - semantic/string/01-double-colon
  - latex/02-dictum
```

### `format.pdf.disabled-preamble-filters`

**Tipo:** `string[]`
**Por defecto:** `['24-eso-pic', '25-pdfx', '26-crop']`

Lista de preamble filters a desactivar. Los defaults del paquete desactivan `24-eso-pic` (fondo de página), `25-pdfx` (PDF/X-1a) y `26-crop` (marcas de corte), pensados para impresión profesional; agrega nombres a la lista para desactivar más, o elimínalos para activarlos.

```yaml
format:
  pdf:
    disabled-preamble-filters:
      - 19-maketitle
```

### `lua-filters`

**Tipo:** `string[]`
**Por defecto:** `undefined` (sin filtros de usuario)

Lista de filtros Lua de usuario. Cada elemento es una ruta relativa al proyecto (ej: `filters/nota.lua`). Los filtros corren en todas las invocaciones de pandoc (markdown → latex/html5/epub3/markdown), antes de los filters de la capa de formato y después de los filtros semánticos. La variable global `FORMAT` de pandoc permite ramificar el comportamiento por formato de salida (`latex`, `html5`, `epub3`, `markdown`). Si una ruta no existe, se muestra una advertencia y se omite.

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

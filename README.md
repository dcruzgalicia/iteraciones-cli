# iteraciones-cli

> escribir, compartir, re-existir

CLI para construir documentos HTML, PDF, EPUB, LaTeX y Markdown a partir de archivos Markdown usando pandoc y Tailwind CSS.

## Requisitos

| Para generar | Necesitas |
|--------------|-----------|
| HTML (siempre) | [bun](https://bun.sh) ≥ 1.0 · [pandoc](https://pandoc.org/installing.html) en `PATH` |
| PDF | TeX Live o **MacTeX full** (latexmk + KOMA-Script) · [ImageMagick](https://imagemagick.org) (`magick`) para preprocesar imágenes a CMYK 300 dpi |
| PDF/X-1a (imprenta) | Todo lo anterior + [Rust](https://rustup.rs): el primer build compila el validador `iteraciones-pdfcheck` automáticamente |

Notas:

- Sin ImageMagick, los PDF se generan igual; solo se omite el preproceso de imágenes (con advertencia).
- `iteraciones-pdfcheck` es opcional: sin él se salta la certificación PDF/X-1a (con advertencia). Compilación manual si prefieres no instalar Rust ahora:

  ```bash
  cd tools/pdfx-validator
  cargo build --release
  cp target/release/iteraciones-pdfcheck /usr/local/bin/   # o cualquier directorio en PATH
  ```

`iteraciones doctor` comprueba solo lo que tu proyecto activa y te dice cómo instalar lo que falte.

## Instalación

```bash
git clone git@github.com:dcruzgalicia/iteraciones-cli.git
cd iteraciones-cli
bun install
bun link
```

Luego, en el directorio del proyecto donde quieras usar el CLI:

```bash
bun link iteraciones-cli
```

Verifica que el comando esté disponible:

```bash
iteraciones --version
```

## Estructura mínima del proyecto

```
mi-proyecto/
  iteraciones.config.yaml   # configuración del sitio
  README.md           # o cualquier archivo .md
```

Puedes generar esta estructura automáticamente con:

```bash
cd mi-proyecto
iteraciones init
```

Esto también crea un archivo `bibliography.bib` de ejemplo.

## Configuración (`iteraciones.config.yaml`)

```yaml
language: "es-MX"                     # idioma del sitio (por defecto: "es-MX")

toc: false                         # índice en cada documento (por defecto: false)

format:
  latex:
    generate: false                # genera archivos .tex (por defecto: false)

  pdf:
    generate: false                # genera PDF (por defecto: false)
    # disabled-preamble-filters:    # preamble filters a desactivar (opcional)
    #   - 24-eso-pic

  html:
    site:
      title: "Mi sitio"              # título del sitio (por defecto: "iteraciones")
      description: "mi tagline"          # frase corta (por defecto: "escribir, compartir, re-existir")
      logo: ""                       # ruta al logo (por defecto: sin logo)
      theme: dark                    # tema: "light" o "dark"
      color: lime                   # color de acento (lime, blue, rose, etc.)
    generate: true                 # genera HTML (por defecto: true)

  epub:
    generate: false                # genera EPUB (por defecto: false)

  markdown:
    generate: false                # genera Markdown procesado (por defecto: false)

# disabled-filters:                # filters a desactivar por nombre completo (opcional)
#   - latex/02-dictum

bibliography: refs/mi-libro.bib   # archivo .bib (opcional; auto-descubierto si falta)
csl: styles/nature.csl            # estilo de citas CSL (opcional; APA-7 si falta)

# lua-filters:                     # filtros Lua de usuario (opcional)
#   - filters/mi-filtro.lua
```

Todas las opciones y sus valores por defecto están en [docs/configuration.md](docs/configuration.md).

## Documentación

- [docs/configuration.md](docs/configuration.md) — todas las opciones de `iteraciones.config.yaml`, valores por defecto y contratos de formato.
- [docs/ejemplos.md](docs/ejemplos.md) — elementos del lenguaje Markdown soportados (incluye la tabla de mapeo de encabezados a PDF y HTML).
- [docs/frontmatter-reference.md](docs/frontmatter-reference.md) — campos del frontmatter y páginas de título.
- [docs/public-surface.md](docs/public-surface.md) — superficie pública congelada pre-1.0 (inventario).
- [docs/architecture.md](docs/architecture.md) — arquitectura del pipeline, decisiones y contratos.
- [docs/quickstart.md](docs/quickstart.md) — primeros pasos.

## Comandos

### Opción global `--project-root`

Todos los comandos aceptan `--project-root <path>` para indicar el directorio raíz del proyecto. Sin ella, se usa el directorio actual. Puede colocarse antes o después del subcomando:

```bash
iteraciones build --project-root /ruta/al/proyecto
iteraciones --project-root /ruta/al/proyecto validate
```

### `iteraciones build`

Construye los documentos a partir de los archivos Markdown.

La salida vive en `dist/files/`: ahí se escriben todos los formatos (`index.html`, `libro.pdf`, …) junto a CSS, fuentes, logo y —con LaTeX activo— el bundle portable `.tex` + imágenes (véase [docs/quickstart.md](docs/quickstart.md)). `iteraciones clean` elimina `dist/` completo; la caché de invalidación vive aparte en `.iteraciones/`.

```
iteraciones build [opciones]
```

| Opción | Descripción | Por defecto |
|--------|-------------|-------------|
| `--full` | Build completo desde cero: elimina la salida anterior (`dist/`) y la caché | — |
| `--output <path>` | Directorio de salida, relativo a la raíz del proyecto (o absoluta) | `dist/files` |
| `--verbose` | Muestra información adicional de progreso | — |
| `--json` | Imprime el resultado como JSON en stdout (consumo programático) | — |

### `iteraciones init`

Crea `iteraciones.config.yaml`, `index.md`, `bibliography.bib` y un `.gitignore` sugerido (con `dist/` y `.iteraciones/`) en el directorio actual. Si alguno de los archivos ya existe, lo omite sin sobreescribirlo. `index.md` es el documento de inicio: el primer build genera `index.html`, la página que enlazan las tarjetas de identidad del resto de documentos.

```
iteraciones init
```

### `iteraciones new <path>`

Crea un archivo Markdown con frontmatter mínimo.

```
iteraciones new posts/mi-articulo.md
```

El archivo se crea con `title`, `date` y el bloque `---`. Si no se incluye extensión `.md`, se agrega automáticamente.

El título se infiere del nombre del archivo capitalizando cada palabra y conservando los acentos que tenga (`corazon.md` → `title: "Corazon"`, `corazón.md` → `title: "Corazón"`). Para un título distinto del nombre —o con acentos que el nombre no tiene—, usa `--title`:

```
iteraciones new --title "Mi artículo" posts/mi-articulo.md
```

### `iteraciones validate`

Valida `iteraciones.config.yaml` y el frontmatter de todos los documentos Markdown del proyecto. `validate` y `build` comparten la misma semántica de errores: todo lo que validate reporta como error es error de build (que falla antes de renderizar, con el mismo mensaje); los warnings son los mismos en ambos comandos. `validate` no comprueba el entorno — eso es trabajo de `doctor`.

```
iteraciones validate
```

### `iteraciones doctor`

Verifica que el entorno tenga todo lo necesario para ejecutar `iteraciones build`.

```
iteraciones doctor [opciones]
```

Comprobaciones que realiza: versión de Bun, pandoc disponible en PATH, configuración del proyecto (`iteraciones.config.yaml`) válida, permisos de lectura y escritura; y, según lo que el proyecto active: pdflatex/KOMA-Script, ImageMagick (PDF) e `iteraciones-pdfcheck` (PDF/X-1a). Cada fallo incluye cómo instalar lo que falta.

Con `--info` también muestra la configuración del proyecto (idioma, documentos, salida, formatos activos, tema HTML, filtros desactivados).

```
iteraciones doctor --info
```

### `iteraciones list-filters`

Lista los filtros Lua disponibles con su tipo, descripción y estado (activo/desactivado).

```
iteraciones list-filters
```

### `iteraciones clean`

Elimina el directorio de salida (`dist/`) y la caché (`.iteraciones/`).

```
iteraciones clean
```

### `iteraciones help [comando]`

Muestra la ayuda general o la de un comando concreto. Equivale a `--help` (o `-h`):

```
iteraciones help
iteraciones help build
```

## Filters

Los filters transforman el contenido Markdown. Se organizan en **capas**:

1. **Capa semántica** (`semantic/`) — corre en cada conversión y deja el contenido sin formato específico (`::` → `Div.spacer`, `:;` → `Div.spacer noindent`; los `Div.dictum/verse/center/flushright` quedan sin transformar).
2. **Capa de formato** (`latex/`, `html/`) — corre en cada exportación y convierte los nodos semánticos a su formato.

Además, un **filtro interno** (`internal/flags.lua`) detecta la estructura del documento (TOC, espaciado post-portada, citas) y expone las condiciones al template efectivo vía metadata.

### Pipeline

Cada formato se genera con una invocación directa de pandoc desde el markdown original (sin AST intermedio):

```
markdown (con frontmatter)
  → pandoc --to latex  [semantic/*, user/*, flags, latex/*] → .tex
  → pandoc --to html5 [semantic/*, user/*, flags, html/*]  → .html
  → pandoc --to epub3 [semantic/*, user/*]                 → .epub
  → pandoc --to markdown [semantic/*, user/*]              → .md
```

El CLI compone los templates efectivos (una vez por build), los filtros y los metadatos; el único post-procesamiento es la extracción de referencias del HTML.

### Filters integrados

| Nombre | Tipo | Entrada → Salida |
|--------|------|------------------|
| `semantic/string/01-double-colon` | string | `::` (línea sola) → `Div.spacer` |
| `semantic/ast/02-double-colon-noindent` | ast | `:;` → `Div.spacer noindent` |
| `latex/01-spacer` | ast | `Div.spacer` → `\\vspace{\\baselineskip}` (+`\\noindent` si noindent) |
| `latex/02-dictum` | ast | `Div.dictum` → `\\dictum[author]{quote}` |
| `latex/03-verse` | ast | `Div.verse` → `\\begin{verse}...\\end{verse}` |
| `latex/04-center` | ast | `Div.center` → `\\begin{center}...\\end{center}` |
| `latex/05-flushright` | ast | `Div.flushright` → `\\begin{flushright}...\\end{flushright}` |
| `latex/06-mbox-sentence-end` | ast | últimas 2 palabras de la oración final del párrafo → `\mbox{}` |
| `latex/08-quote-noindent` | ast | `BlockQuote` seguido de párrafo → `\noindent` al párrafo |
| `latex/09-cjk` | ast | `Div.japanese/chinese/korean` → `\begin{CJK}{UTF8}{min/gbsn/ksc}...\end{CJK}` |
| `latex/10-titlepages` | meta | frontmatter multilinea (`extratitle`, `frontispiece`, `titlehead`, `subject`, `dedication`, `uppertitleback`, `lowertitleback`, `publishers`, `colophon`) → LaTeX para las páginas de título y el colofón final; `title-image`, `publishers-image` y `endpapers` → imágenes de portada y guardas |
| `latex/11-uppercase` | ast | `[texto]{.uppercase}` → `\MakeUppercase{texto}` (LaTeX; en HTML la clase la estiliza Tailwind) |
| `html/01-dictum` | ast | `Div.dictum` → `<blockquote class="dictum">` |
| `html/02-verse` | ast | `Div.verse` → `<div class="verse">` |
| `html/03-center` | ast | `Div.center` → `<div class="center">` |
| `html/04-flushright` | ast | `Div.flushright` → `<div class="flushright">` |
| `html/05-spacer` | ast | `Div.spacer` → `<div class="spacer"></div>` |

### Ejemplo de dictum

```markdown
::: {.dictum}
Dios hizo los números enteros, el resto es obra del hombre.
:::

::: {.dictum}
La ciencia se compone de errores, que a su vez son los pasos
hacia la verdad.

::: {.author}
Julio Verne
:::
:::
```

### Desactivar un filter

En `iteraciones.config.yaml`:

```yaml
disabled-filters:
  - semantic/string/01-double-colon   # desactiva la conversión de ::
```

### Sobrescribir un filter

Crea un archivo con el mismo nombre completo en `<proyecto>/filters/<grupo>/`:

```bash
mkdir -p filters/semantic/string
cat > filters/semantic/string/01-double-colon.lua << 'EOF'
function Para(para)
  -- tu propia implementación
  return nil
end
EOF
```

### Filtros Lua de usuario

Además de sobrescribir filters, puedes agregar filtros Lua propios con `lua-filters:` en `iteraciones.config.yaml`. Las rutas son relativas al proyecto:

```yaml
lua-filters:
  - filters/nota.lua
```

Los filtros corren en **todas** las invocaciones de pandoc (latex, html, epub y markdown). En las exportaciones corren **antes** de los filters del paquete, para poder transformar los nodos semánticos antes de la capa de formato; los filtros semánticos corren antes que los de usuario, para que estos vean los nodos ya resueltos (por ejemplo, `Div.spacer`).

Dentro del filtro, la variable global `FORMAT` de pandoc indica el formato de salida (`latex`, `html5`, `epub3`, `markdown`), lo que permite que un mismo filtro ramifique su comportamiento:

```lua
-- filters/nota.lua
function Div(div)
  if not div.classes:includes("nota") then return nil end
  if FORMAT == "latex" then
    return pandoc.RawBlock("latex", "\\fbox{Nota}")
  elseif FORMAT == "html5" then
    return pandoc.RawBlock("html", '<aside class="nota">Nota</aside>')
  end
  return nil
end
```

Si una ruta no existe en el proyecto, se muestra una advertencia y se omite.

## Licencia

MIT

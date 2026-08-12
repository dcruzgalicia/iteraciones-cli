# iteraciones-cli

> escribir, compartir, re-existir

CLI para construir documentos HTML, PDF, EPUB, LaTeX y Markdown a partir de archivos Markdown usando pandoc y Tailwind CSS.

## Requisitos

- [bun](https://bun.sh) ≥ 1.0
- [pandoc](https://pandoc.org/installing.html) disponible en `PATH`
- (para PDF) TeX Live o MacTeX con KOMA-Script instalado

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
lang: "es-MX"                     # idioma del sitio (por defecto: "es-MX")

toc: false                         # índice en cada documento (por defecto: false)

format:
  latex:
    generate: false                # genera archivos .tex (por defecto: false)

  pdf:
    generate: false                # genera PDF (por defecto: false)
    # disabled-preamble-filters:    # preamble filters a desactivar (opcional)
    #   - 24-eso-pic

  html:
    title: "Mi sitio"              # título del sitio (por defecto: "iteraciones")
    tagline: "mi tagline"          # frase corta (por defecto: "escribir, compartir, re-existir")
    logo: ""                       # ruta al logo (por defecto: sin logo)
    theme: dark                    # tema: "light" o "dark"
    accent: lime                   # color de acento (lime, blue, rose, etc.)
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

## Comandos

### Opción global `--project-root`

Todos los comandos aceptan `--project-root <path>` para indicar el directorio raíz del proyecto. Sin ella, se usa el directorio actual. Puede colocarse antes o después del subcomando:

```bash
iteraciones build --project-root /ruta/al/proyecto
iteraciones --project-root /ruta/al/proyecto validate
```

### `iteraciones build`

Construye los documentos a partir de los archivos Markdown.

```
iteraciones build [opciones]
```

| Opción | Descripción | Por defecto |
|--------|-------------|-------------|
| `--full` | Build completo desde cero: elimina la salida anterior (`dist/`) y la caché | — |
| `--output <path>` | Directorio de salida | `dist/files` |
| `--verbose` | Muestra información adicional de progreso | — |

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

### `iteraciones validate`

Valida `iteraciones.config.yaml` y el frontmatter de todos los documentos Markdown del proyecto.

```
iteraciones validate
```

### `iteraciones doctor`

Verifica que el entorno tenga todo lo necesario para ejecutar `iteraciones build`.

```
iteraciones doctor [opciones]
```

Comprobaciones que realiza: versión de Bun, pandoc disponible en PATH, configuración del proyecto (`iteraciones.config.yaml`) válida, pdflatex y KOMA-Script instalados (solo si el proyecto compila PDF), permisos de lectura y escritura.

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
| `latex/10-titlepages` | meta | frontmatter multilinea (`extratitle`, `dedication`, `uppertitleback`, `lowertitleback`) → LaTeX para las páginas de título internas |
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

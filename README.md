# iteraciones-cli

> escribir, compartir, re-existir

CLI para construir documentos HTML, PDF, EPUB, LaTeX y Markdown a partir de archivos Markdown usando pandoc y Tailwind CSS.

## Requisitos

- [bun](https://bun.sh) ≥ 1.0
- [pandoc](https://pandoc.org/installing.html) disponible en `PATH`

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
  _iteraciones.yaml   # configuración del sitio
  README.md           # o cualquier archivo .md
```

Puedes generar esta estructura automáticamente con:

```bash
cd mi-proyecto
iteraciones init
```

Esto también crea un archivo `bibliography.bib` de ejemplo.

## Configuración (`_iteraciones.yaml`)

```yaml
site:
  title: "Mi sitio"                 # título del sitio (por defecto: "Iteraciones")
  tagline: "mi tagline"             # frase corta (por defecto: "escribir, compartir, re-existir")
  lang: "es-MX"                     # idioma HTML (por defecto: "es-MX")
  logo: ""                          # ruta al logo (por defecto: sin logo)
  base-url: ""                      # URL base del sitio (por defecto: vacío)

format:
  latex: true                       # genera archivos .tex (por defecto: true)

  pdf:
    generate: false                 # genera PDF (por defecto: false)
    # documentclass, geometry, babel, hyperref, microtype, etc.
    # Ver docs/configuration.md para todas las opciones disponibles

  html:
    theme: dark                     # tema: "light" o "dark"
    accent: lime                    # color de acento (lime, blue, rose, etc.)
    generate: false                 # genera HTML (por defecto: false)

  epub:
    generate: false                 # genera EPUB (por defecto: false)

  markdown:
    generate: false                 # genera Markdown procesado (por defecto: false)

disabled-transpilers:               # transpilers a desactivar por nombre completo (opcional)
  # - latex/02-dictum

disabled-preamble-transpilers:      # preamble transpilers a desactivar (opcional)
  # - 01-maketitle-patches
```

## Comandos

### `iteraciones build`

Construye los documentos a partir de los archivos Markdown.

```
iteraciones build [opciones]
```

| Opción | Descripción | Por defecto |
|--------|-------------|-------------|
| `-c, --concurrency <n>` | Máximo de invocaciones pandoc simultáneas | `4` |
| `--no-cache` | Omite la caché incremental; siempre hace build completo | — |
| `--project-root <path>` | Directorio raíz del proyecto | directorio actual |
| `--output <path>` | Directorio de salida | `dist/files` |
| `--no-tailwind` | Omite la generación de CSS con Tailwind | — |
| `--no-export` | Omite la exportación PDF/EPUB | — |
| `--dry-run` | Muestra los documentos a procesar sin generar salida | — |
| `--verbose` | Muestra información adicional de progreso | — |

### `iteraciones init`

Crea `_iteraciones.yaml`, `README.md` y `bibliography.bib` mínimos en el directorio actual. Si alguno de los archivos ya existe, lo omite sin sobreescribirlo.

```
iteraciones init
```

### `iteraciones new <path>`

Crea un archivo Markdown con frontmatter mínimo.

```
iteraciones new posts/mi-articulo.md
```

El archivo se crea con `title`, `date` y el bloque `---`. Si no se incluye extensión `.md`, se agrega automáticamente.

### `iteraciones build --dry-run`

Muestra los documentos que se procesarían sin generar salida. Útil para verificar qué archivos están incluidos antes de un build completo.

### `iteraciones validate`

Valida `_iteraciones.yaml` y el frontmatter de todos los documentos Markdown del proyecto.

```
iteraciones validate
```

| Opción | Descripción |
|--------|-------------|
| `--project-root <path>` | Directorio raíz del proyecto (por defecto: directorio actual) |

### `iteraciones info`

Muestra información básica del proyecto: título, tagline, idioma, estado de pandoc y del directorio de salida.

```
iteraciones info
```

### `iteraciones doctor`

Verifica que el entorno tenga todo lo necesario para ejecutar `iteraciones build`.

```
iteraciones doctor [opciones]
```

| Opción | Descripción |
|--------|-------------|
| `--fix` | Intenta corregir automáticamente los problemas detectados |

Comprobaciones que realiza: pandoc disponible en PATH, configuración del proyecto (`_iteraciones.yaml`) válida, Tailwind CSS disponible, pdflatex y KOMA-Script instalados, pdftoppm disponible, permisos de lectura y escritura.

### `iteraciones transpilers`

Lista los transpilers disponibles con su tipo, descripción y estado (activo/desactivado).

```
iteraciones transpilers
```

## Transpilers

Los transpilers transforman el contenido Markdown. Se organizan en **capas**:

1. **Capa semántica** (`semantic/`) — corre una vez por documento y deja el **AST canónico** sin contenido de formato específico (`::` → `Div.spacer`, `:;` → `Div.spacer noindent`; los `Div.dictum/verse/center/flushright` quedan sin transformar).
2. **Capa de formato** (`latex/`, `html/`) — corre en cada exportación y convierte los nodos semánticos a su formato.

### Pipeline

```
markdown → semantic/string → pandoc --to json → semantic/ast → AST canónico
  → latex/ → pandoc --from json --to latex → .tex
  → html/  → pandoc --from json --to html5 → .html
```

### Transpilers integrados

| Nombre | Tipo | Entrada → Salida |
|--------|------|------------------|
| `semantic/string/01-double-colon` | string | `::` (línea sola) → `Div.spacer` |
| `semantic/ast/02-double-colon-noindent` | ast | `:;` → `Div.spacer noindent` |
| `latex/01-spacer` | ast | `Div.spacer` → `\\vspace{\\baselineskip}` (+`\\noindent` si noindent) |
| `latex/02-dictum` | ast | `Div.dictum` → `\\dictum[author]{quote}` |
| `latex/03-verse` | ast | `Div.verse` → `\\begin{verse}...\\end{verse}` |
| `latex/04-center` | ast | `Div.center` → `\\begin{center}...\\end{center}` |
| `latex/05-flushright` | ast | `Div.flushright` → `\\begin{flushright}...\\end{flushright}` |
| `latex/06-mbox-sentence-end` | ast | últimas palabras de cada oración → `\\mbox{}` |
| `latex/07-mbox-sentence-start` | ast | primera palabra de cada oración → `\\mbox{}` |
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

### Desactivar un transpiler

En `_iteraciones.yaml`:

```yaml
disabled-transpilers:
  - semantic/string/01-double-colon   # desactiva la conversión de ::
```

### Sobrescribir un transpiler

Crea un archivo con el mismo nombre completo en `<proyecto>/transpilers/<grupo>/`:

```bash
mkdir -p transpilers/semantic/string
cat > transpilers/semantic/string/01-double-colon.ts << 'EOF'
export const type = 'string';
export function process(body: string): string {
  // tu propia implementación
  return body;
}
EOF
```

## Licencia

MIT

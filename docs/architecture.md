# Arquitectura de iteraciones-cli

## Visión general

iteraciones-cli es un static site generator (SSG) orientado a publicación editorial. Toma archivos Markdown con frontmatter YAML y genera documentos en múltiples formatos (HTML, PDF, EPUB, LaTeX, Markdown) usando **Pandoc** para las conversiones y **Tailwind CSS** para el estilo.

### Stack

| Componente | Tecnología | Propósito |
|-----------|------------|-----------|
| Runtime | [Bun](https://bun.sh) | Ejecución TypeScript, package manager, test runner |
| CLI | [Commander](https://github.com/tj/commander.js) | Parseo de argumentos y comandos |
| Validación | [Zod](https://zod.dev) | Esquemas de configuración con defaults |
| Conversión | [Pandoc](https://pandoc.org) | Transformación entre formatos de documento |
| CSS | [Tailwind CSS v4](https://tailwindcss.com) | Estilos del HTML generado |
| PDF | latexmk + pdflatex + biber | Compilación LaTeX a PDF |
| Tests | bun test | Framework de tests integrado |

---

## Pipeline de construcción

El pipeline convierte archivos Markdown en documentos en los formatos configurados. Cada formato se genera con una invocación directa de pandoc desde el markdown original (sin AST intermedio) y se escribe directamente en `dist/files/`:

```
┌─────────────┐
│  FASE 1     │  discover()
│  Discovery   │  • Escanea archivos .md con Bun.Glob
│             │  • Caché content-addressed (mtime+size+hash)
│             │  • Lee frontmatter (title, author) y lo conserva completo (fm)
│             │  • Calcula slugs (title-por-author con colisiones)
│             │  • Detecta archivos nuevos, modificados y eliminados
└──────┬──────┘
       │ allDocs[]
       ▼
┌──────────────────────────────┐
│  Planificación                │  computeBuildMetadata()
│                              │  • Hashes de invalidación (filtros, bib, config)
│                              │  • Formatos nuevos/eliminados
│                              │  • computeWorkSets() → renderDocs + exportSets
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  Pipeline por documento       │  runDocumentPipeline()
│                              │
│  Pool 1 (formatos ligeros)   │  • Templates efectivos (compuestos 1× por build)
│  • markdown → latex          │  • Filtros: semantic/*, user/*, internal/flags, capa
│  • markdown → html5          │  • Frontmatter como metadata (fm ?? config)
│  • markdown → epub3          │  • Post-procesamiento único: referencias (HTML)
│  • markdown → markdown       │  • Salidas directas a dist/files/
│                              │  • Concurrencia: ctx.concurrency
│  Pool 2 (PDF, en paralelo)   │  • latexmk en .iteraciones/tmp/pdf → dist/
└──────┬───────────────────────┘
       │
       ▼
┌─────────────┐
│  Assets      │  buildAssets()
│             │  • Compila el CSS con Tailwind escaneando SOLO los HTML
│             │    finales de dist/files (@source explícito, sin caché)
│             │  • Copia fuentes y logo a dist/
└─────────────┘
```

---

## Filtros en cada conversión
```
Archivo .md (con frontmatter)
  │
  ▼
Frontmatter YAML        → SiteConfig (Zod schema) y metadata de pandoc
  │
  ▼
Cada conversión (una invocación pandoc desde el markdown original):
  pandoc --to latex  [semantic/string, semantic/ast, user/*, internal/flags, latex/*]
  pandoc --to html5  [semantic/string, semantic/ast, user/*, internal/flags, html/*]
  pandoc --to epub3  [semantic/string, semantic/ast, user/*]
  pandoc --to markdown [semantic/string, semantic/ast, user/*]
```
El frontmatter fluye como metadata del documento (el CLI complementa con defaults); el filtro interno `internal/flags` expone las condiciones del preámbulo al template vía metadata y el único post-procesamiento es la extracción de referencias del HTML.

El sistema de filtros completo (capas, descripciones y override) se describe abajo.

---

## Sistema de filters

Los filters son filtros Lua que transforman el contenido. Se organizan en **capas**:

1. **Capa semántica** (`semantic/`) — corre en cada conversión y deja el contenido sin formato específico: `::` → `Div.spacer`, `:;` → `Div.spacer noindent`. Los `Div.dictum/verse/center/flushright` quedan sin transformar. La subcapa `string/` corre antes del parseo de pandoc y la `ast/` después, dentro de la misma invocación.
2. **Capa de formato** (`latex/`, `html/`) — corre en cada exportación y convierte los nodos semánticos a su formato (RawBlocks de apertura/cierre alrededor de los bloques nativos). La capa `html/` se aplica al generar la página HTML con el template de pandoc.
3. **Filtros Lua**: todos los filters son filtros Lua (`src/lib/resources/filters/<grupo>/<nombre>.lua`) que corren **dentro** de las invocaciones pandoc (`--lua-filter`), en el orden numérico de su capa. Override: `<proyecto>/filters/<grupo>/<nombre>.lua` reemplaza al del paquete; `disabled-filters` (nombres completos) los desactiva.

Además, existen los **preamble filters** (`src/lib/resources/preamble/*.tex`) que modifican el preámbulo LaTeX.

### Filters integrados

| Nombre | Tipo | Entrada → Salida |
|--------|------|-------------------|
| `semantic/string/01-double-colon` | string | `::` → `Div.spacer` |
| `semantic/ast/02-double-colon-noindent` | ast | `:;` → `Div.spacer noindent` |
| `latex/01-spacer` | ast | `Div.spacer` → `\vspace{\baselineskip}` (+`\noindent` si noindent) |
| `latex/02-dictum` | ast | `Div.dictum` → `\dictum[author]{quote}` |
| `latex/03-verse` | ast | `Div.verse` → `\begin{verse}...\end{verse}` |
| `latex/04-center` | ast | `Div.center` → `\begin{center}...\end{center}` |
| `latex/05-flushright` | ast | `Div.flushright` → `\begin{flushright}...\end{flushright}` |
| `latex/06-mbox-sentence-end` | ast | últimas palabras de cada oración → `\mbox{}` |
| `latex/07-mbox-sentence-start` | ast | primera palabra de cada oración → `\mbox{}` |
| `html/01-dictum` | ast | `Div.dictum` → `<blockquote class="dictum">` |
| `html/02-verse` | ast | `Div.verse` → `<div class="verse">` |
| `html/03-center` | ast | `Div.center` → `<div class="center">` |
| `html/04-flushright` | ast | `Div.flushright` → `<div class="flushright">` |
| `html/05-spacer` | ast | `Div.spacer` → `<div class="spacer"></div>` |

### Preamble filters integrados

| Nombre | Archivo | Propósito |
|--------|---------|-----------|
| 01-documentclass | `src/lib/resources/preamble/01-documentclass.tex` | \documentclass con clase KOMA-Script |
| 02-fonts | `src/lib/resources/preamble/02-fonts.tex` | Codificación y fuente principal |
| 03-spacing | `src/lib/resources/preamble/03-spacing.tex` | Interlineado con setspace |
| 04-margins | `src/lib/resources/preamble/04-margins.tex` | Márgenes con geometry |
| 05-language | `src/lib/resources/preamble/05-language.tex` | Idioma con babel |
| 06-headers | `src/lib/resources/preamble/06-headers.tex` | Encabezados con scrlayer-scrpage |
| 07-typography | `src/lib/resources/preamble/07-typography.tex` | Microtipografía y penalizaciones |
| 08-hyperref | `src/lib/resources/preamble/08-hyperref.tex` | Enlaces PDF |
| 09-tables | `src/lib/resources/preamble/09-tables.tex` | Paquetes de tablas |
| 10-lists | `src/lib/resources/preamble/10-lists.tex` | Listas con enumitem |
| 11-bibliography | `src/lib/resources/preamble/11-bibliography.tex` | Bibliografía con biblatex |
| 12-counters | `src/lib/resources/preamble/12-counters.tex` | Contadores de secciones |
| 13-setkomafont | `src/lib/resources/preamble/13-setkomafont.tex` | Fuentes de la portada |
| 14-sectioning | `src/lib/resources/preamble/14-sectioning.tex` | Estilo de secciones |
| 15-hyphenation-rules | `src/lib/resources/preamble/15-hyphenation-rules.tex` | Reglas de partición de palabras |
| 16-toc-styling | `src/lib/resources/preamble/16-toc-styling.tex` | Estilo del índice |
| 17-toc-section | `src/lib/resources/preamble/17-toc-section.tex` | TOC como \subsubsection* |
| 18-bibliography-heading | `src/lib/resources/preamble/18-bibliography-heading.tex` | Título de bibliografía como subsubsection |
| 19-maketitle | `src/lib/resources/preamble/19-maketitle.tex` | Personaliza \maketitle |
| 20-alignment | `src/lib/resources/preamble/20-alignment.tex` | Redefine center/flushright/flushleft |
| 21-dictum | `src/lib/resources/preamble/21-dictum.tex` | Configuración de epígrafes |
| 22-verse | `src/lib/resources/preamble/22-verse.tex` | Redefine el entorno verse |
| 23-quote | `src/lib/resources/preamble/23-quote.tex` | Redefine el entorno quote |
| 24-eso-pic | `src/lib/resources/preamble/24-eso-pic.tex` | Fondo de página (desactivado por defecto) |
| 25-pdfx | `src/lib/resources/preamble/25-pdfx.tex` | PDF/X-1a (desactivado por defecto) |
| 26-crop | `src/lib/resources/preamble/26-crop.tex` | Marcas de corte (desactivado por defecto) |

### Extensibilidad

- Un filter del proyecto con el mismo nombre completo (p. ej. `<proyecto>/filters/latex/02-dictum.lua`) reemplaza al del paquete (override).
- Para desactivar uno se usa `disabled-filters` (nombres completos, p. ej. `latex/02-dictum`) en `iteraciones.config.yaml`.
- **Filtros Lua de usuario** (`lua-filters:`): lista de rutas relativas al proyecto que corren en todas las invocaciones pandoc (latex, html5, epub3 y markdown), antes de la capa de formato, para poder transformar los nodos semánticos antes de la exportación. Los filtros semánticos corren antes que los de usuario, para que estos vean los nodos ya resueltos (por ejemplo, `Div.spacer`). La variable global `FORMAT` de pandoc permite ramificar el comportamiento por formato de salida. Si una ruta no existe se advierte y se omite.
- Los preamble filters del proyecto (`<proyecto>/preamble/<nombre>.tex`) reemplazan a los del paquete; se desactivan con `format.pdf.disabled-preamble-filters`.

---

## Sistema de caché (build incremental)

El build incremental evita reprocesar documentos que no han cambiado:

1. **state.json** (`.iteraciones/state.json`): guarda el timestamp del build anterior, los formatos activos y los metadatos de cada archivo (title, author, slug, frontmatter completo `fm`).
2. **Detección content-addressed**: cada archivo .md se compara contra el caché por mtime+size+sha256 (sin AST intermedio que conservar).
3. **Invalidación**: filtros (incluido `internal/flags`), configuración por formato, bibliografía y versiones de esquema de los outputs; al invalidarse un formato, sus salidas se regeneran re-ejecutando pandoc desde el markdown (re-parseo).
4. **Formatos activos**: si cambia la configuración de formatos entre builds, se fuerza el reprocesamiento completo de ese formato.
5. **Slugs duplicados**: contador derivado del discovery index para slugs con sufijo `-dN`.
6. **Migración**: los directorios del flujo anterior (`ast/`, `changes/`, `formats/`) se eliminan automáticamente en cada build.

Solo los documentos modificados (o con slug cambiado) pasan por el pipeline; el resto reutiliza sus salidas en `dist/`. Los formatos se escriben directamente en `dist/files/` (sin staging intermedio) y el PDF compila en `.iteraciones/tmp/pdf/`.

**Coste del re-parseo incremental (medido y aceptado):** re-exportar tras una invalidación implica re-parsear el markdown (cada formato vuelve a ejecutar pandoc desde el origen). Medido con `--profile` en el proyecto de integración (2 documentos, 5 formatos): el re-parseo de ambos documentos cuesta ~270-290 ms en el pool 1, indistinguible frente al PDF (~7 s de latexmk), y un build sin cambios no reprocesa nada (~120 ms). Se acepta el coste: reintroducir un AST en disco para evitarlo añadiría complejidad sin beneficio medible, y el build completo es más rápido que v0.18.0 al no existir la pasada markdown → json.

---

## Sistema de configuración

La configuración se lee de `iteraciones.config.yaml` y se valida con **Zod**:

```yaml
lang: es-MX
toc: false

format:
  latex:
    generate: false
  pdf:
    generate: false
    show-date: false
    page-number: header-right
    disabled-preamble-filters:
      - 24-eso-pic
      - 25-pdfx
      - 26-crop
  html:
    title: "Mi sitio"
    tagline: "escribir, compartir, re-existir"
    generate: true
    theme: dark
    accent: lime
  epub:
    generate: false
  markdown:
    generate: false

bibliography: refs/mi-libro.bib   # opcional: .bib del proyecto
csl: styles/nature.csl            # opcional: estilo de citas
disabled-filters: []
lua-filters: []
```

El esquema Zod (`config-schema.ts`) valida tipos, aplica defaults y transforma claves kebab-case a camelCase para las interfaces TypeScript. Los valores por defecto viven en una única fuente: las constantes `DEFAULT_*` de `site-config.ts` (el esquema las consume con `.default()` y el transform las usa como fallback).

### PdfFormatConfig (campos reales)

La configuración PDF es mínima y deliberada: `generate` (activa la compilación con latexmk), `show-date` (fecha en la portada), `page-number` (posición del número de página) y `disabled-preamble-filters` (lista negra de preamble filters, con `24-eso-pic`, `25-pdfx` y `26-crop` desactivados por defecto). Todo el diseño tipográfico (márgenes, fuentes, interlineado, secciones, epígrafes, portada) se gestiona con **preamble filters** `.tex` sobrescribibles por proyecto (`<proyecto>/preamble/<nombre>.tex`) y no es configuración YAML.

## Módulos principales

### `src/cli/`

| Archivo | Responsabilidad |
|---------|----------------|
| `parser.ts` | Define comandos y opciones con Commander. Solo parsea y delega. |
| `dispatcher.ts` | Handlers de cada comando. Maneja errores con try/catch + logError. |
| `progress.ts` | ProgressTracker: muestra secciones, fases y resumen del build. |
| `doctor/` | Verificaciones del sistema (pandoc, pdflatex, permisos). |

### `src/builder/`

| Archivo | Responsabilidad |
|---------|----------------|
| `orchestrator.ts` | `build()`: coordina las fases del pipeline. Función principal. |
| `discover.ts` | Fase 1: escanea archivos, lee frontmatter (y lo conserva completo), detecta cambios. |
| `render.ts` | Conversiones pandoc-directo (markdown → latex/html5), sistema de filters, post-procesamiento de referencias. |
| `pipeline.ts` | Pipeline por documento (pools 1 y 2) con templates efectivos y salidas directas a dist. |
| `build-planner.ts` | Planificador: metadatos de invalidación y conjuntos de trabajo. |
| `build-assets.ts` | Assets: compila el CSS con Tailwind sobre dist/files (acento del @theme), fonts, logo. |
| `latex-preamble.ts` | Compositor del template LaTeX efectivo (una vez por build). |
| `preamble-loader.ts` | Carga de preamble filters (.tex) con override por proyecto. |
| `state.ts` | Caché content-addressed (state.json, hashes de invalidación, migración). |
| `cleanup.ts` | Limpieza de salidas: formatos eliminados, archivos borrados, slugs cambiados. |
| `pdf-pool.ts` | Pool consumidor de compilación PDF (cola de jobs, slots biber). |
| `slug-resolver.ts` | Resolución de slugs con colisiones y sufijos -dN. |
| `gitignore.ts` | Reglas de .gitignore del proyecto y exclusión de paths ocultos. |
| `types.ts` | BuildDocument, Frontmatter, BuildContext, DiscoveryEntry. |
| `export/` | Primitivas de conversión EPUB/Markdown (runner) y ensamblado de metadatos (assemble). |

### `src/config/`

| Archivo | Responsabilidad |
|---------|----------------|
| `config-schema.ts` | Esquemas Zod para toda la configuración. |
| `config-loader.ts` | Carga y valida `iteraciones.config.yaml`. |
| `site-config.ts` | Interfaces TypeScript y valores por defecto. |

### `src/lib/`

| Archivo | Responsabilidad |
|---------|----------------|
| `run.ts` | `mapWithConcurrency()`: ejecuta funciones con límite de concurrencia. |
| `pandoc-runner.ts` | `runPandoc()`: invoca pandoc con pipes stdin/stdout. |
| `logger.ts` | `logError()`, `logWarning()`: formato unificado de mensajes. |
| `errors.ts` | `PandocError`, `ConfigError`: clases de error del sistema. |

---

## Decisiones de diseño

### Presupuesto de arranque

Medido (macOS arm64, Bun 1.3.x, sin pandoc en PATH, `--version`): **~55 ms de media** (10 ejecuciones; la primera incluye cold start de ~0.18 s). Decisión: no optimizar el arranque — está muy por debajo del umbral perceptible y cualquier carga diferida complicaría el código sin beneficio medible. Re-medir si alguna vez el arranque supera los ~200 ms.

### ¿Por qué no hay configuración dinámica del PDF (papel, márgenes, fuente)?

La tipografía del PDF (papel, márgenes, interlineado, fuente, estilos de sección) vive en los preamble filters (`src/lib/resources/preamble/*.tex`) y se personaliza por proyecto con el override `<proyecto>/preamble/<nombre>.tex` (documentado en configuration.md). Decisión pre-1.0: **no** añadir opciones dinámicas (`format.pdf.margins`, `format.pdf.paper`, `format.pdf.font-size`): duplicarían el mecanismo de override, ampliarían la superficie pública sin necesidad y fragmentarían la configuración en dos lugares. El override por `.tex` es la vía soportada; re-evaluar solo si el uso real lo justifica tras 1.0.

### ¿Por qué Bun?

- **Sin Node.js**: Bun es runtime + package manager + test runner + bundler. Una sola dependencia.
- **TypeScript nativo**: sin transpilación, sin tsconfig complejo.
- `Bun.file()` / `Bun.write()`: API moderna para I/O de archivos.
- `Bun.spawn()`: invocación de procesos con pipes.
- `Bun.Glob`: globbing nativo sin dependencias.
- `bun test`: test runner integrado, API compatible con Jest.

### ¿Por qué el pipeline usa dos pools de concurrencia?

Cada documento genera sus formatos con invocaciones directas de pandoc (markdown → latex/html5/epub3/markdown) en el **pool 1**, con concurrencia `ctx.concurrency` (CPU − 1, máx. 16). El **pool 2** consume la cola de compilación PDF en paralelo, solapando latexmk con pandoc: el PDF no bloquea al resto de formatos. Cada instancia de latexmk consume ~300-600 MB de RAM, por eso su concurrencia está acotada a un máximo de **4 slots** (`PDF_MAX_SLOTS` en `pipeline.ts`), independiente de la concurrencia general.

### ¿Por qué templates efectivos y un único post-procesamiento?

El CLI compone los templates HTML y LaTeX efectivos una vez por build (tarjetas ordenadas según `format.html.blocks`; preámbulo con condicionales expuestos por el filtro `internal/flags` vía metadata). Así pandoc genera cada formato directamente desde el markdown original y el único post-procesamiento es la extracción de referencias del HTML (el único bloque que no puede resolver el template: no existe hasta que citeproc lo genera). Esto elimina el ensamblado de bloques y el AST intermedio del flujo anterior, y la verificación de identidad queda a cargo de la suite de tests.

### ¿Por qué el frontmatter fluye como metadata?

El frontmatter completo se pasa a pandoc como metadata del documento (yaml_metadata_block); el CLI solo complementa con defaults (`fm ?? config`) y transformaciones (fecha humana, author-meta). El contrato de campos efectivos está documentado en `docs/frontmatter-reference.md` y `validate` advierte sobre campos sin efecto.

### ¿Por qué Zod en lugar de parseo manual?

El archivo `config-loader.ts` usa esquemas Zod en lugar de parseo manual campo por campo. Beneficios:
- Mensajes de error descriptivos automáticos
- Validación de tipos en runtime
- Defaults declarativos con `.default()` (consumidos desde las constantes `DEFAULT_*`)
- Documentación viva del esquema

### ¿Por qué el tracker de progreso es propio?

El tracker del build (`src/cli/progress.ts`) es un renderer propio y síncrono: filas interactivas en TTY (conteo en vivo `[i/N]`), impresión de estados finales en pipes y texto plano en `--verbose`. La integración anterior con una librería de tareas causó dos regresiones de cuelgue del proceso en TTY; el renderer propio no tiene bucles de render ni promesas de coordinación, así que un error del build no puede dejar el proceso colgado.

### ¿Por qué las listas de filters se derivan del filesystem?

Los nombres de los filters Lua y de los preamble filters se derivan de un glob ordenado de `src/lib/resources/` (el prefijo numérico define el orden): agregar un filter nuevo es crear un archivo, sin tocar código. Las descripciones viven en la primera línea de comentario de cada archivo.

### ¿Por qué no hay plugins/tipos de documento/paginación?

El proyecto comenzó con una arquitectura muy ambiciosa (plugins ESM, 8 tipos de documento, paginación, temas, layouts) que fue simplificada drásticamente entre v0.8 y v0.10. La eliminación de ~3000+ líneas de código muerto mejoró la mantenibilidad, velocidad y predictibilidad del pipeline. Ver `CHANGELOG.md` para los detalles de cada release.

### ¿Por qué el esquema de slugs usa el contador `-dN` para colisiones?

Decisión registrada en el issue #1434 (2026-08), simplificada en el issue #1761: **las colisiones se resuelven solo con sufijos `-dN`**.

Reglas del esquema (implementadas en `src/builder/slug-resolver.ts`):

1. Slug base: `title` transliterado (acentos eliminados, símbolos mapeados: `&` → `y`, `%` → `por-ciento`).
2. Con autor: `title-por-author` usando el primer autor.
3. Si el título se repite, se aplica un sufijo `-dN` (N incremental).
4. Los sufijos `-dN` se derivan del discovery index (`existingSlugs`): eliminar un documento del grupo en colisión no renumera los restantes.

Motivos de la decisión:

- La convención `title-por-author` es parte de la identidad documentada de la herramienta (README y `docs/frontmatter-reference.md`).
- La estabilidad de nombres entre builds protege enlaces, notas y bookmarks del usuario: eliminar un documento no renumera los restantes.
- El esquema está cubierto por tests de casos límite (`slug-changes.test.ts`: títulos duplicados, cambio/quita de autor, acortar título, sufijos `-dN`).

La expansión progresiva de autores (2, 3… hasta 20 autores para desambiguar) se eliminó en el issue #1761: añadía ~40 líneas de complejidad para un caso que ocurre en menos del 1% de los proyectos, y producía slugs largos (`titulo-por-autor1-y-autor2`). `-dN` es más simple y predecible.

### ¿Cómo se excluyen documentos del build? (alcance de `.gitignore`)

Decisión registrada en el issue #1436 (2026-08): **se mantiene el soporte propio de `.gitignore`** y se documentan sus límites.

El descubrimiento de documentos (`src/builder/discover.ts`) procesa **todo** `.md` del proyecto salvo lo que se excluya por: directorios fijos (`node_modules/`, `.git/`, `dist/`, `.iteraciones/`), rutas ocultas (cualquier segmento que empiece por `.`) y reglas de `.gitignore`.

Alcance del soporte (`src/builder/gitignore.ts`):

- Solo el `.gitignore` de la **raíz** del proyecto (sin `.gitignore` anidados en subdirectorios).
- Patrones comunes de git: negación (`!`), anclaje a la raíz (`/` inicial o interior), directorios (barra final `/`), `*`, `**`, `?` y clases `[..]`.
- La última regla que coincide gana (estándar git).

Límites conocidos (aceptados): semántica aproximada en casos límite del estándar git (p. ej. `**` en medio de patrones, escapes exóticos), ausencia de reglas heredadas de `.gitignore` superiores, y el matcher no distingue archivos de directorios (no hace stat: un patrón `dir/` no ignora el directorio en sí en niveles superiores; discovery solo verifica archivos `.md` existentes, así que no afecta al descubrimiento real). La suite de paridad (`src/__tests__/gitignore-parity.test.ts`) compara `isIgnoredByRules` contra `git check-ignore` y lista las divergencias conocidas en `KNOWN_DIVERGENCES`: solo una divergencia nueva falla. Es el único mecanismo de exclusión de contenido; no se ampliará su alcance.

### Congelación de la superficie pública (pre-1.0)

Decisión registrada en el issue #1542 (2026-08): **la superficie pública queda congelada hasta 1.0**. Cualquier cambio incompatible requiere un issue que lo justifique y debe actualizar este documento en el mismo trabajo.

Cambios incompatibles ejecutados en la ventana pre-1.0 (agosto 2026, revisión integral + backlog):

- `format.html.blocks` pasó de objeto con números a **lista ordenada** (`[header, contenido, formatos, indice, referencias, footer]`); la tarjeta de contenido se renombró de `trayectura` a `contenido`.
- `accent` desconocido y `format.latex` booleano pasaron de tolerancia (warning + fallback) a **errores de validación** en build y validate.
- El export Markdown usa **rutas relativas** de bibliografía/CSL y no incrusta el CSL del paquete ni `documentclass`.

Superficie estable:

- **Comandos**: `build`, `init`, `validate`, `doctor`, `new`, `clean`, `list-filters`.
- **Opciones globales**: `--project-root`, `-V/--version`, `-h/--help`.
- **Opciones de build**: `--full`, `--output`, `--verbose`.
- **Configuración** (`iteraciones.config.yaml`): `lang`, `toc`, `format.latex`, `format.html.{title, tagline, logo, theme, accent, generate, blocks}`, `format.pdf.{generate, show-date, page-number, disabled-preamble-filters}`, `format.epub.generate`, `format.markdown.generate`, `disabled-filters`, `lua-filters`, `bibliography`, `csl`.
- **Frontmatter**: `title`, `subtitle`, `date`, `author`, `slug` (manual).
- **Filtros**: nombres completos de los filters del paquete (capas `semantic/`, `latex/`, `html/`) y de los preamble filters numerados; override por archivo y listas `disabled-*`.
- **Salidas**: HTML, PDF, LaTeX, EPUB y Markdown; esquema de slugs `title-por-author` con sufijos `-dN`.

Decisiones confirmadas en este pase (sin cambios de código):

- La terminología `filters` / `preamble filters` / `lua-filters` se conserva tal cual (el comando que los lista es `list-filters`).
- Los nombres numerados de preamble filters expuestos en config (`24-eso-pic`, …) se conservan: renumerarlos rompería configs existentes sin beneficio.

### ¿Por qué un color de acento inválido es un error (no un warning)?

La tolerancia original (decisión #1770: warning + fallback a `lime` en build) se **revirtió**: un `accent` desconocido es ahora un error de validación tanto en `build` como en `validate`. Motivos: era la única clave del schema con comportamiento tolerante (cualquier otro typo, p. ej. `toc: "true"`, ya rompía el build), y un fallback silencioso producía una salida que no era la solicitada. El schema Zod es la única fuente de verdad: no hay interceptaciones previas en `config-loader.ts`.

### ¿Cuál es el contrato entre `build` y `validate`?

Decisión registrada en el issue #1882 (2026-08): **una sola semántica de validación**. La regla:

> **Todo lo que `validate` reporta como error es error de `build`**: el build falla antes de renderizar, con el mismo mensaje. Los warnings se mantienen como warnings en ambos comandos. `validate` no ejecuta el pipeline y no comprueba el entorno (eso es trabajo de `doctor`).

Motivos: antes del acuerdo, `build` degradaba con warning lo que `validate` consideraba error (`title: 123` producía "Sin título" con exit 0 en build y error en validate), y el resumen del build sugería ejecutar `validate` donde este fallaba. La dirección de errores duros es la misma que ya se aplicó a `accent` y a `format.latex` booleano: una salida degradada silenciosa no es la salida solicitada.

Inventario de divergencias conocidas y su veredicto (implementado en el issue #1883):

| Divergencia | `build` (antes) | `validate` (antes) | Veredicto |
|---|---|---|---|
| Tipos inválidos de campos del frontmatter (`title: 123`) | warning + "Sin título" | error | **error en ambos** (mismo mensaje, fallo antes de renderizar) |
| Claves desconocidas en `iteraciones.config.yaml` | warning, continúa | error | **error en ambos** |
| `bibliography`/`csl` configurados e inexistentes | warning + auto-descubrimiento | error | **error en ambos** (una ruta configurada inexistente es config inválida; el auto-descubrimiento solo aplica cuando no se configuró nada) |

Casos que permanecen como **warning en ambos** (no rompen el build): `date` sin formato ISO, campos de frontmatter ignorados por el pipeline, `lua-filters` inexistentes, documentos sin título o sin contenido.

---

## API programática

El proyecto expone algunas funciones como API estable para scripting. **Todo lo demás son internos** y pueden cambiar sin aviso mientras la versión sea < 1.0.0.

### `build(cwd, options)` — `src/builder/orchestrator.ts`

Ejecuta el build completo (discovery → pipeline → assets).

```typescript
import { build } from './src/builder/orchestrator.js';

await build('/ruta/al/proyecto', { full: true });
```

Opciones (`BuildOptions`):

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `outputDir` | `string` | Directorio de salida (default: `dist/files`).
| `full` | `boolean` | Build completo desde cero: elimina salida y caché.
| `verbose` | `boolean` | Salida verbose del tracker.

### `loadSiteConfig(cwd)` — `src/config/config-loader.ts`

Carga y valida `iteraciones.config.yaml` aplicando defaults. Retorna un objeto tipado como `SiteConfig` (derivado del schema Zod).

```typescript
import { loadSiteConfig } from './src/config/config-loader.js';

const config = await loadSiteConfig('/ruta/al/proyecto');
console.log(config.format.html?.title);
```

### `discover(cwd, options)` — `src/builder/discover.ts`

Fase 1 del pipeline: escanea los `.md` del proyecto, detecta cambios contra la caché content-addressed (mtime+size+hash) y resuelve slugs. Retorna los paths relativos, los modificados y el índice de discovery.

```typescript
import { discover } from './src/builder/discover.js';

const { relativePaths, changedPaths, discoveryIndex } = await discover('/ruta/al/proyecto');
```

### `splitFrontmatter(content)` — `src/lib/frontmatter.ts`

Separa el frontmatter YAML del body de un documento Markdown.

```typescript
import { splitFrontmatter } from './src/lib/frontmatter.js';

const { yaml, body } = splitFrontmatter('---\ntitle: Mi documento\n---\n\nContenido.');
```

### Convención

Ninguna de estas funciones escribe en `stdout`/`stderr` por sí misma (excepto los warnings de `discover` vía logger): el CLI es el responsable de la presentación. Para integrar el pipeline en otra herramienta, usar estas funciones directamente con el manejo de errores propio.

### Límites del estado por proceso

La API programática es segura para llamadas repetidas a `build()` en el mismo proceso, con dos salvedades documentadas:

- Los **registros por build** (p. ej. el Set de langs advertidos por `babelOptionsForLang`) viven en el contexto del build (`RenderContext.warnedLangs`): cada llamada a `build()` emite sus propios warnings, sin supresión entre llamadas.
- Los **caches de nombres derivados del filesystem** (`builtinNamesCache` en `filter-resolver.ts`, `builtinPreambleNames` en `preamble-loader.ts`) se memoizan por proceso: asumen que los resources del paquete no cambian durante la vida del proceso. Son invariantes del runtime: si un host de la API modificara los resources entre llamadas, debería recargar el proceso.

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

El pipeline convierte archivos Markdown en documentos en los formatos configurados. Se ejecuta en 5 fases principales:

```
┌─────────────┐
│  FASE 1     │  discover()
│  Discovery   │  • Escanea archivos .md con Bun.Glob
│             │  • Compara mtime contra el build anterior
│             │  • Lee frontmatter (title, author)
│             │  • Calcula slugs (con manejo de duplicados)
│             │  • Detecta archivos nuevos, modificados y eliminados
└──────┬──────┘
       │ allDocs[]
       ▼
┌─────────────┐
│  FASE 2+3   │  renderLatex()
│  Render     │  • Transpilers semánticos string (regex)
│             │  • pandoc --to json → AST canónico
│             │  • Serializa el AST a disco (.iteraciones/ast/)
│             │  • pandoc --from json --to latex → .tex (si LaTeX/PDF activos)
│             │  • pandoc --from json --to html5 → .html fragment (si HTML activo)
└──────┬──────┘
       │ pipelineDocs[]
       ▼
┌─────────────────────────────────────────────┐
│  FASE 4              4 ramas en Promise.all │
│  Exportación                                 │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Markdown │ │  HTML    │ │  EPUB    │    │
│  │(json→md) │ │(fragment→│ │(json→    │    │
│  │          │ │ template)│ │ epub3)   │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │  LaTeX → PDF (secuencial)           │   │
│  │  • generateLatexPreamble()          │   │
│  │  • latexmk -pdf (con biber)         │   │
│  │  • Semáforo: CPU-1 instancias       │   │
│  └──────────────────────────────────────┘   │
└───────────────────┬─────────────────────────┘
                    │ formats/
                    ▼
┌─────────────┐
│  Build Assets │  buildAssets()
│  CSS+Fonts   │  • Tailwind CSS (bun x @tailwindcss/cli)
│             │  • Copia fonts y logo a dist/
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  FASE 5     │  copyToDist()
│  Copia      │  • Copia de .iteraciones/formats/ a dist/files/
│             │  • Solo formatos activos
└─────────────┘
```

### Flujo de datos

```
Archivo .md
  │
  ▼
Frontmatter YAML        → SiteConfig (Zod schema)
  │
  ▼
Body Markdown
  │
  ▼
Transpilers semánticos string → Transformaciones regex
  │                              (:: → Div.spacer, etc.)
  ▼
pandoc --to json        → AST JSON
  │
  ▼
Transpilers semánticos ast → AST canónico
  │                          (Div.dictum/verse/spacer… sin formato)
  │
  ▼
AST canónico (memoria + .iteraciones/ast/{slug}.json)
  │
  ├─ pandoc --from json --to latex   → .tex (LaTeX/PDF)
  ├─ pandoc --from json --to html5   → .html fragment (HTML)
  ├─ pandoc --from json --to epub3   → .epub (EPUB)
  └─ pandoc --from json --to markdown → .md (Markdown)
```

---

## Sistema de transpilers

Los transpilers son módulos ESM que transforman el contenido. Se organizan en **capas** (decisión D1):

1. **Capa semántica** (`semantic/`) — corre una vez y deja el **AST canónico** sin contenido de formato específico: `::` → `Div.spacer`, `:;` → `Div.spacer noindent`. Los `Div.dictum/verse/center/flushright` quedan sin transformar.
2. **Capa de formato** (`latex/`, `html/`) — corre en cada exportación y convierte los nodos semánticos a su formato (RawBlocks de apertura/cierre alrededor de los bloques nativos).

Además, existen los **preamble transpilers** (`lib/resources/preamble/*.tex`) que modifican el preámbulo LaTeX.

### Transpilers integrados

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

### Preamble transpilers integrados

| Nombre | Archivo | Propósito |
|--------|---------|-----------|
| 01-maketitle-patches | `lib/resources/preamble/01-maketitle-patches.tex` | Personaliza `\maketitle` |
| 02-environments | `lib/resources/preamble/02-environments.tex` | Redefine center/flushright sin espacio extra |
| 03-toc-styling | `lib/resources/preamble/03-toc-styling.tex` | Estilo del índice |
| 04-toc-section | `lib/resources/preamble/04-toc-section.tex` | TOC como `\section*` |
| 05-bibliography-heading | `lib/resources/preamble/05-bibliography-heading.tex` | Título de bibliografía como section |
| 06-hyphenation-rules | `lib/resources/preamble/06-hyphenation-rules.tex` | Reglas de partición de palabras |

### Extensibilidad

- Un transpiler del proyecto con el mismo nombre completo (p. ej. `<proyecto>/transpilers/latex/02-dictum.ts`) reemplaza al del paquete (override).
- Para desactivar uno se usa `disabled-transpilers` (nombres completos, p. ej. `latex/02-dictum`) en `_iteraciones.yaml`.
- Los preamble transpilers del proyecto (`<proyecto>/preamble/<nombre>.tex`) reemplazan a los del paquete; se desactivan con `disabled-preamble-transpilers`.

---

## Sistema de caché (build incremental)

El build incremental evita reprocesar documentos que no han cambiado:

1. **state.json** (`.iteraciones/changes/`): guarda el timestamp del build anterior y los metadatos de cada archivo (title, author, slug)
2. **Detección por mtime**: cada archivo .md se compara contra el timestamp del build anterior
3. **Formatos activos**: si cambia la configuración de formatos entre builds, se fuerza el reprocesamiento completo
4. **Slugs duplicados**: contador persistente para slugs con sufijo `-dN`
5. **AST canónico** (`.iteraciones/ast/{slug}.json`): el AST de pandoc (JSON nativo, sin contenido de formato) se serializa en cada render. Cuando se activa un formato nuevo, sus salidas se exportan desde el AST en disco sin re-ejecutar markdown → json; si no hay AST (primer build o caché limpiada), el documento vuelve al pipeline completo.

Solo los documentos modificados (o con slug cambiado) pasan por el pipeline completo. El resto se copia desde el caché.

---

## Sistema de configuración

La configuración se lee de `_iteraciones.yaml` y se valida con **Zod**:

```yaml
site:
  title: "Mi sitio"
  tagline: "escribir, compartir, re-existir"
  lang: es-MX

format:
  latex: true
  pdf:
    generate: false
    # ... 30+ campos tipográficos
  html:
    generate: false
    theme: dark
    accent: lime
  epub:
    generate: false
  markdown:
    generate: false

disabled-transpilers: []
disabled-preamble-transpilers: []
```

El esquema Zod (`config-schema.ts`) aplica defaults para todos los campos, valida tipos, y transforma claves kebab-case a camelCase para las interfaces TypeScript.

### PdfFormatConfig (30+ campos)

La configuración PDF es la más compleja e incluye:

| Grupo | Campos | Propósito |
|-------|--------|-----------|
| Clase | `documentclass` | Clase KOMA-Script (scrartcl, scrbook) |
| Paquetes | `geometry`, `babel`, `hyperref`, `microtype` | Opciones de paquetes LaTeX |
| Fuente | `mathptmx` | Times New Roman |
| Interlineado | `setspace`, `setstretch` | Espaciado entre líneas |
| Guiones | `pretolerance`, `tolerance`, `hyphenpenalty` | Control de partición |
| Composición | `raggedbottom`, `widowpenalty` | Control de páginas |
| Secciones | `sectioning` | Estilo de part, chapter, section |
| Epígrafes | `dictum` | Configuración de dictum |
| Portada | `setkomafont` | Fuentes de maketitle |
| Extras | `eso-pic`, `pdfx`, `crop` | Funcionalidades adicionales |

---

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
| `orchestrator.ts` | `build()`: coordina las 5 fases del pipeline. Función principal de ~260 líneas. |
| `discover.ts` | Fase 1: escanea archivos, lee frontmatter, detecta cambios. |
| `render.ts` | Fase 2+3: transpilers + conversión pandoc a LaTeX y HTML. |
| `build-utils.ts` | Assets CSS (Tailwind), fonts, logo. Template HTML + renderizado. |
| `latex-preamble.ts` | Construcción del preámbulo LaTeX. |
| `types.ts` | BuildDocument, Frontmatter, BuildContext. |
| `export/runner.ts` | Ejecuta exportación a PDF, EPUB, Markdown con concurrencia limitada. |
| `export/assemble.ts` | Ensambla ExportDocument desde BuildDocument. |
| `load-modules.ts` | Carga dinámica ESM de transpilers con override del proyecto. |

### `src/config/`

| Archivo | Responsabilidad |
|---------|----------------|
| `config-schema.ts` | Esquemas Zod para toda la configuración. |
| `config-loader.ts` | Carga y valida `_iteraciones.yaml`. ~76 líneas. |
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

### ¿Por qué Bun?

- **Sin Node.js**: Bun es runtime + package manager + test runner + bundler. Una sola dependencia.
- **TypeScript nativo**: sin transpilación, sin tsconfig complejo.
- `Bun.file()` / `Bun.write()`: API moderna para I/O de archivos.
- `Bun.spawn()`: invocación de procesos con pipes.
- `Bun.Glob`: globbing nativo sin dependencias.
- `bun test`: test runner integrado, API compatible con Jest.

### ¿Por qué el pipeline está en fases paralelas?

Los formatos de salida son independientes entre sí (excepto PDF que necesita LaTeX). La FASE 4 ejecuta HTML, EPUB, Markdown y PDF en 4 ramas paralelas con `Promise.all()`, reduciendo el tiempo total de build.

PDF tiene un semáforo que limita las instancias de `latexmk` a `CPU - 1` porque cada instancia consume ~300-600 MB de RAM.

### ¿Por qué Zod en lugar de parseo manual?

El archivo `config-loader.ts` pasó de **469 a 76 líneas** (-84%) al reemplazar el parseo manual campo por campo con esquemas Zod. Beneficios:
- Mensajes de error descriptivos automáticos
- Validación de tipos en runtime
- Defaults declarativos con `.default()`
- Documentación viva del esquema

### ¿Por qué no hay plugins/tipos de documento/paginación?

El proyecto comenzó con una arquitectura muy ambiciosa (plugins ESM, 8 tipos de documento, paginación, temas, layouts) que fue simplificada drásticamente entre v0.8 y v0.10. La eliminación de ~3000+ líneas de código muerto mejoró la mantenibilidad, velocidad y predictibilidad del pipeline. Ver `CHANGELOG.md` para los detalles de cada release.

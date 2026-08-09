# Contribuyendo a iteraciones-cli

Gracias por tu interés en contribuir. Este documento describe cómo configurar el entorno, las convenciones del proyecto y el proceso para enviar cambios.

## Requisitos

- [Bun](https://bun.sh) ≥ 1.0 — runtime, package manager, test runner y bundler
- [Pandoc](https://pandoc.org/installing.html) — conversión de documentos, debe estar disponible en `PATH`
- (Opcional) [MacTeX](https://tug.org/mactex/) o TeX Live — para exportación PDF con LaTeX

## Configuración del entorno

```bash
git clone git@github.com:dcruzgalicia/iteraciones-cli.git
cd iteraciones-cli
bun install
```

Verifica que todo funcione:

```bash
bun run typecheck   # tsc --noEmit
bun test            # bun test (304 tests en 18 archivos)
bun run src/bin.ts build --project-root /ruta/a/proyecto
```

Los hooks de pre-commit (Husky + lint-staged) ejecutan Biome, typecheck y tests automáticamente antes de cada commit.

## Estructura del proyecto

```
src/
├── bin.ts                   # Entry point (#!/usr/bin/env bun)
├── __tests__/               # Tests unitarios (bun test)
├── builder/                 # Pipeline de construcción
│   ├── orchestrator.ts      # Orquestador principal (build())
│   ├── discover.ts          # Fase 1: discovery y detección de cambios
│   ├── render.ts            # Fase 2+3: filtros Lua + conversión pandoc
│   ├── cleanup.ts           # Limpieza de archivos (formatos, caché, slugs)
│   ├── build-assets.ts      # Assets (CSS, fuentes, logo)
│   ├── latex-preamble.ts    # Constructor de preámbulo LaTeX
│   ├── preamble-loader.ts   # Carga de preamble filters (.tex)
│   ├── build-planner.ts     # Planificador: metadatos de invalidación
│   ├── state.ts             # Caché content-addressed (state.json)
│   ├── pipeline.ts          # Pipeline por documento (pools 1 y 2)
│   ├── pdf-pool.ts          # Pool consumidor de compilación PDF
│   ├── gitignore.ts         # Reglas de .gitignore y paths ocultos
│   ├── slug-resolver.ts     # Resolución de slugs y colisiones
│   ├── types.ts             # BuildDocument, Frontmatter, BuildContext
│   └── export/              # Exportación a PDF, EPUB, Markdown
│       ├── runner.ts        # Ejecutor de exportación
│       ├── assemble.ts      # Ensamblado de ExportDocument
│       └── types.ts         # ExportDocument, ExportMetadata
├── cli/                     # Interface de línea de comandos
│   ├── parser.ts            # Definición de comandos (Commander)
│   ├── dispatcher.ts        # Handlers de comandos
│   ├── progress.ts          # ProgressTracker (salida en terminal)
│   ├── init.ts              # Comando init
│   ├── doctor.ts            # Comando doctor
│   ├── doctor/system-checks.ts  # Verificaciones del sistema
│   ├── validate.ts          # Comando validate
│   └── filters.ts         # Comando filters
├── config/                  # Configuración del sitio
│   ├── config-loader.ts     # Carga de iteraciones.config.yaml
│   ├── config-schema.ts     # Esquemas Zod de validación
│   └── site-config.ts       # Tipos y defaults de SiteConfig
└── lib/                     # Utilidades compartidas
    ├── errors.ts            # Clases de error (PandocError, ConfigError)
    ├── logger.ts            # Funciones helper para mensajes (logError, logWarning)
    ├── pandoc-runner.ts     # Invocación de pandoc
    ├── run.ts               # mapWithConcurrency y utilidades de procesos
    └── resources/           # Recursos empaquetados
        ├── filters/     # Filtros Lua por capa (semantic/, latex/, html/)
        ├── preamble/        # Preamble filters (.tex)
        ├── template.html    # Template HTML (sistema de templates de pandoc)
        ├── styles.css       # CSS entry point de Tailwind
        ├── fonts/           # Fuentes para HTML
        ├── logo.svg         # Logo por defecto
        └── apa-7.csl        # Estilo de citas APA 7ª edición
```

### Pipeline de construcción

```
discover → runDocumentPipeline (AST → LaTeX/HTML/EPUB/Markdown/PDF) → copyToDist
```

El pipeline por documento usa dos pools: el pool 1 genera los formatos ligeros y encola el PDF; el pool 2 compila PDF en paralelo. Ver `orchestrator.ts` para la secuencia completa.

## Commits

Este proyecto utiliza **Conventional Commits** con **scope obligatorio**.

### Formato

```
tipo(scope): verbo en imperativo
```

### Tipos válidos

`feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`

### Scopes activos

`builder`, `cache`, `cli`, `config`, `css`, `export`, `frontmatter`, `orchestrator`, `preamble`, `render`, `state`

### Ejemplos

```
feat(filter): agrega filtro Lua para Div.nota
fix(cache): agrega separador \0 en hash() para evitar colisiones
refactor(cli): extrae reportBuildError para evitar duplicación
docs(config): documenta bloque editorial y export en frontmatter
```

### Reglas

- Primer commit del branch debe cerrar el issue: incluir `Closes #número`
- Verbos en español, imperativo: `agrega`, `corrige`, `elimina` (no `agregar`, `corregir`, `eliminar`)
- Un solo propósito por commit
- No usar `BREAKING CHANGE` mientras la versión sea < 1.0.0

## Proceso de PR

1. **Crea un issue** antes de empezar a trabajar (si no existe ya)
2. **Crea una rama** desde `main` actualizado:
   ```bash
   git checkout main && git pull
   git checkout -b <número>-<descripción-en-kebab-case>
   ```
   Ejemplo: `205-fix-sidebar-pagination`, `310-refactor-pandoc-pipeline`

3. **Desarrolla** con commits atómicos (un propósito por commit)

4. **Sincroniza** antes de push:
   ```bash
   git fetch origin
   git rebase origin/main
   bun run typecheck
   bun test
   ```

5. **Abre el PR**:
   ```bash
   git push -u origin <rama>
   gh pr create --title "..." --body "..."
   ```
   El PR debe:
   - Referenciar el issue (`Closes #número`)
   - Explicar los cambios realizados
   - Indicar riesgos conocidos
   - Mencionar decisiones de diseño relevantes

6. **Espera revisión** — no hacer merge inmediato

7. **Responde comentarios** — cada observación debe recibir respuesta explícita

## Convenciones de código

- **Runtime:** Bun APIs (`Bun.file()`, `Bun.write()`, `Bun.spawn()`) para I/O. Solo usar `node:fs/promises` para operaciones de sistema (mkdir, rm).
- **TypeScript:** `verbatimModuleSyntax: true` — usar `import type` para solo tipos. Imports con extensión `.js`.
- **Nombrado:** archivos en `kebab-case.ts`, funciones en `camelCase`, tipos/interfaces en `PascalCase`.
- **Errores:** Usar `logError()` / `logWarning()` de `src/lib/logger.ts`. No usar `console.error`.
- **Tests:** `bun test`. Los tests deben ser independientes y no requerir pandoc a menos que sea estrictamente necesario.
- **Linting:** Biome (espacios, `lineWidth: 150`, comillas simples). Se ejecuta automáticamente en pre-commit.

## Cómo invalidar la caché de outputs

El hash de filters (`computeFiltersHash` en `src/builder/state.ts`) incluye las versiones de esquema de `CACHE_SCHEMA_VERSIONS`. **Sube la versión de un área cuando cambie su lógica de generación**; si no lo haces, los outputs cacheados (HTML, cuerpos LaTeX) quedan obsoletos silenciosamente:

- `humanDate`: cambios en `src/lib/date.ts` (formato de fecha legible).
- `htmlBlocks`: cambios en la generación de la página HTML (`src/builder/pipeline.ts`) o en el ensamblado de bloques del masonry (`src/builder/html-blocks.ts` / el post-procesamiento de `render.ts`).
- `linkCitations`: cambios en el enlazado de citas del HTML.

Los cambios en el template HTML, en los archivos `.tex` de recursos y en `format.html.blocks` no requieren bump: ya participan en los hashes de configuración y de filters.

## Cómo regenerar el CSS base

El CSS base embarcado vive en `src/lib/resources/css/base.css` (compilado desde `src/lib/resources/styles.css` con Tailwind). La paleta de acentos (`src/lib/accent-palettes.ts`) se ensambla sobre el base en tiempo de build (`base.css` + bloque de variables del acento) — no hay un CSS por acento. Cuando cambies `styles.css`, el template HTML (`src/lib/resources/template.html`) o las clases del post-procesamiento de `render.ts`, regenera:

```bash
bun run scripts/generate-css.ts
```

El test `src/__tests__/css-integrity.test.ts` regenera el CSS de `lime` y lo compara byte a byte con el embarcado: falla si los inputs cambiaron sin regenerar.

## Cómo agregar un filter

Los filters son **filtros Lua** que corren dentro de las invocaciones de pandoc (vía `--lua-filter`). Se organizan en **capas**:

| Capa | Ubicación | Cuándo corre | Ejemplos |
|------|-----------|--------------|----------|
| `semantic/string` | `src/lib/resources/filters/semantic/string/` | En `markdown → json`, antes del parseo | `01-double-colon` (`::` → `Div.spacer`) |
| `semantic/ast` | `src/lib/resources/filters/semantic/ast/` | En `markdown → json`, después del parseo | `02-double-colon-noindent` (`:;` → `Div.spacer noindent`) |
| `latex/` | `src/lib/resources/filters/latex/` | En `json → latex` | `02-dictum`, `03-verse`, `06-mbox-sentence-end` |
| `html/` | `src/lib/resources/filters/html/` | En `json → html5` | `01-dictum`, `02-verse`, `05-spacer` |

Para agregar uno:

1. Crea un archivo en `src/lib/resources/filters/<capa>/<prioridad>-<nombre>.lua`
   - El prefijo numérico (`01-`, `02-`, …) define el **orden de ejecución** dentro de la capa
   - El **nombre completo** es `<capa>/<prioridad>-<nombre>` (ej: `latex/02-dictum`); es el que se usa en `disabled-filters` y se muestra en `iteraciones filters`
2. Escribe la primera línea como comentario `-- descripción corta`: se muestra en `iteraciones filters` (la lee `getBuiltinLuaFilterInfos()`)
3. Implementa las funciones de filtro de pandoc (`Pandoc(doc)`, `Div(div)`, `Para(para)`, etc.) que transforman el AST
4. Agrega tests en `src/__tests__/lua-filters.test.ts` (los tests que invocan pandoc requieren que esté instalado; los de resolución de nombres no)

> La lista de filters se deriva del filesystem (`getBuiltinLuaFilterInfos()` en `src/builder/render.ts`): crear el `.lua` es suficiente, no hay que registrar el nombre en ninguna lista. La descripción que muestra `iteraciones filters` es la primera línea de comentario del archivo (punto 2).

### Ejemplo mínimo

```lua
-- Convierte Div.nota en una nota destacada (formato LaTeX)
function Div(div)
  if not div.classes:includes('nota') then return nil end
  if FORMAT == 'latex' then
    return pandoc.RawBlock('latex', '\\fbox{Nota}')
  elseif FORMAT == 'html5' then
    return pandoc.RawBlock('html', '<aside class="nota">Nota</aside>')
  end
  return nil
end
```

La variable global `FORMAT` de pandoc indica el formato de salida (`latex`, `html5`, `epub3`, `markdown`, `json`), lo que permite que un mismo filtro ramifique su comportamiento.

### Sobrescribir y desactivar

- Un proyecto puede sobrescribir un filter creando `<proyecto>/filters/<capa>/<nombre>.lua` (mismo nombre completo que el del paquete)
- Un proyecto puede desactivar uno con `disabled-filters:` en `iteraciones.config.yaml` (nombres completos)
- Los filtros de usuario se agregan con `lua-filters:` en `iteraciones.config.yaml` y corren en todas las invocaciones pandoc

## Cómo agregar un preamble filter

Los preamble filters son archivos `.tex` con contenido LaTeX puro que se inserta en el preámbulo antes de `\begin{document}`. Se editan como LaTeX, sin escaping de strings TypeScript.

1. Crea un archivo en `src/lib/resources/preamble/<prioridad>-<nombre>.tex`
2. Escribe la primera línea como comentario `% descripción corta`: se muestra en `iteraciones filters` (la lee `getBuiltinPreambleFilterInfos()`)

> La lista de preamble filters se deriva del filesystem (`getBuiltinPreambleFilterNames()` en `src/builder/preamble-loader.ts`): el prefijo numérico del archivo define el orden de aplicación y crear un `.tex` nuevo no requiere tocar código.

Un proyecto puede sobrescribir un preamble filter creando `<proyecto>/preamble/<nombre>.tex`, o desactivarlo con `disabled-preamble-filters:` en `iteraciones.config.yaml`.

## Reportar bugs

Si encuentras un error:

1. Verifica que no haya un issue abierto ya reportándolo
2. Incluye:
   - Versión del CLI (`iteraciones --version`)
   - Sistema operativo y versión de Bun (`bun --version`)
   - `iteraciones.config.yaml` (sin información sensible)
   - Salida completa del comando (usa `--verbose` si aplica)
   - Comportamiento esperado vs. real

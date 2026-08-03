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
bun test            # bun test (126+ tests)
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
│   ├── build-utils.ts       # Assets (CSS, fonts, logo) y preámbulo LaTeX
│   ├── latex-preamble.ts    # Constructor de preámbulo LaTeX
│   ├── types.ts             # BuildDocument, Frontmatter, contextos
│   ├── preamble-loader.ts   # Carga de preamble transpilers (.tex)
│   ├── state.ts             # Caché content-addressed (state.json, hashes)
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
│   ├── config-loader.ts     # Carga de _iteraciones.yaml
│   ├── config-schema.ts     # Esquemas Zod de validación
│   └── site-config.ts       # Tipos y defaults de SiteConfig
└── lib/                     # Utilidades compartidas
    ├── errors.ts            # Clases de error (PandocError, ConfigError)
    ├── logger.ts            # Funciones helper para mensajes (logError, logWarning)
    ├── pandoc-runner.ts     # Invocación de pandoc
    ├── run.ts               # mapWithConcurrency y utilidades de procesos
    └── resources/           # Recursos empaquetados
        ├── transpilers/     # Filtros Lua por capa (semantic/, latex/, html/)
        ├── preamble/        # Preamble transpilers (.tex)
        ├── template.html    # Template HTML (sistema de templates de pandoc)
        ├── styles.css       # CSS entry point de Tailwind
        ├── fonts/           # Fuentes para HTML
        ├── logo.svg         # Logo por defecto
        └── apa-7.csl        # Estilo de citas APA 7ª edición
```

### Pipeline de construcción

```
discover → renderLatex → export (PDF, HTML, EPUB, MD) → copyToDist
```

Las fases se ejecutan en paralelo cuando es posible (FASE 4). Ver `orchestrator.ts` para la secuencia completa.

## Commits

Este proyecto utiliza **Conventional Commits** con **scope obligatorio**.

### Formato

```
tipo(scope): verbo en imperativo
```

### Tipos válidos

`feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`

### Scopes activos

`builder`, `cache`, `cli`, `config`, `css`, `export`, `frontmatter`, `loader`, `orchestrator`, `pagination`, `plugin`, `template`, `theme`

### Ejemplos

```
feat(transpiler): agrega filtro Lua para Div.nota
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

## Cómo agregar un transpiler

Los transpilers son **filtros Lua** que corren dentro de las invocaciones de pandoc (vía `--lua-filter`). Se organizan en **capas**:

| Capa | Ubicación | Cuándo corre | Ejemplos |
|------|-----------|--------------|----------|
| `semantic/string` | `src/lib/resources/transpilers/semantic/string/` | En `markdown → json`, antes del parseo | `01-double-colon` (`::` → `Div.spacer`) |
| `semantic/ast` | `src/lib/resources/transpilers/semantic/ast/` | En `markdown → json`, después del parseo | `02-double-colon-noindent` (`:;` → `Div.spacer noindent`) |
| `latex/` | `src/lib/resources/transpilers/latex/` | En `json → latex` | `02-dictum`, `03-verse`, `06-mbox-sentence-end` |
| `html/` | `src/lib/resources/transpilers/html/` | En `json → html5` | `01-dictum`, `02-verse`, `05-spacer` |

Para agregar uno:

1. Crea un archivo en `src/lib/resources/transpilers/<capa>/<prioridad>-<nombre>.lua`
   - El prefijo numérico (`01-`, `02-`, …) define el **orden de ejecución** dentro de la capa
   - El **nombre completo** es `<capa>/<prioridad>-<nombre>` (ej: `latex/02-dictum`); es el que se usa en `disabled-transpilers` y se muestra en `iteraciones filters`
2. Escribe la primera línea como comentario `-- descripción corta`: se muestra en `iteraciones filters` (la lee `getBuiltinLuaTranspilerInfos()`)
3. Implementa las funciones de filtro de pandoc (`Pandoc(doc)`, `Div(div)`, `Para(para)`, etc.) que transforman el AST
4. Agrega el nombre del archivo a la lista `BUILTIN_*` correspondiente en `src/builder/render.ts` (`BUILTIN_SEMANTIC_STRING`, `BUILTIN_SEMANTIC_AST`, `BUILTIN_LATEX_TRANSPILERS`, `BUILTIN_HTML_TRANSPILERS`)
5. Agrega tests en `src/__tests__/lua-filters.test.ts` (los tests que invocan pandoc requieren que esté instalado; los de resolución de nombres no)

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

- Un proyecto puede sobrescribir un transpiler creando `<proyecto>/transpilers/<capa>/<nombre>.lua` (mismo nombre completo que el del paquete)
- Un proyecto puede desactivar uno con `disabled-transpilers:` en `_iteraciones.yaml` (nombres completos)
- Los filtros de usuario se agregan con `lua-filters:` en `_iteraciones.yaml` y corren en todas las invocaciones pandoc

## Cómo agregar un preamble transpiler

Los preamble transpilers son archivos `.tex` con contenido LaTeX puro que se inserta en el preámbulo antes de `\begin{document}`. Se editan como LaTeX, sin escaping de strings TypeScript.

1. Crea un archivo en `src/lib/resources/preamble/<prioridad>-<nombre>.tex`
2. Agrega el nombre a `BUILTIN_PREAMBLE_TRANSPILERS` en `src/builder/preamble-loader.ts` (la lista define el orden de aplicación)
3. Agrega una descripción a `DESCRIPTIONS` en el mismo archivo (se muestra en `iteraciones filters`)

Un proyecto puede sobrescribir un preamble transpiler creando `<proyecto>/preamble/<nombre>.tex`, o desactivarlo con `disabled-preamble-transpilers:` en `_iteraciones.yaml`.

## Reportar bugs

Si encuentras un error:

1. Verifica que no haya un issue abierto ya reportándolo
2. Incluye:
   - Versión del CLI (`iteraciones --version`)
   - Sistema operativo y versión de Bun (`bun --version`)
   - `_iteraciones.yaml` (sin información sensible)
   - Salida completa del comando (usa `--verbose` si aplica)
   - Comportamiento esperado vs. real

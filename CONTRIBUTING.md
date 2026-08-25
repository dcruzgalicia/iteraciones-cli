# Contribuyendo a iteraciones-cli

Gracias por tu interés en contribuir. Este documento describe cómo configurar el entorno, las convenciones del proyecto y el proceso para enviar cambios.

## Requisitos

- [Bun](https://bun.sh) ≥ 1.2.0 — runtime, package manager, test runner y bundler
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
bun test            # suite completa
bun run src/bin.ts build --project-root /ruta/a/proyecto
```

Los hooks de Husky ejecutan Biome (lint-staged) y typecheck automáticamente antes de cada commit; la suite completa de tests (`bun test`) corre en el hook de pre-push, antes de publicar la rama.

## Estructura del proyecto

src/
├── bin.ts                   # Entry point (#!/usr/bin/env bun)
├── __tests__/               # Tests unitarios (bun test)
├── builder/                 # Pipeline de construcción
│   ├── orchestrator.ts      # Orquestador principal (build())
│   ├── build-planner.ts     # Planificador: metadatos de invalidación
│   ├── discover.ts          # Fase 1: discovery y detección de cambios
│   ├── slug-resolver.ts     # Resolución de slugs y colisiones
│   ├── render.ts            # Conversión markdown → HTML (htmlPageFromMarkdown)
│   ├── filter-resolver.ts    # Resolución y validación de filtros Lua
│   ├── html-composer.ts      # Template HTML, masonry, extracción de referencias
│   ├── latex-composer.ts     # Generación LaTeX y fecha de portada PDF
│   ├── latex-preamble.ts    # Constructor de preámbulo LaTeX
│   ├── preamble-loader.ts   # Carga de preamble filters (.tex)
│   ├── cleanup.ts           # Limpieza de archivos (formatos, caché, slugs)
│   ├── build-assets.ts      # Assets (CSS, fuentes, logo)
│   ├── state.ts             # Re-exports del estado del build (caché)
│   ├── state-serialize.ts   # state.json (lectura/escritura atómica)
│   ├── state-hash.ts        # Hashes de invalidación (CACHE_SCHEMA_VERSIONS)
│   ├── state-bib.ts         # Caché de bibliografía (.bib/.csl)
│   ├── pipeline.ts          # Pipeline por documento (pools 1 y 2)
│   ├── pdf-pool.ts          # Pool consumidor de compilación PDF
│   ├── gitignore.ts         # Reglas de .gitignore y paths ocultos
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
│   └── filters.ts           # Comando list-filters
├── config/                  # Configuración del sitio
│   ├── config-loader.ts     # Carga de iteraciones.config.yaml
│   ├── config-schema.ts     # Esquemas Zod de validación
│   └── site-config.ts       # Tipos y defaults de SiteConfig
└── lib/                     # Utilidades compartidas
    ├── errors.ts            # Clases de error (PandocError, ConfigError, BuildError)
    ├── logger.ts            # Funciones helper para mensajes (logError, logWarning)
    ├── pandoc-runner.ts     # Invocación de pandoc
    ├── run.ts               # mapWithConcurrency y utilidades de procesos
    ├── resources/           # Recursos empaquetados
    │   ├── filters/         # Filtros Lua por capa (semantic/, latex/, html/)
    │   ├── preamble/        # Preamble filters (.tex)
    │   ├── html/            # Plantillas del HTML (skeleton + tarjetas)
    │   ├── styles.css       # CSS entry point de Tailwind
    │   ├── fonts/           # Fuentes para HTML
    │   ├── logo.svg         # Logo por defecto
    │   └── apa-7.csl        # Estilo de citas APA 7ª edición
```

### Pipeline de construcción

```
discover → runDocumentPipeline (markdown → latex/html5/epub3/markdown, templates efectivos) → buildAssets
```

El pipeline por documento usa dos pools: el pool 1 genera los formatos ligeros con invocaciones directas de pandoc y encola el PDF; el pool 2 compila PDF en paralelo. Los formatos se escriben directamente en `dist/files/` (sin staging intermedio). Ver `orchestrator.ts` para la secuencia completa.

## Commits

Este proyecto utiliza **Conventional Commits** con **scope obligatorio**.

### Formato

```
tipo(scope): verbo en imperativo
```

### Tipos válidos

`feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`

### Scopes activos

`builder`, `cache`, `cli`, `cleanup`, `commitlint`, `config`, `css`, `discover`, `export`, `frontmatter`, `github`, `html`, `init`, `latex`, `orchestrator`, `pipeline`, `preamble`, `progress`, `render`, `state`, `test`

### Ejemplos

```
feat(html): agrega filtro Lua para Div.nota
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
- **Nombrado:** archivos en `kebab-case.ts`, funciones en `camelCase`, tipos/interfaces en `PascalCase`. Prefijos: `run*` (handlers de comandos CLI), `exec*` (ejecución de procesos con captura de salida), `check*` (checks de doctor con `CheckResult`), `get*` (lectores simples), `build*` (constructores de contexto) y `resolve*` (path resolvers).
- **Errores:** Usar `logError()` / `logWarning()` de `src/lib/logger.ts`. No usar `console.error`.
- **Tests:** `bun test`. Los tests deben ser independientes y no requerir pandoc a menos que sea estrictamente necesario. La suite completa (incluidos `cli-layer` y `lua-filters`) requiere pandoc instalado; sin él, los tests que lo necesitan se marcan como skip y el resto corre.
- **Linting:** Biome (espacios, `lineWidth: 150`, comillas simples). Se ejecuta automáticamente en pre-commit.

## Cómo se invalida la caché de outputs

La invalidación de outputs cacheados es **automática y por contenido**: el hash de filters (`computeFiltersHash` en `src/builder/state-hash.ts`) incluye el contenido de los archivos fuente que gobiernan cada área de generación (`SCHEMA_SOURCE_FILES` en `state-hash.ts` — fecha legible, página HTML, template LaTeX, export Markdown). Si cambia la lógica de un área, las salidas se regeneran en el siguiente build. **No hay versiones de esquema que subir a mano**; los refactors sin efecto en la salida producen una re-renderización conservadora (aceptada: nunca stale).

**Orden de argv de pandoc:** en `htmlPageFromMarkdown` los filtros `--lua-filter` deben ir ANTES de `--citeproc` (el orden de argv determina el orden de aplicación de los filtros). Está protegido por test de regresión: no reordenar.

## Cómo funciona el CSS generado

El CSS final se **compila en cada build con HTML activo** (sin caché): `buildAssets` ejecuta Tailwind con un input efímero que importa `src/lib/resources/styles.css` (fuentes, `@plugin @tailwindcss/typography`, `@custom-variant dark` por `data-theme` y las `@utility` custom) y declara `@source` **solo a los HTML finales de `dist/files`**. El acento configurado se inyecta como `@theme` con los valores directos de `src/lib/accent-palettes.ts` (sin overrides): las utilities `accent-*` se generan con el color real.

Implicaciones:

- El HTML personalizado en Markdown con clases de Tailwind queda estilizado: el scan lee los HTML finales.
- Una clase eliminada de los HTML se purga del CSS en el siguiente build (no hay auto-referencia del CSS previo).
- Los archivos fuera de `dist/files` (o que no sean `.html`) no aportan clases.
- Cuando cambies `styles.css`, el template HTML (`src/lib/resources/html/skeleton.html`) o las clases del post-procesamiento de `html-composer.ts`, no hay que regenerar nada: el próximo build lo recoge.

El test `src/__tests__/css-integrity.test.ts` compila el CSS sobre un fixture controlado y verifica clases presentes/ausentes y el acento aplicado.

## Cómo agregar un filter

Los filters son **filtros Lua** que corren dentro de las invocaciones de pandoc (vía `--lua-filter`). Se organizan en **capas**:

| Capa | Ubicación | Cuándo corre | Ejemplos |
|------|-----------|--------------|----------|
| `semantic/string` | `src/lib/resources/filters/semantic/string/` | En cada conversión (markdown → latex/html5/epub3/markdown), antes del parseo | `01-double-colon` (`::` → `Div.spacer`) |
| `semantic/ast` | `src/lib/resources/filters/semantic/ast/` | En cada conversión, después del parseo | `02-double-colon-noindent` (`:;` → `Div.spacer noindent`) |
| `latex/` | `src/lib/resources/filters/latex/` | En `markdown → latex` | `02-dictum`, `03-verse`, `06-mbox-sentence-end` |
| `html/` | `src/lib/resources/filters/html/` | En `markdown → html5` | `01-dictum`, `02-verse`, `05-spacer` |

Las capas `semantic/` y los filtros de usuario (`lua-filters:`) corren en **todas** las invocaciones de pandoc (latex, html5, epub3 y markdown); las capas `latex/` y `html/` solo en su conversión. Además existe un filtro interno (`internal/flags`) de detección estructural que corre en las pasadas latex y html y expone condiciones al template vía metadata; no es un filter de usuario.

Para agregar uno:

1. Crea un archivo en `src/lib/resources/filters/<capa>/<prioridad>-<nombre>.lua`
   - El prefijo numérico (`01-`, `02-`, …) define el **orden de ejecución** dentro de la capa
   - El **nombre completo** es `<capa>/<prioridad>-<nombre>` (ej: `latex/02-dictum`); es el que se usa en `disabled-filters` y se muestra en `iteraciones list-filters`
2. Escribe la primera línea como comentario `-- descripción corta`: se muestra en `iteraciones list-filters` (la lee `getBuiltinLuaFilterInfos()`)
3. Implementa las funciones de filtro de pandoc (`Pandoc(doc)`, `Div(div)`, `Para(para)`, etc.) que transforman el AST
4. Agrega tests en `src/__tests__/lua-filters.test.ts` (los tests que invocan pandoc requieren que esté instalado; los de resolución de nombres no)

> La lista de filters se deriva del filesystem (`getBuiltinLuaFilterInfos()` en `src/builder/filter-resolver.ts`): crear el `.lua` es suficiente, no hay que registrar el nombre en ninguna lista. La descripción que muestra `iteraciones list-filters` son las líneas de comentario iniciales del archivo (unidas con espacio, punto 2).

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
2. Escribe la primera línea como comentario `% descripción corta`: se muestra en `iteraciones list-filters` (las líneas de comentario iniciales se unen; la lee `getBuiltinPreambleFilterInfos()`)

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

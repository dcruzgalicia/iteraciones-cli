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
bun test            # bun test (89+ tests)
bun run src/bin.ts build --project-root /ruta/a/proyecto
```

Los hooks de pre-commit (Husky + lint-staged) ejecutan Biome, typecheck y tests automáticamente antes de cada commit.

## Estructura del proyecto

```
src/
├── bin.ts                   # Entry point (#!/usr/bin/env bun)
├── builder/                 # Pipeline de construcción
│   ├── orchestrator.ts      # Orquestador principal (build())
│   ├── discover.ts          # Fase 1: discovery y detección de cambios
│   ├── render.ts            # Fase 2+3: transpilers + conversión pandoc
│   ├── build-utils.ts       # Assets (CSS, fonts, logo) y template HTML
│   ├── latex-preamble.ts    # Constructor de preámbulo LaTeX
│   ├── types.ts             # BuildDocument, Frontmatter, contextos
│   ├── load-modules.ts      # Carga dinámica ESM de transpilers
│   ├── transpilers/         # Transpilers string y AST
│   ├── preamble/            # Transpilers de preámbulo LaTeX
│   ├── preamble-loader.ts   # Carga de preamble transpilers
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
│   └── transpilers.ts       # Comando transpilers
├── config/                  # Configuración del sitio
│   ├── config-loader.ts     # Carga de _iteraciones.yaml
│   ├── config-schema.ts     # Esquemas Zod de validación
│   └── site-config.ts       # Tipos y defaults de SiteConfig
└── lib/                     # Utilidades compartidas
    ├── errors.ts            # Clases de error (PandocError, ConfigError)
    ├── logger.ts            # Funciones helper para mensajes (logError, logWarning)
    ├── pandoc-runner.ts     # Invocación de pandoc
    └── run.ts               # mapWithConcurrency y utilidades de procesos
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
feat(plugin): añade hook beforeBuild a IPlugin
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

Los transpilers transforman el contenido Markdown antes de la conversión a LaTeX.

1. Crea un archivo en `src/builder/transpilers/<prioridad>-<nombre>.ts`
2. Exporta:
   - `type`: `'string'` para transformación de texto (regex), o `'ast'` para transformación del AST de pandoc
   - `process(body: string): string` (para string transpilers)
   - `transform(ast): Promise<ast>` (para AST transpilers)
3. Agrega el nombre a `BUILTIN_TRANSPILERS` en `src/builder/render.ts`
4. Agrega descripción y tipo a `getBuiltinTranspilerInfos()` en el mismo archivo
5. Agrega tests en `src/__tests__/transpilers.test.ts`

## Cómo agregar un preamble transpiler

Los preamble transpilers modifican el preámbulo LaTeX.

1. Crea un archivo en `src/builder/preamble/<prioridad>-<nombre>.ts`
2. Exporta:
   - `description: string`
   - `process(preamble: string[], config: PdfFormatConfig): string[]`
3. Agrega el nombre a `BUILTIN_PREAMBLE_TRANSPILERS` en `src/builder/preamble-loader.ts`

## Reportar bugs

Si encuentras un error:

1. Verifica que no haya un issue abierto ya reportándolo
2. Incluye:
   - Versión del CLI (`iteraciones --version`)
   - Sistema operativo y versión de Bun (`bun --version`)
   - `_iteraciones.yaml` (sin información sensible)
   - Salida completa del comando (usa `--verbose` si aplica)
   - Comportamiento esperado vs. real

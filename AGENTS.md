# AGENTS.md

CLI en Bun + TypeScript que construye sitios, libros (PDF/EPUB) y Markdown con pandoc y LaTeX. No hay contenido de ejemplo del producto: el proyecto a construir es otro directorio.

## Comandos

- `bun install` — Bun >= 1.4 (`package.json`). No hay script `lint` ni paso de compilación: se ejecuta desde `src/`.
- `bun run typecheck` — `tsc --noEmit` sobre `src` y `tools`; es rápido.
- `bunx biome check --write <archivos>` — formato y lint (línea de 150, comillas simples). Los hooks lo corren con `--error-on-warnings`.
- `bun tools/gherkin.ts --name "texto del escenario"` — un escenario. `cucumber.json` carga siempre `features/**/*.feature`; pasar un `.feature` suelto no filtra la suite.
- `bun run gherkin` (o `bun test`) — suite completa: ~1,700 escenarios, 6–10 min. Es la única verificación real: GitHub mantiene release-please hasta migrar; GitLab CI corre `typecheck` y publica la imagen de build en tags; la suite completa sigue local/pre-push.
- `bun src/bin.ts <comando>` — ejecuta el CLI de este checkout. `bun src/bin.ts doctor` revisa el entorno.

## Probar el CLI sin el binario global

Las features de `build.sh` invocan `iteraciones` desde `PATH`; un enlace global puede apuntar a otro checkout. Para el worktree:

```sh
mkdir -p /tmp/iteraciones-bin
printf '#!/bin/sh\nexec bun "%s/src/bin.ts" "$@"\n' "$PWD" > /tmp/iteraciones-bin/iteraciones
chmod +x /tmp/iteraciones-bin/iteraciones
PATH="/tmp/iteraciones-bin:$PATH" bun tools/gherkin.ts --name "..."
```

`build [paths...]` es incremental y construye solo esos documentos (una collection arrastra sus `files[]`); `--full` borra `dist/` y `.iteraciones/` y no se combina con paths.

## Arquitectura

- `src/bin.ts` → `src/cli/parser.ts` (commander) → `src/cli/dispatcher.ts` → `src/builder/orchestrator.ts` (discovery, caché, estado) → `src/builder/pipeline.ts` (formatos por documento).
- `src/lib/resources/` es contenido estático que cada build copia o referencia: filtros Lua (`filters/latex`, `filters/html`, `filters/semantic`), preamble `.tex` numerado (el número es el orden de carga; se desactiva por nombre con `disabledPreambleFilters`), plantillas, fuentes, estilos y XMP.
- Salida: `dist/files/` y un solo árbol `assets/` (`images`, `pdf/images`, `css`, `fonts`). No revivas `assets/img`. `.iteraciones/` es caché y estado.
- La documentación de uso es `iteraciones --help` y el `--help` de cada subcomando; no hay README que buscar.
- En `src/` los imports locales llevan `.js` aunque el archivo sea `.ts`; en `src/test/steps/` llevan `.ts`.

## Pruebas

- Gherkin en español (`cucumber.json`, `language: es`). Escenarios en `features/*.feature`; steps en `src/test/steps/*.steps.ts`.
- Los tests crean proyectos temporales y ejecutan pandoc, LaTeX e ImageMagick de verdad; no hay mocks ni red.
- Preflight exige `pandoc`, `latexmk`, `pdflatex`, `magick`, `pdftoppm`, `pdftotext`, `biber`, `unzip`, `git` e `iteraciones-pdfcheck` (Rust o precompilado; sin él la suite no arranca). Para el PDF ligero (sin `99-pdfx`) también `gs`. `minify` es opcional: sin él el HTML sale sin minificar.

## Assets e imágenes

- Una sola salida por fuente y perfil; no generes variantes responsivas.
- Web/EPUB: máximo 1280 px y 25 KB por imagen, salvo `frontCover`/`backCover` (150 dpi y calidad 70).
- PDF/X: 300 dpi y medidas reales en cm.
- PDF ligero: portadas a 150 dpi; `extratitle`/`frontispiece` conservan geometría de página de título; el resto ≤25 KB.
- CSS propio, sin Tailwind.

## Código y documentación

- No agregues comentarios al código.
- No crees documentación manual (README, guías, tutoriales). Solo se versiona `AGENTS.md`; el resto es lo que generan las herramientas (`CHANGELOG.md`, `--help`).

## Git

- Commits atómicos: un cambio lógico por commit.
- Commits conventional con scope obligatorio (`feat|fix|refactor|chore|docs|test|perf|style`).
- Verbo conjugado en imperativo: `crea`, no `crear`.
- `CHANGELOG.md` lo genera release-please en `main`; no lo edites.
- Nunca mergees automáticamente el PR de release-please; requiere revisión humana.
- Features en una pila de PRs: un issue y un PR por tema, apilados; no contra `main`.
- El remoto se cambia a GitLab manualmente cuando el proyecto exista; la CLI no mueve repositorios.
- En un worktree nuevo los hooks no existen: ejecuta `bun run hooks` una vez (`.husky/_` no se versiona).
- `pre-commit` corre lint-staged + typecheck; `pre-push` corre typecheck + suite completa (6–10 min).

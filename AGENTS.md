# iteraciones-cli — Agent Instructions

Static site generator (SSG) escrito en TypeScript, orientado a publicación editorial. Ejecuta únicamente en **Bun** (no Node). Ver [README.md](README.md) y [ROADMAP.md](ROADMAP.md) para contexto del proyecto.

---

## Protocolo de desarrollo

Este documento es una política operativa. Todo trabajo de desarrollo — sea corrección, feature, refactor o deuda técnica — debe seguir este flujo **sin excepciones**.

### Principios

- Claridad antes que velocidad.
- Historial Git limpio y trazable.
- Cambios pequeños, atómicos y revisables.
- Comunicación explícita: ningún comentario queda sin respuesta.
- Resolución visible de discusiones.

### Restricciones absolutas

**Force push:** Nunca hacer `git push --force` ni `git push --force-with-lease` a ninguna rama sin aprobación explícita del usuario. Si una situación técnica lo requiere (reescritura de historial, rebase de rama publicada), pausar y pedir confirmación antes de ejecutar.

**Archivos solo locales:** Los archivos que coincidan con los patrones `docs/analisis-fase-*.md` y cualquier archivo dentro de directorios `prompts/` deben mantenerse únicamente en el disco local. No commitearlos, no añadirlos a `.gitignore`. Si aparecen como untracked en `git status`, ignorarlos — ese es el estado correcto.

**PRs de release-please:** Los PRs generados por release-please (título `chore(main): release …`, rama `release-please--branches--main--components--…`) **nunca se mergean automáticamente**. Siempre se dejan para merge manual por el usuario.

### Flujo obligatorio

#### 1. Crear issue antes de trabajar

Todo trabajo requiere un issue previo. El issue debe:
- describir claramente el problema, feature o refactor,
- y existir antes de abrir rama o escribir código.

No se inicia trabajo sin número de issue.

#### 2. Crear rama desde `main` actualizado

```bash
git checkout main && git pull
git checkout -b <issue-number>-<short-description>
```

Formato de nombre: `<número>-<descripción-en-kebab-case>`
Ejemplos: `189-my-feature`, `205-fix-sidebar-pagination`, `310-refactor-pandoc-pipeline`

La descripción debe ser corta y describir el objetivo. La rama **siempre** deriva de `main` actualizado.

#### 3. Commits atómicos

Cada commit debe resolver **una sola responsabilidad**: no mezclar refactors, fixes, formatting y features en el mismo commit. Commits grandes dificultan revisión, aumentan riesgo de errores y degradan el historial.

Formato obligatorio: Conventional Commits con scope (ver sección Commits más abajo).

#### 4. Sincronizar con `main` antes de push

Antes de hacer push, verificar que la rama esté actualizada:

```bash
git fetch origin
git rebase origin/main   # o merge, según el contexto
```

Resolver conflictos localmente y validar que el proyecto siga funcionando (`bun run typecheck`, `bun run src/bin.ts build`). Esto es **especialmente necesario** si `main` recibió nuevos commits durante el desarrollo.

#### 5. Push y apertura del PR

Solo cuando la rama esté actualizada, sin conflictos y validada localmente:

```bash
git push -u origin <rama>
gh pr create --title "..." --body "..."
```

El PR debe:
- referenciar el issue (`Closes #<número>`),
- explicar los cambios realizados,
- indicar riesgos conocidos,
- y mencionar decisiones de diseño relevantes.

#### 6. Esperar revisión — no hacer merge inmediato

Después de abrir el PR, **no hacer merge**. Esperar revisiones y analizar cada comentario con atención.

#### 7. Consultar reviews con `gh`

```bash
gh pr view <número> --comments
gh pr review list <número>
```

Para cada comentario determinar si: aplica, aplica parcialmente, o no aplica.

#### 8. Si la revisión aplica

- Corregir el código con cambios mínimos y precisos.
- Usar commits atómicos.
- Responder explícitamente al comentario en el PR (en español) indicando qué se corrigió y cómo.

```bash
gh pr comment <número> --body "Corregido en <commit>: ..."
```

#### 9. Si la revisión NO aplica

No ignorarla silenciosamente. Responder (en español) explicando técnicamente por qué no se implementará, con tono profesional.

```bash
gh pr comment <número> --body "No aplica porque ..."
```

**Todo comentario debe recibir respuesta.** Ninguna observación puede quedar sin atender.

#### 10. Esperar confirmación antes del merge

Después de responder y actualizar el PR, esperar:
- confirmación explícita de que no hay más observaciones, o
- aprobación formal del PR.

No hacer merge prematuramente.

#### 11. Verificación pre-merge

Antes del merge:

```bash
git fetch origin && git rebase origin/main
bun run typecheck
bun run src/bin.ts build
```

Resolver cualquier conflicto nuevo. Confirmar que el PR sigue siendo integrable.

#### 12. Merge

Solo después de: aprobación explícita, revisiones resueltas, conflictos corregidos y validaciones exitosas.

```bash
gh pr merge <número> --squash   # o --merge según política del PR
```

> **PRs de release-please excluidos.** Los PRs con rama `release-please--branches--main--components--…` nunca se mergean en este flujo; el usuario los gestiona manualmente.

---

## Comandos esenciales

```bash
bun run typecheck          # Verificar tipos (tsc --noEmit)
bun run src/bin.ts build   # Ejecutar build completo
bun run src/bin.ts serve   # Build + servidor HTTP + livereload
bun run src/bin.ts doctor  # Verificar entorno (pandoc, permisos, Tailwind)
```

> No hay framework de tests todavía. `bun test` es el target planeado, empezando por `src/template/`.

## Arquitectura del pipeline

```
discover → classify → excludeDrafts → renderDocuments (pandoc)
  → renderBlocksToRegions → buildContext → composeDocuments → writeDocuments
```

| Módulo | Responsabilidad |
|--------|----------------|
| `src/builder/orchestrator.ts` | Función `build()` — orquestador principal (~370 líneas, pendiente de refactor) |
| `src/builder/pipeline/` | Pasos discretos: `discover`, `classify`, `render`, `compose`, `write` |
| `src/builder/classifier/` | Asigna `type`, `kind`, `templatePath` a cada documento |
| `src/builder/context/` | Builders de `TemplateContext` por tipo de documento |
| `src/template/` | Motor de templates custom: `tokenize → parse → renderAst` |
| `src/cache/` | Caché en disco `.iteraciones/cache/{scope}/{key[0..1]}/{key}` |
| `src/plugin/` | Carga ESM dinámica + `PluginRegistry` con hooks del ciclo de vida |
| `src/services/pandoc-runner.ts` | Invoca pandoc: `--from markdown --to html5 --no-highlight` |
| `src/cli/` | Comandos con `commander`, despachados por `dispatcher.ts` |
| `src/config/` | Lee `_iteraciones.yaml` via `Bun.YAML.parse` |

## Convenciones críticas

**Runtime y APIs:**
- Usar `Bun.file()` / `Bun.write()` para I/O de archivos del proyecto. `node:fs/promises` solo para operaciones de sistema (mkdir, rm).
- `Bun.Glob` para discovery, `Bun.CryptoHasher` para hashes, `Bun.YAML.parse` para YAML.

**TypeScript:**
- `verbatimModuleSyntax: true` — usar `import type` para importar solo tipos.
- Imports con extensión `.js` (Bun resuelve `.ts` → `.js`).
- `export` nombrado por defecto. `default export` solo en plugins (contrato de la API pública).
- Strict completo activo: no usar `any`, respetar `noUncheckedIndexedAccess`.

**Naming:**
- Archivos: `kebab-case.ts`
- Funciones: `camelCase`. Prefijos convencionales: `build*` (context builders), `run*` (command handlers), `resolve*` (path resolvers).
- Tipos/interfaces: `PascalCase`.
- Variables de template (en `TemplateContext`): `kebab-case` (e.g., `site-title`, `author-href`).

**Error handling:**
- Usar `process.stderr.write(...)` + `process.exitCode = 1`. No usar `console.error`.
- Solo 3 clases de error (`src/errors.ts`): `PandocError`, `ConfigError`, `PluginError`.

**Plugins:**
- Los hooks deben retornar copia modificada del contexto, nunca mutar. Los contextos son `Readonly<…>`.

**Linting (Biome):**
- Espacios (no tabs), `lineWidth: 150`, comillas simples en JS/TS.
- `organizeImports: on` — Biome ordena los imports automáticamente.
- HTML en `pandoc/`, `layouts/`, `templates/`, `themes/` **no** se lintea.

**Commits:** Conventional Commits. Formato estricto:

```
type(scope): verbo en imperativo
```

- **Scope obligatorio** — nunca omitir.
- **Verbo en imperativo** (tú, positivo) — **nunca infinitivo**.
  - `-ar` → `-a`: `agregar` ✗ → `agrega` ✓, `usar` ✗ → `usa` ✓, `eliminar` ✗ → `elimina` ✓
  - `-er` / `-ir` → `-e`: `añadir` ✗ → `añade` ✓, `incluir` ✗ → `incluye` ✓, `corregir` ✗ → `corrige` ✓
  - Irregulares frecuentes: `forzar` → `fuerza`, `mostrar` → `muestra`, `advertir` → `advierte`

Types válidos: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`.
Scopes activos: `builder`, `cache`, `cli`, `config`, `css`, `export`, `frontmatter`, `loader`, `orchestrator`, `pagination`, `plugin`, `template`, `theme`.

Ejemplos correctos:
```
feat(plugin): añade hook beforeBuild a IPlugin
fix(cache): agrega separador \0 en hash() para evitar colisiones
perf(builder): usa mtime en discovery para evitar re-leer archivos sin cambios
refactor(cli): extrae reportBuildError para evitar duplicación
docs(config): documenta bloque editorial: y export: en frontmatter-reference
```

**No usar `BREAKING CHANGE` en commits mientras la versión sea < 1.0.0.** El proyecto usa [release-please](https://github.com/googleapis/release-please); un footer `BREAKING CHANGE:` o el sufijo `!` en el tipo (ej. `feat!:`) disparan un salto a la versión mayor y publicarían una v1.0.0 prematura. Si el cambio es incompatible, describir el impacto en el body del commit como texto plano (sin el prefijo `BREAKING CHANGE:`).

## Deuda técnica conocida (no introducir más)

- `src/loader/document-loader.ts` — legacy, conservado por compatibilidad. Re-exporta `SourceDocument` desde `../builder/types.js`. Ver issue #19. No extender.
- `makeRelativeContext` en `orchestrator.ts` — sin abstracción de grafo de tipos; el orden de procesamiento es implícito en el cuerpo de `build()`.
- `buildBlockTypeContext` en `orchestrator.ts` — switch/case acoplado; crece con cada nuevo `DocumentType`. Pendiente mover a `type-graph.ts` en Fase 1.
- `VALID_TYPES` en `classifier/infer-type.ts` — definición independiente de `DocumentType`; pueden divergir. Pendiente derivar del type-graph.
- `console.warn` en `theme-resolver.ts` — debe ser `process.stderr.write`. Inconsistencia menor.

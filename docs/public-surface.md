# Superficie pública — inventario de congelación pre-1.0

Inventario ejecutado del issue #2096 (puerta del hito M1). Cada elemento
abajo es **contrato congelado**: cambios incompatibles posteriores exigen
salto mayor en la versión.

## CLI (7 comandos)

| Comando | Flags |
|---------|-------|
| `build` | `--full`, `--output <path>`, `--verbose`, `--json` |
| `init` | — |
| `validate` | `--json` |
| `doctor` | `--info`, `--json` |
| `new <path>` | `-t/--title` |
| `clean` | `--json` |
| `list-filters` | `--verbose`, `--json` |

Globales: `--version`, `--project-root <path>` (antes o después del subcomando).

## Contratos de salida

- Exit codes: 0 éxito/advertencias no bloqueantes · 1 error (build, validate, doctor con check duro fallido, **PDF/X con 99-pdfx activo** — decisión D2 #2162).
- `--json`: objeto único en stdout, progreso suprimido. Contrato por comando:
  - **build**: `{processed, cached, formats, outputDir, invalidations, durationMs}` en éxito; `{error, warnings?}` en fallo.
  - **validate**: `{ok, documents, errors, warnings}`.
  - **clean**: `{ok, removed: string[], failures: [{dir, error}]}`.
  - **doctor**: `{ok, checks: [{label, ok, detail, warn}]}`; con `--info --json` añade `{config: string[]}`.
  - **list-filters**: `{filters: [{name, type, description, active}], preamble: [{...}]}`.
- Formato unificado de mensajes: glifo `[contexto]` mensaje + hint opcional. Íntegramente en español; errores OS traducidos. WARNING de PDF/X incluido en el objeto de error de `--json` (fila `warnings`).

## Ciclo II — cambios de contrato (pre-congelación)

Los elementos añadidos o modificados durante el ciclo II de revisión integral:

- **CLI**: `clean --json` (#2183), `doctor --json` (#2184), `list-filters --json` (#2235) — familia JSON completa.
- **PDF/X**: `99-pdfx` activo = fallo del build (exit 1) con detalle por PDF (decisión D2 #2162). `clean` elimina la salida declarada por el estado (#2183).
- **init**: crea el directorio raíz si no existe (#2180).
- **help**: `help <desconocido>` falla con sugerencia (#2179).
- **doctor**: verifica biber con bibliografía + PDF (#2184).
- **Vocabulario**: `sitio` → `proyecto/documentos` en strings de usuario (#2182).
- **Warnings en fallo**: warnings acumulados visibles en stderr y en `--json` (#2239).

## Configuración — `iteraciones.config.yaml`

- Exigido por `build` y `validate` (#2071); archivo vacío = defaults. Claves desconocidas: error estricto.
- Raíz: `language`, `toc`, `format`, `disabled-filters`, `lua-filters`, `bibliography`, `csl` + campos Dublin Core (title…abstract).
- `format.latex|pdf|epub|markdown`: `generate`; `pdf` añade `show-date`, `page-number`, `cover-image`, `disabled-preamble-filters` y DC por-formato; `html` añade `site.{title,description,logo,theme,color}` y `blocks`.
- Fuente única tipada: schema Zod inferido con paridad compilación-tiempo contra las sub-interfaces (#2072).

## Filters

- 18 filters Lua: `semantic/string/01-double-colon`, `semantic/ast/02-double-colon-noindent`, `latex/01…12`, `html/01…05`. Override por proyecto `filters/<grupo>/<nombre>.lua`; desactivación vía `disabled-filters`.
- 31 preamble filters `.tex` (01-documentclass … cola de imprenta 97-eso-pic / 98-crop / 99-pdfx). Override `preamble/<nombre>.tex`; desactivación vía `disabled-preamble-filters`.
- Interacción fija: 99-pdfx activo ⇒ 08-hyperref auto-desactivado (aviso visible).

## Distribución LaTeX

Bundle portable junto al `.tex` de dist (ADR #2084): imágenes `<slug>-<base>.jpg` namespaced, referencias relativas por filename.

## API programática

Consumo del builder como módulo (demo de referencia: `tools/headless-demo.ts`):

- `build(options, reporter?) → Promise<BuildSummary>` (`src/builder/orchestrator.ts`) — única puerta de entrada. `BuildSummary` es el contrato tipado del resultado.
- Eventos del reporter: ver `BuildReporter` (`src/builder/types.ts`) — `setFormats`, `planPhases`, `startPhase`, `reportFile`, `completePhase`.

El resto de exports internos del paquete NO son superficie: los símbolos privados
pueden cambiar sin salto mayor (triaje #2137; 30 huérfanos des-exportados,
queda solo lo listado aquí).

## Estado interno

`.iteraciones/state.json` — `schemaVersion` actual: ver `STATE_SCHEMA_VERSION` (`state-serialize.ts`). Campos documentados en architecture.md §estado.

## Verificaciones previas a congelar (checklist)

1. [x] Inventario completo sin elementos ocultos (extraído de la CLI real).
2. [x] Auditoría de residuos: cero aliases, modos legacy ni capas de compatibilidad en `src/` (grep dirigido; los "fallback" restantes son semántica de defaults legítima).
3. [x] Paridad tipo-nivel schema↔interfaces vigente (`config-schema-parity.test.ts`, #2072) — fuente única verificada por compilación.
4. [x] Constantes compartidas anti strings mágicos vigentes (#2074); clasificación de errores por códigos estructurales (`BUILD_ERROR_CODES`, `PANDOC_ERROR_CODES`).
5. [x] Suite completa verde (777 tests) y contratos fixed por tests de regresión nombrados (hotfixes PDF/X #2085).
6. [x] Documentación sincronizada con comportamiento real (#2094, #2230) + integridad automática docs↔schema docs-config-integrity.
7. [ ] Decisión formal de congelación — se marca al hacer merge del milestone de congelación (#2249).

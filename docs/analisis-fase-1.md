# Análisis arquitectónico — Fase 1: Arquitectura base

> Auditoría: mayo 2026 · iteraciones-cli v0.4.0 (post-Fase 0)  
> Bloque analizado: `src/builder/orchestrator.ts` + `src/builder/pipeline/` + `src/builder/classifier/` + `src/builder/context/`

---

## 1. Evaluación del bloque actual

### Responsabilidades reales

La función `build()` en `orchestrator.ts` (~400 líneas) concentra actualmente:

1. **Setup del entorno**: verificar Pandoc, cargar config, cargar plugins, crear `BuildContext`, limpiar outputDir, generar assets.
2. **Gestión de caché**: crear `renderCache` y `composeCache` con fingerprint de plugins, CLI version y versión de Pandoc.
3. **Pipeline de descubrimiento**: `discover()` → `classifyDocuments()` → `excludeDrafts()`.
4. **Construcción del contexto del sitio**: `buildSiteContext()` + detección del menú primario → `enrichedSiteCtx`.
5. **Renderizado pandoc por grupo de tipo**: 9 llamadas independientes a `renderDocuments()`, filtradas manualmente por tipo.
6. **Construcción de índices cruzados**: `createAuthorDocumentIndex()` → `authorDocumentIndex`.
7. **Pre-paso de bloques**: render + contexto de bloques → `renderBlocksToRegions()` → `finalSiteCtx`.
8. **Procesamiento de contexto por tipo**: filtrar → render (si no se hizo antes) → `buildContext` / `buildPaged*PipelineContexts` para cada uno de los 9 tipos.
9. **Ensamblaje del pool de candidatos**: `collectionPool`, `collectionBlockPool`, `listCandidatePool` armados manualmente con spreads.
10. **Relativización de contextos**: `makeRelativeContext()` sobre todos los docs.
11. **Composición y escritura**: `composeDocuments()` → `writeDocuments()`.
12. **Hook `afterBuild`** con lista de paths calculada ad hoc.
13. **Poda de caché**: con lista de `allRenderedDocs` ensamblada manualmente con otro spread de 10 variables.

### Límites correctos e incorrectos

**Correctos:**
- `discover`, `classify`, `render`, `compose`, `write` son funciones independientes con responsabilidades claras.
- Los context builders (`src/builder/pipeline/context/`) están bien separados por tipo.
- El patrón `buildPaged*PipelineContexts` es consistente y correcto.
- La caché está desacoplada de la lógica de negocio.

**Incorrectos:**
- El orden de procesamiento entre tipos (`file` → `author` → `event` → bloques → `collection` → ...) está **codificado en el cuerpo de `build()`**, no en una estructura de datos. Es un grafo de dependencias implícito que solo existe como secuencia de variables locales.
- `buildBlockTypeContext()` es un `switch` sobre `DocumentType` que vive en el orquestador en lugar de en los context builders individuales.
- Cada nuevo tipo de documento requiere modificar **al menos 5 lugares** distintos del sistema.
- `listCandidatePool` y `allRenderedDocs` se ensamblan manualmente; si se añade un tipo nuevo sin actualizar ambos, hay bugs silenciosos.

### Nivel de madurez

**Funcional pero frágil.** El sistema procesa los 9 tipos actuales correctamente. Sin embargo, la carga cognitiva para entender `build()` es alta: un lector debe seguir el flujo de ~20 variables locales interrelacionadas para comprender el orden de procesamiento.

### Métricas actuales

| Métrica | Valor |
|---|---|
| Líneas en `orchestrator.ts` | ~400 |
| Líneas en función `build()` | ~270 (post-setup) |
| Importaciones en `orchestrator.ts` | 31 |
| Tipos de documentos soportados | 9 |
| Llamadas a `renderDocuments()` | 9 (una por tipo) |
| Llamadas a `mapWithConcurrency` | indirectas vía `renderDocuments`/`composeDocuments`/`writeDocuments` |
| Spreads para ensamblar pools | 4 construcciones manuales |
| Lugares a modificar al agregar un tipo | ≥ 5 |

### Acoplamiento

El orquestador importa directamente **todos** los context builders de todos los tipos:

```typescript
import { buildAuthorPipelineContext, buildAuthorsPipelineContext, buildPagedAuthorsPipelineContexts } from './pipeline/context/authors.js';
import { buildCardPipelineContext } from './pipeline/context/card.js';
import { buildCollectionPipelineContext, buildPagedCollectionPipelineContexts } from './pipeline/context/collection.js';
// … etc.
```

Esto crea un acoplamiento fan-in: el orquestador conoce todos los tipos concretos. Agregar un tipo nuevo añade un import y múltiples referencias al orquestador. El orquestador es imposible de extender sin modificarlo.

### Deuda técnica

| Deuda | Severidad | Archivo |
|---|---|---|
| Grafo de dependencias entre tipos implícito en código | Alta | `orchestrator.ts` |
| `buildBlockTypeContext` switch/case en orquestador | Alta | `orchestrator.ts` |
| Pools (`collectionPool`, `listCandidatePool`) armados manualmente | Media | `orchestrator.ts` |
| `VALID_TYPES` en `infer-type.ts` sin vínculo con `DocumentType` en tiempo de compilación | Media | `classifier/infer-type.ts` |
| Setup de entorno mezclado con lógica del pipeline | Media | `orchestrator.ts` |
| `makeRelativeContext` como función standalone no extensible | Baja | `orchestrator.ts` |
| `collect.ts` (`collectByType`) no usado por el pipeline principal (solo por validación) | Baja | `collect.ts` |

---

## 2. Objetivo ideal del bloque

### Responsabilidades que debería tener

**El orquestador** debería:
- Cargar configuración y preparar el `BuildContext`.
- Ejecutar un array configurable de `PipelineStage[]` en el orden correcto.
- Manejar la caché de forma transversal (no por tipo).
- Delegar 100% la lógica de tipo a los stages.

**Los stages** deberían:
- Cada uno conocer su grupo de tipos.
- Declarar sus dependencias (qué tipos necesitan del pipeline anterior).
- Construir los contextos de sus propios tipos.
- Ser intercambiables y testables de forma aislada.

### Lo que NO debería hacer

- El orquestador **no** debería conocer `buildAuthorPipelineContext`, `buildCollectionPipelineContext` ni ningún context builder concreto.
- Ningún módulo del pipeline **no** debería construir pools manualmente con spreads.
- El switch `buildBlockTypeContext` **no** debería vivir en el orquestador; debería ser una responsabilidad del stage de cada tipo.

### Arquitectura ideal

```
BuildContext
    │
    ▼
PipelineRunner.run(stages[], ctx)
    │
    ├─ DiscoverStage      → SourceDocument[]
    ├─ ClassifyStage      → BuildDocument[]
    ├─ ExcludeDraftsStage → BuildDocument[]
    ├─ RenderStage        → BuildDocument[] (con htmlFragment)
    ├─ BlocksStage        → BuildDocument[] (pre-paso bloques + finalSiteCtx)
    ├─ ContextStage       → BuildDocument[] (con templateContext, por tipo)
    ├─ RelativizeStage    → BuildDocument[] (rutas relativizadas)
    ├─ ComposeStage       → BuildDocument[] (con outputHtml)
    └─ WriteStage         → BuildDocument[] (con outputPath)
```

Cada stage es una función (o clase) con contrato uniforme:

```typescript
// src/builder/pipeline/stage.ts
export interface PipelineStage<TIn = BuildDocument[], TOut = BuildDocument[]> {
  readonly name: string;
  run(input: TIn, ctx: BuildContext, shared: PipelineShared): Promise<TOut>;
}

// Estado compartido entre stages (caché, registro de plugins, índices)
export interface PipelineShared {
  cache: { render?: RenderCache; compose?: ComposeCache };
  registry: PluginRegistry;
  siteCtx: TemplateContext;          // se va enriqueciendo
  authorIndex: AuthorDocumentIndex;  // construido en RenderStage
}
```

### Contrato del grafo de tipos

El grafo de dependencias entre tipos debe existir como estructura de datos, no como código:

```typescript
// src/builder/pipeline/type-graph.ts
export interface TypeStageSpec {
  types: DocumentType[];
  phase: 'primary' | 'blocks' | 'index';
  /** Tipos que deben estar renderizados antes de que este stage corra. */
  dependsOn: DocumentType[];
  /** Si true, este tipo puede ser bloque (kind === 'block'). */
  canBeBlock: boolean;
  /** Si true, usa paginación. */
  paginated: boolean;
  /** Construye el pool de candidatos para este tipo. */
  buildPool(rendered: Map<DocumentType, BuildDocument[]>): BuildDocument[];
  /** Construye el contexto para un documento de este tipo. */
  buildContext: TypeContextBuilder;
}
```

### Flujo de datos ideal

```
SourceDocument[]
    │ classify
    ▼
BuildDocument[] { type, kind, templatePath }
    │ filter(kind !== 'block') + render primary types
    ▼
Map<DocumentType, BuildDocument[]> (rendered primaries)
    │ build author index
    │ render blocks + renderBlocksToRegions
    ▼
finalSiteCtx: TemplateContext (enriquecido con region slots)
    │ render + buildContext for each type
    ▼
BuildDocument[] { templateContext }
    │ makeRelativeContext
    ▼
BuildDocument[] { templateContext relativizado }
    │ composeDocuments
    ▼
BuildDocument[] { outputHtml }
    │ writeDocuments
    ▼
BuildDocument[] { outputPath }
```

---

## 3. Roadmap por fases

### Fase 1a — Extracción de funciones nombradas (refactoring estructural puro)

**Objetivo:** Hacer `build()` legible sin cambiar ninguna lógica. No introduce abstracciones nuevas.

**Tareas:**

1. **Extraer `setupBuildEnvironment()`**: verificación de Pandoc, carga de config, carga de plugins, creación de `BuildContext`, limpieza de outputDir, generación de assets, construcción de `renderCache` y `composeCache`.

2. **Extraer `runDiscovery()`**: `discover` → `classify` → `excludeDrafts` → log. Retorna `BuildDocument[]`.

3. **Extraer `buildEnrichedSiteContext()`**: `buildSiteContext` + detección del menú primario → `enrichedSiteCtx`.

4. **Extraer `runPrimaryRender()`**: renderizado de `file`, `author`, `event` y construcción de `authorDocumentIndex`. Retorna `{ renderedFileDocs, renderedAuthorDocs, renderedEventDocs, authorDocumentIndex }`.

5. **Extraer `runBlocksPrestep()`**: render de bloques + `buildBlockTypeContext` por bloque + `renderBlocksToRegions` → `finalSiteCtx`. Retorna `finalSiteCtx`.

6. **Extraer `runContextPhase()`**: toda la fase de construcción de contextos por tipo (desde `contextCollectionDocs` hasta `allContextDocs`). Retorna `BuildDocument[]` con `templateContext`.

7. **Extraer `runFinalization()`**: relativización + compose + write + afterBuild + poda de caché.

**Resultado esperado:** `build()` queda como una secuencia de ~10 llamadas nombradas de ≤50 líneas totales.

**Criterios de finalización:**
- `build()` tiene ≤80 líneas.
- `bun run typecheck` pasa limpio.
- Ningún test de integración (cuando existan) falla.
- El cuerpo de cada función extraída no supera 60 líneas.

**Dependencias:** Ninguna. Es refactoring puro — no requiere Fase 1b.

**Riesgo:** Bajo. Solo mueve código, no cambia lógica. El riesgo real es introducir un bug sutil al mover variables; mitigado con typecheck estricto.

**Estimación:** 2-3 días.

---

### Fase 1b — Contrato `PipelineStage` y grafo de tipos

**Objetivo:** Hacer que agregar un nuevo tipo de documento requiera modificar **1 archivo** en lugar de 5+.

**Tareas:**

1. **Crear `src/builder/pipeline/stage.ts`**: definir interfaces `PipelineStage`, `PipelineShared`, `TypeContextBuilder`.

2. **Crear `src/builder/pipeline/type-graph.ts`**: definir `TypeStageSpec[]` con los 9 tipos actuales. Cada spec declara `types`, `phase`, `dependsOn`, `canBeBlock`, `paginated`, `buildPool()` y `buildContext()`.

3. **Crear `src/builder/pipeline/runner.ts`**: `PipelineRunner` que ejecuta los stages en el orden correcto según `phase` y `dependsOn`.

4. **Mover `buildBlockTypeContext`** de `orchestrator.ts` a cada `TypeStageSpec.buildContext` correspondiente.

5. **Reemplazar pools manuales** (`collectionPool`, `listCandidatePool`, `collectionBlockPool`) por `spec.buildPool(renderedMap)` en cada spec.

6. **Reemplazar `allRenderedDocs`** (para poda de caché) por iteración sobre todos los arrays del `renderedMap`.

7. **Actualizar `VALID_TYPES`** en `infer-type.ts` para derivarse del type-graph en tiempo de compilación, garantizando que `DocumentType` y `VALID_TYPES` no puedan divergir.

**API propuesta:**

```typescript
// type-graph.ts (fragmento)
export const TYPE_STAGES: TypeStageSpec[] = [
  {
    types: ['file'],
    phase: 'primary',
    dependsOn: [],
    canBeBlock: true,
    paginated: false,
    buildPool: () => [],
    buildContext: (doc, siteCtx, shared) =>
      mergeContexts(buildContext(doc, siteCtx, shared.authorIndex),
                    buildRelatedAuthorsContext(doc, shared.authorIndex)),
  },
  {
    types: ['collection'],
    phase: 'index',
    dependsOn: ['file', 'author', 'event'],
    canBeBlock: true,
    paginated: true,
    buildPool: (rendered) => [
      ...rendered.get('file') ?? [],
      ...rendered.get('author') ?? [],
      ...rendered.get('event') ?? [],
    ],
    buildContext: (doc, siteCtx, shared, pool) =>
      buildCollectionPipelineContext(doc, siteCtx, pool, shared.authorIndex),
  },
  // … etc.
];
```

**Criterios de finalización:**
- Agregar un nuevo `DocumentType` requiere: añadir la entrada en `DocumentType` union + añadir una `TypeStageSpec` en `type-graph.ts`. Nada más.
- El orquestador no importa ningún context builder concreto.
- `bun run typecheck` pasa.
- Tests de integración pasan (ver Fase 1c).

**Dependencias:** Fase 1a (el orquestador debe estar estructurado antes de refactorizarlo en stages).

**Riesgo:** Medio. El cambio afecta el flujo de datos central. La introducción del `renderedMap` como estructura compartida requiere cuidado para no romper el orden de procesamiento actual. Requiere tests de integración antes de considerar este paso completo.

**Estimación:** 4-6 días.

---

### Fase 1c — Tests de integración con fixtures

**Objetivo:** Red de seguridad para que los refactors de Fase 1a y 1b no introduzcan regresiones silenciosas.

**Estructura propuesta:**

```
src/builder/__tests__/
  fixtures/
    simple-site/          # 3 file docs, 1 index.md (list)
      _iteraciones.yaml
      index.md
      posts/
        articulo-1.md
        articulo-2.md
        articulo-3.md
    with-authors/         # file + author + collection
      _iteraciones.yaml
      index.md
      personas/
        sofia.md          # type: author
      textos/
        ensayo.md         # author: ["Sofia"]
      antologia.md        # type: collection, items: [textos/ensayo.md]
    with-blocks/          # sidebar y footer blocks
      _iteraciones.yaml
      index.md
      sidebar.md          # type: list, block: true, region: sidebar-primary
    with-pagination/      # list con más docs que listItemsLimit
      _iteraciones.yaml
      index.md            # type: list
      posts/
        post-1.md … post-12.md
    with-events/
      _iteraciones.yaml
      index.md
      evento.md           # type: event
      eventos.md          # type: events
  build.test.ts           # tests end-to-end
  snapshot.test.ts        # snapshot tests del HTML generado
```

**Criterios mínimos:**
- Cada fixture produce HTML sin errores de build.
- Los archivos de salida existen en el directorio de output.
- La paginación genera los archivos correctos (`index.html`, `index/2.html`).
- Los bloques inyectan su contenido en la región correcta del layout.
- La caché produce resultados idénticos en el segundo build.

**Criterios de finalización:**
- Al menos 5 fixtures con 2+ tests cada una.
- `bun test src/builder/__tests__` pasa en <30 segundos.
- Los tests siguen pasando después de aplicar Fase 1b.

**Dependencias:** Fase 1a completa (para tener un orquestador estable sobre el que probar).

**Riesgo:** Bajo. Los tests no cambian lógica. El riesgo está en elegir fixtures que cubran los edge cases relevantes.

**Estimación:** 3-4 días.

---

### Fase 1d — Documentación del modelo de contenido

**Objetivo:** Que un colaborador nuevo pueda entender el sistema de tipos sin leer código fuente.

**Archivo:** `docs/content-model.md`

**Contenido:**
- Diagrama del ciclo de vida de un documento (`SourceDocument` → `BuildDocument` a través del pipeline).
- Tabla completa de `DocumentType`: propósito, campos de frontmatter relevantes, comportamiento de paginación, si puede ser bloque.
- Tabla de `DocumentKind`: cuándo usar `page` vs `block`, cómo la región controla la inyección.
- Cómo se resuelve el template para cada tipo (prioridad: proyecto → tema → default).
- Diagrama del grafo de dependencias entre tipos (qué tipos necesitan estar renderizados antes que otros).
- El ciclo de vida de un bloque vs una página.

**Criterios de finalización:**
- Un desarrollador externo puede implementar un plugin de transformación correcto después de leer el documento.
- El documento describe los 9 tipos actuales con ejemplos de frontmatter.

**Dependencias:** Fase 1b (el grafo de dependencias debe estar como estructura de datos explícita antes de documentarlo).

**Estimación:** 1-2 días.

---

## 4. Problemas críticos

### P1 — Imposibilidad de agregar tipos sin modificar el orquestador

**Severidad:** Alta · **Urgencia:** Media · **Dificultad:** Media · **Impacto arquitectónico:** Alto

Para agregar un tipo nuevo actualmente se debe:
1. Añadir a `DocumentType` union en `types.ts`
2. Añadir a `VALID_TYPES` en `infer-type.ts`
3. Añadir a `resolveTemplatePath` en `resolve-template.ts` (indirectamente, por existencia del archivo de template)
4. Crear `src/builder/pipeline/context/{type}.ts`
5. Añadir `case` en `buildBlockTypeContext` en `orchestrator.ts`
6. Añadir import del context builder en `orchestrator.ts`
7. Añadir bloque de render + contexto en `build()` en `orchestrator.ts`
8. Añadir el tipo al pool apropiado (`collectionPool` y/o `listCandidatePool`) en `orchestrator.ts`
9. Añadir el tipo a `allRenderedDocs` en `orchestrator.ts`

Errores de omisión en pasos 8 o 9 son silenciosos: el tipo simplemente no aparece en listas ni en la poda de caché.

### P2 — `listCandidatePool` incompleto es un bug silencioso

**Severidad:** Alta · **Urgencia:** Media · **Dificultad:** Baja · **Impacto arquitectónico:** Medio

`listCandidatePool` incluye explícitamente todos los tipos excepto los que se procesan después de `list`. Si se agrega un tipo nuevo y se coloca en la fase `index` pero antes de `list` en `build()`, no aparecerá en documentos `type: list`. No hay validación ni warning.

Actualmente `listCandidatePool` ya incluye `renderedListDocs` (los propios `list` se listan a sí mismos), lo cual es correcto pero no obvio.

### P3 — `buildBlockTypeContext` no tiene cobertura completa garantizada

**Severidad:** Media · **Urgencia:** Baja · **Dificultad:** Baja · **Impacto arquitectónico:** Medio

```typescript
function buildBlockTypeContext(doc, siteCtx, collectionPool, …): TemplateContext {
  switch (doc.type) {
    case 'collection': …
    case 'author': …
    // …
    default:
      return mergeContexts(buildContext(doc, siteCtx, authorDocumentIndex), …);
  }
}
```

El `default` actúa como fallback para cualquier tipo nuevo que no tenga `case` propio. Esto significa que un tipo nuevo con `kind === 'block'` no fallará — simplemente usará un contexto incorrecto. TypeScript no puede detectar este problema porque `DocumentType` tiene un `default` válido.

**Solución:** Cuando el tipo-grafo sea una estructura de datos (Fase 1b), la búsqueda de `buildContext` para bloques fallará explícitamente si el tipo no está registrado.

### P4 — `VALID_TYPES` puede divergir de `DocumentType`

**Severidad:** Media · **Urgencia:** Baja · **Dificultad:** Baja · **Impacto arquitectónico:** Bajo

```typescript
// types.ts
export type DocumentType = 'file' | 'collection' | … | 'list';

// infer-type.ts
const VALID_TYPES = new Set<string>(['file', 'collection', … , 'list']);
```

Son definiciones independientes. TypeScript no garantiza que sean iguales. Si se añade un tipo a `DocumentType` y se olvida `VALID_TYPES`, el tipo siempre se infiere como `'file'`. Sin test, este bug pasa desapercibido.

**Solución:**
```typescript
// Derivar VALID_TYPES desde DocumentType garantiza coherencia en compilación
const VALID_TYPES = new Set<DocumentType>(['file', 'collection', …, 'list']);
// O mejor: derivar desde el type-graph
```

### P5 — Sin `PipelineStage`, la exportación PDF/EPUB es difícil de diseñar

**Severidad:** Baja (hoy) → Alta (en Fase 4) · **Urgencia:** Baja · **Dificultad:** Alta sin refactoring

La exportación editorial (Fase 4 del roadmap) necesita reutilizar `discover`, `classify`, `render` y parte de `context`, pero con un pipeline de escritura distinto (PDF/EPUB en lugar de HTML). Sin un contrato de stage, el pipeline de exportación solo puede copiar código del orquestador o convertirse en otro función monolítica paralela.

Con el contrato de Fase 1b, un pipeline de exportación puede reutilizar todos los stages hasta `ContextStage` y sustituir `ComposeStage` y `WriteStage` por versiones que generan PDF/EPUB.

### P6 — `console.warn` en `theme-resolver.ts`

**Severidad:** Baja · **Urgencia:** Baja · **Dificultad:** Trivial · **Impacto arquitectónico:** Mínimo

```typescript
// theme-resolver.ts
console.warn(`[iteraciones] Tema desconocido: "${theme}". Usando el tema claro por defecto.`);
```

Viola la convención del proyecto (`process.stderr.write`). Inconsistencia menor pero visible en tests.

### P7 — Cache key de compose usa `JSON.stringify(doc.templateContext)` completo

**Severidad:** Media · **Urgencia:** Baja · **Dificultad:** Media · **Impacto:** Performance

La clave de caché de compose serializa el `templateContext` completo, incluyendo todos los `body` de los `list-items`. Para un documento `list` con 50 items, la clave puede ser de 50-100KB. Esto hace el cálculo del hash innecesariamente lento y llena el caché con claves grandes.

Catalogado en el roadmap general como I11 (importante). No es bloqueador de Fase 1 pero vale registrar aquí porque el type-graph de Fase 1b es el lugar natural para pre-computar hashes de contexto.

---

## 5. Evolución técnica

### Qué vale la pena sofisticar

**1. El contrato de stage como dato, no como código**

El cambio de mayor leverage: transformar el switch `doc.type → buildContext` en una tabla de stages consultable. No requiere un framework complejo; solo una interfaz TypeScript bien definida y un array de especificaciones.

**2. El `renderedMap` como estado compartido entre stages**

En lugar de ~10 variables locales en `build()`, usar un `Map<DocumentType, BuildDocument[]>` que los stages van poblando. Esto hace que el pool de candidatos para cualquier tipo sea `spec.dependsOn.flatMap(type => renderedMap.get(type) ?? [])`, determinístico y sin omisiones posibles.

**3. Build incremental en `serve` (preparación)**

La base para builds incrementales es un **grafo de dependencias de archivos**: saber que cambiar `personas/sofia.md` (author) invalida todos los `collection` que la incluyen. Este grafo puede construirse al mismo tiempo que se ejecuta el pipeline de contexto. No requiere implementación en Fase 1, pero el type-graph de Fase 1b es el lugar correcto para registrar las dependencias cruzadas.

**4. Observabilidad del pipeline**

Cada stage debería reportar cuántos documentos procesó, cuántos vinieron de caché y cuánto tiempo tomó. Esta información es la base de los reportes de build de Fase 2 (DX) y del profiling de Fase 3 (performance).

### Qué debe mantenerse simple

**El motor de templates** no debe cambiar. La arquitectura de stages no afecta al lenguaje `$var$`, `$if(k)$`, `$for(k)$`.

**La API de plugins** solo necesita un hook nuevo en esta fase: `onDocumentClassified` (que permite a plugins cambiar el tipo inferido). Los hooks `beforeBuild` y `onDocumentDiscovered` del roadmap de Fase 5 son deseables pero no críticos para Fase 1.

**El formato de `BuildDocument`** no debe cambiar. Los campos opcionales (`htmlFragment?`, `templateContext?`, `outputHtml?`, `outputPath?`) son el contrato correcto para un documento que acumula datos a través del pipeline. No conviene tipificarlos como tipos separados por fase (ej. `RenderedDocument`, `ContextualizedDocument`) hasta que los tests de integración estén en su lugar; el refactoring de tipos es costoso y de bajo valor inmediato.

### Pipeline de exportación (preparación para Fase 4)

La arquitectura ideal de Fase 1b permite que el pipeline de exportación se implemente así:

```typescript
// Reutiliza todos los stages hasta ContextStage
const exportPipeline = [
  new DiscoverStage(),
  new ClassifyStage(),
  new ExcludeDraftsStage(),
  new RenderStage(),
  new ContextStage(),
  // Stages propios de exportación:
  new ResolveCollectionStage(),  // toma una collection y ordena sus items
  new ConcatenateMarkdownStage(), // genera un .md temporal
  new PandocExportStage({ format: 'pdf', engine: 'weasyprint' }),
];
```

Esto es solo posible si los stages tienen un contrato uniforme. Si no lo tienen, la exportación termina como otra función de 300 líneas.

---

## 6. Comparación con otros sistemas

### Hugo

Hugo resuelve el equivalente al tipo-grafo con **page kinds** (`home`, `section`, `taxonomy`, `term`, `page`) codificados en su tipo `Page`. El orden de procesamiento también está hardcodeado pero en Go con patrones más idiomáticos (métodos en interfaces). La ventaja de Hugo es velocidad; la desventaja es que agregar un tipo nuevo requiere modificar el core en Go.

**Lección:** El modelo de tipos fijo de Hugo es suficiente para un SSG web genérico, pero no para un sistema editorial que necesita tipos como `author`, `event`, `collection` con semántica propia. La apuesta de iteraciones de tener tipos declarados en frontmatter es correcta.

### Eleventy

Eleventy usa **data cascade** y **collections** configuradas en `eleventy.config.js`. Las colecciones son arrays de objetos que el usuario define. No hay tipos fijos. El pipeline es extensible vía `addTransform`, `addFilter`, etc.

**Lección adaptable:** El `addTransform` de Eleventy es el equivalente de los hooks `beforeRender`/`afterRender` ya implementados. Lo que falta es el equivalente de `addCollection` — la capacidad de que un plugin declare un nuevo tipo de documento con su propia lógica de contexto. El type-graph de Fase 1b puede evolucionar en esa dirección.

**Error a evitar:** La data cascade de Eleventy puede volverse opaca en proyectos grandes; la resolución de qué datos tiene un documento requiere seguir la cadena de herencia. El sistema de iteraciones con `TemplateContext` plano y `mergeContexts()` explícito es más predecible.

### Astro

Astro separa claramente **content collections** (datos) de **pages** (output). Los content collections tienen esquemas Zod y la API es tipada. El pipeline usa Vite como base.

**Lección adaptable:** La validación de frontmatter con esquemas explícitos (análoga a Zod) es un gap real en iteraciones. Actualmente `Frontmatter` es permisivo: `[key: string]: unknown` como escape hatch. Definir esquemas por tipo (no para Fase 1, pero sí para Fase 2-3) aumentaría la calidad de los errores.

**Error a evitar:** Astro requiere Node.js y tiene un bundler complejo. iteraciones mantiene la ventaja de ser un pipeline simple sin bundler de cliente.

### mdBook

mdBook tiene un pipeline de stages explícito (`SUMMARY.md` → tree de capítulos → render HTML/PDF). Es el SSG más cercano en filosofía editorial.

**Lección adaptable:** El `SUMMARY.md` de mdBook (que define el orden editorial del libro) es análogo al `items:` de frontmatter de una `collection`. La diferencia es que mdBook lo centraliza en un archivo; iteraciones lo distribuye en el frontmatter. Para libros, un archivo central de orden editorial puede ser más ergonómico.

**Error a evitar:** mdBook está especializado en documentación técnica y su formato es rígido. iteraciones tiene un modelo de bloques y regiones más flexible que mdBook no tiene.

### Pandoc

Pandoc resuelve el pipeline de conversión como una cadena `Reader → AST Filters (Lua) → Writer`. Cada fase es un paso con tipos bien definidos.

**Lección crítica:** La arquitectura de Pandoc demuestra el valor de un AST intermedio como punto de extensión neutral. En iteraciones, el `htmlFragment` devuelto por Pandoc es el equivalente del AST post-render. Los filtros Lua de Pandoc (para transformar el AST antes de escribir) son más poderosos que el hook `afterRender` actual. Exponer filtros Lua como parte de la configuración de un plugin (Fase 5, D6 del roadmap) sería una ventaja real.

### Quartz

Quartz (Obsidian-to-web) tiene un pipeline de `QuartzTransformerPlugin` con dos métodos: `markdownPlugins()` y `htmlPlugins()`. Es explícitamente un array de transformaciones encadenadas.

**Lección directa:** El contrato de Quartz (`markdownPlugins()` / `htmlPlugins()`) es exactamente el tipo de interfaz que Fase 1b debería definir. La diferencia es que Quartz trabaja sobre un solo tipo de documento (nota), mientras iteraciones tiene 9+ tipos con semánticas distintas.

---

## 7. Features futuras

### Fundamentales (necesarias para madurez)

**F1 — Validación de frontmatter por tipo**

Actualmente `parseFrontmatter()` devuelve `Frontmatter` con campos opcionales para todos los tipos. Un documento `type: event` puede pasar sin campos `date` o `location` y el error solo aparece en el output HTML (vacío). Se necesita validación en `classify` o en el type-stage correspondiente.

**F2 — `onDocumentClassified` hook para plugins**

Permite que un plugin cambie el `type` o `kind` inferido de un documento. Necesario para plugins que mapeen a tipos custom sin modificar el core.

**F3 — `generateFiles()` en plugins**

La capacidad de que un plugin genere archivos adicionales (sitemap, feed RSS, índice de búsqueda) debe diseñarse durante Fase 1 aunque no se implemente hasta Fase 5. El stage `WriteStage` es el punto de integración natural.

**F4 — Pipeline de exportación como variante reutilizable**

El contrato de stage de Fase 1b debe diseñarse con exportación en mente. El `WriteStage` debe poder ser sustituido por un `ExportStage` sin reimplementar los stages anteriores.

### Diferenciadoras

**D1 — Type-safe context builders**

Reemplazar `TemplateContext = Record<string, unknown>` por tipos específicos por `DocumentType`:

```typescript
type FileTemplateContext = {
  title: string;
  body: string;
  'author-href'?: string;
  // …
};
type CollectionTemplateContext = {
  title: string;
  'list-items': ListItem[];
  // …
};
```

Esto haría que un context builder incorrecto fallara en compilación, no en runtime. Alto impacto, alta complejidad. Requiere que el type-graph de Fase 1b esté estable.

**D2 — Grafo de dependencias explícito para builds incrementales**

El type-graph de Fase 1b naturalmente codifica qué tipos dependen de cuáles. Extender cada `TypeStageSpec` con un método `invalidates(changedDoc, allDocs)` permite implementar builds incrementales reales en `serve` (Fase 3 del roadmap).

**D3 — Plugins con tipos custom**

Con el type-graph como estructura de datos, un plugin podría declarar un nuevo `TypeStageSpec`:

```typescript
// plugin.ts
export default {
  name: 'plugin-podcast',
  typeStages: [{
    types: ['podcast-episode'],
    phase: 'primary',
    // …
  }],
};
```

Esto convertiría iteraciones en una plataforma extensible en tipos, no solo en transformaciones.

### Visionarias

**V1 — Pipeline distribuido**

Si cada stage opera sobre `BuildDocument[]` con un contrato puro, los stages más costosos (`RenderStage` con Pandoc) podrían distribuirse entre workers Bun. El contrato de stage hace esta distribución posible sin cambiar la lógica de negocio.

**V2 — Virtual documents generados por plugins**

Un stage podría generar `BuildDocument` que no provienen de archivos físicos (ej. una página de índice generada automáticamente, un changelog, una página de búsqueda). El `DiscoverStage` ya separa el origen de los documentos del pipeline; extenderlo para aceptar documentos virtuales es un cambio relativamente pequeño.

**V3 — Composición declarativa del pipeline**

En lugar de un array fijo de stages, el pipeline podría definirse en `_iteraciones.yaml`:

```yaml
pipeline:
  - discover
  - classify
  - render
  - context
  - compose
  - write
  - plugin: "@iteraciones/plugin-sitemap"
  - plugin: "@iteraciones/plugin-rss"
```

Esto haría el orden del pipeline observable y configurable sin tocar código.

---

## 8. Riesgos a largo plazo

### R1 — Crisis del orquestador monolítico (crítico)

**Probabilidad sin Fase 1:** Alta · **Impacto:** Alto · **Reversibilidad:** Baja

El orquestador crece ~50 líneas por cada nuevo tipo de documento. A 12-15 tipos, `build()` tendrá 600+ líneas con 40+ variables locales interrelacionadas. En ese punto, cualquier modificación al orden de procesamiento tendrá un riesgo alto de introducir bugs de dependencia silenciosos (tipo procesado antes de que sus dependencias estén renderizadas). El refactoring de Fase 1 se vuelve progresivamente más difícil a medida que crece el número de tipos.

**Señal de alerta:** Si se añaden 2 tipos nuevos antes de Fase 1b, el refactoring ya es peligroso sin tests de integración.

### R2 — El type-graph se vuelve demasiado complejo para ser un array simple

**Probabilidad:** Media · **Impacto:** Medio · **Reversibilidad:** Alta

Con types que dependen de otros types que a su vez dependen de otros, el grafo puede tener ciclos (que actualmente no existen pero podrían introducirse por error). Un array de `TypeStageSpec` no detecta ciclos. Si el grafo crece, puede requerirse un topological sort real.

**Mitigación:** El grafo actual es un DAG de 3 fases (`primary → blocks → index`) sin ciclos dentro de cada fase. Documentar esta invariante y agregar una validación de ciclos al cargar el type-graph.

### R3 — Acoplamiento temporal entre tipos no declarado

**Probabilidad:** Alta · **Impacto:** Medio · **Reversibilidad:** Media

Actualmente, los bloques de tipo `list` solo tienen acceso al pool `[renderedFileDocs, renderedAuthorDocs, renderedEventDocs]` porque el pre-paso de bloques ocurre antes de que `collection`, `card`, etc. estén renderizados. Esto es una **limitación conocida y documentada** en el código. Sin embargo, no está representada en la estructura de datos del tipo; está solo en un comentario.

Si se intenta que un bloque `list` filtre por `type: collection`, el resultado estará vacío sin ninguna advertencia. Con el type-graph, la `buildPool` de bloques puede derivarse automáticamente de `spec.dependsOn` en la fase `primary`, haciendo la limitación explícita y detectable.

### R4 — Incompatibilidad futura de `TemplateContext` plano con tipos custom

**Probabilidad:** Media · **Impacto:** Alto · **Reversibilidad:** Baja

`TemplateContext = Record<string, unknown>` es flexible hoy pero no escala a tipos-safe. Si en Fase 4 se añaden metadatos editoriales complejos (`isbn`, `series`, `volume`) y en Fase 5 plugins que generan contextos adicionales, el `TemplateContext` plano puede producir colisiones de claves silenciosas.

**Mitigación:** `mergeContexts()` ya usa `{ ...base, ...override }` con precedencia explícita. Documentar la convención de namespacing de claves por tipo (prefijo `collection-`, `author-`, etc.) antes de que el número de claves crezca.

### R5 — Sin tests de integración, cualquier refactoring de Fase 1 es peligroso

**Probabilidad:** Alta · **Impacto:** Alto

Este es el riesgo más urgente. El roadmap dice: "el orquestador completo no debe tocarse antes de tener la test suite de integración". Sin los tests de fixtures de Fase 1c, la Fase 1b puede introducir regresiones en el procesamiento de tipos complejos (bloques con collection, autores relacionados en events) que solo se detectarían manualmente.

**Mitigación:** Implementar **Fase 1c antes de Fase 1b**. La Fase 1a (extracción de funciones nombradas) puede hacerse antes de los tests porque no cambia lógica.

---

## 9. Backlog técnico

### Milestones

| Milestone | Condición | Estimación |
|---|---|---|
| **v0.6.0-alpha** | Fase 1a completa (orquestador con funciones nombradas) | Semana 3 |
| **v0.6.0-beta** | Fase 1c completa (tests de integración con 5 fixtures) | Semana 5 |
| **v0.6.0** | Fase 1b completa (type-graph + PipelineStage) | Semana 7 |
| **v0.6.1** | Fase 1d completa (docs/content-model.md) | Semana 8 |

### Quick wins (≤1 día cada uno)

| # | Tarea | Archivo | Impacto |
|---|---|---|---|
| QW1 | Reemplazar `console.warn` por `process.stderr.write` en `theme-resolver.ts` | `theme-resolver.ts` | Consistencia |
| QW2 | Tipar `VALID_TYPES` como `Set<DocumentType>` en lugar de `Set<string>` | `infer-type.ts` | Type safety |
| QW3 | Agregar comentario en `buildBlockTypeContext` explicando la limitación del pool | `orchestrator.ts` | Claridad |
| QW4 | Agregar validación de que `listCandidatePool` no esté vacío cuando `doc.frontmatter.filters` está definido | `pipeline/context/list.ts` | Robustez |
| QW5 | Extraer la construcción del `pluginFingerprint` a una función separada | `orchestrator.ts` | Legibilidad |

### Refactors (Fase 1a)

| # | Tarea | Esfuerzo |
|---|---|---|
| R1 | Extraer `setupBuildEnvironment()` | 2h |
| R2 | Extraer `runDiscovery()` | 1h |
| R3 | Extraer `buildEnrichedSiteContext()` | 1h |
| R4 | Extraer `runPrimaryRender()` | 2h |
| R5 | Extraer `runBlocksPrestep()` | 2h |
| R6 | Extraer `runContextPhase()` | 3h |
| R7 | Extraer `runFinalization()` | 2h |

### Tests de integración (Fase 1c)

| # | Fixture | Tests prioritarios |
|---|---|---|
| T1 | `simple-site` | Build produce archivos HTML; list pagina correctamente |
| T2 | `with-authors` | Author context incluye publicaciones; collection resuelve items |
| T3 | `with-blocks` | Bloque inyectado en región correcta; bloque no genera archivo propio |
| T4 | `with-pagination` | Genera `index.html` + `index/2.html`; links de prev/next correctos |
| T5 | `with-events` | Event resuelve speakers; events pagina correctamente |
| T6 | `cache-consistency` | Segundo build con caché produce HTML idéntico |
| T7 | `dry-run` | `--dry-run` no genera archivos; muestra conteo correcto |
| T8 | `no-cache` | `--no-cache` produce el mismo output que build frío |

### Mejoras arquitectónicas (Fase 1b)

| # | Tarea | Esfuerzo | Depende de |
|---|---|---|---|
| A1 | Definir `PipelineStage` interface | 2h | Fase 1a |
| A2 | Crear `TypeStageSpec` y `type-graph.ts` con los 9 tipos | 4h | A1 |
| A3 | Mover `buildBlockTypeContext` a specs individuales | 3h | A2 |
| A4 | Reemplazar pools manuales con `spec.buildPool(renderedMap)` | 3h | A2 |
| A5 | Reemplazar `allRenderedDocs` spread con iteración sobre `renderedMap` | 1h | A2 |
| A6 | Actualizar imports del orquestador (eliminar imports de context builders concretos) | 1h | A3, A4 |
| A7 | Derivar `VALID_TYPES` desde el type-graph | 1h | A2 |

### Herramientas de debugging y observabilidad

| # | Tarea | Descripción |
|---|---|---|
| D1 | Estadísticas por stage en `--verbose` | Cuántos docs procesó, cuántos de caché, tiempo |
| D2 | Grafo de dependencias en `--dry-run` | Mostrar el orden de procesamiento de tipos |
| D3 | `iteraciones debug-cache` | Listar entradas de caché con keys y timestamps |

### Métricas y benchmarks

| # | Métrica | Baseline (estimar) | Objetivo |
|---|---|---|---|
| M1 | Tiempo de build de 50 docs | ~15-25s (estimado) | <15s |
| M2 | Tiempo de build con caché caliente | ~5-10s (estimado) | <3s |
| M3 | Líneas en `build()` post-Fase 1a | 270 | <80 |
| M4 | Lugares a modificar al agregar un tipo | 5-9 | 1-2 |
| M5 | Cobertura de tests en `src/builder/` | 0% | >60% |

---

## 10. Evaluación final

### ¿Qué tan sólido puede volverse el bloque?

**Muy sólido**, con condiciones. El código actual demuestra que las decisiones fundamentales son correctas: separación de discover/classify/render/compose/write, context builders por tipo, caché desacoplada del pipeline, plugins con hooks bien definidos. Nada de esto necesita rehacerse.

Lo que necesita cambiar es la **coordinación**: cómo el orquestador sabe qué tipo depende de qué, en qué orden procesarlos, y cómo construir el contexto para cada uno. Actualmente esto vive como procedimiento imperativo en `build()`; debe convertirse en datos declarativos en `type-graph.ts`.

### ¿Qué tan crítico es para el proyecto?

**El más crítico de todos los bloques.** El orquestador es el único punto de entrada del pipeline de build. Si se rompe, todo el proyecto se rompe. Si se vuelve inmantenible, el proyecto se detiene.

Más importante: el orquestador es el bloqueador de **todas las features de alto impacto**: exportación PDF/EPUB (Fase 4), builds incrementales (Fase 3), tipos custom en plugins (Fase 5). Sin el refactoring de Fase 1, agregar cualquiera de estas features requiere modificar el mismo archivo monolítico con alto riesgo de regresión.

### ¿Qué tan difícil es madurarlo?

**Técnicamente: no muy difícil.** El código existente es limpio, tipado y sin deuda técnica grave. El refactoring de Fase 1a es casi mecánico (mover bloques a funciones). El de Fase 1b requiere diseñar bien el `TypeStageSpec` interface, pero es un problema de diseño de API bien acotado.

**Operacionalmente: requiere disciplina de orden.** Los tests de integración (Fase 1c) deben existir antes de Fase 1b. Si se aplica Fase 1b sin tests, el riesgo de regresión silenciosa es alto. La tentación de ir directamente a Fase 1b (más elegante) antes de tener Fase 1c (más aburrida) es el riesgo real.

### ¿Cuál es la ventaja estratégica real?

Un type-graph declarativo convierte iteraciones en un sistema **extensible en tipos de contenido**, no solo en transformaciones. Esto es lo que diferencia a iteraciones de Hugo (tipos fijos en Go), Eleventy (tipos de usuario sin semántica editorial) y mdBook (un solo tipo de documento).

Con el contrato de stage y el type-graph, un plugin puede declarar un tipo `podcast-episode`, `glossary-term`, `dataset` o `bibliography-entry` con su propia lógica de contexto, resolución de dependencias y template. Ningún SSG generalista ofrece esto con la claridad que el diseño actual hace posible.

La **exportación editorial** (PDF/EPUB) también se vuelve natural: es otro conjunto de stages que reutiliza `discover`, `classify`, `render` y `context` y sustituye `compose` y `write` por equivalentes para formatos de libro. Sin el contrato de stage, esta reutilización es imposible sin duplicar código.

En resumen: **Fase 1 no es un refactor de comodidad. Es la precondición técnica de todo lo que hace especial al proyecto.**

---

*Análisis generado en mayo 2026 · iteraciones-cli v0.4.0 (post-Fase 0) · `src/builder/orchestrator.ts` + pipeline*

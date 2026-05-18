# Análisis arquitectónico — Fase 2: DX y configuración

> Auditoría: junio 2026 · iteraciones-cli v0.4.x (post-Fase 1)  
> Bloque analizado: `src/cli/` · `src/config/` · `src/errors.ts`

---

## 1. Evaluación del bloque actual

### Responsabilidades reales

El bloque DX/configuración abarca tres capas ortogonales:

**Capa de entrada (`src/cli/`, 11 archivos, 875 líneas):**
- `parser.ts` — define el árbol de comandos con Commander y delega en `dispatcher.ts`
- `dispatcher.ts` — ejecuta los comandos y convierte excepciones en salidas formateadas
- `validate.ts`, `doctor.ts`, `init.ts` — comandos con lógica propia
- `serve.ts`, `watch.ts`, `watcher.ts` — ciclo de vida del servidor local
- `http-server.ts`, `livereload.ts` — infraestructura de servidor y SSE
- `doctor/system-checks.ts`, `doctor/project-checks.ts` — checks del entorno

**Capa de configuración (`src/config/`, 2 archivos, 108 líneas):**
- `config-loader.ts` — lee y parsea `_iteraciones.yaml` con fallback a defaults
- `site-config.ts` — define `SiteConfig`, `DEFAULT_SITE_CONFIG`, `KNOWN_ACCENT_COLORS`

**Capa de errores (`src/errors.ts`, 30 líneas):**
- Define `PandocError`, `ConfigError`, `PluginError`

### Qué está bien

- `dispatcher.ts` es consistente: todas las excepciones se capturan, se usan `PandocError`/`ConfigError` para dar contexto cuando el tipo lo tiene, se aplica `process.stderr.write` + `process.exitCode = 1` correctamente.
- `errors.ts` es mínimo y expresivo: cada clase lleva el campo de contexto relevante (`sourcePath`, `configPath`, `pluginPath`).
- `parser.ts` valida los dos argumentos escalares que puede recibir (`--concurrency` y `--port`) antes de ejecutar el comando. Es el único punto de validación de entrada del CLI.
- `config-loader.ts` nunca lanza por campos ausentes o de tipo incorrecto: siempre aplica el default. El resultado es que un proyecto con `_iteraciones.yaml` vacío funciona igual que uno sin él.
- `doctor.ts` implementa `--fix` con un patrón limpio: cada `CheckResult` puede llevar un `fixAction` opcional, lo que permite extender los checks sin tocar la lógica de presentación.
- `init.ts` usa la bandera `wx` del sistema de archivos para crear los archivos sin sobrescribir — semántica correcta para un comando de scaffolding.
- `validate.ts` da salida determinista (archivos ordenados antes de procesar) y hace un resumen de errores limpio.

### Qué está mal

**1. `console.warn` en `config-loader.ts`**  
La función `resolveAccent` llama a `console.warn(...)` cuando el color de acento es desconocido. Rompe el contrato del proyecto (toda salida de error debe ir a `process.stderr.write`) y contamina stdout en contextos donde se usa el output del CLI como pipe.

```typescript
// src/config/config-loader.ts:resolveAccent (línea ~57)
console.warn(`[iteraciones] Color de acento desconocido: "${value}"...`);
```

**2. `--output` no está expuesto en el CLI**  
`BuildOptions.outputDir` existe y el pipeline lo usa correctamente, pero `parser.ts` no tiene ningún flag `--output`. El usuario no puede cambiar el directorio de salida sin tocar el código. Esto bloquea casos de uso legítimos (CI que construye en un directorio específico, monorepos con varias salidas).

**3. `runClean` ignora `outputDir`**  
`dispatcher.ts:runClean` limpia `join(cwd, 'dist/web')` de forma hardcoded, ignorando cualquier configuración de salida. Si un usuario usara `--output ./public` (cuando esté disponible), `clean` no limpiaría el directorio correcto.

**4. `validate` solo verifica sintaxis YAML, no semántica**  
El comando `validate` detecta YAML malformado, pero no:
- Si los valores de `type:` son válidos (podría usar `VALID_TYPES` de `type-graph.ts`)
- Si los archivos listados en `items:` de una colección existen
- Si `region:` tiene un valor reconocido
- Si el template referenciado por `template:` existe en disco
- Si los campos obligatorios por tipo están presentes

Un `iteraciones validate` sin errores no garantiza que `iteraciones build` vaya a tener éxito.

**5. `SiteConfig` carece de campos editoriales**  
La interfaz actual es:
```typescript
interface SiteConfig {
  title, tagline, lang, logo, listItemsLimit, plugins, theme, accent
}
```
No hay `baseUrl`, `author`, `copyright`, `description` ni campos de build separados (`build.outputDir`, `build.concurrency`). El URL base es el campo más urgente: sin él, las rutas absolutas en feeds RSS, sitemaps o canonical links son imposibles sin heurísticas externas.

**6. Modo `--verbose` con información mínima**  
Con `--verbose` se emiten 4 mensajes:
1. `Assets generados en {outputDir}`
2. `Descubiertos {n} documentos`
3. `Excluidos {n} borradores (draft:true)` (condicional)
4. `Escritos {n} archivos en {outputDir}`

No hay: tiempo de build, desglose por tipo de documento, tasa de aciertos de caché, tiempo de pandoc, ni tamaño del output. El verbose actual no ayuda a diagnosticar builds lentos.

**7. `serve` no pasa opciones al `build`**  
`serve.ts` llama `await build(cwd)` sin opciones — sin concurrency personalizada, sin verbose. Durante el desarrollo es el comando más usado y el menos configurable.

**8. Errores de rebuild en `serve.ts` van a stdout**  
```typescript
// serve.ts:stopWatcher callback
process.stdout.write(`serve: error en rebuild — ${...}\n`);
```
Los errores deben ir a `stderr`. Mezclar en `stdout` rompería cualquier parsing externo del output del servidor.

**9. No existe `iteraciones new`**  
El único scaffolding disponible es `iteraciones init`, que crea `_iteraciones.yaml` y `README.md` genéricos. No hay forma de crear un documento nuevo con el frontmatter mínimo correcto para su tipo (`file`, `collection`, `author`, `event`, `block`). Los usuarios tienen que copiar ejemplos o consultar la documentación para saber qué campos poner.

**10. Falta documentación de referencia**  
`docs/` tiene solo tres archivos de análisis interno (`analisis-fase-0.md`, `analisis-fase-1.md`, `content-model.md`). No hay `quickstart.md`, `frontmatter-reference.md`, `configuration.md`, `plugins.md` ni `themes.md`. El `content-model.md` existe (Fase 1d) pero no hay entrada al sistema para un usuario nuevo.

### Nivel de madurez

**Funcional para uso interno, insuficiente para adopción externa.** Las partes más usadas (build, serve, watch) funcionan correctamente. Las partes orientadas al usuario nuevo (init, validate, mensajes de error) son básicas o incompletas. El 30% de los problemas listados son triviales de corregir (1-2 horas cada uno). El 70% restante requiere decisiones de diseño previas.

### Métricas actuales

| Métrica | Valor |
|---|---|
| Comandos CLI | 8 (`build`, `clean`, `info`, `init`, `validate`, `watch`, `doctor`, `serve`) |
| Opciones en `build` | 6 (`--concurrency`, `--no-cache`, `--project-root`, `--no-tailwind`, `--dry-run`, `--verbose`) |
| Opciones expuestas vs disponibles en `BuildOptions` | 6/8 (falta `--output` y `--css-path`) |
| Campos en `SiteConfig` | 8 (falta `baseUrl`, campos de build, metadatos editoriales) |
| Validaciones semánticas en `validate` | 0 (solo YAML sintáctico) |
| Mensajes en modo `--verbose` | 4 |
| Instancias de `console.warn` en el proyecto | 1 (`config-loader.ts:resolveAccent`) |
| Comandos de scaffolding | 1 (`init`; sin `new`) |
| Archivos de documentación de usuario | 0 (los existentes son análisis interno) |

### Acoplamiento

La capa CLI está correctamente desacoplada del pipeline: `dispatcher.ts` solo importa `build()`, `loadSiteConfig()` y las clases de error. No conoce el pipeline internamente.

El acoplamiento problemático está dentro de `config-loader.ts`: la validación de `accent` llama a `console.warn` en lugar de a `process.stderr.write`, y no hay una separación entre "parsear el YAML" y "validar los valores semánticos". Mezclar ambas en `loadSiteConfig` hace difícil reutilizar el parsing en un contexto de validación offline.

### Deuda técnica

| Deuda | Severidad | Archivo |
|---|---|---|
| `console.warn` en `resolveAccent` | Alta | `config/config-loader.ts` |
| `runClean` con `dist/web` hardcoded | Media | `cli/dispatcher.ts` |
| `--output` sin exponer en CLI | Media | `cli/parser.ts` |
| Errores de rebuild en stdout en `serve.ts` | Media | `cli/serve.ts` |
| `validate` sin validación semántica | Alta | `cli/validate.ts` |
| `SiteConfig` sin `baseUrl` | Media | `config/site-config.ts` |
| `serve` llama `build()` sin opciones | Baja | `cli/serve.ts` |

---

## 2. Objetivo ideal del bloque

### Responsabilidades que debería tener

**`parser.ts`** debería:
- Exponer todos los `BuildOptions` relevantes como flags del comando `build`
- Tener opciones globales (`--project-root`, `--config`) reutilizables entre comandos
- Mantener toda la validación de tipos de argumentos en este módulo (no en dispatcher)

**`config-loader.ts`** debería:
- Separar **parsing** de **validación**: una función pura `parseSiteConfig(raw: unknown): SiteConfig` y una función de validación `validateSiteConfig(config: SiteConfig): ValidationIssue[]`
- Nunca emitir warnings directamente; retornar advertencias al caller
- Soportar `baseUrl` y campos de build opcionales

**`validate.ts`** debería:
- Validar toda la información que haría fallar un `build`: frontmatter semántico, tipos válidos, items existentes, templates disponibles, regiones válidas
- Usar `VALID_TYPES` de `type-graph.ts` para validar valores de `type:`
- Tener `--strict` mode que trate advertencias como errores
- Retornar código de salida 0 solo cuando el proyecto puede construirse sin errores

**`errors.ts`** debería:
- Agregar `ValidationError` con `file`, `line`, `column`, `rule`, `suggestion`
- Considerar severity levels: `error` | `warning` | `info`

**`init.ts` / `new.ts`** deberían:
- `init`: scaffolding de proyecto (como hoy)
- `new`: scaffolding de documento por tipo, con frontmatter mínimo correcto

### Lo que NO debería hacer

- La capa CLI **no** debería conocer el pipeline de build ni los tipos de documentos
- `config-loader.ts` **no** debería emitir output directamente (ni a stdout ni a stderr ni console)
- `validate.ts` **no** debería ejecutar pandoc ni renderizar documentos

### Arquitectura ideal

```
parser.ts
  └─ buildProgram()
       ├─ command('build')    ← --output, --concurrency, --no-cache, --dry-run, --verbose
       ├─ command('validate') ← --strict, --type <type>, --fix (futuro)
       ├─ command('new')      ← <type> <path> [--region <region>]
       └─ command('doctor')   ← --fix

config-loader.ts
  ├─ parseSiteConfig(raw: unknown): SiteConfig        ← parsing puro, sin side effects
  ├─ validateSiteConfig(config: SiteConfig, cwd: string): ValidationIssue[]
  └─ loadSiteConfig(cwd: string): Promise<{ config: SiteConfig; warnings: ValidationIssue[] }>

errors.ts
  ├─ PandocError(message, sourcePath, stderr)
  ├─ ConfigError(message, configPath)
  ├─ PluginError(message, pluginPath)
  └─ ValidationError(message, file, rule?, suggestion?)

validate.ts
  ├─ validateConfig(cwd)        ← config semántica
  ├─ validateFrontmatter(cwd)   ← YAML + tipo + campos requeridos
  ├─ validateItemPaths(cwd)     ← items: en collections
  ├─ validateRegions(cwd)       ← region: en blocks
  └─ validateTemplates(cwd)     ← template: references
```

### Contrato para `--verbose`

El output verbose en un build completo debería verse así:

```
build: 47 documentos descubiertos (2 borradores omitidos)
build: pandoc — 35 conversiones en 2.9s (35 miss, 0 hit de caché)
build: compose — 47 documentos en 0.8s (39 hit de caché)
build: escritos 47 archivos HTML, 1 CSS, 3 fuentes → dist/web/
build: completado en 4.1s
```

---

## 3. Roadmap por fases

### Fase 2a — Correcciones inmediatas (≈ 2–3 días)

**Objetivo:** Eliminar la deuda técnica trivial y exponer opciones ya disponibles.

**Tareas:**
1. `fix(config): reemplazar console.warn por process.stderr.write en resolveAccent`
2. `feat(cli): exponer --output <path> en comando build`
3. `fix(cli): runClean usa outputDir resuelto en lugar de dist/web hardcoded`
4. `fix(cli): mover error de rebuild en serve.ts de stdout a stderr`
5. `feat(cli): pasar concurrency y verbose a build() desde serve.ts`

**Dependencias:** ninguna.  
**Riesgo:** mínimo — cambios aislados de 1-5 líneas cada uno.  
**Complejidad:** baja.  
**Criterios de finalización:** `bun run typecheck` sin errores; el test de integración existente no regresiona; el output de `serve` en caso de error de rebuild aparece en stderr.

### Fase 2b — Validación semántica (≈ 1 semana)

**Objetivo:** Que `iteraciones validate` detecte el 100% de los errores que harían fallar un build.

**Tareas:**
1. Importar `VALID_TYPES` de `type-graph.ts` y validar el campo `type:` en el frontmatter
2. Validar campos requeridos por tipo (p.ej. `collection` requiere `items:` o maneja el caso de ausencia explícitamente)
3. Validar que las rutas en `items:` de colecciones apunten a archivos `.md` existentes
4. Validar que `region:` en documentos `block` tenga un valor reconocido (definir `VALID_REGIONS` en `constants.ts` o `type-graph.ts`)
5. Validar que el template referenciado en `template:` exista en disco (local o del paquete)
6. Reportar advertencias de `loadSiteConfig` (p.ej. `accent` desconocido) sin lanzar error

**Dependencias:** Fase 2a completa (para que el contrato de errores sea consistente).  
**Riesgo:** medio — requiere acceso al filesystem para las validaciones de paths.  
**Complejidad:** media — 5 funciones de validación independientes.  
**Criterio de finalización:** un proyecto con `items:` que apuntan a archivos inexistentes produce un error en `validate` antes del build.

### Fase 2c — Scaffolding con `iteraciones new` (≈ 3–4 días)

**Objetivo:** Que un usuario nuevo pueda crear cualquier tipo de documento sin consultar la documentación de frontmatter.

**Tareas:**
1. Crear `src/cli/new.ts` con función `runNew(cwd, type, outputPath, options)`
2. Registrar el comando `new <type> <path>` en `parser.ts` con opción `--region <region>` para blocks
3. Definir templates de frontmatter mínimo por tipo en un mapa interno (no archivos externos)
4. Validar que `<type>` sea un `DocumentType` válido; mostrar la lista si no lo es
5. Usar flag exclusivo `wx` igual que `init.ts`

**Dependencias:** `VALID_TYPES` de `type-graph.ts` (ya disponible).  
**Riesgo:** bajo — independiente del pipeline de build.  
**Complejidad:** baja.  
**Criterio de finalización:** `iteraciones new file notas/mi-articulo.md` crea un archivo con el frontmatter correcto.

### Fase 2d — Build report e informe verbose (≈ 2–3 días)

**Objetivo:** Que `--verbose` sea útil para diagnosticar builds lentos y entender el estado de la caché.

**Tareas:**
1. Añadir timestamps a los pasos del pipeline (`Date.now()` antes/después de cada paso nombrado)
2. Retornar o acumular estadísticas desde `renderDocuments` (hits/misses de caché, tiempo)
3. Añadir al final del build un resumen formateado con el desglose por paso
4. Agregar estadísticas de `writeDocuments` (número de archivos por tipo, tamaño total)

**Dependencias:** ninguna (aditivo, no modifica el contrato de las funciones).  
**Riesgo:** bajo — changes are additive.  
**Complejidad:** media — requiere propagar estadísticas a través del pipeline.  
**Criterio de finalización:** `--verbose` muestra tiempo de pandoc, tasa de aciertos de caché y tiempo total del build.

### Fase 2e — Documentación de referencia (≈ 1 semana)

**Objetivo:** Que un usuario nuevo pueda hacer su primer build exitoso sin leer código fuente.

**Tareas:**
1. `docs/quickstart.md` — del `init` al primer build, paso a paso
2. `docs/frontmatter-reference.md` — todos los campos por tipo con tipos y ejemplos
3. `docs/configuration.md` — `_iteraciones.yaml` campo por campo
4. `docs/plugins.md` — hooks disponibles con ejemplos mínimos
5. `docs/themes.md` — cómo personalizar layouts y templates

**Dependencias:** `docs/content-model.md` (Fase 1d, disponible).  
**Riesgo:** nulo (solo escritura).  
**Criterio de finalización:** un desarrollador externo sin contexto del proyecto puede completar el quickstart en menos de 30 minutos.

### Fase 2f — `baseUrl` y metadatos editoriales (≈ 2 días)

**Objetivo:** Habilitar generación de URLs absolutas para RSS feeds, sitemaps y canonical links.

**Tareas:**
1. Agregar `baseUrl?: string` a `SiteConfig` e `DEFAULT_SITE_CONFIG`
2. Parsear `site.base-url` desde `_iteraciones.yaml` en `config-loader.ts`
3. Exponer `baseUrl` en `TemplateContext` como `site-base-url`
4. Documentar en `docs/configuration.md`

**Dependencias:** Fase 2e (documentación).  
**Riesgo:** bajo — cambio aditivo.  
**Criterio de finalización:** `{{ site-base-url }}` disponible en templates.

---

## 4. Problemas críticos

### P1 — `console.warn` en `config-loader.ts`

| Atributo | Valor |
|---|---|
| Severidad | Alta |
| Urgencia | Inmediata |
| Dificultad | Trivial (1 línea) |
| Impacto arquitectónico | Bajo (solo corrección de contrato) |

Rompe la invariante del proyecto: toda salida de diagnóstico va a stderr. Si el output del CLI se procesa como pipe, un `console.warn` contamina stdout. Es la única instancia en el código base.

### P2 — `validate` da falsa seguridad semántica

| Atributo | Valor |
|---|---|
| Severidad | Alta |
| Urgencia | Media |
| Dificultad | Media (requiere diseño) |
| Impacto arquitectónico | Alto (define el contrato del comando) |

Un usuario que ejecuta `iteraciones validate` y no ve errores asume que su proyecto está listo para el build. Sin validación semántica, esto es falso: puede haber `items: [posts/articulo.md]` que no existe, o `type: articulo` que no es un tipo válido, y ninguno se detecta. El primer fallo visible ocurre en el build, con un mensaje de error menos orientado al usuario.

### P3 — `runClean` con path hardcoded

| Atributo | Valor |
|---|---|
| Severidad | Media |
| Urgencia | Media (se vuelve alta cuando se exponga `--output`) |
| Dificultad | Trivial |
| Impacto arquitectónico | Bajo |

Si un usuario configura un directorio de salida personalizado y ejecuta `clean`, el directorio real de salida no se limpia. Puede generar confusión sobre por qué el build antiguo sigue presente.

### P4 — Sin `baseUrl` en `SiteConfig`

| Atributo | Valor |
|---|---|
| Severidad | Media |
| Urgencia | Baja (no bloquea uso actual) |
| Dificultad | Baja |
| Impacto arquitectónico | Medio (bloquea RSS, sitemaps, canonical) |

El sistema asume rutas relativas en todo el sitio. Para feeds RSS o sitios con herramientas de SEO, las rutas absolutas son necesarias. Añadir `baseUrl` después de que haya muchos templates en uso puede requerir coordinar actualizaciones de templates.

### P5 — `serve.ts` propaga errores de rebuild a stdout

| Atributo | Valor |
|---|---|
| Severidad | Media |
| Urgencia | Media |
| Dificultad | Trivial |
| Impacto arquitectónico | Bajo |

Un script que parsee la salida del servidor para detectar errores no puede distinguirlos de la salida normal del servidor. También viola el contrato del CLI.

### P6 — Modo verbose prácticamente vacío

| Atributo | Valor |
|---|---|
| Severidad | Baja |
| Urgencia | Baja |
| Dificultad | Media |
| Impacto arquitectónico | Bajo |

El flag `--verbose` existe pero aporta información insuficiente para diagnóstico real. No hay timing, no hay estadísticas de caché, no hay progreso documento a documento. En un proyecto con 100+ archivos, no hay forma de saber qué paso está tardando.

---

## 5. Evolución técnica

### Lo que vale la pena sofisticar

**Sistema de validación estructurado:** el paso de `ValidationError` como tipo a usar en `validate.ts` (en lugar del tipo ad-hoc `{ file: string; message: string }`) abre la puerta a severity levels, sugerencias de corrección automática, y agrupación de errores por tipo de problema. La complejidad adicional es baja; el beneficio en UX es significativo.

**Reporte de build con timing por paso:** añadir `hrtime()` en el orquestador alrededor de cada función nombrada (ya están nombradas tras Fase 1a) es un cambio de 5 líneas que produce datos de profiling básicos sin necesidad de herramientas externas. Es el tipo de mejora que tiene cero costo de mantenimiento.

**Separación parsing/validación en `config-loader.ts`:** la función `loadSiteConfig` actualmente hace ambas cosas. Separar `parseSiteConfig(raw: unknown): SiteConfig` (sin I/O, testeable) de `validateSiteConfig(config, cwd)` permite testear el parsing sin tocar el filesystem, y reutilizar la validación desde el comando `validate` para que el feedback sea consistente.

**`iteraciones new` con tipos derivados del grafo:** en lugar de mantener un mapa ad-hoc de frontmatter mínimo por tipo, se puede hacer que `TypeStageSpec` en `type-graph.ts` incluya un campo `minimalFrontmatter(): string` que el comando `new` use. Esto mantiene el grafo de tipos como fuente de verdad, consistente con la Fase 1b.

### Lo que debe mantenerse simple

**No añadir un formato de log estructurado (JSON logs):** el CLI está diseñado para uso humano interactivo. JSON logs son útiles en pipelines de CI, pero agregar un flag `--log-format json` complejiza la capa de salida sin beneficio proporcional para el caso de uso principal.

**No validar tipos de Pandoc internamente:** el sistema ya delega la conversión Markdown→HTML a Pandoc. Intentar detectar qué elementos de Markdown provocarán un error de Pandoc antes de invocarlo duplicaría lógica sin ganancia real.

**No implementar un config watcher para recarga en caliente:** el watcher ya hace rebuild cuando `_iteraciones.yaml` cambia (la extensión `.yaml` está en `WATCHED_EXTENSIONS`). Un mecanismo adicional de hot-reload solo para la config es complejidad sin caso de uso justificado.

---

## 6. Comparación con otros sistemas

### Hugo

Hugo tiene un sistema de CLI muy maduro: `hugo --minify --baseURL https://...` expone todos los parámetros del build como flags. El `hugo new content/posts/mi-post.md` genera frontmatter a partir de arquetipos (archivos de plantilla en `archetypes/`). La diferencia con el diseño ideal de `iteraciones new` es que Hugo usa archivos externos para los arquetipos, mientras que en `iteraciones-cli` tiene más sentido derivar el frontmatter mínimo del `TypeStageSpec` en `type-graph.ts`.

**Idea adaptable:** exponer `--output` (Hugo lo tiene como `--destination`).  
**Error a evitar:** los arquetipos de Hugo son archivos sueltos que pueden divergir de las reglas del tipo; en iteraciones, el frontmatter mínimo debería vivir en la spec del tipo.

### Eleventy

Eleventy tiene `--dryrun` muy utilizado por su output detallado: lista cada archivo que procesaría con su template asignado. El `--verbose` de iteraciones podría adoptar este nivel de detalle para `dry-run`: mostrar tipo, template y destino por cada documento.

**Idea adaptable:** `--dry-run` podría mostrar el tipo inferido y el template asignado por cada documento, no solo los conteos.

### Astro

Astro tiene el output de build más visual del ecosistema: muestra nombre del archivo, tamaño, y si fue generado estático o SSR. El resumen final incluye tiempo total y breakdown por categoría.

**Idea adaptable:** el build report de Fase 2d podría incluir tamaños de archivos HTML generados.

### Jekyll

Jekyll valida el frontmatter automáticamente al leer los archivos, y si el valor de `layout:` no existe en `_layouts/` falla con un error específico. Esto es exactamente el comportamiento que debe tener `iteraciones validate` para `template:`.

**Idea adaptable:** el modelo de "validate-on-load antes del build" de Jekyll es correcto; en iteraciones, la validación debería ser un paso explícito antes del pipeline.

### mdBook

`mdbook init` crea la estructura completa de un libro con `SUMMARY.md` preconfigurado. Es el mejor ejemplo de scaffolding de proyecto en el espacio de generadores de documentación.

**Idea adaptable:** `iteraciones init` podría crear también un `posts/` de ejemplo con un artículo de demostración, no solo `_iteraciones.yaml` y `README.md`.

### Quartz

Quartz tiene un sistema de configuración TypeScript (no YAML) con tipos completos y validación en tiempo de compilación. Elimina la necesidad de un comando `validate` porque los errores de config son errores de TypeScript.

**Error a evitar:** la config en TypeScript requiere un paso de compilación antes del build. Para proyectos editoriales donde el usuario no es desarrollador, YAML es más accesible. La validación runtime sigue siendo necesaria.

---

## 7. Features futuras

### Fundamentales

- **`--output <path>` en `build`**: sin esto, el CLI no soporta casos de uso básicos de CI y monorepos. Riesgo de proliferación de workarounds (scripts shell, variables de entorno no documentadas).
- **`validate` con validación semántica**: que detecte el 100% de los errores que harían fallar un `build`. Sin esto, `validate` genera falsa confianza.
- **Build report con timing**: sin información de timing, los builds lentos son imposibles de diagnosticar sin instrumentación externa.
- **`baseUrl` en `SiteConfig`**: bloquea feeds RSS, sitemaps y cualquier herramienta SEO que requiera URLs absolutas.

### Diferenciadoras

- **`iteraciones new <type> <path>` con frontmatter derivado del type-graph**: el scaffold conoce las reglas del tipo porque lee `TypeStageSpec`. Si se añade un nuevo tipo, `new` lo soporta automáticamente sin cambiar `new.ts`.
- **`validate --explain <file>`**: modo de ayuda que explica por qué un documento tiene determinado `type` inferido, qué template recibirá y qué contexto se construirá para él. Útil para depurar comportamientos inesperados de clasificación.
- **`doctor` con más checks**: verificar que el directorio `dist/` es escribible, que la versión de Bun es suficiente, que los plugins declarados en `_iteraciones.yaml` son accesibles.

### Visionarias

- **JSON schema para `_iteraciones.yaml`**: publicar un schema JSON que habilite autocompletado y validación en VSCode sin instalar ninguna extensión. Hugo y Astro ya tienen schemas publicados. Genera una ventaja de DX significativa con costo bajo.
- **`iteraciones validate --fix`**: para errores simples como `type:` incorrecto o `region:` inválido, sugerir y aplicar la corrección automáticamente (igual que `doctor --fix`).
- **Integración con GitHub Actions**: publicar una action oficial que ejecute `iteraciones validate` y `iteraciones build` en CI, con output de errores formateado como annotations de GitHub.

---

## 8. Riesgos a largo plazo

### R1 — `validate` nunca alcanza la semántica del build

Si `validate` queda perpetuamente como "solo verifica YAML", el comando se vuelve irrelevante: los usuarios aprenden que para saber si su proyecto construye deben ejecutar `build` directamente. El comando ocupa espacio en la interfaz sin aportar valor real. **La ventana para establecer el contrato correcto de `validate` es ahora**, mientras la base de usuarios es pequeña.

### R2 — `SiteConfig` se expande sin estructura

Actualmente `SiteConfig` es una interfaz plana. Cada nueva feature tiende a añadir un campo de primer nivel. Si se añaden `baseUrl`, `outputDir`, `concurrency`, `copyright`, `author`, `social.twitter` todos al mismo nivel, la interfaz se vuelve difícil de mantener y documentar. Es mejor definir una estructura jerárquica antes de añadir el quinto campo: `site.*`, `build.*`, `social.*`.

### R3 — Documentación que diverge del código

El modelo actual (documentación en `docs/`, código en `src/`) puede divergir si los cambios de código no se reflejan en los docs. Sin una suite de tests que verifique que los ejemplos de documentación son válidos, la documentación se stale en semanas. La solución a largo plazo es usar los fixtures de tests como fuente de ejemplos en la documentación.

### R4 — Errores de pandoc sin contexto de archivo

`PandocError` incluye `sourcePath` y el stderr de pandoc, pero el stderr de pandoc rara vez incluye el número de línea del archivo Markdown original (especialmente con pipes). A medida que los proyectos crecen, diagnosticar qué construcción de Markdown provocó un error de pandoc requiere bisección manual. La solución requiere parsing del stderr de pandoc por versión, lo que es frágil.

### R5 — Comandos sin `--project-root` consistente

`build` tiene `--project-root`, pero `serve`, `validate` y `watch` solo usan `process.cwd()`. Si se ejecuta `iteraciones serve` desde un directorio diferente al proyecto, fallará silenciosamente o con un error confuso. Estandarizar `--project-root` como opción global del programa (no de cada subcomando) es trivial con Commander y eliminaría este inconsistencia.

---

## 9. Backlog técnico

### Quick wins (< 1 día cada uno)

| ID | Tarea | Scope |
|---|---|---|
| QW-2.1 | `console.warn` → `process.stderr.write` en `resolveAccent` | `config` |
| QW-2.2 | Exponer `--output <path>` en comando `build` del parser | `cli` |
| QW-2.3 | `runClean` usa `outputDir` resuelto (no `dist/web` literal) | `cli` |
| QW-2.4 | Errores de rebuild en `serve.ts` → stderr | `cli` |
| QW-2.5 | `serve.ts` pasa `concurrency` y `verbose` a `build()` | `cli` |
| QW-2.6 | Estandarizar `--project-root` como opción global del programa | `cli` |

### Refactors (1–3 días cada uno)

| ID | Tarea | Scope |
|---|---|---|
| R-2.1 | Separar `parseSiteConfig` de `validateSiteConfig` en `config-loader.ts` | `config` |
| R-2.2 | Agregar `baseUrl?: string` a `SiteConfig` y parsear `site.base-url` | `config` |
| R-2.3 | Reemplazar tipo ad-hoc `{file, message}` en `validate.ts` por `ValidationError` | `cli` |
| R-2.4 | Añadir `hrtime` en pasos del orchestrator para build report básico | `orchestrator` |

### Features (3–7 días cada una)

| ID | Tarea | Scope |
|---|---|---|
| F-2.1 | Validación semántica de frontmatter en `validate.ts` (tipo, campos, items, region, template) | `cli` |
| F-2.2 | Comando `iteraciones new <type> <path>` con frontmatter del type-graph | `cli` |
| F-2.3 | Build report verbose con timing por paso y tasa de caché | `orchestrator`, `cli` |
| F-2.4 | `iteraciones init` crea un directorio `posts/` con artículo de ejemplo | `cli` |

### Documentación

| ID | Tarea |
|---|---|
| D-2.1 | `docs/quickstart.md` — del init al primer build |
| D-2.2 | `docs/frontmatter-reference.md` — todos los campos por tipo |
| D-2.3 | `docs/configuration.md` — `_iteraciones.yaml` campo por campo |
| D-2.4 | `docs/plugins.md` — hooks disponibles con ejemplos |
| D-2.5 | `docs/themes.md` — layouts y templates |

### Tests

| ID | Tarea |
|---|---|
| T-2.1 | Tests unitarios para `parseSiteConfig` (tras separar parsing/validación) |
| T-2.2 | Tests de integración para `validate` semántico (fixture con errors conocidos) |
| T-2.3 | Tests para `iteraciones new` (verifica frontmatter mínimo por tipo) |

### Prioridad de ejecución recomendada

```
QW-2.1 → QW-2.2 → QW-2.3 → QW-2.4 → QW-2.5    (Fase 2a, 2-3 días)
    ↓
F-2.1 + R-2.3                                     (Fase 2b, ~1 semana)
    ↓
F-2.2                                              (Fase 2c, 3-4 días)
    ↓
R-2.4 + F-2.3                                      (Fase 2d, 2-3 días)
    ↓
D-2.1 → D-2.2 → D-2.3 → D-2.4 → D-2.5           (Fase 2e, ~1 semana)
    ↓
R-2.2 + R-2.1                                      (Fase 2f, 2 días)
```

---

## 10. Evaluación final

### Solidez alcanzable

El bloque CLI/configuración puede alcanzar un nivel de madurez alto con esfuerzo moderado. Los 6 quick wins son todos correctivos de 1–5 líneas sobre código que ya funciona; la semana de trabajo produce un impacto desproporcionado en la calidad percibida del sistema.

La parte más difícil no es técnica: es mantener la coherencia entre `validate.ts` y el pipeline real de build. Si `validate` no cubre todos los paths de error del pipeline, siempre habrá una clase de errores que solo se detectan en `build`. El diseño ideal requiere que cada función del pipeline que puede lanzar pueda también ser invocada en modo "dry validation" sin efectos secundarios.

### Criticidad para el proyecto

**Alta.** La DX es la primera impresión del proyecto. Un usuario que ejecuta `iteraciones build` por primera vez y recibe un error críptico sin sugerencia de solución no regresa. Inversamente, un usuario que ejecuta `iteraciones new file mi-articulo.md` y obtiene un archivo con el frontmatter correcto tiene confianza en el sistema desde el inicio.

El bloque CLI también es el único punto de contacto para usuarios no-técnicos (editores, periodistas, académicos) que son el caso de uso editorial central del proyecto.

### Dificultad de maduración

**Baja a media.** Los 6 quick wins son mecánicos. La validación semántica requiere pensar el contrato completo de `validate` (¿qué debe detectar? ¿cuándo es un error vs advertencia?), pero la implementación técnica es straightforward. `iteraciones new` es el task más autónomo y el que más confianza en el sistema genera.

El único task de dificultad real es el build report con timing: requiere propagar estadísticas a través de múltiples funciones del pipeline, lo que puede ser acoplamiento indeseado si no se diseña como una capa de observabilidad separada.

### Ventaja estratégica real

El proyecto compite con Hugo (velocidad), Eleventy (flexibilidad) y Astro (ecosistema). La ventaja de `iteraciones-cli` es la especialización editorial: colecciones, autores, eventos, bloques, publicación Markdown-first con Pandoc. Esta ventaja se amplifica si la DX es superior para editores no-técnicos.

Un `iteraciones validate` que explique exactamente qué falta antes del build, combinado con un `iteraciones new` que genere el frontmatter correcto sin consultar documentación, es una ventaja competitiva real en el nicho editorial. Ninguno de los SSGs generales tiene un scaffolding orientado a tipos de contenido editorial.

El riesgo estratégico es el opuesto: si la DX permanece básica, el sistema es solo "otro SSG en TypeScript" sin ventaja visible. La Fase 2 es la que convierte el sistema de una herramienta interna en un proyecto adoptable externamente.

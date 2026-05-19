# Roadmap técnico y estratégico — iteraciones-cli

> Versión: 0.5.0 · Última actualización: mayo 2026  
> Perspectiva: arquitecto de software, maintainer senior SSG, estratega técnico, director de producto técnico.

---

## 1. Evaluación de madurez actual

**Clasificación: Herramienta funcional con diferenciador editorial implementado**

El proyecto tiene pipeline completo, caché incremental, sistema de plugins, livereload, CLI completa, exportación PDF/EPUB via LaTeX, test suite y documentación. Las Fases 0–4 y los criterios de Fase 6 del roadmap original están completos.

| Condición | Estado |
|---|---|
| Test suite | ✅ Implementada (`src/template/__tests__/`, `src/builder/__tests__/`) |
| Documentación de usuario | ✅ Implementada (`docs/`) |
| Feature diferenciadora implementada | ✅ Sistema editorial PDF/EPUB (Fases 4a–4e) |
| Citas bibliográficas CSL | ✅ Implementado en HTML + PDF + EPUB (Fase 6) |
| Soporte de math (KaTeX/MathJax) | ✅ Implementado (Fase 6) |

### Estado actual y próximos pasos

**Las condiciones de v1.0 y las Fases 0–4 están completamente resueltas. Los criterios de Fase 6 también están cumplidos (mayo 2026).**

Para seguir madurando hacia v2.0+:
- Hooks adicionales en el sistema de plugins (`beforeBuild`, `onDocumentDiscovered`) — completa Fase 5
- Templates LaTeX especializados para libros (E7 — Fase 6.1)
- Site de documentación con dogfooding (Fase 7.2)
- API de plugins documentada con ejemplos funcionales

**Runtime:** Bun es el runtime exclusivo del proyecto por diseño. No se planea migración a Node.js (ver §8 Riesgos).

### Riesgos actuales

| Riesgo | Probabilidad | Impacto |
|---|---|---|
| Cambio en Bun API rompe el CLI | Media | Alto (riesgo aceptado — Bun es una decisión explícita, ver §8) |
| Pandoc externo: actualización cambia HTML generado | Baja | Medio (documentar versión mínima, testear en CI) |
| Complejidad de xelatex: errores difíciles de interpretar | Media | Medio (stderr filtrado, plantillas estables) |
| Abandono por falta de traction | Media | Total |

---

## 2. Roadmap por fases

---

### Fase 0 — Estabilización ✅ COMPLETADA

**Objetivo:** Hacer el proyecto confiable para el uso actual antes de construir sobre él.

No se agrega ninguna feature. Solo se corrigen bugs, se elimina deuda técnica de bajo riesgo y se construye la red de seguridad mínima.

#### Tareas

**0.1 — Corregir el hash sin separador** (1h)
- Archivo: `src/cache/hasher.ts`
- Cambio: insertar un separador `\0` entre valores para prevenir colisiones.
- Antes: `hasher.update(value)`
- Después: `hasher.update(value); hasher.update('\0')`
- Riesgo: **invalida toda la caché existente** en proyectos que ya usan el CLI. Esto es aceptable y esperado; documentarlo en CHANGELOG.

**0.2 — Unificar `IGNORED_DIRS`** (30min)
- Crear `src/constants.ts` con `export const IGNORED_DIRS = new Set([...])`.
- Reemplazar las tres definiciones duplicadas en `discover.ts`, `document-loader.ts` y `validate.ts`.

**0.3 — Eliminar `document-loader.ts` duplicado** (1-2h)
- El archivo `src/loader/document-loader.ts` define `SourceDocument` por segunda vez (issue #19 pendiente).
- Eliminarlo o convertirlo en re-export de `src/builder/types.ts`.
- Verificar que ningún path lo importe directamente (grep).

**0.4 — Agregar guard de profundidad en `makeRelativeContext`** (1h)
- Archivo: `src/builder/orchestrator.ts`
- Agregar contador de profundidad con límite (ej. 20 niveles) para prevenir stack overflow por objetos circulares de plugins.

**0.5 — Hacer `copyLogo` informativo, no silencioso** (30min)
- Reemplazar `.catch(() => undefined)` por un warning en stderr.
- Agregar validación básica: la ruta del logo no debe contener `..`.

**0.6 — Primer test suite** (1-2 días)
- Objetivo mínimo: tests para `src/template/` completo (lexer, parser, renderer, if, for, variables).
- Son funciones puras sin I/O; perfectas para empezar.
- Usar `bun test` (nativo, sin dependencias adicionales).
- Fixtures: strings de template + contexto esperado → HTML esperado.
- Meta: >80% de cobertura en `src/template/`.

**0.7 — Limitar concurrencia en `writeDocuments`** (30min)
- Reemplazar `Promise.all` por `mapWithConcurrency` con el mismo `concurrency` del contexto.

#### Criterios de finalización
- Todos los bugs críticos listados en la auditoría resueltos.
- `bun test` pasa con cobertura >80% en `src/template/`.
- No hay definiciones duplicadas de `SourceDocument` ni `IGNORED_DIRS`.

#### Dependencias
- Ninguna. Esta fase no depende de otras.

#### Impacto
- El proyecto pasa de "frágil pero funcional" a "confiable para uso actual".
- La test suite permite hacer cambios futuros con confianza.

---

### Fase 1 — Arquitectura base ✅ COMPLETADA

**Objetivo:** Hacer el orquestador extensible sin romper la funcionalidad existente.

Este es el refactoring más importante del proyecto. Sin él, agregar nuevos tipos de documentos, nuevos outputs y nuevas fases del pipeline se vuelve exponencialmente más difícil.

#### 1.1 — Definir el contrato del pipeline

Antes de tocar código, definir en tipos TypeScript qué es una "etapa del pipeline":

```typescript
// src/builder/pipeline/stage.ts
export interface PipelineStage<TIn, TOut> {
  name: string;
  run(input: TIn, ctx: BuildContext): Promise<TOut>;
}
```

Esta abstracción no necesita ser un sistema de plugins ni un framework complejo. Solo necesita ser un tipo que todos los pasos del pipeline implementen.

#### 1.2 — Extraer el grafo de tipos del orquestador

El orquestador codifica implícitamente el orden de procesamiento: `file` → `author` → `event` → `block` → `collection` → etc. Este orden debe estar en una estructura de datos explícita, no en el cuerpo de una función de 370 líneas.

Propuesta:

```typescript
// src/builder/pipeline/stages.ts
export const PIPELINE_STAGES = [
  { types: ['file'],   phase: 'primary' },
  { types: ['author'], phase: 'primary', dependsOn: ['file'] },
  { types: ['event'],  phase: 'primary', dependsOn: ['author'] },
  { types: ['block'],  phase: 'blocks',  dependsOn: ['file', 'author', 'event'] },
  { types: ['collection', 'list', 'authors', 'events', 'menu', 'card'], phase: 'index' },
] as const;
```

#### 1.3 — Refactorizar el orquestador en pasos nombrados

Extraer cada bloque lógico del orquestador a funciones independientes y bien nombradas:

- `runPrimaryDocs(docs, ctx, cache, registry)` → renderiza file/author/event
- `runBlocks(docs, primaryDocs, ctx, cache, registry)` → el pre-paso de bloques
- `runIndexDocs(docs, allDocs, ctx, cache, registry)` → collections, lists, etc.
- `composePage(doc, ctx, cache, registry)` → compose + write para un doc
- `buildFinalSiteContext(siteCtx, blocks)` → ensambla el contexto final del sitio

El cuerpo del orquestador se vuelve una secuencia de llamadas a estas funciones.

#### 1.4 — Tests de integración del pipeline

Con el orquestador refactorizado, agregar tests de integración usando fixtures:
- Un directorio `test/fixtures/` con colecciones pequeñas de documentos Markdown
- Tests que verifican que `build(fixtureDir)` produce el HTML esperado
- Cubrir: paginación, bloques, collections, autores relacionados, temas

#### 1.5 — Documentar el modelo de tipos de documentos

Crear `docs/content-model.md` explicando:
- `type`: qué procesar (file, collection, author, etc.)
- `kind`: cómo procesar (page = genera archivo, block = inyecta en región)
- `region`: dónde inyectar (para kind=block)
- Relaciones entre tipos (cómo `list` agrega `file`, cómo `author` agrega `file` por coincidencia de nombre)

#### Criterios de finalización
- El orquestador tiene <100 líneas en su cuerpo principal (el resto en funciones nombradas)
- Agregar un nuevo tipo de documento requiere modificar max 3 archivos (el stage config + un archivo de contexto + el pipeline/context correspondiente)
- Tests de integración pasan para al menos 5 escenarios end-to-end

#### Impacto
- **Desbloquea Fase 4 (Sistema editorial)**: sin este refactoring, agregar output PDF/EPUB requeriría modificar el orquestador monolítico.
- **Desbloquea extensibilidad real**: nuevos tipos sin tocar el núcleo.

---

### Fase 2 — DX y configuración ✅ COMPLETADA

**Objetivo:** Reducir la fricción de uso. Que un usuario nuevo pueda construir un sitio en <30 minutos sin leer código fuente.

#### 2.1 — Documentación de referencia

Crear `docs/` con:
- `quickstart.md` — del `init` al primer build
- `content-model.md` — tipos, kinds, regiones (ver 1.5)
- `frontmatter-reference.md` — todos los campos con tipos y ejemplos
- `plugins.md` — cómo escribir y registrar un plugin
- `configuration.md` — `_iteraciones.yaml` campo por campo
- `themes.md` — cómo personalizar layouts y templates

#### 2.2 — Mejorar mensajes de error con contexto

Actualmente los errores son buenos pero podrían incluir más contexto accionable:

| Error actual | Error mejorado |
|---|---|
| `collection "x": item no encontrado: "y"` | `collection "x": el item "y" no existe. ¿Olvidaste crearlo? Rutas disponibles: [...]` |
| Error de pandoc genérico | Incluir la línea del Markdown que causó el error si está disponible |
| `composeDocuments: templateContext no definido` | Indicar en qué paso del pipeline se perdió el contexto |

#### 2.3 — Exponer `--output` en el CLI

`BuildOptions.outputDir` ya existe. Solo falta exponerlo en `parser.ts`:
```
iteraciones build --output ./public
```

#### 2.4 — Reportes de build más informativos

Con `--verbose`, mostrar al terminar:
```
build completado en 4.2s
  documentos: 47 procesados, 12 desde caché (render), 8 desde caché (compose)
  pandoc: 35 conversiones × ~85ms = 2.9s
  assets: CSS generado en 1.1s
  output: dist/web/ (47 archivos HTML, 1 CSS, 3 fuentes)
```

#### 2.5 — Mejorar `iteraciones validate`

Extender para validar:
- Que cada `items:` en collections apunta a archivos existentes
- Que `region:` en bloques sea un valor válido
- Que los templates referenciados existan

#### 2.6 — `iteraciones new` para scaffolding de contenido

```
iteraciones new file notas/mi-articulo.md
iteraciones new collection antologia-2026.md
iteraciones new block sidebar.md --region sidebar-primary
```

Genera el archivo con el frontmatter mínimo correcto para cada tipo.

#### Criterios de finalización
- Un desarrollador nuevo puede hacer su primer build exitoso siguiendo `docs/quickstart.md` sin ayuda externa
- `iteraciones validate` detecta el 100% de los errores de configuración que harían fallar un build
- Todos los comandos del CLI tienen mensajes de error que incluyen sugerencia de acción

---

### Fase 3 — Performance ✅ COMPLETADA

**Objetivo:** Reducir el tiempo de build en sitios medianos (>100 documentos) a menos de la mitad del tiempo actual.

#### 3.1 — Pandoc server mode (impacto máximo)

Pandoc 3.x soporta `--serve` (modo servidor HTTP). En lugar de forking un proceso por documento:

1. Arrancar N instancias de Pandoc en modo servidor al inicio del build
2. Enviar documentos via HTTP al pool de instancias
3. Recibir el HTML fragment
4. Apagar las instancias al terminar

Esto elimina el fork overhead (~50-100ms por documento) y el costo de escritura de archivos temporales en `/tmp`. Para 100 documentos, la ganancia esperada es 5-15 segundos.

**Nota importante:** Pandoc server mode es experimental en algunas versiones. Verificar compatibilidad y tener fallback al modo actual.

#### 3.2 — Caché de CSS de Tailwind

La generación de CSS con Tailwind escanea todos los templates en cada build. Propuesta:
- Hashear el contenido de todos los templates `.html` + `styles.css`
- Si el hash no cambió desde el último build, copiar el CSS cacheado en lugar de regenerar
- Guardar el hash y el CSS generado en `.iteraciones/cache/css/`

Ganancia esperada: 1-3 segundos por build cuando no cambian templates.

#### 3.3 — Optimizar la clave de caché en compose

Reemplazar `JSON.stringify(doc.templateContext)` (que serializa todos los `body` de los `list-items`) por un hash pre-computado del contexto:

```typescript
const contextHash = hash(
  doc.htmlFragment,
  doc.templatePath ?? '',
  JSON.stringify(doc.frontmatter), // solo metadatos, no HTML
  // los hashes de los items relacionados, no su contenido completo
  ...(doc.frontmatter.items ?? []).map(itemPath => itemHashMap.get(itemPath) ?? '')
);
```

Esto reduce el tamaño de la clave de caché de kilobytes a 64 bytes.

#### 3.4 — Build incremental real en `serve`

El watcher actual hace un build completo en cada cambio. Un build incremental verificaría:
- Si cambió `_iteraciones.yaml` → rebuild completo
- Si cambió un template `.html` → rebuild de todos los documentos que usan ese template
- Si cambió un `file` → rebuild del `file` + todos los `list`/`collection`/`authors` que lo incluyen
- Si cambió un `block` → rebuild del bloque + compose de todos los documentos (el bloque afecta el layout global)

Esto requiere un **grafo de dependencias** entre documentos, que también es la base para builds distribuidos futuros.

#### 3.5 — Corregir la race condition del watcher

Reemplazar el flag `running` por una cola:

```typescript
let pendingRebuild = false;
// Si llega un cambio mientras hay un rebuild activo, marcar como pendiente
// Al terminar el rebuild, si hay pendiente, lanzar otro
```

#### Criterios de finalización
- Build de 100 documentos en <10 segundos (actualmente ~30-60s estimados con pandoc fork)
- `serve` con watch incremental: cambiar un archivo dispara rebuild solo de los afectados
- La caché de CSS evita regeneración cuando los templates no cambian

---

### Fase 4 — Sistema editorial ✅ COMPLETADA

**Objetivo:** Implementar el diferenciador central del proyecto: generación de PDF y EPUB integrada en `iteraciones build`, desde el mismo contenido Markdown del sitio.

Esta es la fase más importante estratégicamente. Sin ella, el proyecto es "otro SSG más". Con ella, tiene una identidad única: el mismo contenido Markdown genera el sitio web y los archivos descargables en un solo comando.

#### Tipos de contenido exportables

La exportación aplica exclusivamente a los tipos con cuerpo editorial significativo:

| Tipo | Clase LaTeX | Semántica editorial |
|---|---|---|
| `file` | `scrartcl` | Artículo, cuento, poema, tutorial, capítulo |
| `event` | `scrartcl` | Ficha de evento o invitación |
| `author` | `scrartcl` | Currículum, semblanza o biografía |
| `collection` | `scrbook` | Libro, antología, novela, poemario |
| `events` | `scrbook` | Programa de actividades |

Los tipos `authors`, `menu`, `card` y `list` no se exportan: son estructurales del sitio (paginación, navegación, directorios dinámicos).

#### Modelo de exportación integrado en el build

La exportación **no es un comando separado**. Es parte de `iteraciones build`. Para cada documento de tipo exportable, el build genera en paralelo su HTML (para el sitio) y sus archivos PDF/EPUB (para descarga), todos en el mismo directorio `dist/web/`:

```
dist/web/
  notas/articulo.html
  notas/articulo.pdf       ← descarga (scrartcl)
  notas/articulo.epub
  antologia/index.html
  antologia/index.pdf      ← libro completo (scrbook)
  antologia/index.epub
```

Los templates HTML reciben variables `download-pdf` y `download-epub` con la URL relativa al archivo generado. Para builds rápidos durante desarrollo: `iteraciones build --no-export`.

#### Motor PDF: xelatex y KOMA-Script

El único motor de exportación PDF es LaTeX. No se soportan alternativas basadas en CSS (WeasyPrint, wkhtmltopdf, puppeteer) — la calidad tipográfica no es adecuada para publicación editorial. Motor por defecto: `xelatex` (más rápido). Alternativa: `lualatex` (para documentos que requieren scripting Lua). Ambos incluidos en MacTeX full / TeX Live full.

Las clases KOMA-Script determinan el layout: `scrartcl` para documentos individuales, `scrbook` para colecciones (portada, tabla de contenidos, capítulos).

#### 4.1 — Exportación EPUB de documentos individuales

Integrar en el pipeline de `iteraciones build` la generación de EPUB para `file`, `event` y `author` vía `pandoc --to epub3`. Sin dependencia de TeX en esta sub-fase.

Módulos nuevos: `src/builder/export/types.ts`, `src/services/pandoc-exporter.ts`, `src/builder/export/assemble.ts`, `src/builder/export/runner.ts`. Integrar en `orchestrator.ts` después de `renderDocuments`, antes de `buildContext`.

**Criterio:** `iteraciones build` con `export.formats: [epub]` genera `.epub` para cada `file`, `event` y `author`.

#### 4.2 — Exportación PDF con xelatex y KOMA-Script

Añadir generación de PDF con templates `scrartcl` y `scrbook` (KOMA-Script). Crear `pandoc/export/scrartcl.latex` y `pandoc/export/scrbook.latex`. Añadir `convertToPdf()` en `pandoc-exporter.ts` y `checkLatexEngine()` en `src/cli/doctor/`.

**Criterio:** `iteraciones build` genera PDFs con tipografía KOMA-Script correcta. Un `scrbook` de una colección incluye portada, tabla de contenidos, y puede mezclar capítulos de tipo `file`, `event` y `author`.

#### 4.3 — Enlaces de descarga en el sitio web

Inyectar `download-pdf` y `download-epub` en los `TemplateContext` de los tipos exportables (`file`, `event`, `author`, `collection`, `events`). Actualizar los templates HTML por defecto con bloque condicional de descarga.

**Criterio:** La página de un artículo muestra enlace de descarga a su PDF/EPUB. La página de una colección muestra enlace al libro completo.

#### 4.4 — Manifesto editorial en frontmatter

Extender el frontmatter con metadatos editoriales ricos:

```yaml
type: collection
title: Antología de ensayos
editorial:
  isbn: 978-0-000-00000-0
  publisher: Laboratorio Común
  edition: Primera edición
  year: 2026
  rights: CC BY-SA 4.0
  description: Una colección de textos sobre diseño y tecnología.
  cover: assets/portada.jpg
  bibliography: referencias.bib
  csl: apa.csl
```

Activa: portada en scrbook, citeproc para bibliografía, cover en EPUB. Metadatos también usables en HTML (Open Graph, Schema.org). La configuración global vive en `_iteraciones.yaml`:

```yaml
export:
  formats: [pdf, epub]   # si ausente, no se exporta nada
  pdf-engine: xelatex    # xelatex (por defecto) o lualatex
```

#### 4.5 — Caché de exportación y hooks de plugins

Añadir `'export'` a `CacheScope` (caché binaria de PDF/EPUB en `.iteraciones/cache/export/`). Añadir hooks `beforeExport` y `afterExport` a `IPlugin`. Añadir `--no-export` al comando `build`.

#### Criterios de finalización
- `iteraciones build` con `export.formats: [pdf, epub]` genera HTML + PDF + EPUB para todos los tipos exportables, todos en `dist/web/`
- Los metadatos editoriales del frontmatter se reflejan en los archivos exportados
- Las páginas del sitio muestran enlaces de descarga funcionales
- `iteraciones build --no-export` funciona para builds rápidos
- `iteraciones doctor` reporta disponibilidad de xelatex/lualatex y KOMA-Script

---

### Fase 5 — Ecosistema y plugins (3-5 semanas)

**Objetivo:** Hacer que el sistema de plugins sea lo suficientemente poderoso para que la comunidad pueda extender el sistema sin modificar el núcleo.

#### 5.1 — Hooks adicionales

Los 4 hooks actuales (`beforeRender`, `afterRender`, `beforeCompose`, `afterCompose`) cubren el ciclo de un documento individual. Faltan hooks para:

- `beforeBuild` — se ejecuta antes de empezar el pipeline (útil para generar contenido dinámico)
- `onDocumentDiscovered` — permite a plugins filtrar o agregar documentos al pool
- `onDocumentClassified` — permite a plugins sobreescribir el tipo/kind inferido
- `afterBuild` — ya existe, pero sin acceso al grafo de dependencias

#### 5.2 — Plugins con capacidad de generar archivos ✅ IMPLEMENTADO

Los plugins pueden generar archivos adicionales mediante el hook `generateFiles`. Ya está implementado en `src/plugin/types.ts`:

```typescript
interface IPlugin {
  // ...hooks existentes...
  generateFiles?(ctx: BuildContext): Promise<GeneratedFile[]>;
}

interface GeneratedFile {
  relativePath: string;  // ej. 'sitemap.xml', 'feed.json'
  content: string;
}
```

Esto permite plugins externos como:
- `@iteraciones/plugin-sitemap`
- `@iteraciones/plugin-rss`
- `@iteraciones/plugin-search-index`

#### 5.3 — Plugins oficiales básicos

> **Fuera del alcance de este repositorio.** Los plugins oficiales se desarrollan como paquetes independientes bajo el scope `@iteraciones/`. Este repositorio solo contiene el core del CLI: la interfaz `IPlugin`, el `PluginRegistry`, y los hooks del ciclo de vida. Los plugins tienen sus propios repositorios, issues y ciclos de release.
>
> Repositorios planificados: `@iteraciones/plugin-sitemap`, `@iteraciones/plugin-rss`, `@iteraciones/plugin-search-index`, `@iteraciones/plugin-reading-time`.

#### 5.4 — Documentación de la API de plugins con ejemplos

El contrato de plugins está bien definido en `src/plugin/types.ts`. Falta:
- `docs/plugins.md` con la referencia completa
- Un plugin de ejemplo mínimo en un repositorio dedicado (`@iteraciones/plugin-example`)
- Guía de pruebas para plugins

#### Criterios de finalización
- La API de plugins está documentada con ejemplos funcionales (`docs/plugins.md`)
- Un plugin externo puede generar archivos adicionales mediante `generateFiles`
- Los hooks `beforeBuild` y `onDocumentDiscovered` están disponibles

---

### Fase 6 — Publicación multiplataforma ✅ COMPLETADA (criterios)

**Objetivo:** Convertir el sistema editorial en una plataforma real de publicación.

> **Mayo 2026.** Los tres criterios de finalización están cumplidos. Pendiente deseable: 6.1 (templates LaTeX especializados para libros — E7).

#### 6.1 — Templates LaTeX para libros

Desarrollar un conjunto de templates Pandoc LaTeX para:
- Libros de ensayos
- Documentación técnica
- Antologías con múltiples autores
- Artículos académicos (con citas CSL)

Los templates se distribuyen con el CLI y el usuario puede sobreescribirlos.

#### 6.2 — Soporte de citas bibliográficas (CSL) ✅ IMPLEMENTADO

Pandoc soporta citas en formato BibTeX/CSL. Exponer esta capacidad:

```yaml
# En el frontmatter de un documento o collection
bibliography: referencias.bib
csl: apa.csl  # o una ruta a un .csl custom
```

Ningún SSG generalista tiene soporte de citas bibliográficas. Esta es una ventaja real para contenido académico, periodístico e investigativo.

> Implementado en PRs #276 (validación de rutas), #277 (bibliography/csl globales en ExportConfig) y #278 (citeproc en salida HTML). El pipeline de exportación PDF/EPUB pasa `--bibliography` y `--csl` a pandoc.

#### 6.3 — Build con todos los formatos activos

`iteraciones build` ya genera HTML + PDF + EPUB en un solo comando cuando `export.formats` está configurado. Todo el output convive en `dist/web/`: los archivos descargables junto al HTML que los enlaza.

```
dist/web/
  notas/articulo.html + articulo.pdf + articulo.epub
  antologia/index.html + index.pdf + index.epub
```

En Fase 6 se optimiza la orquestación para sitios con cientos de documentos exportables: paralelización máxima con gestión de carga de xelatex (single-threaded, ~15-60s/documento).

#### 6.4 — Control de exportación en watch mode ✅ IMPLEMENTADO

En modo `iteraciones serve`, la exportación PDF se desactiva por defecto (xelatex tarda 15-60s/documento; no es viable en el ciclo rápido de desarrollo). El EPUB sí puede regenerarse en watch mode (~1-3s). Para forzar exportación completa en un rebuild puntual: `iteraciones build --no-export=false`. La exportación diferida bajo demanda (PDF generado al visitar la página) es una mejora de Fase 6.

> Implementado en PR #274.

#### 6.5 — Soporte de math (LaTeX/MathML) ✅ IMPLEMENTADO

Pandoc soporta `--mathjax` o `--katex` para renderizar ecuaciones. Exponer en config:

```yaml
site:
  math: katex  # o mathjax
```

Esto incluye el CDN de KaTeX/MathJax automáticamente y configura Pandoc correctamente.

> Implementado en PR #279.

#### Criterios de finalización
- Un sitio web con su colección de artículos puede exportarse como PDF y EPUB con un solo comando
- Las citas bibliográficas se renderizan correctamente en HTML, PDF y EPUB
- El sistema es completamente multiplataforma sin configuración adicional

---

### Fase 7 — Competitividad y diferenciación (ongoing)

**Objetivo:** Posicionar el proyecto como la herramienta de referencia para publicación editorial en Markdown.

#### 7.1 — Compatibilidad Node.js

> **Fuera del alcance de este proyecto.** iteraciones-cli es exclusivamente Bun. Las APIs de Bun (`Bun.file`, `Bun.YAML`, `Bun.Glob`, `Bun.CryptoHasher`) se usan deliberadamente: son parte del contrato técnico del proyecto, ofrecen mejor performance y simplifican el codebase. No se planea migración a Node.js.

#### 7.2 — Site de documentación

Construido con el propio iteraciones-cli (dogfooding):
- Referencia completa del CLI
- Galería de ejemplos
- Tutoriales por caso de uso

#### 7.3 — Example content mejorado

El repositorio `example-content` es el ejemplo de referencia. Expandirlo para demostrar:
- Una colección exportada como PDF
- Un sitio con múltiples autores
- Bloques de región personalizados
- Un plugin custom funcional

#### 7.4 — Benchmark público

Publicar métricas de performance comparativas con Hugo, Eleventy y Zola para distintos tamaños de sitio:
- 10, 50, 100, 500 documentos
- Con caché fría y caliente
- Con y sin generación de Tailwind

---

## 3. Priorización total

### Crítico (resolver antes de cualquier nueva feature)

| # | Ítem | Archivo | Esfuerzo |
|---|---|---|---|
| C1 | ✅ Hash sin separador (colisión de caché) | `src/cache/hasher.ts` | 1h |
| C2 | ✅ Test suite para motor de templates | `src/template/**` | 1-2d |
| C3 | ✅ Eliminar `SourceDocument` duplicado | `src/loader/document-loader.ts` | 2h |
| C4 | ✅ Unificar `IGNORED_DIRS` | 3 archivos | 30min |
| C5 | ✅ Guard de profundidad en `makeRelativeContext` | `src/builder/orchestrator.ts` | 1h |

### Importante (resolver en Fases 1-3)

| # | Ítem | Esfuerzo |
|---|---|---|
| I1 | ✅ Refactorizar orquestador en pasos nombrados | 3-5d |
| I2 | ✅ Documentación de tipos de documentos | 2d |
| I3 | ✅ Exponer `--output` en CLI | 1h |
| I4 | ✅ Build incremental real en `serve` | 3-5d |
| I5 | ✅ Pandoc server mode | 3-5d |
| I6 | ✅ Validar ruta del logo (path traversal) | 1h |
| I7 | ✅ Caché de CSS de Tailwind | 1d |
| I8 | ✅ `copyLogo` informativo en lugar de silencioso | 30min |
| I9 | ✅ Limitar concurrencia en `writeDocuments` | 30min |
| I10 | ✅ Race condition en watcher (queuing) | 2h |
| I11 | ✅ Optimizar clave de caché en compose | 2h |

### Deseable (Fases 2-5)

| # | Ítem |
|---|---|
| D1 | ✅ `iteraciones new` para scaffolding de contenido |
| D2 | ✅ Reportes de build detallados con estadísticas de caché |
| D3 | ✅ `iteraciones validate` extendido (items, regiones) |
| D4 | Hooks `beforeBuild` y `onDocumentDiscovered` |
| D5 | Plugin oficial de sitemap — *repositorio separado (`@iteraciones/plugin-sitemap`)* |
| D6 | Plugin oficial de RSS — *repositorio separado (`@iteraciones/plugin-rss`)* |
| D7 | ✅ Mejores mensajes de error con sugerencias |
| D8 | ✅ Tests de integración end-to-end |
| D9 | ✅ Documentación completa en `docs/` |

### Experimental (Fases 4-7)

| # | Ítem |
|---|---|
| E1 | ✅ Exportación PDF via Pandoc |
| E2 | ✅ Exportación EPUB via Pandoc |
| E3 | ✅ Soporte de citas bibliográficas CSL |
| E4 | ~~Compatibilidad Node.js~~ — fuera de alcance (Bun exclusivo por diseño) |
| E5 | Site de documentación con dogfooding |
| E6 | ✅ Soporte de math (KaTeX/MathJax) |
| E7 | Templates LaTeX para libros |
| E8 | ✅ Build multiplataforma unificado |

---

## 4. Orden correcto de implementación

### Lo que debe resolverse primero (sin excepciones)

```
C1 → C3 → C4 → C5  (bugs y limpieza: 1-2 días)
C2 (tests de templates: 1-2 días)
```

Los bugs críticos son cambios de una línea. No hay razón para diferirlos. La test suite de templates es la red de seguridad para todo lo que viene después.

### Lo que no debe tocarse todavía

**El orquestador completo (Fase 1)** no debe tocarse antes de tener la test suite de integración. Refactorizar sin tests es reemplazar una fragilidad por otra.

**La API pública de plugins** no debe estabilizarse antes del refactoring del orquestador. Los hooks adicionales propuestos en Fase 5 deben diseñarse con el pipeline refactorizado en mente.

**La exportación PDF/EPUB** no debe implementarse antes del refactoring del orquestador. El output de exportación es otro "tipo de pipeline" que comparte lógica con el build HTML. Sin el refactoring, terminaría hardcodeado en el mismo lugar incorrecto.

### Refactors peligrosos si se hacen prematuramente

**Pandoc server mode (Fase 3.1):** Cambio de bajo nivel que afecta el comportamiento de todas las conversiones. Sin tests de integración, un bug en el nuevo modo sería difícil de detectar.

**Refactoring del contrato de TemplateContext a tipos fuertes:** Cambiar `Record<string, unknown>` por tipos específicos por tipo de documento sería un refactoring masivo que afecta cientos de líneas. Es deseable a largo plazo pero requiere que el pipeline esté estabilizado primero.

### Cambios que desbloquean más capacidades futuras

El **refactoring del orquestador (Fase 1)** es el cambio con más leverage. Desbloquea:
- Nuevos tipos de documentos sin modificar el núcleo
- Pipeline de exportación PDF/EPUB como variante del pipeline HTML
- Build incremental real (el grafo de dependencias se puede construir sobre el pipeline modular)
- Tests de integración reales

Los **tests de templates (Fase 0)** son el segundo cambio con más leverage. Desbloquean:
- Cualquier modificación al motor de templates con confianza
- Extensiones del lenguaje de templates (filtros, funciones, includes)
- Documentación de edge cases del motor

---

## 5. Evolución arquitectónica

### Qué debe permanecer simple

- El **lenguaje de templates** (`$var$`, `$if(k)$`, `$for(k)$`). La simplicidad es una feature, no una limitación. Pandoc Lua filters son el mecanismo correcto para transformaciones complejas de contenido; el motor de templates del layout debe seguir siendo legible para no-programadores.

- El **formato de configuración** (`_iteraciones.yaml`). Un solo archivo YAML plano. No agregar includes, herencia, ni configuración por directorio. La complejidad del sitio debe expresarse en el contenido, no en la configuración.

- El **frontmatter** como contrato entre contenido y sistema. Agregar campos nuevos debe ser aditivo y backward-compatible. Nunca romper frontmatter existente.

- El **CLI** como interfaz principal. No agregar APIs programáticas complejas ni modos de servidor web full-featured. El CLI es la superficie pública; mantenerla pequeña.

### Qué vale la pena sofisticar

**El pipeline de transformación** debe evolucionar hacia una arquitectura de etapas composable donde cada etapa sea intercambiable. El objetivo a largo plazo:

```
Fase 0: discover → classify → [render] → [context] → [compose] → write
Fase 1: discover → classify → stage[] → write
Fase 4: discover → classify → stage[] → write | export
```

Donde `stage[]` es un array configurable de transformaciones que puede ser extendido por plugins.

**El sistema de caché** puede sofisticarse con:
- Grafo de dependencias para invalidación selectiva
- Caché distribuida (para CI/CD) usando el mismo formato de claves SHA-256 sobre un backend S3/R2
- Caché de Pandoc server (no solo del resultado, sino del estado del proceso)

**El modelo editorial** es donde vale invertir la mayor complejidad:
- Manifesto editorial en frontmatter (ISBN, editorial, derechos, serie, volumen)
- Templates de exportación por género (ensayo, novela, documentación técnica, poesía)
- Soporte de secciones, partes y capítulos dentro de una collection
- Generación de índice temático a partir de keywords del frontmatter

### Arquitectura objetivo (v2.0)

```
src/
  pipeline/
    stages/
      discover.ts      # SourceDocument[]
      classify.ts      # BuildDocument[]
      render.ts        # htmlFragment por doc
      context.ts       # templateContext por doc
      compose.ts       # outputHtml por doc
      write.ts         # outputPath por doc
      export.ts        # nuevo: PDF, EPUB, DOCX
    graph.ts           # grafo de dependencias
    runner.ts          # ejecuta stages en orden correcto
  editorial/
    collection-resolver.ts
    book-builder.ts
    epub-exporter.ts
    pdf-exporter.ts
  plugin/
    registry.ts        # sin cambios
    loader.ts          # sin cambios
    types.ts           # + nuevos hooks
  template/
    (sin cambios)      # el motor permanece simple
  config/
    (sin cambios)      # la config permanece simple
```

---

## 6. Estrategia competitiva

### Nicho correcto

**No competir con:** Hugo, Eleventy, Astro, Next.js static, Gatsby.

Estos proyectos tienen años de desarrollo, comunidades grandes, ecosistemas de plugins maduros y están optimizados para casos de uso web-first. Competir en velocidad de build con Hugo (Go) o en ecosistema con Eleventy es una batalla perdida.

**Competir con:** La ausencia de una herramienta específica.

No existe ninguna herramienta que haga bien estas tres cosas simultáneamente:
1. Generar un sitio web estático desde Markdown
2. Exportar el mismo contenido como libro PDF de calidad tipográfica
3. Exportar como EPUB para distribución digital

Pandoc lo puede hacer por separado, pero no hay un SSG que lo orqueste de manera coherente con un modelo editorial (collections, autores, metadatos de publicación, templates de libro).

### Identidad real del proyecto

**iteraciones-cli como "pandoc-powered editorial publishing system".**

No es un framework web. Es un sistema de publicación editorial que como subproducto también genera sitios web estáticos.

Esta identidad diferencia el proyecto de todos los SSG existentes y apela a un usuario específico:
- Escritores con capacidad técnica media
- Editoras y editoriales independientes con recursos limitados
- Investigadores que publican en web y en papel
- Colectivos y cooperativas de contenido con ciclos editoriales largos
- Archivistas y documentalistas

### Ventajas estructurales reales

1. **Pandoc como motor central:** Soporte nativo de citas académicas (CSL/BibTeX), math (LaTeX), tablas complejas, footnotes, definiciones, highlighting de código, y cualquier extensión del ecosistema Pandoc. Ningún SSG generalista tiene esto.

2. **Content-first sin JavaScript de cliente:** El output es HTML estático puro. Sin bundlers, sin hydration, sin dependencias de runtime. Funciona en hosting de $0 (GitHub Pages, Cloudflare Pages, Netlify free) para siempre.

3. **Modelo de bloques editoriales:** La arquitectura de `block` + `region` permite construir layouts complejos (sidebar, footer, header) completamente en Markdown, sin escribir templates HTML. Esto es accesible para editores no-técnicos.

4. **Output `file://` ready:** El sitio generado funciona abriendo archivos en el browser sin servidor. Para distribución offline, archivos adjuntos en email, o revisión local, esto es valioso.

5. **Filosofía de bajo costo total:** Sin hosting de servidor, sin base de datos, sin CMS, sin licencias. El costo marginal de mantener el sitio en producción es prácticamente cero.

### Posicionamiento recomendado

> "iteraciones: el sistema de publicación editorial para escritoras, investigadoras y colectivos que trabajan en Markdown.  
> Un contenido, múltiples formatos: web, PDF, EPUB."

Este posicionamiento es diferenciado, honesto con las capacidades actuales (web) y aspiracional respecto a las capacidades en desarrollo (PDF, EPUB).

---

## 7. Features futuras

### Fundamentales (necesarias para madurar)

**F1 — Test suite completa**  
Sin esto, cualquier cambio es potencialmente regresivo. Prioridad absoluta.

**F2 — Documentación de usuario**  
Sin esto, nadie puede adoptar el proyecto sin leer el código fuente.

**F3 — Exportación PDF básica**  
Sin esto, el proyecto no tiene diferenciador. Es "otro SSG más basado en Pandoc".

**F4 — `iteraciones new` para scaffolding**  
La fricción de crear el frontmatter correcto para cada tipo es la primera barrera de adopción.

**F5 — Plugin oficial de sitemap**  
Requerido para SEO básico. Debería venir incluido (o como plugin oficial simple).

### Diferenciadoras (features que hacen al proyecto especial)

**D1 — Exportación EPUB** ✅  
Junto con PDF, completa el triángulo web + papel + digital. Ningún SSG hace esto.

**D2 — Soporte de citas bibliográficas CSL** ✅  
Para contenido académico, periodístico e investigativo. Pandoc ya lo soporta; solo hay que exponerlo en la configuración. Diferenciador real para universidades, revistas, archivos históricos.

**D3 — Manifiesto editorial en frontmatter** ✅  
ISBN, editorial, derechos, serie, número de edición. Metadatos que se propagan automáticamente a PDF, EPUB y HTML (Open Graph, Schema.org). Posiciona el proyecto como herramienta seria para publicación.

**D4 — Exportación diferida bajo demanda en watch mode**  
En `iteraciones serve`, los archivos PDF/EPUB se generan bajo demanda (al navegar a una página) en vez de en cada rebuild. Útil para sitios grandes donde la generación completa con xelatex tomaría minutos.

**D5 — Grafo de contenido consultable**  
`iteraciones graph --output graph.json` exporta el grafo de relaciones entre documentos (collections, autores, keywords). Permite construir visualizaciones, análisis de contenido, y herramientas de navegación ricas.

**D6 — Filtros Pandoc Lua via plugins**  
Exponer la capacidad de definir filtros Pandoc Lua desde un plugin de iteraciones:
```yaml
plugins:
  - ./plugins/mi-filtro.lua  # filtro Pandoc Lua
```
Esto da acceso al AST completo de Pandoc sin necesidad de post-procesar HTML con regex.

### Visionarias (ideas coherentes con la filosofía editorial)

**V1 — Collections anidadas (series y volúmenes)**  
Una collection puede contener otras collections como "partes" de un libro. Esto permite estructuras como:
```
libro-completo.md
  ├── parte-1-origenes.md (collection)
  │   ├── capitulo-1.md
  │   └── capitulo-2.md
  └── parte-2-desarrollo.md (collection)
      ├── capitulo-3.md
      └── capitulo-4.md
```
La exportación PDF de `libro-completo.md` genera el libro con estructura de partes y capítulos.

**V2 — Revisiones y versiones de contenido**  
Soporte para publicar múltiples versiones de un documento (ej. primera edición, edición revisada):
```yaml
versions:
  - label: "Primera edición (2024)"
    file: notas/articulo-v1.md
  - label: "Edición revisada (2026)"
    file: notas/articulo-v2.md
```
El template muestra un selector de versión y el PDF incluye el historial de revisiones.

**V3 — Anthology mode: múltiples autores, una publicación**  
Una collection puede aceptar contribuciones de múltiples autores, cada uno con sus propios metadatos de autoría, bio y derechos. El sistema genera:
- Página de la antología en el sitio web
- PDF con portada, prólogo, notas de autores y créditos
- EPUB con metadatos OPF multi-autor correctos

**V4 — Archive mode: sitio como archivo permanente**  
Una collection puede marcarse como "archivada" (fecha de cierre, estado de conservación, institución responsable). El sistema genera:
- HTML con metadatos de archivo (Dublin Core)
- PDF/A (formato de preservación a largo plazo)
- Manifiesto de preservación digital

Este caso de uso es real y no lo cubre ningún SSG: archivos históricos, revistas discontinuadas, acervos de movimientos sociales.

**V5 — Reading experience personalizable sin JavaScript**  
Usando solo CSS variables (ya existe soporte con el sistema de `accent`), ofrecer:
- Modo oscuro/claro (ya existe el tema `dark`)
- Tamaño de texto configurable via URL params leídos por CSS
- Modo "libro" (columna estrecha, interlineado generoso) vs modo "web"

**V6 — Export pipeline hooks** ✅  
Implementado en Fase 4e. `IPlugin` tiene `beforeExport`, `afterExport` y `generateFiles`. Ver `src/plugin/types.ts`.

---

## 8. Riesgos a largo plazo

### Riesgo crítico — Pandoc como dependencia externa

**El riesgo más serio del proyecto a largo plazo.** Pandoc es un binario externo escrito en Haskell. Esto implica:

- **Versionado no controlado:** Una actualización de Pandoc puede cambiar el HTML que genera, invalidando el CSS y los templates. Ya sucede con versiones menores de Pandoc.
- **Distribución compleja:** Los usuarios deben instalar Pandoc manualmente. En CI/CD esto requiere configuración adicional. Herramientas como Hugo distribuyen un binario único auto-contenido.
- **No hay runtime en browser:** No se puede hacer preview en el browser ni ofrecer un editor online sin un servidor backend.
- **Latencia de fork (resuelta parcialmente con Pandoc server mode):** Incluso con server mode, Pandoc sigue siendo un proceso separado.

**Mitigación:** Pandoc server mode reduce la latencia. Documentar la versión mínima requerida de Pandoc y testear contra múltiples versiones en CI.

**No mitigable sin rediseño:** La distribución de un binario único auto-contenido requeriría implementar un parser Markdown propio o compilar Pandoc como WebAssembly (factible pero de muy alta complejidad).

### Riesgo aceptado — Dependencia de Bun

Bun es un proyecto de alto ritmo con breaking changes frecuentes. La v1.x ha sido relativamente estable, pero versiones futuras pueden traer cambios en APIs usadas directamente (`Bun.file`, `Bun.YAML`, `Bun.CryptoHasher`).

**Decisión explícita:** Bun es el runtime exclusivo del proyecto, no una dependencia provisional. Las APIs de Bun ofrecen mejor performance y simplifican el codebase. La migración a Node.js no está planificada. El riesgo se acepta y se gestiona testeando contra la versión de Bun declarada en `package.json` y actualizando proactivamente ante breaking changes.

### Riesgo resuelto — Crisis del orquestador

El orquestador fue refactorizado en Fase 1 en pasos discretos (`src/builder/pipeline/`). Cada nuevo tipo de documento se integra a través del type-graph sin modificar el cuerpo principal.

### Riesgo medio — Complejidad de la generación de PDF

La generación de PDFs de alta calidad tipográfica con xelatex es notoriamente compleja. Los errores de LaTeX son difíciles de interpretar para usuarios no técnicos. Los templates KOMA-Script (scrartcl, scrbook) son difíciles de personalizar sin conocimiento de LaTeX.

**Decisión tomada:** El motor es exclusivamente LaTeX (xelatex por defecto, lualatex como alternativa). No se soportan motores CSS-to-PDF (WeasyPrint, wkhtmltopdf, puppeteer) — la calidad tipográfica no es adecuada para publicación editorial.

**Mitigación:** Proveer templates LaTeX por defecto de alta calidad, mensajes de error traducidos a lenguaje editorial, y documentación de las personalizaciones más comunes.

### Riesgo bajo — Fragmentación del modelo de datos

El `Frontmatter` interface usa `[key: string]: unknown` como escape hatch. A medida que se agreguen más features (metadatos editoriales, configuración de exportación, versiones), habrá presión para agregar más campos a este interface. Sin disciplina, el frontmatter puede volverse un saco de everything que es difícil de documentar y validar.

**Mitigación:** Mantener el frontmatter base mínimo. Los metadatos extendidos (editorial, export, archive) deben vivir en sub-objetos bien definidos (`export:`, `editorial:`, `archive:`) y validarse con esquemas explícitos.

### Riesgo bajo — Templates HTML como superficie de customización

Los templates actuales son archivos HTML con sintaxis `$var$`. A medida que aumenta la complejidad (listas paginadas, exportación, versiones), habrá presión para agregar más lógica a los templates. El motor de templates actual no soporta funciones, filtros, includes ni herencia. Esto puede llevar a templates enormes con mucha repetición.

**Mitigación:** No extender el motor de templates. En su lugar, preparar los datos en el contexto (pre-computar valores que de otro modo requerirían lógica en el template). Los templates deben mantenerse como "vistas estúpidas" sin lógica de negocio.

---

## 9. Plan de trabajo concreto

> **Sprints 0–5 completados (mayo 2026).** Las secciones a continuación se conservan como referencia histórica.

### Sprint 0 — Quick wins ✅ COMPLETADO

**Estimación total: 2-3 días de trabajo**

| Tarea | Archivo | Estimación | Impacto |
|---|---|---|---|
| Fix hash sin separador | `src/cache/hasher.ts` | 30min | Previene corrupción de caché |
| Unificar IGNORED_DIRS | `src/constants.ts` + 3 archivos | 30min | Elimina riesgo de divergencia |
| Eliminar SourceDocument duplicado | `src/loader/document-loader.ts` | 1h | Elimina confusión de tipos |
| Guard en makeRelativeContext | `src/builder/orchestrator.ts` | 1h | Previene stack overflow con plugins maliciosos |
| copyLogo con warning | `src/builder/assets.ts` | 30min | Mejor DX |
| Validar logo path traversal | `src/builder/assets.ts` | 30min | Seguridad |
| Limitar concurrencia en writeDocuments | `src/builder/pipeline/write.ts` | 30min | Previene EMFILE |
| Race condition en watcher | `src/cli/watcher.ts` | 1h | Confiabilidad en serve |
| CHANGELOG entry | `CHANGELOG.md` | 15min | |

**Criterio de merge:** Todos los cambios pasan `bun run typecheck`.

---

### Sprint 1 — Tests ✅ COMPLETADO

**Estimación total: 3-4 días de trabajo**

```
test/
  template/
    lexer.test.ts       # tokenize() con todos los constructos
    parser.test.ts      # parse() con anidamiento y edge cases
    renderer.test.ts    # renderAst() con contextos variados
    variables.test.ts   # resolveValue(), coerceToString()
    if.test.ts          # renderIf() con truthy/falsy edge cases
    for.test.ts         # renderFor() con primitivos y objetos
  cache/
    hasher.test.ts      # hash() no colisiona con separador
    cache-manager.test.ts # read/write/prune
  builder/
    paginate.test.ts    # paginateItems(), buildPageHrefs()
    classifier.test.ts  # inferType(), inferKind()
    frontmatter.test.ts # parseFrontmatter() con edge cases
```

**Criterio de merge:** `bun test` pasa, cobertura >80% en `src/template/` y `src/cache/`.

---

### Sprint 2 — Refactoring del orquestador ✅ COMPLETADO

**Estimación total: 5-7 días de trabajo**

**Paso 2a:** Extraer funciones nombradas sin cambiar lógica (refactoring estructural puro)

```
runPrimaryDocuments()    → renderiza file, author, event
buildAuthorIndex()       → construye el índice de autores
runBlockDocuments()      → el pre-paso de bloques
buildFinalSiteContext()  → ensambla el contexto con las regiones
runPageDocuments()       → collections, lists, menus, cards
```

**Paso 2b:** Tests de integración con fixtures

```
test/integration/
  fixtures/
    simple-site/         # 5 archivos, 1 collection
    with-authors/        # autores + publicaciones
    with-blocks/         # bloques de sidebar y footer
    with-pagination/     # list con paginación
  build.test.ts          # build() de cada fixture produce HTML esperado
```

**Criterio de merge:** El orquestador tiene <100 líneas en su cuerpo principal. Tests de integración pasan. Ninguna regresión en el example-content.

---

### Sprint 3 — DX básica ✅ COMPLETADO

**Estimación total: 4-5 días de trabajo**

| Tarea | Estimación |
|---|---|
| `docs/content-model.md` | 1d |
| `docs/frontmatter-reference.md` | 1d |
| `docs/configuration.md` | 1d |
| Exponer `--output` en CLI | 1h |
| `iteraciones validate` extendido (items, regiones) | 1d |
| Reportes de build con estadísticas | 4h |

---

### Sprint 4 — Performance ✅ COMPLETADO

**Estimación total: 5-7 días de trabajo**

| Tarea | Estimación | Riesgo |
|---|---|---|
| Caché de CSS Tailwind | 1d | Bajo |
| Optimizar clave de caché en compose | 4h | Bajo |
| Pandoc server mode | 3-4d | Medio (experimental) |
| Build incremental básico en `serve` | 2-3d | Alto |

**Nota:** Pandoc server mode y build incremental pueden implementarse en paralelo por diferentes colaboradores.

---

### Sprint 5 — Exportación editorial ✅ COMPLETADO

**Estimación total: 7-10 días de trabajo**

| Tarea | Estimación |
|---|---|
| `src/builder/export/types.ts` + `EXPORTABLE_TYPES` | 0.5d |
| `src/services/pandoc-exporter.ts` (EPUB vía pandoc) | 1d |
| `src/builder/export/assemble.ts` + `runner.ts` | 1d |
| Templates KOMA-Script `scrartcl.latex` + `scrbook.latex` | 2-3d |
| Exportación PDF (xelatex + `convertToPdf()`) | 1-2d |
| Context builders: `download-pdf` + `download-epub` | 0.5d |
| `--no-export` en `iteraciones build` | 0.5d |
| `iteraciones doctor` + check xelatex/KOMA-Script | 0.5d |
| Frontmatter `editorial:` extendido | 1d |
| Tests y fixtures de exportación | 1-2d |

---

### Milestones

| Milestone | Condición | Estado |
|---|---|---|
| **v0.5.0 — Estable** | Fases 0–3 completas | ✅ Alcanzado (mayo 2026) |
| **v1.0.0 — Herramienta usable** | Fases 0–4 completas + docs | ✅ Alcanzado (mayo 2026) |
| **v1.x — Ecosistema** | Fase 5: hooks adicionales + API de plugins documentada | En progreso |
| **v2.0.0 — Plataforma seria** | Fase 6: CSL + math + export en watch mode + site de docs | Pendiente |

---

## 10. Evaluación final

### ¿El proyecto tiene potencial real?

**Sí, pero en un nicho específico y con condiciones.**

El potencial es real porque la combinación de Pandoc + colecciones editoriales + múltiples formatos de salida no existe en ningún SSG actual. Eso es un espacio vacío en el mercado. El espacio vacío solo tiene valor si alguien lo necesita, y hay usuarios que lo necesitan: escritores técnicos, investigadores, editoras independientes, colectivos de contenido, archivistas.

El potencial es condicional porque depende de que se implemente la exportación PDF/EPUB. Sin ella, el proyecto es "un SSG con Pandoc como renderer", lo cual es interesante técnicamente pero no suficientemente diferente para motivar adopción.

### ¿Qué tan lejos está de ser competitivo?

**De competir en web-first (Hugo/Eleventy): muy lejos, y sería un error intentarlo.**

**De ser la herramienta de referencia en publicación editorial Markdown: 4-6 meses de trabajo real.**

La brecha no es de complejidad técnica sino de prioridades:
1. Test suite (2-3 semanas) — necesaria antes de todo
2. Refactoring del orquestador (1-2 semanas) — necesario antes de la exportación
3. Exportación PDF/EPUB (3-4 semanas) — el diferenciador

Con 2 personas trabajando a tiempo parcial, v1.5.0 (con exportación funcional) es alcanzable en 4-6 meses.

### ¿Qué tan difícil sería llevarlo a un nivel serio?

**Técnicamente: no muy difícil.** El código base es limpio y bien estructurado. No hay decisiones catastróficas que requieran reescritura completa. Los problemas son: ausencia de tests, ausencia de documentación, y features pendientes, no deuda técnica irreversible.

**Estratégicamente: más difícil.** Construir traction en un ecosistema dominado por Hugo, Eleventy y Astro requiere un mensaje claro y diferenciado. Ese mensaje solo es creíble cuando la exportación editorial está implementada.

### ¿Qué decisiones podrían arruinarlo?

1. **Intentar competir con Hugo en velocidad.** Es una batalla perdida. La arquitectura basada en pandoc-como-proceso tiene un techo de velocidad inherente. Intentar superarlo requeriría reescribir el parser de Markdown en Go o Rust.

2. **Agregar JavaScript de cliente.** Iría en contra de la filosofía de simplicidad y bajo mantenimiento. Un bundle de JS significa bundler, versiones, actualizaciones de seguridad, SSR, hydration. Todo lo que el proyecto evita intencionalmente.

3. **Convertir el motor de templates en un sistema complejo.** Agregar herencia, macros, funciones, filtros al motor de templates lo convertiría en Nunjucks o Jinja. Hay razones por las que esos sistemas existen, pero agregar esa complejidad a este proyecto sería abandonar la filosofía de simplicidad.

4. **Ignorar la documentación indefinidamente.** El project puede tener la mejor arquitectura del mundo y ningún usuario si no hay documentación. La falta de documentación no es un problema "de después"; es el bloqueador actual de adopción.

5. **No implementar la exportación PDF/EPUB.** Si en v1.0.0 el proyecto sigue siendo solo un SSG web, la ventana de oportunidad para establecer el nicho editorial se cierra. Otros proyectos o plugins de Eleventy/Hugo pueden llegar a ese espacio.

### ¿Qué decisiones podrían volverlo realmente interesante?

1. **Implementar la exportación editorial antes de v1.0.0.** Un sitio web + PDF + EPUB desde el mismo Markdown, con un solo comando. Eso es una demo concreta que comunica el valor diferencial en segundos.

2. **Construir el site de docs con el propio iteraciones-cli.** Dogfooding que demuestra las capacidades del sistema y genera confianza.

3. **Publicar una antología real con el sistema.** Un libro PDF publicado en un blog construido con iteraciones-cli es la mejor demostración posible. Si la filosofía del proyecto es "escribir, compartir, re-existir", construir algo real con él es la prueba de concepto más poderosa.

4. **Enfocarse en la comunidad editorial en español.** El proyecto ya está en español. La mayoría de los SSGs tienen documentación y comunidad en inglés. Ser la herramienta de publicación editorial nativa en español para colectivos, revistas independientes, archivos y universidades de América Latina y España es un nicho concreto y mal atendido.

5. **Soporte de citas CSL.** Este feature solo, dirigido a investigadores académicos y periodistas, justifica el uso de Pandoc como engine. Hugo no lo tiene. Eleventy no lo tiene. Astro no lo tiene. Es una ventaja técnica concreta en un mercado mal atendido.

---

### Conclusión

El proyecto tiene las condiciones para convertirse en algo genuinamente diferente si mantiene su filosofía y ejecuta las features diferenciadoras. El código base es más sólido de lo que sugiere su número de versión. Las decisiones arquitectónicas centrales (Pandoc, Markdown-first, caché incremental, sistema de bloques, modelo de tipos) son correctas.

El camino crítico es: **tests → refactoring → exportación editorial → documentación**.

Sin tests, el refactoring es peligroso.  
Sin refactoring, la exportación es difícil de agregar.  
Sin exportación, no hay diferenciador.  
Sin documentación, no hay adopción.

En ese orden, y con el foco puesto en el nicho editorial en lugar de intentar ser "otro SSG más rápido", el proyecto tiene una oportunidad real.

---

*Roadmap generado en auditoría técnica de mayo 2026 · iteraciones-cli v0.4.0*

# Modelo de contenido — iteraciones-cli

> Referencia para colaboradores. Describe los tipos de documentos, el ciclo de vida en el pipeline y el grafo de dependencias entre tipos.  
> Actualizado: mayo 2026 · iteraciones-cli v0.4.x

---

## Índice

1. [Ciclo de vida de un documento](#1-ciclo-de-vida-de-un-documento)
2. [DocumentType — los 9 tipos](#2-documenttype--los-9-tipos)
3. [DocumentKind — page vs block](#3-documentkind--page-vs-block)
4. [Frontmatter por tipo](#4-frontmatter-por-tipo)
5. [Resolución de template](#5-resolución-de-template)
6. [Grafo de dependencias entre tipos](#6-grafo-de-dependencias-entre-tipos)
7. [Ciclo de vida de un bloque](#7-ciclo-de-vida-de-un-bloque)
8. [Cómo agregar un tipo nuevo](#8-cómo-agregar-un-tipo-nuevo)

---

## 1. Ciclo de vida de un documento

Un documento pasa por 6 fases del pipeline, acumulando campos en la interfaz `BuildDocument`:

```
Archivo .md en disco
        │
        ▼ discover()
SourceDocument
  { filePath, relativePath, frontmatter, body, sourceHash, mtimeMs }
        │
        ▼ classifyDocuments()
BuildDocument
  + { type, kind, templatePath }
        │
        ▼ excludeDrafts()         [draft: true → descartado]
BuildDocument (activo)
        │
        ▼ renderDocuments()       [Pandoc: markdown → HTML]
BuildDocument
  + { htmlFragment }
        │
        ▼ runContextPhaseWithTypeGraph()
BuildDocument
  + { templateContext }          [variables del template resueltas]
        │
        ▼ composeDocuments()      [templateContext → layout HTML]
BuildDocument
  + { outputHtml }
        │
        ▼ writeDocuments()
BuildDocument
  + { outputPath }               [archivo HTML en outputDir]
```

### Fases del pipeline

| Función | Fase | Qué hace |
|---|---|---|
| `setupBuildEnvironment()` | Setup | Pandoc, config, plugins, assets, cachés |
| `runDiscovery()` | Discover | `discover → classify → excludeDrafts` |
| `buildEnrichedSiteContext()` | Context de sitio | `buildSiteContext` + menú primario |
| `runPrimaryRender()` | Render primario | Pandoc para `file`, `author`, `event` |
| `runBlocksPrestep()` | Pre-paso bloques | Render + contexto de bloques → region slots |
| `runContextPhaseWithTypeGraph()` | Contexto por tipo | Contextos del template para los 9 tipos |
| `runFinalization()` | Finalización | Relativizar + compose + write + afterBuild + poda caché |

---

## 2. DocumentType — los 9 tipos

Definido en `src/builder/types.ts`:

```typescript
type DocumentType = 'file' | 'collection' | 'author' | 'authors'
                  | 'event' | 'events' | 'menu' | 'card' | 'list';
```

| Tipo | Propósito | Fase de render | Paginado | Puede ser bloque |
|---|---|---|---|---|
| `file` | Documento editorial base (artículo, nota, ensayo) | Primary | No | Sí |
| `author` | Página de perfil de un colaborador/autor | Primary | No | Sí |
| `event` | Página de un evento o actividad puntual | Primary | No | Sí |
| `collection` | Lista curada manual (`items:` en frontmatter) | Index | Sí | Sí |
| `authors` | Índice paginado de todos los autores | Index | Sí | Sí |
| `events` | Índice paginado de todos los eventos | Index | Sí | Sí |
| `menu` | Menú de navegación del sitio | Index | No | Sí |
| `card` | Bloque visual de contenido destacado | Index | No | Sí |
| `list` | Índice dinámico con filtros y paginación | Index | Sí | Sí |

### Fase primary vs index

**Primary** (`file`, `author`, `event`): se renderizan con Pandoc antes del pre-paso de bloques. Sus renders están disponibles para construir el `authorDocumentIndex` y para los pools de bloques.

**Index** (`collection`, `authors`, `events`, `menu`, `card`, `list`): se renderizan después del pre-paso de bloques, en el orden declarado en `TYPE_STAGES`. Cada tipo tiene acceso al `renderedMap` acumulado hasta ese momento.

---

## 3. DocumentKind — page vs block

```typescript
type DocumentKind = 'page' | 'block';
```

| Kind | Genera archivo HTML | Visible en URL | Uso |
|---|---|---|---|
| `page` | Sí (`relativePath` → `outputPath`) | Sí | Documento navegable |
| `block` | **No** | No | Fragmento HTML inyectado en una región del layout |

### Cómo se infiere el kind

Un documento tiene `kind === 'block'` si su frontmatter declara `block: true`. En caso contrario, `kind === 'page'`.

```yaml
# block: true → este documento no genera archivo propio
block: true
region: sidebar-primary
```

### Regiones disponibles

```typescript
type Region = 'content-before' | 'content-after'
            | 'sidebar-primary' | 'sidebar-secondary'
            | 'footer-left' | 'footer-center' | 'footer-right';
```

El campo `region:` en el frontmatter de un bloque determina en qué slot del layout se inyecta su HTML renderizado.

---

## 4. Frontmatter por tipo

Todos los tipos comparten los campos base de `Frontmatter`. Los campos específicos por tipo se documentan a continuación.

### Campos comunes (todos los tipos)

```yaml
title: "Título del documento"     # recomendado; ausente o no-string → cadena vacía
type: file                         # DocumentType; default: file
draft: false                       # true → excluido del build
keywords:                          # array de strings; usado en filtros
  - tecnología
  - ensayo
```

### `file` — Documento editorial

```yaml
type: file
title: "El título del artículo"
date: 2024-06-15              # fecha ISO; usada para ordenamiento
author:                       # array de nombres; se resuelven contra type:author
  - Sofía García
keywords:
  - investigación
```

### `author` — Perfil de autor

```yaml
type: author
title: "Sofía García"         # nombre completo; usado como clave de lookup
date: 2022-01-01              # fecha de incorporación (opcional)
```

El campo `title` es la clave de resolución: cuando un `file` declara `author: ["Sofía García"]`, el sistema busca el doc `type: author` cuyo `title` coincide (insensible a mayúsculas).

### `event` — Evento

```yaml
type: event
title: "Seminario de primavera"
date: 2024-03-20
author:                       # organizadores/autores del evento
  - Sofía García
speakers:                     # ponentes; strings o objetos con href y body
  - "Carlos López"
  - title: "Amara Diallo"
    href: /personas/amara.html
    body: "Investigadora de IA"
```

### `collection` — Lista curada

```yaml
type: collection
title: "Antología de ensayos"
items:                        # rutas relativas al cwd, en orden editorial
  - textos/ensayo-uno.md
  - textos/ensayo-dos.md
  - textos/ensayo-tres.md
author:
  - Sofía García
```

Los `items:` deben existir como docs renderizados en el momento del build. Si alguna ruta no existe, el build falla con un error explícito.

### `authors` — Índice de autores

```yaml
type: authors
title: "Quiénes somos"
```

Genera un índice paginado de todos los docs `type: author` del sitio, ordenados alfabéticamente.

### `events` — Índice de eventos

```yaml
type: events
title: "Agenda"
```

Genera un índice paginado de todos los docs `type: event`, separados en próximos y pasados respecto a la fecha de build.

### `menu` — Menú de navegación

```yaml
type: menu
title: "Menú principal"
nav:                          # ítems de navegación leídos por buildMenuContext
  - label: "Inicio"
    link: /index.html
  - label: "Artículos"
    link: /articulos/index.html
  - label: "Autores"
    link: /autores/index.html
```

Uno de los docs de este tipo puede ser el menú primario del sitio (detectado automáticamente; se inyecta en todas las páginas vía `menuHref` / `menuTitle`). El campo `nav:` es leído por `buildMenuContext` para generar las variables `menu-items` del template; sin él, el menú no tendrá ítems de navegación.

### `card` — Tarjeta de contenido

```yaml
type: card
title: "Destacado"
block: true                   # cards suelen usarse como bloques
region: sidebar-primary
```

### `list` — Índice dinámico con filtros

```yaml
type: list
title: "Todos los artículos"
filters:                      # opcional; sin filters lista todo el sitio
  type:
    - file
  keywords:
    - investigación
  author:
    - Sofía García
```

Los filtros aplican AND entre criterios y OR dentro de cada criterio. Si no se declaran filtros, el `list` incluye todos los docs del sitio excepto sí mismo.

---

## 5. Resolución de template

Para cada doc, el template HTML se resuelve en este orden de prioridad:

```
1. {cwd}/templates/{type}.html     (proyecto — máxima prioridad)
2. {tema}/templates/{type}.html    (tema seleccionado en config; si el tema
                                    es desconocido, se usa el tema claro con
                                    advertencia en stderr)
```

Implementado en `src/builder/classifier/resolve-template.ts`. No existe un tercer nivel de fallback por tipo: si el tema activo no tiene el template del tipo solicitado, el build falla con un error de ruta.

Para personalizar el template de un tipo en el proyecto, basta con crear el archivo en `templates/`:

```
mi-sitio/
  templates/
    file.html          # sobreescribe el template default de file
    collection.html    # sobreescribe el template de collection
```

---

## 6. Grafo de dependencias entre tipos

El grafo existe como estructura de datos en `src/builder/pipeline/type-graph.ts` (`TypeStageSpec[]`). El orden del array determina el orden de procesamiento.

### Diagrama

```
file ─────────────────────────────────────────────────────────┐
  │                                                             ├─► collection (pool: file+author+event)
  └──► author ─────────────────────────────────────────────────├─► authors   (pool: author)
                                                                │
event ──────────────────────────────────────────────────────── ┤
                                                                ├─► events    (pool: event)
                                                                ├─► menu      (pool: ninguno)
                                                                ├─► card      (pool: ninguno)
                                                                └─► list      (pool: TODOS los anteriores)
```

> `file` precede a `author` en la fase primary porque el pool de páginas de `author` usa los docs de `file` ya procesados.

### Tabla de dependencias

| Tipo | `dependsOn` (pool de páginas) | `dependsOn` (pool de bloques) |
|---|---|---|
| `file` | ninguno | ninguno |
| `author` | `file` | `file` |
| `event` | ninguno | ninguno |
| `collection` | `file`, `author`, `event` | `file`, `author`, `event` |
| `authors` | `author` | `author` |
| `events` | `event` | `event` |
| `menu` | ninguno | ninguno |
| `card` | ninguno | ninguno |
| `list` | todos los tipos anteriores | **solo `file`** (limitación del pre-paso) |

> **Limitación conocida de bloques `list`:** el pre-paso de bloques ocurre antes de que `collection`, `card`, etc. estén renderizados. Un bloque `type: list` con `filters.type: [collection]` devolverá una lista vacía. Esta limitación está documentada en `type-graph.ts` y en el código del runner.

### Invariantes del grafo

1. No hay ciclos. El DAG tiene 3 capas: `primary → blocks → index`.
2. Dentro de la capa `index`, `list` siempre va al final (su pool incluye todos los anteriores).
3. El orquestador no conoce los tipos concretos: delega 100% al type-graph.

---

## 7. Ciclo de vida de un bloque

Un bloque (`kind === 'block'`) sigue un camino diferente al de una página:

```
classify → kind=block
         │
         ▼ runBlocksPrestep()
         renderDocuments()          [Pandoc: body → htmlFragment]
         │
         ▼ spec.buildBlockContext() [type-graph: construye templateContext]
         │                          [pool limitado a tipos primary]
         ▼ renderBlocksToRegions()  [aplica template → innerHtml]
         │                          [agrupa por región]
         ▼ { ...enrichedSiteCtx,    [region slots disponibles para todas las páginas]
             'sidebar-primary': '<div>…</div>',
             'footer-left': '<div>…</div>' }
```

**Los bloques no generan archivos HTML.** Su output es HTML inline inyectado en el `TemplateContext` del sitio (en el slot de su `region:`), que luego se aplica a todas las páginas que usan ese layout.

---

## 8. Cómo agregar un tipo nuevo

Gracias al type-graph de Fase 1b, el procedimiento es:

### Pasos mínimos (obligatorios)

**1. Añadir el tipo al union `DocumentType`** en `src/builder/types.ts`:

```typescript
export type DocumentType = 'file' | 'collection' | ... | 'mi-tipo';
```

**2. Añadir una `TypeStageSpec`** en `src/builder/pipeline/type-graph.ts`:

```typescript
{
  type: 'mi-tipo',
  phase: 'index',           // 'primary' si debe estar disponible antes de bloques
  canBeBlock: true,         // puede aparecer con block: true en frontmatter
  paginated: false,         // true si usa listItemsLimit
  buildPool: (rendered) => [...(rendered.get('file') ?? [])],
  buildPageContexts: (doc, siteCtx, pool, authorIndex) => [
    { ...doc, templateContext: buildMiTipoPipelineContext(doc, siteCtx, pool) },
  ],
  buildBlockContext: (doc, siteCtx, primaryRendered, authorIndex) =>
    buildMiTipoPipelineContext(doc, siteCtx, primaryRendered.get('file') ?? []),
},
```

`VALID_TYPES` se deriva automáticamente del array, por lo que el clasificador reconocerá el nuevo tipo sin ningún cambio adicional.

### Pasos adicionales (según el tipo)

| Paso | Necesario si… |
|---|---|
| Crear `src/builder/context/mi-tipo.ts` | el tipo tiene lógica de contexto propia |
| Crear `src/builder/pipeline/context/mi-tipo.ts` | el tipo tiene context builder de pipeline |
| Crear `templates/mi-tipo.html` en el tema | el tipo necesita un template propio |
| Añadir al union `Region` en `types.ts` | el tipo define nuevas regiones de layout |

### Lo que NO es necesario cambiar

- `src/builder/orchestrator.ts` — el runner itera `TYPE_STAGES` automáticamente
- `src/builder/classifier/infer-type.ts` — `VALID_TYPES` se deriva del type-graph
- Ningún otro archivo del pipeline

---

*Documentación generada en mayo 2026 · iteraciones-cli v0.6.0 · [analisis-fase-1.md](analisis-fase-1.md)*

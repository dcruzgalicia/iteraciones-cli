# Plugins

Los plugins permiten extender el pipeline de build con lógica personalizada en puntos específicos del ciclo de vida.

## Registro de un plugin

En `_iteraciones.yaml`, declara las rutas de los plugins como módulos ESM relativos al directorio raíz del proyecto:

```yaml
plugins:
  - plugins/mi-plugin.js
  - plugins/otro-plugin.js
```

Los módulos se cargan dinámicamente con `import()` en tiempo de build.

## Estructura de un plugin

Un plugin es un módulo ESM con un `export default` que implementa la interfaz `IPlugin`:

```javascript
// Plugin mínimo — implementa solo los hooks que necesites
export default {
  name: 'mi-plugin',

  async afterRender(context) {
    // Modificar el HTML fragment producido por pandoc
    return {
      ...context,
      html: context.html.replace(/foo/g, 'bar'),
    };
  },
};
```

Todos los hooks son opcionales. Implementa solo los que necesites.

## Hooks disponibles

### `beforeBuild(context)`

Se ejecuta una vez al inicio del build, antes de descubrir o procesar ningún documento. No retorna valor.

**Parámetro:**

```typescript
type PluginBeforeBuildContext = {
  readonly cwd: string;                                  // directorio raíz del proyecto
  readonly outputDir: string;                            // directorio de salida absoluto
  readonly siteConfig: Readonly<Record<string, unknown>>; // configuración de _iteraciones.yaml
};
```

Útil para: conectar servicios externos, validar configuración y fallar rápido, preparar directorios o recursos necesarios durante el build.

---

### `onDocumentClassified(context)`

Se ejecuta por cada documento inmediatamente después de la clasificación automática de `type`, `kind` y `templatePath`, antes del render con pandoc. Permite a plugins sobreescribir la clasificación inferida o excluir el documento del pipeline.

- Retornar `null` excluye el documento del pipeline.
- Retornar un objeto aplica los cambios de `type`, `kind` y `templatePath`.
- No retornar nada (`void`) preserva la clasificación original.

**Parámetro:**

```typescript
type PluginClassifiedDocument = {
  readonly sourcePath: string;       // ruta absoluta al .md fuente
  readonly relativePath: string;     // ruta relativa (ej. 'eventos/meetup.md')
  readonly type: string;             // tipo inferido: 'file', 'event', 'author', etc.
  readonly kind: string;             // 'page' | 'block'
  readonly templatePath: string | undefined; // ruta absoluta al template resuelto
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
};
```

**Retorno:** `PluginClassifiedDocument | null | void`

Útil para: forzar un tipo según el directorio del archivo, asignar un template custom, excluir documentos según criterios de metadatos post-clasificación.

---

### `onDocumentDiscovered(context)`

Se ejecuta por cada documento descubierto, después de excluir borradores (`draft: true`) y después de `onDocumentClassified`. Permite modificar el cuerpo markdown, el frontmatter o la ruta relativa del documento, o excluirlo completamente.

- Retornar `null` excluye el documento del pipeline.
- Retornar un objeto aplica los cambios de `body`, `frontmatter` y `relativePath`.
- No retornar nada (`void`) preserva el documento original.

**Parámetro:**

```typescript
type PluginSourceDocument = {
  readonly sourcePath: string;       // ruta absoluta al .md fuente
  readonly relativePath: string;     // ruta relativa (ej. 'notas/mi-nota.md')
  readonly type: string;             // tipo clasificado: 'file', 'event', 'author', etc.
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;             // markdown sin frontmatter
};
```

**Retorno:** `PluginSourceDocument | null | void`

Útil para: construir índices internos, emitir advertencias de validación, inyectar contenido en el cuerpo markdown, filtrar documentos según metadatos arbitrarios.

---

### `beforeRender(context)`

Se ejecuta antes de que pandoc convierta el Markdown a HTML fragment.

**Parámetro:**

```typescript
type PluginRenderContext = {
  readonly sourcePath: string;                        // ruta absoluta al .md fuente
  readonly variables: Readonly<Record<string, string>>; // variables para pandoc
};
```

**Retorno:** `PluginRenderContext` (con posibles modificaciones)

> Nota: en la implementación actual, las variables del contexto no se pasan a pandoc como metadatos. El hook sirve como punto de observación del ciclo de renderizado.

---

### `afterRender(context)`

Se ejecuta después de que pandoc produce el HTML fragment.

**Parámetro:**

```typescript
type PluginRenderResult = {
  readonly sourcePath: string; // ruta absoluta al .md fuente
  readonly html: string;       // HTML fragment producido por pandoc
};
```

**Retorno:** `PluginRenderResult` (con posibles modificaciones al `html`)

Útil para: añadir anotaciones al HTML, reemplazar patrones, insertar marcado adicional.

---

### `beforeCompose(context)`

Se ejecuta antes de componer el HTML final (template + layout).

**Parámetro:**

```typescript
type PluginComposeContext = {
  readonly outputRelativePath: string;                        // ruta relativa en dist/web
  readonly templateContext: Readonly<Record<string, unknown>>; // variables del template
};
```

**Retorno:** `PluginComposeContext` (con posibles modificaciones al `templateContext`)

Útil para: añadir variables al template, modificar el contexto antes del render final.

**Importante:** los contextos son `Readonly`. Retorna siempre una copia con spread:

```javascript
async beforeCompose(context) {
  return {
    ...context,
    templateContext: {
      ...context.templateContext,
      'mi-variable': 'valor',
    },
  };
}
```

---

### `afterCompose(context)`

Se ejecuta después de componer el HTML final de cada página.

**Parámetro:**

```typescript
type PluginComposeResult = {
  readonly outputRelativePath: string; // ruta relativa en dist/web
  readonly html: string;               // HTML final (página completa)
};
```

**Retorno:** `PluginComposeResult` (con posibles modificaciones al `html`)

Útil para: minificación, inyección de scripts de analytics, inserción de metaetiquetas.

---

### `beforeExport(context)`

Se ejecuta antes de que un documento se convierta a PDF o EPUB con pandoc. Permite modificar el cuerpo markdown o los metadatos editoriales antes de la conversión.

> Solo se llama si la exportación está configurada en `_iteraciones.yaml` bajo `export:`.

**Parámetro:**

```typescript
type PluginExportContext = {
  readonly sourcePath: string;                          // ruta absoluta al .md fuente
  readonly body: string;                                // markdown ensamblado del documento
  readonly metadata: Readonly<Record<string, unknown>>; // metadatos editoriales
};
```

Los metadatos editoriales incluyen campos como: `title`, `author[]`, `date`, `lang`, `isbn`, `publisher`, `description`, `rights`, `documentclass`, `toc`.

**Retorno:** `PluginExportContext` (con posibles modificaciones)

Útil para: añadir notas al pie globales, inyectar secciones en el markdown, modificar metadatos como el título o el idioma del PDF/EPUB generado.

---

### `afterExport(context)`

Se ejecuta después de que pandoc genera un archivo PDF o EPUB. Permite post-procesar los bytes del archivo resultante.

> Solo se llama si la exportación está configurada en `_iteraciones.yaml` bajo `export:`.

**Parámetro:**

```typescript
type PluginExportResult = {
  readonly sourcePath: string;    // ruta absoluta al .md fuente
  readonly format: 'pdf' | 'epub'; // formato del archivo generado
  readonly data: Uint8Array;      // bytes del archivo generado
};
```

**Retorno:** `PluginExportResult` (con posibles modificaciones a `data`)

Los bytes retornados se escriben en disco y se almacenan en caché. Builds posteriores con el mismo plugin usan los bytes cacheados.

Útil para: añadir watermarks, comprimir, firmar digitalmente, cifrar archivos generados.

---

### `generateFiles(context)`

Se ejecuta al término del build para generar archivos adicionales en `dist/web`. Los archivos retornados se escriben en disco antes de ejecutar `afterBuild`, de modo que `afterBuild` recibe sus rutas en `outputPaths`.

**Parámetro:**

```typescript
type PluginBuildContext = {
  readonly outputDir: string;                           // ruta absoluta a dist/web
  readonly outputPaths: ReadonlyArray<string>;          // rutas relativas de todos los archivos generados
  readonly siteConfig: Readonly<Record<string, unknown>>; // configuración leída de _iteraciones.yaml
  readonly documents: ReadonlyArray<PluginDocumentSummary>; // resumen de todos los documentos construidos
  readonly graph: PluginDocumentGraph;                  // grafo de dependencias entre documentos
};

type PluginDocumentSummary = {
  readonly relativePath: string; // ruta relativa al .md fuente (ej. 'notas/mi-nota.md')
  readonly outputPath: string;   // ruta relativa al .html de salida (ej. 'notas/mi-nota.html')
  readonly type: string;         // tipo clasificado: 'file', 'author', 'event', etc.
  readonly frontmatter: Readonly<Record<string, unknown>>;
};

type PluginDocumentGraph = {
  edges: ReadonlyArray<{
    from: string;                    // relativePath del documento que referencia al otro
    to: string;                      // relativePath del documento referenciado
    relation: 'contains' | 'authored-by'; // tipo de relación
  }>;
};
```

**Retorno:** `GeneratedFile[]`

```typescript
type GeneratedFile = {
  relativePath: string;          // ruta relativa en dist/web (ej. 'sitemap.xml', 'feeds/rss.json')
  content: string | ArrayBuffer; // contenido textual (UTF-8) o binario
};
```

El campo `graph.edges` contiene:
- **`'contains'`**: un documento `collection` referencia explícitamente al otro via `items:` en su frontmatter.
- **`'authored-by'`**: un documento con `author:` en su frontmatter apunta a un documento de tipo `author`.

Útil para: generar `sitemap.xml`, feeds RSS/JSON/Atom, índices de búsqueda, manifiestos de PWA, archivos binarios adicionales.

**Ejemplo — generador de sitemap:**

```javascript
export default {
  name: 'sitemap',

  generateFiles({ outputDir, documents, siteConfig }) {
    const baseUrl = siteConfig['baseUrl'] ?? '';
    const urls = documents
      .filter((d) => d.type === 'file' || d.type === 'event')
      .map((d) => `  <url><loc>${baseUrl}/${d.outputPath}</loc></url>`)
      .join('\n');

    return [
      {
        relativePath: 'sitemap.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
      },
    ];
  },
};
```

---

### `afterBuild(context)`

Se ejecuta una vez al término del build, después de que todos los archivos han sido escritos en `dist/web` (incluyendo los generados por `generateFiles`). No retorna valor.

**Parámetro:** `PluginBuildContext` (mismo tipo que `generateFiles`, ver arriba)

Útil para: notificaciones, reportes post-build, sincronización con servicios externos, detección de documentos huérfanos.

**Ejemplo — detectar documentos huérfanos:**

```javascript
export default {
  name: 'orphan-detector',

  afterBuild({ documents, graph }) {
    const referenced = new Set(graph.edges.map((e) => e.to));
    const orphans = documents
      .filter((d) => d.type === 'file' && !referenced.has(d.relativePath));

    if (orphans.length > 0) {
      process.stderr.write(`[orphan-detector] ${orphans.length} documento(s) sin colección:\n`);
      for (const doc of orphans) {
        process.stderr.write(`  - ${doc.relativePath}\n`);
      }
    }
  },
};
```

---

## Plugin de referencia mínimo

El siguiente plugin cubre los tres patrones más comunes: observar, transformar y generar. Puedes usarlo como punto de partida.

```javascript
// plugins/mi-plugin.js
export default {
  name: 'mi-plugin',

  // 1. Inicialización — se ejecuta una vez antes del pipeline
  beforeBuild({ cwd, siteConfig }) {
    process.stdout.write(`[mi-plugin] Build desde: ${cwd}\n`);
  },

  // 2. Filtrado post-clasificación — excluir o reclasificar documentos
  onDocumentClassified(doc) {
    // Forzar tipo 'file' para documentos en un directorio específico
    if (doc.relativePath.startsWith('borradores/')) return null; // excluir
    return; // preservar clasificación original
  },

  // 3. Modificación pre-render — enriquecer el frontmatter o el body
  onDocumentDiscovered(doc) {
    if (doc.type !== 'file') return;
    // Añadir una variable al frontmatter
    return {
      ...doc,
      frontmatter: { ...doc.frontmatter, 'mi-variable': 'valor-inyectado' },
    };
  },

  // 4. Generación de archivos al final del build
  generateFiles({ documents, siteConfig, graph }) {
    const baseUrl = String(siteConfig['baseUrl'] ?? '');
    const referenced = new Set(graph.edges.map((e) => e.to));
    const orphans = documents.filter((d) => d.type === 'file' && !referenced.has(d.relativePath));

    const report = {
      generatedAt: new Date().toISOString(),
      totalDocuments: documents.length,
      orphans: orphans.map((d) => d.relativePath),
    };

    return [
      { relativePath: 'plugin-report.json', content: JSON.stringify(report, null, 2) },
    ];
  },
};
```

---

## Pruebas de plugins

Los plugins son módulos ESM estándar. Para probarlos con `bun test`:

### Estructura recomendada

```
plugins/
  mi-plugin.js         ← plugin
  mi-plugin.test.js    ← pruebas unitarias del plugin
```

### Patrón de prueba

Cada hook es una función pura o casi-pura; se puede invocar directamente en los tests sin necesidad del CLI:

```javascript
// plugins/mi-plugin.test.js
import { describe, expect, it } from 'bun:test';
import plugin from './mi-plugin.js';

describe('mi-plugin', () => {
  it('excluye documentos en borradores/', async () => {
    const doc = {
      sourcePath: '/proyecto/borradores/draft.md',
      relativePath: 'borradores/draft.md',
      type: 'file',
      kind: 'page',
      templatePath: undefined,
      frontmatter: { title: 'Borrador', author: [], keywords: [], date: '', draft: false },
      body: '# Contenido',
    };
    const result = await plugin.onDocumentClassified?.(doc);
    expect(result).toBeNull();
  });

  it('inyecta mi-variable en documentos tipo file', async () => {
    const doc = {
      sourcePath: '/proyecto/notas/nota.md',
      relativePath: 'notas/nota.md',
      type: 'file',
      frontmatter: { title: 'Mi nota', author: [], keywords: [], date: '' },
      body: '# Contenido',
    };
    const result = await plugin.onDocumentDiscovered?.(doc);
    expect(result?.frontmatter['mi-variable']).toBe('valor-inyectado');
  });

  it('genera plugin-report.json con lista de huérfanos', () => {
    const context = {
      outputDir: '/proyecto/dist/web',
      outputPaths: [],
      siteConfig: { baseUrl: 'https://mi-sitio.com' },
      documents: [
        { relativePath: 'notas/huerfana.md', outputPath: 'notas/huerfana.html', type: 'file', frontmatter: {} },
        { relativePath: 'coleccion.md', outputPath: 'coleccion.html', type: 'collection', frontmatter: { items: [] } },
      ],
      graph: { edges: [] },
    };
    const files = plugin.generateFiles?.(context);
    expect(files).toHaveLength(1);
    const report = JSON.parse(String(files?.[0].content));
    expect(report.orphans).toContain('notas/huerfana.md');
  });
});
```

Ejecutar las pruebas:

```bash
bun test plugins/
```

### Verificar integración end-to-end

Para validar que el plugin se registra y ejecuta correctamente en el pipeline completo:

```bash
# Registrar el plugin en _iteraciones.yaml y ejecutar un build real
iteraciones build
```

Si el hook lanza un error, el build termina con un mensaje que incluye el nombre del plugin (ej. `[plugin:mi-plugin] ...`).

---

## Orden de ejecución

Los plugins se ejecutan en el orden en que se declaran en `plugins:`. Si un hook falla, el build termina con error e indica el nombre del plugin.

## Diagnóstico

```bash
iteraciones doctor
```

Verifica el entorno del proyecto. `iteraciones doctor` comprueba: pandoc instalado y en PATH (>= 3.0), disponibilidad de `@tailwindcss/cli`, parseo correcto de `_iteraciones.yaml`, existencia de templates en `templates/` (locales o del paquete CLI), y permisos de lectura/escritura en el directorio del proyecto. **No** verifica archivos de plugins ni carga los módulos; para detectar errores en los hooks es necesario ejecutar `iteraciones build`.

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

### `onDocumentDiscovered(context)`

Se ejecuta por cada documento descubierto y clasificado, después de excluir borradores (`draft: true`) y antes de que comience el render con pandoc. No retorna valor.

**Parámetro:**

```typescript
type PluginSourceDocument = {
  readonly filePath: string;                            // ruta absoluta al .md fuente
  readonly relativePath: string;                        // ruta relativa (ej. 'notas/mi-nota.md')
  readonly type: string;                                // tipo clasificado: 'file', 'event', 'author', etc.
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;                                // markdown sin frontmatter
};
```

Útil para: construir índices internos con todos los documentos, emitir advertencias de validación, preparar datos que se necesitarán en `beforeRender`.

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
  readonly outputDir: string;                          // ruta absoluta a dist/web
  readonly outputPaths: ReadonlyArray<string>;         // rutas relativas de todos los archivos generados
  readonly siteConfig: Readonly<Record<string, unknown>>; // configuración leída de _iteraciones.yaml
  readonly documents: ReadonlyArray<PluginDocumentSummary>; // resumen de todos los documentos construidos
};

type PluginDocumentSummary = {
  readonly relativePath: string; // ruta relativa al .md fuente (ej. 'notas/mi-nota.md')
  readonly outputPath: string;   // ruta relativa al .html de salida (ej. 'notas/mi-nota.html')
  readonly type: string;         // tipo clasificado: 'file', 'author', 'event', etc.
  readonly frontmatter: Readonly<Record<string, unknown>>;
};
```

**Retorno:** `GeneratedFile[]`

```typescript
type GeneratedFile = {
  relativePath: string;          // ruta relativa en dist/web (ej. 'sitemap.xml', 'feeds/rss.json')
  content: string | ArrayBuffer; // contenido textual (UTF-8) o binario
};
```

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

Útil para: notificaciones, reportes post-build, sincronización con servicios externos.

---

## Ejemplo completo — generador de sitemap

```javascript
export default {
  name: 'sitemap-generator',

  generateFiles({ documents, siteConfig }) {
    const baseUrl = siteConfig['baseUrl'] ?? '';
    const htmlDocs = documents.filter((d) => d.type === 'file' || d.type === 'event' || d.type === 'author');

    const urls = htmlDocs
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

## Orden de ejecución

Los plugins se ejecutan en el orden en que se declaran en `plugins:`. Si un hook falla, el build termina con error e indica el nombre del plugin.

## Diagnóstico

```bash
iteraciones doctor
```

Verifica el entorno del proyecto. `iteraciones doctor` comprueba: pandoc instalado y en PATH (>= 3.0), disponibilidad de `@tailwindcss/cli`, parseo correcto de `_iteraciones.yaml`, existencia de templates en `templates/` (locales o del paquete CLI), y permisos de lectura/escritura en el directorio del proyecto. **No** verifica archivos de plugins ni carga los módulos; para detectar errores en los hooks es necesario ejecutar `iteraciones build`.

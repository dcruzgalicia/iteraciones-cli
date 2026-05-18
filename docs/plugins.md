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

### `afterBuild(context)`

Se ejecuta una vez al término del build, después de que todos los archivos han sido escritos en `dist/web`. No retorna valor.

**Parámetro:**

```typescript
type PluginBuildContext = {
  readonly outputDir: string;                  // ruta absoluta a dist/web
  readonly outputPaths: ReadonlyArray<string>; // rutas relativas de todos los archivos generados
};
```

Útil para: generar feeds RSS/Atom, crear sitemap.xml, enviar notificaciones, copiar archivos adicionales.

---

## Ejemplo completo — generador de sitemap

```javascript
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export default {
  name: 'sitemap-generator',

  async afterBuild({ outputDir, outputPaths }) {
    const baseUrl = 'https://mi-sitio.example.com';
    const htmlPaths = outputPaths.filter((p) => p.endsWith('.html'));

    const urls = htmlPaths
      .map((p) => `  <url><loc>${baseUrl}/${p}</loc></url>`)
      .join('\n');

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    await writeFile(join(outputDir, 'sitemap.xml'), sitemap, 'utf8');
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

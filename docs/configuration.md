# Configuración — `_iteraciones.yaml`

El archivo `_iteraciones.yaml` en la raíz del proyecto es la única fuente de configuración del sitio. Es opcional: si no existe, se usan todos los valores por defecto.

## Estructura completa

```yaml
site:
  title: 'Mi sitio'
  tagline: 'mi frase corta'
  lang: 'es'
  logo: ''
  accent: 'lime'
  base-url: ''
  list-items:
    limit: 10

plugins: []

theme: 'light'
```

## Campos

### `site.title`

**Tipo:** `string`  
**Por defecto:** `'Iteraciones'`

Título del sitio. Aparece en el `<title>` de cada página HTML y en el encabezado del layout.

### `site.tagline`

**Tipo:** `string`  
**Por defecto:** `'escribir, compartir, re-existir'`

Frase corta que acompaña al título en el encabezado.

### `site.lang`

**Tipo:** `string`  
**Por defecto:** `'es'`

Código de idioma BCP 47. Se usa como valor del atributo `lang` en el elemento `<html>`.

### `site.logo`

**Tipo:** `string`  
**Por defecto:** `''` (sin logo)

Ruta al archivo de logo relativa al directorio raíz del proyecto. Acepta SVG, PNG o cualquier formato de imagen que el navegador soporte.

```yaml
site:
  logo: 'assets/logo.svg'
```

### `site.accent`

**Tipo:** `string`  
**Por defecto:** `'lime'`

Color de acento del tema. Debe ser un color de la paleta de Tailwind CSS v4 con escala completa (50–950). Colores válidos: `slate`, `gray`, `zinc`, `neutral`, `stone`, `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`.

Si se declara un color no reconocido, se usa `'lime'` con un aviso en `stderr`.

### `site.list-items.limit`

**Tipo:** `number` (entero positivo)  
**Por defecto:** `10`

Número máximo de elementos por página en las listas paginadas (tipos `list`, `events`, `authors`, `collection`).

### `plugins`

**Tipo:** `string[]`  
**Por defecto:** `[]`

Lista de rutas relativas a módulos ESM que implementan la interfaz de plugin. Ver [docs/plugins.md](plugins.md).

```yaml
plugins:
  - plugins/mi-plugin.js
  - plugins/otro-plugin.js
```

### `site.base-url`

**Tipo:** `string`  
**Por defecto:** `''` (sin prefijo)

URL base del sitio, usada para construir enlaces absolutos (sitemap, feeds). Debe incluir el protocolo y no terminar en `/`.

```yaml
site:
  base-url: 'https://ejemplo.com'
```

### `theme`

**Tipo:** `string | undefined`  
**Por defecto:** tema integrado

Nombre del tema integrado. Valores disponibles: `light`, `dark`. Ver [docs/themes.md](themes.md).

```yaml
theme: 'light'
```

## Ejemplo mínimo

```yaml
site:
  title: 'Notas de campo'
  tagline: 'apuntes desde el margen'
  lang: 'es'
```

## Validación

El comando `iteraciones validate` verifica la sintaxis de `_iteraciones.yaml` y el frontmatter de todos los documentos Markdown del proyecto:

```bash
iteraciones validate
```

Los errores se imprimen en `stderr`. El comando devuelve código de salida `1` si hay errores, `0` si todo es válido.

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
  theme: 'light'
  # math: katex     # opcional; omitir desactiva el renderizado matemático
  # export:         # opcional; omitir desactiva la exportación
  #   formats: [pdf, epub]
  #   pdf-engine: xelatex
  #   pdf-concurrency: 2
  list-items:
    limit: 10

plugins: []
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

### `site.theme`

**Tipo:** `string | undefined`  
**Por defecto:** tema integrado `light`

Nombre del tema integrado. Valores disponibles: `light`, `dark`. Ver [docs/themes.md](themes.md).

```yaml
site:
  theme: 'dark'
```

### `site.math`

**Tipo:** `'katex' | 'mathjax' | undefined`  
**Por defecto:** sin renderizado matemático

Motor de renderizado de fórmulas matemáticas. `katex` es más rápido y se carga desde CDN en el cliente; `mathjax` ofrece mayor cobertura de LaTeX pero es más pesado. Si se omite, no se inyecta ningún motor.

```yaml
site:
  math: katex
```

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

### `site.export`

Controla la generación de archivos PDF y EPUB a partir de los documentos exportables del sitio (tipos `file`, `event`, `author`, `collection`, `events`). Si la sección `export` no existe dentro de `site:` o no contiene `formats`, la exportación está desactivada.

#### `site.export.formats`

**Tipo:** `Array<'pdf' | 'epub'>`  
**Por defecto:** sin exportación (la exportación se considera desactivada cuando `formats` está ausente o vacío)

Lista de formatos a generar. El orden no importa; se generan en paralelo por documento.

```yaml
site:
  export:
    formats: [pdf, epub]
```

#### `site.export.pdf-engine`

**Tipo:** `'xelatex' | 'lualatex'`  
**Por defecto:** `'xelatex'`

Motor LaTeX utilizado para generar PDF. `xelatex` tiene mayor compatibilidad con fuentes OpenType; `lualatex` ofrece soporte más completo de Unicode y mayor extensibilidad.

#### `site.export.pdf-concurrency`

**Tipo:** `integer >= 1`  
**Por defecto:** `2`

Número máximo de documentos que se exportan a PDF en paralelo. xelatex no es multi-thread y consume memoria significativa (~300-600 MB por instancia); un valor alto puede saturar el sistema en sitios con muchos documentos exportables.

Ajustar según la RAM disponible:

| RAM disponible | Valor recomendado |
|---------------|-------------------|
| 4 GB           | 1                 |
| 8 GB           | 2 (por defecto)   |
| 16 GB+         | 3–4               |

```yaml
site:
  export:
    formats: [pdf]
    pdf-concurrency: 3
```

#### `site.export.bibliography`

**Tipo:** `string | undefined`  
**Por defecto:** sin bibliografía global

Ruta relativa al proyecto a un archivo `.bib` de bibliografía BibTeX. Se aplica a todos los documentos exportados, salvo que el frontmatter del documento especifique su propia ruta.

#### `site.export.csl`

**Tipo:** `string | undefined`  
**Por defecto:** estilo por defecto de pandoc

Ruta relativa al proyecto a un archivo `.csl` de estilo de citas. Requiere que `bibliography` esté configurado.

#### `site.export.template`

**Tipo:** `'literary' | 'academic' | 'anthology' | 'technical' | undefined`  
**Por defecto:** template base según el tipo de documento

Variante de template LaTeX a usar por defecto para todos los documentos exportados. Puede sobreescribirse a nivel de documento mediante `editorial.template` en el frontmatter.

- `literary` / `academic`: para documentos de tipo `scrartcl` (`file`, `event`, `author`).
- `anthology` / `technical`: para documentos de tipo `scrbook` (`collection`, `events`).

Si la variante no es compatible con el tipo del documento, se usa el template base.

```yaml
site:
  export:
    formats: [pdf]
    pdf-engine: xelatex
    pdf-concurrency: 2
    template: academic
    bibliography: referencias.bib
    csl: apa.csl
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

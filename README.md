# iteraciones-cli

> escribir, compartir, re-existir

CLI para construir sitios estáticos a partir de archivos Markdown usando pandoc y Tailwind CSS.

## Requisitos

- [bun](https://bun.sh) ≥ 1.0
- [pandoc](https://pandoc.org/installing.html) disponible en `PATH`

## Instalación

```bash
git clone git@github.com:dcruzgalicia/iteraciones-cli.git
cd iteraciones-cli
bun install
bun link
```

Luego, en el directorio del proyecto donde quieras usar el CLI:

```bash
bun link iteraciones-cli
```

Verifica que el comando esté disponible:

```bash
iteraciones --version
```

## Estructura mínima del proyecto

```
mi-proyecto/
  _iteraciones.yaml   # configuración del sitio
  README.md           # o cualquier archivo .md
```

Puedes generar esta estructura automáticamente con:

```bash
cd mi-proyecto
iteraciones init
```

## Configuración (`_iteraciones.yaml`)

```yaml
site:
  title: "Mi sitio"          # título del sitio (por defecto: "Iteraciones")
  tagline: "mi tagline"      # frase corta (por defecto: "escribir, compartir, re-existir")
  lang: "es"                 # idioma HTML (por defecto: "es")
  logo: ""                   # ruta al logo (por defecto: "")
  list-items:
    limit: 10                # máximo de elementos en listas paginadas (por defecto: 10)

plugins: []                  # rutas ESM a plugins (relativas al directorio del proyecto)

theme:                       # nombre o ruta del tema (por defecto: tema integrado)
```

## Comandos

### `iteraciones build`

Construye el sitio a partir de los archivos Markdown.

```
iteraciones build [opciones]
```

| Opción | Descripción | Por defecto |
|--------|-------------|-------------|
| `-c, --concurrency <n>` | Máximo de invocaciones pandoc simultáneas | `4` |
| `--no-cache` | Omite la caché incremental; siempre hace build completo | — |
| `--project-root <path>` | Directorio raíz del proyecto | directorio actual |
| `--no-tailwind` | Omite la generación de CSS con Tailwind | — |
| `--dry-run` | Muestra los documentos a procesar sin generar salida | — |
| `--verbose` | Muestra información adicional de progreso | — |

### `iteraciones serve`

Arranca un servidor HTTP con livereload automático.

```
iteraciones serve [opciones]
```

| Opción | Descripción | Por defecto |
|--------|-------------|-------------|
| `-p, --port <n>` | Puerto del servidor | `3000` |

### `iteraciones watch`

Observa cambios en los archivos y reconstruye el sitio sin servidor HTTP.

```
iteraciones watch [opciones]
```

| Opción | Descripción |
|--------|-------------|
| `--verbose` | Muestra información adicional de progreso |

### `iteraciones clean`

Elimina el directorio de salida (`dist/web`) y la caché (`.iteraciones`).

```
iteraciones clean
```

### `iteraciones info`

Muestra información del proyecto y la configuración activa.

```
iteraciones info
```

### `iteraciones init`

Crea `_iteraciones.yaml` y `README.md` mínimos en el directorio actual. Si alguno de los archivos ya existe, lo omite sin sobreescribirlo.

```
iteraciones init
```

### `iteraciones validate`

Valida `_iteraciones.yaml` y el frontmatter de todos los documentos Markdown del proyecto.

```
iteraciones validate
```

### `iteraciones doctor`

Verifica que el entorno tenga todo lo necesario para ejecutar `iteraciones build`.

```
iteraciones doctor [opciones]
```

| Opción | Descripción |
|--------|-------------|
| `--fix` | Intenta corregir automáticamente los problemas detectados |

Comprobaciones que realiza: pandoc disponible, configuración válida, plantillas presentes, Tailwind disponible, permisos de lectura y escritura.

## Licencia

MIT

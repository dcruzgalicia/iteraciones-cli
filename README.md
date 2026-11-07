# iteraciones-cli

Escribir, compartir, re-existir. Convierte documentos Markdown en un sitio HTML,
EPUB, LaTeX/PDF y Markdown con plantillas y filtros propios.

## Requisitos

- [Bun](https://bun.sh/) 1.4 o superior.
- Pandoc, y ImageMagick 7 si el proyecto usa imágenes.

## Instalación en un proyecto

El paquete todavía no se publica en npm. Instálalo fijado a un tag de GitHub:

```bash
bun add -d github:dcruzgalicia/iteraciones-cli#v0.27.0
bunx iteraciones init
```

No uses una rama móvil en un proyecto publicado: fija siempre un tag.

## Comandos

```bash
iteraciones init            # configuración y archivos mínimos
iteraciones init sveltia    # agrega admin/, layout y package.json para Netlify
iteraciones build           # genera el sitio y los demás formatos
iteraciones preview         # reconstruye al detectar cambios
iteraciones validate        # revisa configuración y frontmatter
```

## Admin de Sveltia y Netlify

`iteraciones init sveltia` crea `admin/` con Sveltia vendorizado, el layout de
contenido (`textos/`, `creadoras/`, `colecciones/`, `listas/`, `anuncios/`,
`intervenciones/`, `menu.md`) y las dependencias del proyecto. No ejecuta
`bun install` ni sobrescribe archivos existentes.

El build copia `admin/` a `dist/files/admin/` automáticamente cuando el formato
HTML está activo.

Para publicar, conecta el repositorio del sitio desde la interfaz de Netlify:

- Build command: `bun install && bun run build`
- Publish directory: `dist/files`
- Variable `BUN_VERSION`: la versión de Bun que uses localmente.

No hay flujo de CI ni `netlify.toml`: Netlify reconstruye en cada push a `main`.
Después ajusta `admin/config.yml` con `OWNER/REPO` y la URL del sitio, y
configura el proveedor OAuth de GitHub en Netlify.

## Desarrollo

```bash
bun install
bun run typecheck
bun run test
```

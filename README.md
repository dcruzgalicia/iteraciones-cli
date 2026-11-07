# iteraciones-cli

Escribir, compartir, re-existir. Convierte documentos Markdown en un sitio HTML,
EPUB, LaTeX/PDF y Markdown con plantillas y filtros propios.

## Requisitos

- [Bun](https://bun.sh/) 1.4 o superior.
- Pandoc, y ImageMagick 7 si el proyecto usa imágenes.

## Instalación en un proyecto

La CLI todavía no se publica en npm. Cada proyecto guarda en su repositorio el
tarball de la versión que usa, para que el build sea reproducible sin depender
de una rama móvil.

En el repositorio de `iteraciones-cli`, genera el tarball de la versión que
quieras usar:

```bash
bun pm pack
```

Eso crea `iteraciones-cli-X.Y.Z.tgz`. Cópialo al proyecto:

```bash
mkdir -p vendor
cp iteraciones-cli-X.Y.Z.tgz vendor/
```

En el `package.json` del proyecto:

```json
{
  "dependencies": {
    "iteraciones-cli": "file:vendor/iteraciones-cli-X.Y.Z.tgz"
  },
  "scripts": {
    "build": "iteraciones build",
    "dev": "iteraciones preview"
  }
}
```

Después:

```bash
bun install
bun run build
```

Guarda el tarball y `bun.lock` en el repositorio. Para actualizar la CLI,
reemplaza el tarball, cambia la ruta en `package.json` y vuelve a ejecutar
`bun install`.

## Comandos

```bash
iteraciones init            # configuración y archivos mínimos
iteraciones init sveltia    # agrega admin/, layout y scripts para Netlify
iteraciones build           # genera el sitio y los demás formatos
iteraciones preview         # reconstruye al detectar cambios
iteraciones validate        # revisa configuración y frontmatter
```

## Admin de Sveltia y Netlify

`iteraciones init sveltia` crea `admin/` con Sveltia vendorizado, el layout de
contenido (`textos/`, `creadoras/`, `colecciones/`, `listas/`, `anuncios/`,
`intervenciones/`, `menu.md`) y los scripts `build` y `dev` del `package.json`.
No ejecuta `bun install`, no agrega la dependencia de la CLI ni sobrescribe
archivos existentes: el proyecto vendoriza su propio tarball.

El build copia `admin/` a `dist/files/admin/` automáticamente cuando el formato
HTML está activo.

Para publicar, conecta el repositorio del sitio desde la interfaz de Netlify:

- Install command: `bun install`
- Build command: `bun run build`
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

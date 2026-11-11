# iteraciones-cli

Convierte documentos Markdown en un sitio HTML, PDF, EPUB, LaTeX y Markdown
con plantillas, portadas, índice y descargas.

La documentación de uso vive en [`docs/`](docs/README.md):

- [Conceptos](docs/conceptos.md): types, formatos, salida y precedencia.
- [Configuración](docs/configuracion.md): referencia de `iteraciones.config.yaml`.
- [Recetas](docs/README.md#recetas): blog, libro y repositorio.
- [Despliegue](docs/README.md#despliegue): cabeceras, GitHub Pages, Netlify y Cloudflare.
- [Showcase](docs/showcase.md) y [piloto universitario](docs/piloto-universitario.md).

## Inicio rápido

```bash
# En el repositorio de iteraciones-cli, genera el tarball de la versión que usarás
bun pm pack

# En el proyecto nuevo
mkdir -p vendor
cp ../iteraciones-cli/iteraciones-cli-*.tgz vendor/
```

Declara la CLI en el `package.json` del proyecto:

```json
{
  "private": true,
  "dependencies": {
    "iteraciones-cli": "file:vendor/iteraciones-cli-0.27.0.tgz"
  }
}
```

Después:

```bash
bun install
bunx iteraciones init sveltia
bunx iteraciones new textos/primer-texto.md
bun run build
```

El sitio queda en `dist/files/`. La guía completa, con la estructura del
proyecto y la configuración, está en [`docs/README.md`](docs/README.md).

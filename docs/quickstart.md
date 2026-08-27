# Quickstart — del `init` al primer build

Esta guía lleva un directorio vacío hasta documentos procesados en menos de 5 minutos.

## Requisitos previos

- **Bun** ≥ 1.0 — [bun.sh](https://bun.sh)
- **Pandoc** disponible en `PATH` — [pandoc.org/installing.html](https://pandoc.org/installing.html)

## 1. Instalación

```bash
git clone git@github.com:dcruzgalicia/iteraciones-cli.git
cd iteraciones-cli
bun install
bun link
```

En el directorio del proyecto que quieras construir:

```bash
bun link iteraciones-cli
```

Verifica que el comando esté disponible:

```bash
iteraciones --version
```

## 2. Inicializar el proyecto

```bash
mkdir mi-sitio && cd mi-sitio
iteraciones init
```

Esto crea cuatro archivos:

```
mi-sitio/
  iteraciones.config.yaml       # configuración del sitio
  index.md                      # documento de inicio (se convierte en index.html)
  bibliography.bib              # archivo de referencias bibliográficas
```

El primer `build` genera `index.html`: es la página de inicio que enlazan las tarjetas de identidad del resto de los documentos.

## 3. Verificar el entorno

```bash
iteraciones doctor
```

Verifica pandoc, el motor LaTeX (solo si el proyecto genera PDF) y los permisos del directorio.

## 4. Escribir contenido

Crea documentos Markdown adicionales:

```bash
iteraciones new posts/primer-articulo.md
```

El comando crea `posts/primer-articulo.md` con el frontmatter mínimo correcto, infiriendo el título desde el nombre del archivo (capitaliza cada palabra) y usando la fecha actual:

```markdown
---
title: "Primer articulo"
date: "2026-08-09"
---

Escribe tu contenido aquí.
```

Edita el archivo y añade tu contenido después del bloque `---`.

## 5. Construir los documentos

```bash
iteraciones build
```

Los documentos procesados se generan en `dist/files/`. Los formatos activos dependen de la configuración en `iteraciones.config.yaml` (`format.latex`, `format.pdf.generate`, `format.html.generate`, etc.).

## 6. Verificar el proyecto

Antes de publicar, valida la configuración y el frontmatter de todos los documentos:

```bash
iteraciones validate
```

Los errores y advertencias se imprimen en `stderr` con la ruta del archivo y el campo afectado.

## 7. Publicar con certificación PDF/X-1a (opcional)

Para enviar los PDF a imprenta, activa el paquete PDF/X vaciando la lista de preamble filters desactivados (por defecto apaga `97-eso-pic`, `98-crop` y `99-pdfx`):

```yaml
format:
  pdf:
    generate: true
    disabled-preamble-filters: []
```

Requisitos adicionales de este flujo:

- **MacTeX full / TeX Live** (latexmk) e **ImageMagick**: `brew install imagemagick`
- **Rust** ([rustup](https://rustup.rs)): el primer build compila el validador `iteraciones-pdfcheck` y lo deja en caché de usuario; a partir de ahí no vuelve a compilar.

Comprueba que tu entorno está completo antes del primer build:

```bash
iteraciones doctor
```

Con todo en orden, cada build termina con la confirmación de certificación:

```
✔ Validación PDF/X-1a: 2 PDFs certifican PDF/X-1a
```

Si algún PDF no certificara, el build **falla** (exit 1) con el detalle por PDF: archivo, código, página y mensaje. Con `99-pdfx` activo la certificación es una garantía, no una sugerencia: quien no quiere bloqueo puede desactivar el filter en `disabled-preamble-filters`. Las condiciones exactas que valida el binario están documentadas en [docs/architecture.md](architecture.md).

## 8. Ciclo de trabajo habitual

```bash
# Verificar entorno
iteraciones doctor

# Validar configuración y frontmatter
iteraciones validate

# Build rápido (solo archivos modificados)
iteraciones build

# Build completo sin caché
iteraciones build --full

# Build con información detallada
iteraciones build --verbose
```

## Próximos pasos

- [docs/configuration.md](configuration.md) — todos los campos de `iteraciones.config.yaml`
- [docs/frontmatter-reference.md](frontmatter-reference.md) — frontmatter de documentos

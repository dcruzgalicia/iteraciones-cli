# Quickstart — del `init` al primer build

Esta guía lleva un directorio vacío hasta documentos procesados en menos de 5 minutos.

## Requisitos previos

- **Bun** ≥ 1.0 — [bun.sh](https://bun.sh)
- **Pandoc** disponible en `PATH` — [pandoc.org/installing.html](https://pandoc.org/installing.html)

Verifica tu entorno con:

```bash
iteraciones doctor
```

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

## 2. Inicializar el proyecto

```bash
mkdir mi-sitio && cd mi-sitio
iteraciones init
```

Esto crea tres archivos:

```
mi-sitio/
  iteraciones.config.yaml       # configuración del sitio
  README.md               # documento de ejemplo
  bibliography.bib        # archivo de referencias bibliográficas
```

## 3. Escribir contenido

Crea documentos Markdown adicionales:

```bash
iteraciones new posts/primer-articulo.md
```

El comando crea `posts/primer-articulo.md` con el frontmatter mínimo correcto:

```markdown
---
title: ''
date: 2025-01-01
---

```

Edita el archivo y añade tu contenido después del bloque `---`.

## 4. Construir los documentos

```bash
iteraciones build
```

Los documentos procesados se generan en `dist/files/`. Los formatos activos dependen de la configuración en `iteraciones.config.yaml` (`format.latex`, `format.pdf.generate`, `format.html.generate`, etc.).

Para ver qué documentos se procesarían sin generar salida:

```bash
iteraciones build --dry-run
```

## 5. Verificar el proyecto

Antes de publicar, valida la configuración y el frontmatter de todos los documentos:

```bash
iteraciones validate
```

Los errores y advertencias se imprimen en `stderr` con la ruta del archivo y el campo afectado.

## 6. Ciclo de trabajo habitual

```bash
# Verificar entorno
iteraciones doctor

# Validar configuración y frontmatter
iteraciones validate

# Build rápido (solo archivos modificados)
iteraciones build

# Build completo sin caché
iteraciones build --no-cache

# Build con información detallada
iteraciones build --verbose
```

## Próximos pasos

- [docs/configuration.md](configuration.md) — todos los campos de `iteraciones.config.yaml`
- [docs/frontmatter-reference.md](frontmatter-reference.md) — frontmatter de documentos

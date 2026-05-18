# Quickstart — del `init` al primer build

Esta guía lleva un directorio vacío hasta un sitio HTML funcional en menos de 5 minutos.

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

Esto crea dos archivos:

```
mi-sitio/
  _iteraciones.yaml   # configuración del sitio
  README.md           # documento de ejemplo
```

## 3. Escribir contenido

Crea documentos Markdown adicionales:

```bash
iteraciones new file posts/primer-articulo.md
```

El comando crea `posts/primer-articulo.md` con el frontmatter mínimo correcto:

```markdown
---
title: ''
date: 2025-01-01
---

```

Edita el archivo y añade tu contenido después del bloque `---`.

## 4. Construir el sitio

```bash
iteraciones build
```

El sitio se genera en `dist/web/`. Para ver el resultado con recarga automática:

```bash
iteraciones serve
```

Abre `http://localhost:3000` en tu navegador.

## 5. Verificar el proyecto

Antes de publicar, valida la configuración y el frontmatter de todos los documentos:

```bash
iteraciones validate
```

Los errores y advertencias se imprimen en `stderr` con la ruta del archivo y el campo afectado.

## 6. Ciclo de trabajo habitual

```bash
# Desarrollar con servidor y livereload
iteraciones serve

# Verificar sin generar salida
iteraciones build --dry-run

# Limpiar artefactos generados
iteraciones clean

# Build de producción con timing detallado
iteraciones build --verbose
```

## Próximos pasos

- [docs/configuration.md](configuration.md) — todos los campos de `_iteraciones.yaml`
- [docs/frontmatter-reference.md](frontmatter-reference.md) — frontmatter por tipo de documento
- [docs/themes.md](themes.md) — cómo personalizar el layout
- [docs/plugins.md](plugins.md) — extender el pipeline con hooks

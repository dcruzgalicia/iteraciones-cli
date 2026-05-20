# Benchmark de rendimiento

> **Estado:** Datos recolectados para iteraciones-cli. Las columnas de Hugo, Eleventy y Zola están pendientes de medición con las herramientas instaladas. Ver [scripts/benchmark.sh](../scripts/benchmark.sh) para reproducir.

Comparativa de tiempo de build entre iteraciones-cli y generadores estáticos populares. Se mide el tiempo de pared (*wall-clock time*) incluyendo el arranque del runtime.

## Metodología

### Contenido sintético

Cada SSG procesa `N` documentos Markdown idénticos generados automáticamente:

```markdown
---
title: "Documento de prueba N"
date: "2025-MM-DD"
description: "Descripción del documento N"
tags: [benchmark, prueba]
---

# Documento N
[~200 palabras de contenido]
```

El script `scripts/benchmark.sh` genera los proyectos sintéticos, ejecuta los builds y reporta los tiempos.

### Tipos de medición

| Tipo | Descripción |
|------|-------------|
| **Caché fría** | Primer build: sin caché `.iteraciones/`, pandoc convierte todos los documentos |
| **Caché caliente** | Segundo build sin cambios: todas las conversiones pandoc se sirven desde la caché en disco |

### Variables controladas

- Misma cantidad de documentos por prueba: **10, 50, 100, 500**
- Export PDF/EPUB **desactivado** (compara solo el pipeline HTML)
- Tailwind CSS reportado por separado (agrega ~150ms al build frío)

---

## Entorno de medición

| Campo | Valor |
|-------|-------|
| Fecha | 2026-05-19 |
| Hardware | Apple M-series (arm64) |
| SO | macOS 26.4.1 |
| Bun | 1.3.14 |
| iteraciones-cli | 0.4.0 |
| Pandoc | 3.9.0.2 |

---

## Resultados: sin Tailwind CSS, sin export PDF

Mide el pipeline principal: discover → classify → render (pandoc) → compose → write.

| Docs | iteraciones-cli frío | iteraciones-cli caliente | Hugo frío | Hugo caliente | Eleventy frío | Eleventy caliente | Zola frío | Zola caliente |
|-----:|---------------------:|-------------------------:|----------:|--------------:|--------------:|------------------:|----------:|--------------:|
| 10 | 356 ms | 61 ms | — | — | — | — | — | — |
| 50 | 433 ms | 73 ms | — | — | — | — | — | — |
| 100 | 735 ms | 74 ms | — | — | — | — | — | — |
| 500 | 3 403 ms | 150 ms | — | — | — | — | — | — |

> **—** = pendiente de medición (herramienta no instalada en este entorno).

### Notas

- El tiempo de **caché fría** está dominado por las conversiones Markdown→HTML de pandoc (~3ms/doc en este hardware).
- El tiempo de **caché caliente** (61–150ms) incluye: arranque de Bun (~50ms), discover/classify y escritura de archivos HTML. Las conversiones pandoc son 0ms (100% caché).
- El overhead de Bun al arrancar es de ~50ms independiente del tamaño del proyecto.

---

## Resultados: con Tailwind CSS, sin export PDF

Incluye la generación de `css/styles.css` via Tailwind v4 (escaneo de clases + compilación).

| Docs | iteraciones-cli frío | iteraciones-cli caliente |
|-----:|---------------------:|-------------------------:|
| 10 | 512 ms | 71 ms |
| 50 | 558 ms | 80 ms |
| 100 | 884 ms | 94 ms |

> Tailwind agrega ~150ms al build frío (escaneo de HTML generado + compilación CSS). En caché caliente el CSS también se reutiliza, por eso el delta es mínimo (~10ms).

---

## Cómo reproducir

```bash
# Clonar e instalar
git clone https://github.com/dcruzgalicia/iteraciones-cli
cd iteraciones-cli
bun install

# Benchmark básico (sin Tailwind, sin export)
bash scripts/benchmark.sh --no-tailwind

# Benchmark con Tailwind
bash scripts/benchmark.sh

# Tamaños personalizados
bash scripts/benchmark.sh --sizes=10,50,100 --no-tailwind
```

Para añadir datos de Hugo, Eleventy y Zola, instalar las herramientas correspondientes y descomentar las secciones del script `scripts/benchmark.sh`.

---

## Escalabilidad

El tiempo de caché fría crece aproximadamente lineal con el número de documentos (dominado por las llamadas a pandoc). La caché caliente es sublineal porque el overhead fijo (arranque de Bun + discover) domina para proyectos pequeños:

```
caché fría   ≈ 50ms (arranque) + N × 6ms/doc  (aproximado, depende de hardware)
caché caliente ≈ 50ms (arranque) + N × 0.2ms/doc (discover + write, sin pandoc)
```

Para sitios con 100+ documentos exportables en PDF, usar `iteraciones build` fuera del modo `serve`. Con `iteraciones serve` los PDFs se generan bajo demanda al navegar a cada URL de PDF.

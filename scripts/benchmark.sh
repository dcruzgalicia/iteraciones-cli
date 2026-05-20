#!/usr/bin/env bash
# benchmark.sh — Benchmark reproducible de iteraciones-cli
#
# Genera proyectos sintéticos con N documentos Markdown y mide el tiempo
# de build en caché fría (primer build) y caliente (segundo build sin cambios).
#
# Uso:
#   bash scripts/benchmark.sh [--sizes 10,50,100,500] [--no-tailwind] [--no-export]
#
# Requisitos:
#   - bun >= 1.1.0  (https://bun.sh)
#   - iteraciones-cli instalado o ejecutado desde el raíz del repositorio
#
# Para comparar con otros SSGs, descomenta las secciones correspondientes
# y asegúrate de tener instalado: hugo, eleventy (npx), zola.
#
# Notas:
#   - Los tiempos incluyen el arranque del runtime (Bun); son wall-clock time.
#   - La caché fría elimina .iteraciones/ antes de cada medición.
#   - La caché caliente usa el resultado del build anterior sin modificar nada.
#   - Tailwind CSS añade ~150ms al build frío por escaneo de clases y compilación.

set -euo pipefail

# ── Configuración ──────────────────────────────────────────────────────────────
SIZES="${BENCHMARK_SIZES:-10 50 100 500}"
NO_TAILWIND_FLAG=""
NO_EXPORT_FLAG="--no-export"
TMPDIR_BASE="$(mktemp -d)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_CMD="bun run ${REPO_ROOT}/src/bin.ts"

# Parsear flags
for arg in "$@"; do
  case "$arg" in
    --no-tailwind) NO_TAILWIND_FLAG="--no-tailwind" ;;
    --with-export) NO_EXPORT_FLAG="" ;;
    --sizes=*) SIZES="${arg#--sizes=}" ; SIZES="${SIZES//,/ }" ;;
  esac
done

# ── Limpieza en salida ─────────────────────────────────────────────────────────
trap 'rm -rf "${TMPDIR_BASE}"' EXIT

# ── Función: generar proyecto sintético ───────────────────────────────────────
generate_project() {
  local n="$1"
  local dir="${TMPDIR_BASE}/project_${n}"
  mkdir -p "${dir}/notas"

  cat > "${dir}/_iteraciones.yaml" << 'YAML'
site:
  title: "Benchmark Site"
  description: "Proyecto sintético para benchmark de iteraciones-cli"
  url: "http://localhost:3000"
  lang: "es"
YAML

  for i in $(seq 1 "${n}"); do
    local month
    month="$(printf '%02d' $(( (i % 12) + 1 )))"
    local day
    day="$(printf '%02d' $(( (i % 28) + 1 )))"
    cat > "${dir}/notas/doc-${i}.md" << DOC
---
title: "Documento de prueba ${i}"
date: "2025-${month}-${day}"
description: "Descripción del documento número ${i} para benchmark de rendimiento"
tags: [benchmark, prueba, "serie-${i}"]
---

# Documento ${i}

Este es el contenido del documento número ${i} generado automáticamente
para pruebas de rendimiento de iteraciones-cli.

## Primera sección

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

## Segunda sección

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in
culpa qui officia deserunt mollit anim id est laborum.
DOC
  done

  echo "${dir}"
}

# ── Función: medir tiempo en ms ───────────────────────────────────────────────
elapsed_ms() {
  local start="$1"
  local end="$2"
  echo $(( (end - start) / 1000000 ))
}

# ── Cabecera ───────────────────────────────────────────────────────────────────
echo "# Benchmark iteraciones-cli"
echo "Fecha:    $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "Hardware: $(uname -s) $(uname -m)"
echo "Bun:      $(bun --version 2>/dev/null || echo 'no disponible')"
echo "CLI:      $(cd "${REPO_ROOT}" && node -p "require('./package.json').version" 2>/dev/null || echo '?')"
echo "Pandoc:   $(pandoc --version 2>/dev/null | head -1 || echo 'no disponible')"
[[ -n "${NO_TAILWIND_FLAG}" ]] && echo "CSS:      sin Tailwind (--no-tailwind)" || echo "CSS:      con Tailwind"
[[ -z "${NO_EXPORT_FLAG}" ]] && echo "Export:   habilitado" || echo "Export:   deshabilitado (--no-export)"
echo ""

# ── Benchmark iteraciones-cli ──────────────────────────────────────────────────
echo "## iteraciones-cli"
echo ""
printf "%-6s  %-10s  %-10s\n" "Docs" "Fría (ms)" "Caliente (ms)"
printf "%-6s  %-10s  %-10s\n" "------" "----------" "-------------"

for n in ${SIZES}; do
  project_dir="$(generate_project "${n}")"

  # Caché fría: eliminar .iteraciones/ para forzar conversiones pandoc completas
  rm -rf "${project_dir}/.iteraciones"
  t0="$(date +%s%N)"
  # shellcheck disable=SC2086
  ${CLI_CMD} build --project-root "${project_dir}" ${NO_TAILWIND_FLAG} ${NO_EXPORT_FLAG} 2>/dev/null
  t1="$(date +%s%N)"
  cold="$(elapsed_ms "${t0}" "${t1}")"

  # Caché caliente: segundo build sin cambios
  t0="$(date +%s%N)"
  # shellcheck disable=SC2086
  ${CLI_CMD} build --project-root "${project_dir}" ${NO_TAILWIND_FLAG} ${NO_EXPORT_FLAG} 2>/dev/null
  t1="$(date +%s%N)"
  warm="$(elapsed_ms "${t0}" "${t1}")"

  printf "%-6s  %-10s  %-10s\n" "${n}" "${cold}" "${warm}"

  rm -rf "${project_dir}"
done

# ── Benchmark Hugo (comentado — instalar hugo primero) ────────────────────────
#
# Requiere: brew install hugo  (o https://gohugo.io/installation)
#
# generate_hugo_project() {
#   local n="$1"
#   local dir="${TMPDIR_BASE}/hugo_${n}"
#   hugo new site "${dir}" --format yaml -q
#   # Configurar tema mínimo
#   mkdir -p "${dir}/layouts/_default"
#   cat > "${dir}/layouts/_default/baseof.html" << 'HTML'
# <!DOCTYPE html><html><body>{{ block "main" . }}{{ end }}</body></html>
# HTML
#   cat > "${dir}/layouts/_default/single.html" << 'HTML'
# {{ define "main" }}<main>{{ .Content }}</main>{{ end }}
# HTML
#   cat > "${dir}/layouts/_default/list.html" << 'HTML'
# {{ define "main" }}<ul>{{ range .Pages }}<li>{{ .Title }}</li>{{ end }}</ul>{{ end }}
# HTML
#   for i in $(seq 1 "${n}"); do
#     cat > "${dir}/content/doc-${i}.md" << DOC
# +++
# title = "Documento ${i}"
# date = "2025-01-01"
# +++
# # Documento ${i}
# Contenido de prueba.
# DOC
#   done
#   echo "${dir}"
# }
#
# echo ""
# echo "## Hugo"
# echo ""
# printf "%-6s  %-10s  %-10s\n" "Docs" "Fría (ms)" "Caliente (ms)"
# printf "%-6s  %-10s  %-10s\n" "------" "----------" "-------------"
#
# for n in ${SIZES}; do
#   hugo_dir="$(generate_hugo_project "${n}")"
#   t0="$(date +%s%N)"
#   hugo --source "${hugo_dir}" 2>/dev/null
#   t1="$(date +%s%N)"
#   cold="$(elapsed_ms "${t0}" "${t1}")"
#   t0="$(date +%s%N)"
#   hugo --source "${hugo_dir}" 2>/dev/null
#   t1="$(date +%s%N)"
#   warm="$(elapsed_ms "${t0}" "${t1}")"
#   printf "%-6s  %-10s  %-10s\n" "${n}" "${cold}" "${warm}"
#   rm -rf "${hugo_dir}"
# done

# ── Benchmark Zola (comentado — instalar zola primero) ────────────────────────
#
# Requiere: brew install zola  (o https://www.getzola.org/documentation/getting-started/installation)
#
# generate_zola_project() { ... }
#
# echo ""
# echo "## Zola"
# ...

# ── Benchmark Eleventy (comentado — instalar eleventy primero) ────────────────
#
# Requiere: npm install -g @11ty/eleventy  (o npx @11ty/eleventy)
#
# generate_eleventy_project() { ... }
#
# echo ""
# echo "## Eleventy"
# ...

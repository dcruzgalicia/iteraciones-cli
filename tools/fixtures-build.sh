#!/usr/bin/env bash
# Compila las fixtures de los dos proyectos de ejemplo en directorios temporales.
# Sirve para verificar que siguen compilando sin tocar los proyectos originales.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES="$ROOT/src/test/fixtures/projects"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/iteraciones-fixtures.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

for nombre in sitio libro; do
  destino="$WORK/$nombre"
  mkdir -p "$destino"
  cp -R "$FIXTURES/$nombre/." "$destino/"

  echo "== $nombre =="
  bun "$ROOT/src/bin.ts" build --project-root "$destino" --full

  archivos="$(find "$destino/dist/files" -maxdepth 1 -type f | wc -l | tr -d ' ')"
  total="$(find "$destino/dist/files" -type f | wc -l | tr -d ' ')"
  echo "$nombre: $archivos archivos de salida, $total archivos con assets"
done

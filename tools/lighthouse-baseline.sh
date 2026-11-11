#!/usr/bin/env bash
# Guarda una línea base móvil de Lighthouse en docs/lighthouse/.
#
# Uso:
#   tools/lighthouse-baseline.sh [URL] [NOMBRE]
#
# Variables:
#   LIGHTHOUSE_URL   URL a medir (por defecto http://127.0.0.1:4173/)
#   LIGHTHOUSE_NAME  nombre del reporte (por defecto la fecha de hoy)
#   CHROME_PATH      ejecutable de Chrome/Chromium (si falta, se busca uno)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${LIGHTHOUSE_URL:-${1:-http://127.0.0.1:4173/}}"
NAME="${LIGHTHOUSE_NAME:-${2:-$(date +%Y-%m-%d)-mobile}}"
OUT_DIR="${LIGHTHOUSE_DIR:-$ROOT/docs/lighthouse}"

if [[ -z "${CHROME_PATH:-}" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"; do
    if [[ -x "$candidate" ]]; then
      CHROME_PATH="$candidate"
      break
    fi
  done
fi

if [[ -z "${CHROME_PATH:-}" ]]; then
  CHROME_PATH="$(find "$HOME/Library/Caches/ms-playwright" -path '*chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' -print -quit 2>/dev/null || true)"
fi

if [[ -z "${CHROME_PATH:-}" || ! -x "$CHROME_PATH" ]]; then
  echo "No encontré Chrome/Chromium. Instala Chrome o define CHROME_PATH." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "Lighthouse móvil: $URL"
echo "Chrome: $CHROME_PATH"
echo "Reporte: $OUT_DIR/$NAME.{json,html}"

CHROME_PATH="$CHROME_PATH" bunx --bun lighthouse "$URL" \
  --quiet \
  --only-categories=performance,accessibility,best-practices,seo \
  --chrome-flags="--headless=new --no-sandbox" \
  --output=json \
  --output=html \
  --output-path="$OUT_DIR/$NAME"

for ext in json html; do
  if [[ -f "$OUT_DIR/$NAME.report.$ext" ]]; then
    mv "$OUT_DIR/$NAME.report.$ext" "$OUT_DIR/$NAME.$ext"
  fi
done

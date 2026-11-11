# Lighthouse: línea base móvil

Foto de referencia del sitio de ejemplo antes de tocar el HTML. **No es una puerta de CI**:
el reporte se guarda para comparar a mano, no para bloquear el build.

## Referencia del issue #2783

Medición original del sitio de ejemplo (móvil):

| Categoría | Score |
| --- | --- |
| Performance | 0.96 |
| Accessibility | 0.89 |
| Best Practices | 0.96 |
| SEO | 0.91 |

| Métrica | Valor |
| --- | --- |
| LCP | 2.9 s |
| CLS | 0 |
| TBT | 0 ms |

## Medición guardada

- Fecha: 2026-11-10.
- URL: `http://127.0.0.1:4173/index.html` (servidor local sobre `/Users/david/Proyectos/historikas/dist/files`).
- Lighthouse 13.6.0, preset móvil por defecto, Chromium de Playwright 1254 vía `CHROME_PATH`.
- Reportes: `2026-11-10-historikas-mobile.json` y `2026-11-10-historikas-mobile.html`.

| Categoría | Score local |
| --- | --- |
| Performance | 1.00 |
| Accessibility | 0.89 |
| Best Practices | 0.96 |
| SEO | 0.91 |

| Métrica | Valor local |
| --- | --- |
| FCP / LCP | 1.5 s |
| CLS | 0 |
| TBT | 0 ms |
| Speed Index | 1.5 s |

La medición local no aplica la latencia de red de la referencia, así que Performance y LCP
salen mejores. Accessibility, Best Practices y SEO coinciden con el issue. La referencia
oficial sigue siendo la tabla del issue.

## Repetirla

```sh
# Servir el sitio ya construido
python3 -m http.server 4173 --bind 127.0.0.1 \
  --directory /Users/david/Proyectos/historikas/dist/files

# En otra terminal
tools/lighthouse-baseline.sh http://127.0.0.1:4173/index.html 2026-11-10-historikas-mobile
```

`tools/lighthouse-baseline.sh` acepta `LIGHTHOUSE_URL`, `LIGHTHOUSE_NAME`,
`LIGHTHOUSE_DIR` y `CHROME_PATH`. Si no hay Chrome del sistema, busca el Chromium de
Playwright en `~/Library/Caches/ms-playwright`.

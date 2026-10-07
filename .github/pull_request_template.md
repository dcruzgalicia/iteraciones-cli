## Resumen

Qué hace el PR, en una o dos frases.

## Cambios

- Cambio 1 (archivo o área)
- Cambio 2

## Riesgos

Riesgos conocidos y cómo se mitigaron. Si no hay, decirlo explícitamente.

## Pruebas

- `bun run typecheck` ✓/✗
- `bun run gherkin` — N escenarios / M steps ✓/✗
- Build de integración (`--project-root /ruta/al/proyecto`, `--full`): formatos generados y archivos vacíos ✓/✗
- Si aplica, `ITERACIONES_SIN_CAPABILITY=<x> bun run gherkin` para ver qué omite en una máquina sin esa herramienta
- Otras verificaciones manuales relevantes

Closes #N

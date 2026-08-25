import type { BuildReporter } from './types.js';

/**
 * Reporter nulo: consumidor por defecto de `build()` cuando nadie inyecta
 * uno (API programática headless). No escribe nada: el contrato documentado
 * de la API es que el CLI —no el builder— es responsable de la presentación.
 * Los warnings siguen saliendo por stderr vía logger (comportamiento global
 * existente), nunca por el reporter.
 */
export const silentReporter: BuildReporter = {
  setFormats(): void {},
  planPhases(): Promise<void> {
    return Promise.resolve();
  },
  startPhase(): void {},
  reportFile(): void {},
  completePhase(): void {},
  log(): void {},
  addWarning(): void {},
  addSummaryLine(): void {},
  showCleanup(): void {},
  startLightFormats(): void {},
  finish(): Promise<void> {
    return Promise.resolve();
  },
  fail(): Promise<void> {
    return Promise.resolve();
  },
};

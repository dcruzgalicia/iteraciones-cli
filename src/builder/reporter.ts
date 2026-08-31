import type { BuildReporter } from './types.js';

export const silentReporter: BuildReporter = {
  setFormats(): void {},
  planPhases(): void {},
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

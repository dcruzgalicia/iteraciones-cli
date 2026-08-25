/**
 * Demo headless de la API programática (issue #2017): consume `build()` con
 * un reporter propio de ~30 líneas, sin UI ni tracker. El builder emite
 * eventos; este reporter decide cómo presentarlos (aquí: texto plano).
 *
 * Uso: bun tools/headless-demo.ts /ruta/al/proyecto
 */
import { build } from '../src/builder/orchestrator.js';
import type { BuildReporter } from '../src/builder/types.js';

const reporter: BuildReporter = {
  setFormats(formats) {
    console.log(`formatos: ${formats.map((f) => `${f.phase}=${f.active ? 'on' : 'off'}`).join(' ')}`);
  },
  planPhases(phases) {
    console.log(`fases planificadas: ${phases.join(', ')}`);
    return Promise.resolve();
  },
  startPhase(phase, total = 0) {
    if (total > 0) console.log(`→ ${phase} (0/${total})`);
  },
  reportFile(file) {
    console.log(`  ✓ ${file.relativePath} [${file.phase}]`);
  },
  completePhase(count) {
    if (count !== undefined) console.log(`✔ fase completada (${count})`);
  },
  log(message) {
    console.log(message);
  },
  addWarning(message) {
    console.error(`⚠ ${message}`);
  },
  addSummaryLine(line) {
    console.log(line);
  },
  showCleanup() {},
  startLightFormats() {},
  finish(processed, cached) {
    console.log(`listo: ${processed} procesados, ${cached} desde caché`);
    return Promise.resolve();
  },
  fail() {
    console.error('✖ build fallido');
    return Promise.resolve();
  },
};

const cwd = process.argv[2] ?? process.cwd();
await build(cwd, { verbose: false }, reporter);

/**
 * Regenera el CSS base embarcado en src/lib/resources/css/base.css.
 * Ejecutar tras cambiar styles.css, el template HTML o las clases del
 * post-procesamiento de render.ts.
 *
 * Uso: bun run scripts/generate-css.ts
 */
import { generateBaseCss } from '../src/lib/generate-css.js';

await generateBaseCss();
console.log('CSS base regenerado en src/lib/resources/css/base.css');

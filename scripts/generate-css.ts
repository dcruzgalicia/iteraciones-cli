/**
 * Regenera los CSS precompilados de los 23 acentos en
 * src/lib/resources/css/<accent>.css. Ejecutar tras cambiar styles.css,
 * el template HTML o las clases del post-procesamiento de render.ts.
 *
 * Uso: bun run scripts/generate-css.ts
 */
import { generateAllCss } from '../src/lib/generate-css.js';

await generateAllCss();
console.log('CSS precompilados regenerados en src/lib/resources/css/');

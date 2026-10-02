export default {
  // El guard de tautologías mira todo `src/__tests__`, no sólo lo staged: una
  // aserción tautológica puede haber entrado por un archivo que nadie editó.
  'src/__tests__/**/*.ts': ['bun run check-tautologias'],
  // Igual de cierto para Gherkin: un step sin definir no rompe `bun test` y
  // cucumber lo reporta como `undefined` sin error, o sea que el suite queda
  // verde sin comprobar ese scenario. Corre sobre `features/**` y
  // `src/test/steps/**` completos, no sólo lo staged: un .feature puede quedar
  // huérfano porque se borró el step que usaba, en un commit que no lo tocó.
  'features/**/*.feature': ['bun run check-steps'],
  'src/test/steps/**/*.ts': ['bun run check-steps'],
  '**/*.{ts,js,mjs,cjs,json,jsonc,css}': ['bunx --bun --no-install @biomejs/biome check --write --error-on-warnings'],
};

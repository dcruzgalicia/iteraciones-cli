export default {
  // El guard de tautologías mira todo `src/__tests__`, no sólo lo staged: una
  // aserción tautológica puede haber entrado por un archivo que nadie editó.
  'src/__tests__/**/*.ts': ['bun run check-tautologias'],
  '**/*.{ts,js,mjs,cjs,json,jsonc,css}': ['bunx --bun --no-install @biomejs/biome check --write --error-on-warnings'],
};

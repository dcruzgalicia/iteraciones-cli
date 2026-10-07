export default {
  // biome corre sobre todo lo staged; el typecheck completo va en pre-commit.
  '**/*.{ts,js,mjs,cjs,json,jsonc,css}': ['bunx --bun --no-install @biomejs/biome check --write --error-on-warnings'],
};

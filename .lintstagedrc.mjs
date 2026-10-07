export default {
  '**/*.{ts,js,mjs,cjs,json,jsonc,css}': ['bunx --bun --no-install @biomejs/biome check --write --error-on-warnings'],
};

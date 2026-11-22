import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';

Then('el Dockerfile de build usa paquetes nativos y no Homebrew', () => {
  const dockerfile = readFileSync(join(process.cwd(), 'docker', 'iteraciones-build.Dockerfile'), 'utf8');
  for (const texto of ['oven/bun:1-debian', 'ca-certificates', 'curl', 'imagemagick', 'librsvg2-bin', 'pandoc']) {
    if (!dockerfile.includes(texto)) throw new Error(`el Dockerfile no incluye ${JSON.stringify(texto)}`);
  }
  if (dockerfile.includes('brew')) throw new Error('el Dockerfile no debe usar Homebrew');
});

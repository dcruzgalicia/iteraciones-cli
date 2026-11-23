import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { parse } from 'yaml';

Then('el Dockerfile de build usa paquetes nativos y no Homebrew', () => {
  const dockerfile = readFileSync(join(process.cwd(), 'docker', 'iteraciones-build.Dockerfile'), 'utf8');
  for (const texto of [
    'oven/bun:1-debian',
    'ca-certificates',
    'curl',
    'imagemagick',
    'librsvg2-bin',
    'pandoc',
    'texlive-full',
    'texlive-lang-cjk',
    'texlive-lang-spanish',
    'latexmk',
    'biber',
    'ghostscript',
    'poppler-utils',
    'minify',
    'iteraciones-pdfcheck',
  ]) {
    if (!dockerfile.includes(texto)) throw new Error(`el Dockerfile no incluye ${JSON.stringify(texto)}`);
  }
  if (dockerfile.includes('brew')) throw new Error('el Dockerfile no debe usar Homebrew');
});

Then('el pipeline de GitLab construye y publica la imagen en tags', () => {
  const texto = readFileSync(join(process.cwd(), '.gitlab-ci.yml'), 'utf8');
  parse(texto);
  for (const fragmento of ['typecheck:', 'build-image:', '$CI_COMMIT_TAG', 'docker build', 'docker push', '/usr/local/bin/smoke-test']) {
    if (!texto.includes(fragmento)) throw new Error(`el pipeline no incluye ${JSON.stringify(fragmento)}`);
  }
});

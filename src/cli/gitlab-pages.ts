import { join } from 'node:path';
import { writeExclusive } from '../builder/pipeline-io.js';
import { report } from './project-files.js';

export const DEFAULT_BUILD_IMAGE = 'registry.gitlab.com/OWNER/REPO/iteraciones-build:latest';

export function gitlabPagesConfig(buildImage = DEFAULT_BUILD_IMAGE): string {
  return [
    'pages:',
    `  image: ${buildImage}`,
    '  stage: deploy',
    '  interruptible: true',
    '  resource_group: pages',
    '  rules:',
    '    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
    '  cache:',
    '    key:',
    '      prefix: pages-$CI_COMMIT_REF_SLUG',
    '      files:',
    '        - bun.lock',
    '    paths:',
    '      - .iteraciones/',
    '      - dist/',
    '  script:',
    '    - bun install --frozen-lockfile',
    '    - bun run build',
    '  pages:',
    '    publish: dist/files',
    '',
  ].join('\n');
}

export async function writeGitlabPages(cwd: string, buildImage = DEFAULT_BUILD_IMAGE, context = 'add'): Promise<boolean> {
  const creado = await writeExclusive(join(cwd, '.gitlab-ci.yml'), gitlabPagesConfig(buildImage));
  report(creado, '.gitlab-ci.yml', context);
  return creado;
}

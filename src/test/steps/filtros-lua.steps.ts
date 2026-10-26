import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { execPandoc } from '../../lib/pandoc-runner.js';
import { checkExpectations, loadCase, world } from './lua-world.js';

const FILTERS = join(import.meta.dir, '../../lib/resources/filters');

const LATEX_FILTERS = [
  '01-br',
  '02-dictum',
  '03-verse',
  '04-center',
  '05-flushright',
  '09-quote-noindent',
  '10-cjk',
  '07-titlepages',
  '11-uppercase',
  '16-runt',
].map((name) => join(FILTERS, 'latex', `${name}.lua`));

const HTML_FILTERS = ['01-dictum', '02-verse', '05-br'].map((name) => join(FILTERS, 'html', `${name}.lua`));

Given('el caso de LaTeX {string}', loadCase);
Given('el caso de HTML {string}', loadCase);

When('lo convierto a LaTeX', async () => {
  const testCase = world.testCase;
  if (testCase === null) throw new Error('no se cargo ningun caso: falta el Given');

  const latex = testCase.filters ? testCase.filters.map((name) => join(FILTERS, 'latex', `${name}.lua`)) : LATEX_FILTERS;
  const extraArgs = latex.flatMap((f) => ['--lua-filter', f]);
  world.output = await execPandoc({
    input: testCase.markdown,
    sourcePath: 'test.md',
    to: 'latex',
    from: testCase.from,
    extraArgs,
  });
});

When('lo convierto a HTML', async () => {
  const testCase = world.testCase;
  if (testCase === null) throw new Error('no se cargo ningun caso: falta el Given');

  const extraArgs = HTML_FILTERS.flatMap((f) => ['--lua-filter', f]);
  world.output = await execPandoc({
    input: testCase.markdown,
    sourcePath: 'test.md',
    to: 'html5',
    extraArgs,
  });
});

Then('cumple las expectativas guardadas', checkExpectations);

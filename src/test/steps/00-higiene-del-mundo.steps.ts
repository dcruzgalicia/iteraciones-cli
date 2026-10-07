import { mock } from 'bun:test';
import { After, AfterAll, BeforeAll } from '@cucumber/cucumber';

After(() => {
  mock.restore();
});

const stdoutReal = process.stdout.write.bind(process.stdout);
const stderrReal = process.stderr.write.bind(process.stderr);

const silencioso = (): boolean => process.env.ITERACIONES_VERBOSE !== '1';

BeforeAll(() => {
  if (!silencioso()) return;
  process.stdout.write = (): boolean => true;
  process.stderr.write = (): boolean => true;
});

AfterAll(() => {
  process.stdout.write = stdoutReal;
  process.stderr.write = stderrReal;
});

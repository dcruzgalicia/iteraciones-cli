import { buildProgram } from './parser.js';

export async function dispatch(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

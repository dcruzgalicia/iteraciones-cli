#!/usr/bin/env bun
import { CommanderError } from 'commander';
import { buildProgram } from './cli/parser.js';

try {
  await buildProgram().parseAsync(process.argv);
} catch (err) {
  // commander con exitOverride lanza CommanderError tras mostrar el mensaje
  // (traducido por configureOutput): el exit code se fija sin matar el proceso.
  if (err instanceof CommanderError) {
    process.exitCode = err.exitCode;
  } else {
    throw err;
  }
}

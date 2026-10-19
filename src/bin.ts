#!/usr/bin/env bun
import { CommanderError } from 'commander';
import { buildProgram } from './cli/parser.js';
import { forwardSignalsToChildren } from './lib/run.js';

forwardSignalsToChildren();

try {
  await buildProgram().parseAsync(process.argv);
} catch (err) {
  if (err instanceof CommanderError) {
    process.exitCode = err.exitCode;
  } else {
    throw err;
  }
}

#!/usr/bin/env bun
import { buildProgram } from './cli/parser.js';

await buildProgram().parseAsync(process.argv);

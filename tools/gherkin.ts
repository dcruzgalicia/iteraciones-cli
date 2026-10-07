#!/usr/bin/env bun
import { reportMissingTools } from '../src/test/preflight.js';

if (await reportMissingTools()) process.exit(1);

const proc = Bun.spawn(['bunx', 'cucumber-js', ...process.argv.slice(2)], { stdout: 'inherit', stderr: 'inherit' });
process.exit(await proc.exited);

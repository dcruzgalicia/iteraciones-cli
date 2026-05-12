#!/usr/bin/env bun
import { dispatch } from './cli/dispatcher.js';

await dispatch(process.argv);

#!/usr/bin/env node
/**
 * Build the site for the current inputs and activate it.
 *
 *   rebuild.mjs           build unless the current inputs are already served
 *   rebuild.mjs --force   build even if the same inputs failed before
 *   rebuild.mjs --check   validate the config and print the input hash only
 */
import { computeHash, loadConfig, log, reconcile, validateConfig } from '../lib/site.mjs';

const args = new Set(process.argv.slice(2));

if (args.has('--check')) {
  validateConfig(loadConfig());
  console.log(computeHash());
  process.exit(0);
}

const result = reconcile({ force: args.has('--force') });
log(`${result.hash}: ${result.action}`);
process.exit(result.action === 'failed' ? 1 : 0);

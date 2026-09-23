#!/usr/bin/env node
/**
 * Watch the mounted config and data for changes and rebuild the site.
 *
 * Polls the input hash every REFERENCE_WATCH_INTERVAL seconds (default 10)
 * and additionally wakes up early on file system events, which do not fire
 * on every kind of bind mount.
 */
import { existsSync, watch } from 'node:fs';
import { dirname } from 'node:path';
import {
  currentHash,
  hasFailed,
  hashInputs,
  intEnv,
  log,
  paths,
  readInputs,
  reconcile,
  seed,
  sweep
} from '../lib/site.mjs';

const interval = intEnv('REFERENCE_WATCH_INTERVAL', 10) * 1000;
const debounce = 1500;

let timer = null;
let running = false;
let pending = false;
let reported = null;

function check() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    const hash = hashInputs(readInputs());
    if (hash !== currentHash()) {
      if (hasFailed(hash)) {
        if (reported !== hash) {
          log(`inputs ${hash} failed to build earlier; fix them or run rebuild.mjs --force`);
          reported = hash;
        }
      } else {
        const result = reconcile();
        if (result.action !== 'current') log(`${result.hash}: ${result.action}`);
      }
    }
  } catch (error) {
    if (reported !== error.message) {
      log(`check failed: ${error.message}`);
      reported = error.message;
    }
  } finally {
    running = false;
    if (pending) {
      pending = false;
      schedule();
    }
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(check, debounce);
}

sweep();
seed();

for (const target of [dirname(paths.config), paths.data]) {
  if (!existsSync(target)) continue;
  try {
    const watcher = watch(target, { recursive: true, persistent: false }, schedule);
    watcher.on('error', (error) =>
      log(`stopped watching ${target} (${error.message}); polling only`)
    );
    log(`watching ${target}`);
  } catch (error) {
    log(`cannot watch ${target} (${error.message}); polling only`);
  }
}

log(`polling every ${interval / 1000} s; serving ${currentHash() || 'nothing'}`);
check();
setInterval(check, interval);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(0));
}

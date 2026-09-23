/**
 * Build pipeline for the self-hosted container.
 *
 * Inputs: the mounted site config, user posts and icons, plus the image build
 * id. They are read once into a snapshot, hashed into a release id, and the
 * release is built from that snapshot in a staging directory, verified, moved
 * into the releases directory and activated by atomically replacing the
 * symlink nginx serves from. Failed builds are recorded so the same inputs are
 * not retried until they change. A lock file keeps the watcher and a manual
 * rebuild from building at the same time.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import { basename, join } from 'node:path';
import Ajv from 'ajv';
import yaml from 'js-yaml';

const env = (name, fallback) => process.env[name] || fallback;

export const log = (msg) => console.log(`[reference] ${new Date().toISOString()} ${msg}`);

/** Positive integer from the environment; anything else falls back with a warning. */
export function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || String(value) !== raw.trim() || value < 1) {
    log(`ignoring ${name}="${raw}" (expected a positive integer); using ${fallback}`);
    return fallback;
  }
  return value;
}

export const paths = {
  app: env('REFERENCE_APP', '/app'),
  config: env('REFERENCE_CONFIG', '/config/site.yml'),
  data: env('REFERENCE_DATA', '/data'),
  releases: env('REFERENCE_RELEASES', '/srv/releases'),
  state: env('REFERENCE_STATE', '/srv/state'),
  www: env('REFERENCE_WWW', '/srv/www')
};
export const keepReleases = intEnv('REFERENCE_KEEP_RELEASES', 3);

export class ConfigError extends Error {}

// ---------------------------------------------------------------------------
// Inputs

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])])
    );
  }
  return value;
}

const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(schema);

export function validateConfig(config) {
  if (config === null) return;
  if (!validate(config)) {
    const details = validate.errors
      .map((e) => `  ${e.instancePath || '(root)'} ${e.message}`)
      .join('\n');
    throw new ConfigError(`${paths.config} is invalid:\n${details}`);
  }
}

function listFiles(dir, extension) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current, prefix) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), rel);
      else if (entry.name.endsWith(extension)) out.push(rel);
    }
  };
  walk(dir, '');
  return out;
}

export function buildId() {
  const file = join(paths.app, 'BUILD_ID');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : 'dev';
}

/**
 * Read every input once. Problems (unreadable files, YAML syntax errors,
 * duplicate names) are collected rather than thrown so that they still
 * produce a hash and can be recorded as a failed build.
 */
export function readInputs() {
  const snapshot = {
    build: buildId(),
    config: null,
    configText: null,
    posts: [],
    icons: [],
    problems: []
  };

  if (existsSync(paths.config)) {
    try {
      snapshot.configText = readFileSync(paths.config, 'utf8');
      const parsed = yaml.load(snapshot.configText);
      if (parsed !== undefined && parsed !== null) {
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          snapshot.problems.push(`${paths.config}: expected a YAML mapping at the top level`);
        } else {
          snapshot.config = parsed;
        }
      }
    } catch (error) {
      snapshot.problems.push(`${paths.config}: ${error.message}`);
    }
  }

  for (const [group, extension] of [
    ['posts', '.md'],
    ['icons', '.svg']
  ]) {
    const dir = join(paths.data, group);
    const seen = new Map();
    for (const rel of listFiles(dir, extension)) {
      const name = basename(rel);
      if (seen.has(name)) {
        snapshot.problems.push(`${dir}: ${rel} and ${seen.get(name)} would both become ${name}`);
        continue;
      }
      seen.set(name, rel);
      try {
        snapshot[group].push({ rel, name, data: readFileSync(join(dir, rel)) });
      } catch (error) {
        snapshot.problems.push(`${join(dir, rel)}: ${error.message}`);
      }
    }
  }
  return snapshot;
}

/** Stable id for a snapshot: config content (comments and key order ignored), user files, image build. */
export function hashInputs(snapshot) {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify({
      build: snapshot.build,
      config: snapshot.config ? sortKeys(snapshot.config) : snapshot.configText,
      problems: snapshot.problems
    })
  );
  for (const group of ['posts', 'icons']) {
    for (const file of snapshot[group]) {
      hash.update(`\0${group}/${file.rel}\0`);
      hash.update(file.data);
    }
  }
  return hash.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// State

export function currentHash() {
  try {
    return basename(readlinkSync(paths.www));
  } catch {
    return null;
  }
}

const failedLog = (hash) => join(paths.state, 'failed', `${hash}.log`);
export const hasFailed = (hash) => existsSync(failedLog(hash));
export const clearFailed = (hash) => rmSync(failedLog(hash), { force: true });
export const hasRelease = (hash) => existsSync(join(paths.releases, hash, '.complete'));

export function activate(hash) {
  const target = join(paths.releases, hash);
  const tmp = `${paths.www}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(target, tmp);
  renameSync(tmp, paths.www);
  const now = new Date();
  utimesSync(target, now, now); // newest release is the last one pruned
  log(`serving release ${hash}`);
}

function prune(current) {
  if (!existsSync(paths.releases)) return;
  const releases = readdirSync(paths.releases)
    .filter((name) => !name.startsWith('.') && name !== current)
    .map((name) => ({ name, mtime: statSync(join(paths.releases, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const release of releases.slice(Math.max(keepReleases - 1, 0))) {
    const deleting = join(paths.releases, `.deleting-${release.name}`);
    renameSync(join(paths.releases, release.name), deleting);
    rmSync(deleting, { recursive: true, force: true });
    log(`pruned release ${release.name}`);
  }
}

/** Copy the release baked into the image into /srv when no complete release is there. */
export function seed() {
  const seedDir = join(paths.app, 'seed');
  if (!existsSync(seedDir)) return null;
  mkdirSync(paths.releases, { recursive: true });
  if (readdirSync(paths.releases).some((name) => hasRelease(name))) return null;
  for (const name of readdirSync(seedDir)) {
    if (!existsSync(join(seedDir, name, '.complete'))) continue;
    cpSync(join(seedDir, name), join(paths.releases, name), { recursive: true });
    if (!currentHash()) activate(name);
    log(`seeded release ${name} from the image`);
    return name;
  }
  return null;
}

/** Remove a file, or the target of a symlink (the image links db.json into /srv/state). */
function removeThrough(file) {
  try {
    const target = readlinkSync(file);
    rmSync(target, { force: true });
  } catch {
    rmSync(file, { force: true });
  }
}

/** Remove leftovers of interrupted builds and prunes. Run at startup. */
export function sweep() {
  mkdirSync(paths.releases, { recursive: true });
  mkdirSync(join(paths.state, 'failed'), { recursive: true });
  for (const [dir, prefixes] of [
    [paths.releases, ['.staging-', '.deleting-']],
    [paths.state, ['src-', 'overlay-']]
  ]) {
    for (const name of readdirSync(dir)) {
      if (prefixes.some((prefix) => name.startsWith(prefix))) {
        rmSync(join(dir, name), { recursive: true, force: true });
        log(`removed leftover ${join(dir, name)}`);
      }
    }
  }
  releaseLock(true);
}

// ---------------------------------------------------------------------------
// Lock

const lockFile = () => join(paths.state, 'build.lock');

function acquireLock() {
  mkdirSync(paths.state, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockFile(), 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number.parseInt(readFileSync(lockFile(), 'utf8'), 10);
      if (pid === process.pid) return true;
      try {
        process.kill(pid, 0);
        return false; // held by a live process
      } catch {
        rmSync(lockFile(), { force: true }); // stale
      }
    }
  }
  return false;
}

function releaseLock(force = false) {
  try {
    const pid = Number.parseInt(readFileSync(lockFile(), 'utf8'), 10);
    if (force || pid === process.pid) rmSync(lockFile(), { force: true });
  } catch {
    // no lock
  }
}

// ---------------------------------------------------------------------------
// Build

function run(cmd, args, options, output) {
  const result = spawnSync(cmd, args, {
    ...options,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  output.push(`$ ${cmd} ${args.join(' ')}\n${result.stdout || ''}${result.stderr || ''}`);
  if (result.status !== 0) {
    throw new Error(
      `${basename(cmd)} exited with ${result.status === null ? result.signal : `status ${result.status}`}`
    );
  }
}

function stageSource(hash, snapshot) {
  const src = join(paths.state, `src-${hash}`);
  rmSync(src, { recursive: true, force: true });
  cpSync(join(paths.app, 'source'), src, { recursive: true });
  for (const [group, dir] of [
    ['posts', '_posts'],
    ['icons', 'assets/icon']
  ]) {
    for (const file of snapshot[group]) {
      const target = join(src, dir, file.name);
      if (existsSync(target)) log(`${group}/${file.rel} replaces the built-in ${dir}/${file.name}`);
      writeFileSync(target, file.data);
    }
  }
  return src;
}

function verify(dir) {
  for (const required of ['index.html', 'search.json', 'css/style.css', 'js/main.js']) {
    if (!existsSync(join(dir, required))) throw new Error(`build output is missing ${required}`);
  }
  const pages = readdirSync(dir).filter(
    (name) => name.endsWith('.html') && name !== 'index.html'
  ).length;
  if (pages < 1) throw new Error('build output has no cheat sheet pages');
  return pages + 1;
}

/** Build a snapshot into a release and activate it. Returns 'built', 'failed' or 'busy'. */
export function build(snapshot, hash) {
  if (!acquireLock()) {
    log(`another build is running; ${hash} will be picked up afterwards`);
    return 'busy';
  }
  const started = Date.now();
  const output = [];
  const staging = join(paths.releases, `.staging-${hash}`);
  const overlay = join(paths.state, `overlay-${hash}.yml`);
  let src = null;
  mkdirSync(paths.releases, { recursive: true });
  mkdirSync(join(paths.state, 'failed'), { recursive: true });
  try {
    if (snapshot.problems.length > 0) {
      throw new ConfigError(
        `inputs cannot be used:\n${snapshot.problems.map((p) => `  ${p}`).join('\n')}`
      );
    }
    validateConfig(snapshot.config);
    log(
      `building ${hash} (${snapshot.posts.length} user posts, ${snapshot.icons.length} user icons)`
    );
    src = stageSource(hash, snapshot);
    rmSync(staging, { recursive: true, force: true });
    removeThrough(join(paths.app, 'db.json'));
    writeFileSync(overlay, yaml.dump({ source_dir: src, public_dir: staging }));

    const bin = (name) => join(paths.app, 'node_modules', '.bin', name);
    const opts = {
      cwd: paths.app,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        REFERENCE_SOURCE_DIR: src,
        REFERENCE_PUBLIC_DIR: staging
      }
    };
    const configs = ['_config.yml', ...(snapshot.config ? [paths.config] : []), overlay].join(',');
    run(
      bin('postcss'),
      ['themes/coo/source/css/style.tailwindcss', '-o', 'themes/coo/source/css/style.css'],
      opts,
      output
    );
    run(bin('hexo'), ['generate', '--config', configs, '--silent'], opts, output);
    run(bin('gulp'), [], opts, output);

    const pages = verify(staging);
    writeFileSync(join(staging, '.complete'), new Date().toISOString());
    const release = join(paths.releases, hash);
    if (existsSync(release)) {
      const deleting = join(paths.releases, `.deleting-${hash}`);
      renameSync(release, deleting);
      rmSync(deleting, { recursive: true, force: true });
    }
    renameSync(staging, release);
    activate(hash);
    prune(hash);
    clearFailed(hash);
    log(`built ${hash}: ${pages} pages in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return 'built';
  } catch (error) {
    const reason = error instanceof ConfigError ? error.message : error.stack || String(error);
    const report = `${reason}\n\n${output.join('\n')}`;
    writeFileSync(failedLog(hash), report);
    console.error(report.slice(-4000));
    log(
      `build ${hash} failed, keeping ${currentHash() || 'nothing'}; details in ${failedLog(hash)}`
    );
    rmSync(staging, { recursive: true, force: true });
    return 'failed';
  } finally {
    if (src) rmSync(src, { recursive: true, force: true });
    rmSync(overlay, { force: true });
    releaseLock();
  }
}

/** Bring the served site in line with the current inputs. Returns what happened. */
export function reconcile({ force = false } = {}) {
  const snapshot = readInputs();
  const hash = hashInputs(snapshot);
  if (hash === currentHash()) return { hash, action: 'current' };
  if (hasRelease(hash)) {
    activate(hash);
    return { hash, action: 'activated' };
  }
  if (hasFailed(hash)) {
    if (!force) return { hash, action: 'failed' };
    clearFailed(hash);
  }
  return { hash, action: build(snapshot, hash) };
}

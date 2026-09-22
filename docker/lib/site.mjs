/**
 * Build pipeline for the self-hosted container.
 *
 * Inputs: the mounted site config, user posts and icons, plus the image build
 * id. They are hashed into a release id. Each release is built in a staging
 * directory, verified, moved into the releases directory and then activated
 * by atomically replacing the symlink nginx serves from. Failed builds are
 * recorded so the same inputs are not retried until they change.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import Ajv from 'ajv';
import yaml from 'js-yaml';

const env = (name, fallback) => process.env[name] || fallback;

export const paths = {
  app: env('REFERENCE_APP', '/app'),
  config: env('REFERENCE_CONFIG', '/config/site.yml'),
  data: env('REFERENCE_DATA', '/data'),
  releases: env('REFERENCE_RELEASES', '/srv/releases'),
  state: env('REFERENCE_STATE', '/srv/state'),
  www: env('REFERENCE_WWW', '/srv/www')
};
export const keepReleases = Number.parseInt(env('REFERENCE_KEEP_RELEASES', '3'), 10);

const log = (msg) => console.log(`[reference] ${new Date().toISOString()} ${msg}`);

// ---------------------------------------------------------------------------
// Inputs and hashing

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

export function loadConfig() {
  if (!existsSync(paths.config)) return null;
  const parsed = yaml.load(readFileSync(paths.config, 'utf8'));
  if (parsed === undefined || parsed === null) return null;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`${paths.config}: expected a YAML mapping at the top level`);
  }
  return parsed;
}

const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(schema);

export class ConfigError extends Error {}

export function validateConfig(config) {
  if (config === null) return;
  if (!validate(config)) {
    const details = validate.errors
      .map((e) => `  ${e.instancePath || '(root)'} ${e.message}`)
      .join('\n');
    throw new ConfigError(`${paths.config} is invalid:\n${details}`);
  }
}

function listFiles(dir, extensions) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) walk(join(current, entry.name), rel);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(rel);
    }
  };
  walk(dir, '');
  return out;
}

export function userInputs() {
  return {
    posts: { dir: join(paths.data, 'posts'), files: listFiles(join(paths.data, 'posts'), ['.md']) },
    icons: { dir: join(paths.data, 'icons'), files: listFiles(join(paths.data, 'icons'), ['.svg']) }
  };
}

export function buildId() {
  const file = join(paths.app, 'BUILD_ID');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : 'dev';
}

/** Stable id for the current inputs: config content (comments and key order ignored), user files, image build. */
export function computeHash() {
  const config = loadConfig();
  const inputs = userInputs();
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ build: buildId(), config: sortKeys(config) }));
  for (const group of Object.values(inputs)) {
    for (const rel of group.files) {
      hash.update(`\0${rel}\0`);
      hash.update(readFileSync(join(group.dir, rel)));
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
export const hasRelease = (hash) => existsSync(join(paths.releases, hash, 'index.html'));

export function activate(hash) {
  const target = join(paths.releases, hash);
  const tmp = `${paths.www}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(target, tmp);
  renameSync(tmp, paths.www);
  log(`serving release ${hash}`);
}

function prune(current) {
  if (!existsSync(paths.releases)) return;
  const releases = readdirSync(paths.releases)
    .filter((name) => !name.startsWith('.') && name !== current)
    .map((name) => ({ name, mtime: statSync(join(paths.releases, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const release of releases.slice(Math.max(keepReleases - 1, 0))) {
    rmSync(join(paths.releases, release.name), { recursive: true, force: true });
    log(`pruned release ${release.name}`);
  }
}

// ---------------------------------------------------------------------------
// Build

function run(cmd, args, options, output) {
  const result = spawnSync(cmd, args, { ...options, encoding: 'utf8' });
  output.push(`$ ${cmd} ${args.join(' ')}\n${result.stdout || ''}${result.stderr || ''}`);
  if (result.status !== 0) {
    throw new Error(`${basename(cmd)} exited with status ${result.status}`);
  }
}

function stageSource(hash, config, inputs) {
  const src = join(paths.state, `src-${hash}`);
  rmSync(src, { recursive: true, force: true });
  cpSync(join(paths.app, 'source'), src, { recursive: true });
  for (const slug of config?.exclude_posts || []) {
    rmSync(join(src, '_posts', `${slug}.md`), { force: true });
  }
  for (const rel of inputs.posts.files) {
    cpSync(join(inputs.posts.dir, rel), join(src, '_posts', basename(rel)));
  }
  for (const rel of inputs.icons.files) {
    cpSync(join(inputs.icons.dir, rel), join(src, 'assets', 'icon', basename(rel)));
  }
  return src;
}

function verify(dir) {
  for (const required of ['index.html', 'search.json', 'css/style.css', 'js/main.js']) {
    if (!existsSync(join(dir, required))) throw new Error(`build output is missing ${required}`);
  }
  const pages = readdirSync(dir).filter((name) => name.endsWith('.html')).length;
  if (pages < 10) throw new Error(`build output has only ${pages} pages`);
  return pages;
}

export function build(hash) {
  const started = Date.now();
  const output = [];
  const staging = join(paths.releases, `.staging-${hash}`);
  const overlay = join(paths.state, `overlay-${hash}.yml`);
  let src = null;
  mkdirSync(paths.releases, { recursive: true });
  mkdirSync(join(paths.state, 'failed'), { recursive: true });
  try {
    const config = loadConfig();
    validateConfig(config);
    const inputs = userInputs();
    log(
      `building ${hash} (${inputs.posts.files.length} user posts, ${inputs.icons.files.length} user icons)`
    );
    src = stageSource(hash, config, inputs);
    rmSync(staging, { recursive: true, force: true });
    rmSync(join(paths.app, 'db.json'), { force: true });
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
    const configs = ['_config.yml', ...(config ? [paths.config] : []), overlay].join(',');
    run(
      bin('postcss'),
      ['themes/coo/source/css/style.tailwindcss', '-o', 'themes/coo/source/css/style.css'],
      opts,
      output
    );
    run(bin('hexo'), ['generate', '--config', configs, '--silent'], opts, output);
    run(bin('gulp'), ['--max-old-space-size=4096'], opts, output);

    const pages = verify(staging);
    const release = join(paths.releases, hash);
    rmSync(release, { recursive: true, force: true });
    renameSync(staging, release);
    activate(hash);
    prune(hash);
    rmSync(failedLog(hash), { force: true });
    log(`built ${hash}: ${pages} pages in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return true;
  } catch (error) {
    const reason = error instanceof ConfigError ? error.message : error.stack || String(error);
    const report = `${reason}\n\n${output.join('\n')}`;
    writeFileSync(failedLog(hash), report);
    console.error(report.slice(-4000));
    log(
      `build ${hash} failed, keeping ${currentHash() || 'nothing'}; details in ${failedLog(hash)}`
    );
    rmSync(staging, { recursive: true, force: true });
    return false;
  } finally {
    if (src) rmSync(src, { recursive: true, force: true });
    rmSync(overlay, { force: true });
  }
}

/** Bring the served site in line with the current inputs. Returns what happened. */
export function reconcile({ force = false } = {}) {
  const hash = computeHash();
  if (hash === currentHash()) return { hash, action: 'current' };
  if (hasRelease(hash)) {
    activate(hash);
    return { hash, action: 'activated' };
  }
  if (hasFailed(hash) && !force) return { hash, action: 'failed' };
  return { hash, action: build(hash) ? 'built' : 'failed' };
}

export { log, resolve };

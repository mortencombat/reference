#!/usr/bin/env node
/**
 * Sanity-check a built site: required files exist, enough pages were
 * generated, and no page loads scripts or styles from third parties or
 * contains known ad, affiliate or tracking markers.
 *
 *   node tools/check-site.mjs [public-dir] [--allow-livecodes]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || 'public';
const allowLivecodes = args.includes('--allow-livecodes');

const REQUIRED = [
  'index.html',
  'search.json',
  'robots.txt',
  'manifest.json',
  'sitemap.xml',
  'css/style.css',
  'js/main.js'
];
const MIN_PAGES = 100;
const FORBIDDEN = [
  'googlesyndication',
  'adsbygoogle',
  'googletagmanager',
  'google-analytics.com',
  'clarity.ms',
  'carbonads',
  'carbon_container',
  'buymeacoffee.com',
  'utm_medium=affiliate',
  'serviceWorker.register',
  'disqus.com'
];
// Some upstream cheat sheets embed small widgets that load a library from a
// CDN. That is content, not the theme; keep the list short and deliberate.
const ALLOWED_EXTERNAL = [
  'https://cdn.tailwindcss.com', // color-picker.md
  'https://unpkg.com/cronstrue@', // cron.md
  ...(allowLivecodes ? ['https://cdn.jsdelivr.net/npm/livecodes'] : [])
];

const problems = [];
for (const file of REQUIRED) {
  if (!existsSync(join(dir, file))) problems.push(`missing ${file}`);
}

const pages = readdirSync(dir).filter((name) => name.endsWith('.html'));
if (pages.length < MIN_PAGES)
  problems.push(`only ${pages.length} pages, expected at least ${MIN_PAGES}`);

const external =
  /<(?:script[^>]+src|link[^>]+rel=["']stylesheet["'][^>]+href)=["'](https?:\/\/[^"']+)["']/gi;
for (const page of pages) {
  const html = readFileSync(join(dir, page), 'utf8');
  for (const marker of FORBIDDEN) {
    if (html.includes(marker)) problems.push(`${page}: contains "${marker}"`);
  }
  for (const match of html.matchAll(external)) {
    const url = match[1];
    if (!ALLOWED_EXTERNAL.some((prefix) => url.startsWith(prefix))) {
      problems.push(`${page}: loads external resource ${url}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`check-site: ${problems.length} problem(s) in ${dir}`);
  for (const problem of problems.slice(0, 50)) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-site: ${dir} ok (${pages.length} pages)`);

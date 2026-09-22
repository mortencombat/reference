/**
 * Apply `theme_config` from the site config over the theme's own _config.yml.
 *
 * Hexo's built-in merge unions arrays, which would make it impossible to
 * shrink or reorder lists such as `categories`. Here objects merge key by key
 * and arrays replace, so an operator can override one nested key (say
 * `hero.title`) while keeping the other defaults, or hand over a whole list.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function merge(defaults, overrides) {
  if (!isPlainObject(defaults) || !isPlainObject(overrides)) return overrides;
  const out = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] =
      isPlainObject(value) && isPlainObject(defaults[key]) ? merge(defaults[key], value) : value;
  }
  return out;
}

hexo.on('generateBefore', () => {
  const defaults =
    yaml.load(fs.readFileSync(path.join(hexo.theme_dir, '_config.yml'), 'utf8')) || {};
  hexo.theme.config = merge(defaults, hexo.config.theme_config || {});
});

/**
 * Upstream cheat sheets cross-link each other with absolute URLs to the
 * upstream domains. Rewrite those to this site's root so links stay on the
 * self-hosted instance.
 */
const UPSTREAM_HOSTS = [
  'https://cheatsheets.zip',
  'https://quickref.me',
  'https://www.quickref.me'
];

hexo.extend.filter.register('after_post_render', (data) => {
  const root = (hexo.config.root || '/').replace(/\/$/, '');
  for (const host of UPSTREAM_HOSTS) {
    data.content = data.content.split(`${host}/`).join(`${root}/`);
  }

  // Widgets embedded from source/widget load two libraries from public CDNs.
  // cronstrue is vendored (tools/vendor.mjs); the Tailwind Play CDN is
  // redundant inside a page because the site stylesheet already covers the
  // widget's classes.
  data.content = data.content
    .replace(
      /<script[^>]+src=["']https:\/\/unpkg\.com\/cronstrue@[^"']*["'][^>]*><\/script>/g,
      `<script src="${root}/vendor/cronstrue.min.js"></script>`
    )
    .replace(
      /<script[^>]+src=["']https:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*><\/script>\s*/g,
      ''
    );
  return data;
});

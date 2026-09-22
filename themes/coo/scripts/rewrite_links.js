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
  return data;
});

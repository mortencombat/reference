/**
 * Links to the upstream project (Fechin/reference) that this site is built on.
 * All values come from `theme.upstream` so a self-hosted instance can point
 * them elsewhere or hide them.
 */
function upstream(theme) {
  return Object.assign(
    {
      name: 'Reference',
      author: 'Fechin',
      repo: 'https://github.com/Fechin/reference',
      donate: 'https://github.com/sponsors/Fechin'
    },
    theme.upstream || {}
  );
}

hexo.extend.helper.register('upstream', function () {
  return upstream(this.theme);
});

hexo.extend.helper.register('request_cheatsheet', function () {
  const { repo } = upstream(this.theme);
  return `${repo}/issues/new?title=Cheatsheet+request%3A+&labels=request&template=cheatsheet-request.md`;
});

hexo.extend.helper.register('contributing', function () {
  return upstream(this.theme).repo;
});

hexo.extend.helper.register('edit_page', function () {
  const { repo } = upstream(this.theme);
  if (this.page.layout === 'post') {
    return `${repo}/blob/main/source/_posts/${this.page.slug}.md`;
  }
  return repo;
});

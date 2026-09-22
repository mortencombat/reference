/**
 * Decide which posts exist on this site.
 *
 * `theme.categories` is the single source of truth: a post is kept only if
 * at least one of its categories is listed there, or if it is listed in
 * `theme.featured_posts`. Individual posts can be dropped by slug through
 * `theme.exclude_posts`. Removed posts get no page, no search entry and no
 * sitemap entry.
 */
hexo.extend.filter.register('before_generate', function () {
  const Post = hexo.model('Post');
  const allowed = new Set(hexo.theme.config.categories || []);
  const featured = new Set(hexo.theme.config.featured_posts || []);
  const excluded = new Set(hexo.theme.config.exclude_posts || []);
  const remove = [];

  Post.forEach((post) => {
    if (post.layout === 'note') return;
    const categories = post.categories.map((category) => category.name);
    if (excluded.has(post.slug)) {
      remove.push({ post, reason: 'excluded' });
    } else if (!featured.has(post.slug) && !categories.some((name) => allowed.has(name))) {
      remove.push({
        post,
        reason: `not in categories (${categories.join(', ') || 'no category'})`
      });
    }
  });

  if (remove.length > 0) {
    hexo.log.info(`Skipping ${remove.length} post(s) by configuration`);
    remove.forEach(({ post, reason }) => hexo.log.debug(`  ${post.slug}: ${reason}`));
  }
  return Promise.all(remove.map(({ post }) => Post.removeById(post._id)));
});

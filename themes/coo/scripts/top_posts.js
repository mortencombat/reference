/**
 * "Top" posts for the sidebar and footer, taken from `theme.top_posts`
 * (a list of post slugs) instead of upstream's Google Analytics export.
 */
hexo.extend.helper.register('topPosts', function (maximum = 4) {
  const slugs = Array.isArray(this.theme.top_posts) ? this.theme.top_posts : [];
  const posts = [];
  for (const slug of slugs) {
    const post = this.site.posts.findOne({ slug });
    if (!post) {
      hexo.log.warn(`top_posts: no post with slug "${slug}"`);
      continue;
    }
    posts.push({
      title: post.title,
      path: post.path,
      slug: post.slug,
      icon: `icon-${post.slug}`,
      background: post.background || 'bg-gradient-to-r from-indigo-500 to-purple-600'
    });
    if (posts.length >= maximum) break;
  }
  return posts;
});

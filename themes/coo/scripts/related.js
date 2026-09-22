/**
 * Related posts by tag and category overlap.
 *
 * Replaces hexo-related-popular-posts, which depended on Google Analytics
 * client libraries and does not run on Node 24 or newer.
 */
function namesOf(list) {
  if (!list || typeof list.toArray !== 'function') return [];
  return list.toArray().map((item) => item.name);
}

hexo.extend.helper.register('related_posts', function (page, maxCount = 4) {
  if (!page || page.layout === 'note') return [];
  const tags = new Set(namesOf(page.tags));
  const categories = new Set(namesOf(page.categories));
  if (tags.size === 0 && categories.size === 0) return [];

  const scored = [];
  this.site.posts.each((post) => {
    if (post.layout === 'note' || post.path === page.path) return;
    let score = 0;
    namesOf(post.tags).forEach((tag) => {
      if (tags.has(tag)) score += 2;
    });
    namesOf(post.categories).forEach((category) => {
      if (categories.has(category)) score += 1;
    });
    if (score > 0) scored.push({ score, post });
  });

  scored.sort((a, b) => b.score - a.score || a.post.title.localeCompare(b.post.title));
  return scored.slice(0, maxCount).map(({ post }) => ({
    title: post.title,
    path: post.path,
    slug: post.slug,
    background: post.background
  }));
});

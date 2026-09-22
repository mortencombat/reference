/**
 * Decide which posts exist on this site.
 *
 * `theme.categories` is the single source of truth. Each entry is either a
 * category name (the whole category) or an object restricting it:
 *
 *   - Programming
 *   - name: Game
 *     only: [apex-legends, minecraft]
 *   - name: Toolkit
 *     except: [tableconvert]
 *
 * A post is built if at least one of its categories admits it, or if it is
 * listed in `theme.featured_posts`. `theme.exclude_posts` removes a post from
 * every category. The home page shows a post under each category that
 * admits it. Removed posts get no page, no search entry and no sitemap entry.
 */
function normalize(entries) {
  return (entries || []).map((entry) => {
    if (typeof entry === 'string') return { name: entry, only: null, except: new Set() };
    return {
      name: entry.name,
      only: Array.isArray(entry.only) ? new Set(entry.only) : null,
      except: new Set(Array.isArray(entry.except) ? entry.except : [])
    };
  });
}

const admits = (rule, slug) => (rule.only ? rule.only.has(slug) : !rule.except.has(slug));

hexo.extend.helper.register('category_rules', function () {
  return normalize(this.theme.categories);
});

hexo.extend.helper.register('category_admits', (rule, slug) => admits(rule, slug));

hexo.extend.filter.register('before_generate', function () {
  const Post = hexo.model('Post');
  const rules = new Map(normalize(hexo.theme.config.categories).map((rule) => [rule.name, rule]));
  const featured = new Set(hexo.theme.config.featured_posts || []);
  const excluded = new Set(hexo.theme.config.exclude_posts || []);
  const remove = [];
  const members = new Map(); // category name -> slugs of its posts

  Post.forEach((post) => {
    if (post.layout === 'note') return;
    const categories = post.categories.map((category) => category.name);
    for (const name of categories) {
      if (!members.has(name)) members.set(name, new Set());
      members.get(name).add(post.slug);
    }
    const admitted = categories.filter(
      (name) => rules.has(name) && admits(rules.get(name), post.slug)
    );
    if (excluded.has(post.slug)) {
      remove.push({ post, reason: 'excluded' });
    } else if (!featured.has(post.slug) && admitted.length === 0) {
      remove.push({
        post,
        reason: `not admitted by any category (${categories.join(', ') || 'no category'})`
      });
    }
  });

  for (const rule of rules.values()) {
    for (const [key, slugs] of [
      ['only', rule.only],
      ['except', rule.except]
    ]) {
      for (const slug of slugs || []) {
        if (!members.get(rule.name)?.has(slug)) {
          hexo.log.warn(
            `categories: "${slug}" in ${rule.name}.${key} is not a post in that category`
          );
        }
      }
    }
  }

  if (remove.length > 0) {
    hexo.log.info(`Skipping ${remove.length} post(s) by configuration`);
    remove.forEach(({ post, reason }) => hexo.log.debug(`  ${post.slug}: ${reason}`));
  }
  return Promise.all(remove.map(({ post }) => Post.removeById(post._id)));
});

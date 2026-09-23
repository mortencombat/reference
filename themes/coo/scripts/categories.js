/**
 * Decide which posts exist on this site and how categories are composed.
 *
 * `theme.categories` is the single source of truth. Each entry is either a
 * category name (the whole category as the posts declare it) or an object:
 *
 *   - name: Keyboard Shortcuts
 *     include: [windows-shortcuts]   # additive: posts from elsewhere too
 *     except: [apex-legends]         # subtractive
 *     sort: -date                    # date (default), -date, title, -title
 *   - name: Team                     # a category of your own
 *     only: [bash, git, docker]      # exact membership, any posts
 *     sort: listed                   # in the order written (only with `only`)
 *
 * `only` cannot be combined with `include` or `except`. A post is built if
 * some category admits it or it is listed in `theme.featured_posts`;
 * `theme.exclude_posts` removes a post from every category. The configured
 * membership is applied to the posts themselves, so search, metadata and
 * the home page agree.
 */
const SORTS = new Set(['date', '-date', 'title', '-title', 'listed']);

function normalize(entries) {
  return (entries || []).map((entry) => {
    const rule =
      typeof entry === 'string'
        ? { name: entry, include: [], only: null, except: [], sort: null }
        : {
            name: entry.name,
            include: Array.isArray(entry.include) ? entry.include : [],
            only: Array.isArray(entry.only) ? entry.only : null,
            except: Array.isArray(entry.except) ? entry.except : [],
            sort: entry.sort || null
          };
    if (rule.only && rule.include.length > 0) {
      throw new Error(
        `categories: "${rule.name}" uses both only and include; only is the exact list`
      );
    }
    if (rule.only && rule.except.length > 0) {
      throw new Error(
        `categories: "${rule.name}" uses both only and except; only is the exact list`
      );
    }
    if (rule.sort && !SORTS.has(rule.sort)) {
      throw new Error(
        `categories: "${rule.name}" has sort "${rule.sort}"; use date, -date, title, -title or listed`
      );
    }
    if (rule.sort === 'listed' && !rule.only) {
      throw new Error(
        `categories: "${rule.name}" uses sort: listed, which needs an only list to take the order from`
      );
    }
    return rule;
  });
}

function sortPosts(posts, sort, order) {
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const byDate = (a, b) => a.date.valueOf() - b.date.valueOf() || byTitle(a, b);
  switch (sort) {
    case '-date':
      return posts.sort((a, b) => byDate(b, a));
    case 'title':
      return posts.sort(byTitle);
    case '-title':
      return posts.sort((a, b) => byTitle(b, a));
    case 'listed':
      return posts.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
    default:
      return posts.sort(byDate);
  }
}

hexo.extend.helper.register('category_rules', function () {
  return normalize(this.theme.categories);
});

/** The posts of a category, in the configured order. */
hexo.extend.helper.register('category_posts', function (rule) {
  const category = this.site.categories.findOne({ name: rule.name });
  if (!category) return [];
  const sort = rule.sort || this.theme.sort_posts || 'date';
  return sortPosts(category.posts.toArray(), sort, rule.only || []);
});

hexo.extend.filter.register('before_generate', function () {
  const Post = hexo.model('Post');
  const config = hexo.theme.config;
  if (config.sort_posts && (!SORTS.has(config.sort_posts) || config.sort_posts === 'listed')) {
    throw new Error(`sort_posts: "${config.sort_posts}"; use date, -date, title or -title`);
  }
  const rules = normalize(config.categories);
  const featured = new Set(config.featured_posts || []);
  const excluded = new Set(config.exclude_posts || []);
  const warn = (msg) => hexo.log.warn(`categories: ${msg}`);

  const bySlug = new Map();
  const declared = new Map(); // category name -> Set of slugs
  Post.forEach((post) => {
    if (post.layout === 'note') return;
    bySlug.set(post.slug, post);
    for (const { name } of post.categories.toArray()) {
      if (!declared.has(name)) declared.set(name, new Set());
      declared.get(name).add(post.slug);
    }
  });

  // Membership per rule, from declared categories and the rule's lists.
  const membership = new Map(); // slug -> [category names, in config order]
  const admit = (slug, name) => {
    if (!membership.has(slug)) membership.set(slug, []);
    membership.get(slug).push(name);
  };
  for (const rule of rules) {
    const own = declared.get(rule.name) || new Set();
    let members;
    if (rule.only) {
      members = rule.only.filter((slug) => {
        if (!bySlug.has(slug)) warn(`"${slug}" in ${rule.name}.only is not a post`);
        return bySlug.has(slug);
      });
    } else {
      members = [...own];
      for (const slug of rule.include) {
        if (!bySlug.has(slug)) warn(`"${slug}" in ${rule.name}.include is not a post`);
        else if (own.has(slug))
          warn(`"${slug}" in ${rule.name}.include is already in that category`);
        else members.push(slug);
      }
      const except = new Set(rule.except);
      for (const slug of except) {
        if (!members.includes(slug))
          warn(`"${slug}" in ${rule.name}.except is not a post in that category`);
      }
      members = members.filter((slug) => !except.has(slug));
    }
    for (const slug of members) {
      if (excluded.has(slug)) {
        if (rule.only || rule.include.includes(slug))
          warn(`"${slug}" is listed for ${rule.name} but also in exclude_posts`);
        continue;
      }
      admit(slug, rule.name);
    }
    if (members.length === 0 && !own.size)
      warn(`"${rule.name}" has no posts; give it include or only, or add posts that declare it`);
  }

  const remove = [];
  const updates = [];
  for (const [slug, post] of bySlug) {
    if (excluded.has(slug)) {
      remove.push({ post, reason: 'excluded' });
    } else if (membership.has(slug)) {
      const wanted = membership.get(slug);
      const current = post.categories.toArray().map((c) => c.name);
      if (wanted.length !== current.length || wanted.some((name, i) => name !== current[i])) {
        updates.push(post.setCategories(wanted));
      }
    } else if (!featured.has(slug)) {
      const current = post.categories.toArray().map((c) => c.name);
      remove.push({
        post,
        reason: `not admitted by any category (${current.join(', ') || 'no category'})`
      });
    }
  }

  if (remove.length > 0) {
    hexo.log.info(`Skipping ${remove.length} post(s) by configuration`);
    remove.forEach(({ post, reason }) => hexo.log.debug(`  ${post.slug}: ${reason}`));
  }
  return Promise.all([...updates, ...remove.map(({ post }) => Post.removeById(post._id))]);
});

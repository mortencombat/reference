/**
 * Generate robots.txt and the PWA manifest from the site config instead of
 * shipping static copies that hard-code the upstream domain.
 */
hexo.extend.generator.register('robots', () => {
  const url = hexo.config.url.replace(/\/$/, '');
  const root = hexo.config.root || '/';
  const lines = ['User-agent: *', `Allow: ${root}`, '', `Sitemap: ${url}${root}sitemap.xml`, ''];
  return { path: 'robots.txt', data: lines.join('\n') };
});

hexo.extend.generator.register('manifest', () => {
  const { title, subtitle, description, language } = hexo.config;
  const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
  const manifest = {
    name: subtitle ? `${title} - ${subtitle}` : title,
    short_name: title,
    description,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#6366f1',
    scope: '/',
    lang: language || 'en',
    icons: sizes.map((size) => ({
      src: `/assets/logo/icon-${size}x${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'maskable any'
    }))
  };
  return { path: 'manifest.json', data: JSON.stringify(manifest, null, 2) };
});

/**
 * Citation links: `[[Tooltip text]](url)` renders as a small external-link
 * icon whose tooltip is the bracketed text. The tokens `s`, `src` and
 * `source` (any case) map to the tooltip "Source", which is the convention
 * the upstream ChatGPT sheet uses as `[[s]](url)`.
 *
 * Guards, so that ordinary content is never converted: the link must be
 * external, the text must be a single short token without line breaks, and
 * the link must not carry data-* attributes of its own (the jQuery sheet
 * lists attribute selectors such as [[name]](url){data-tooltip=...}).
 */
const SOURCE_TOKENS = new Set(['s', 'src', 'source']);
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

hexo.extend.filter.register('after_post_render', (data) => {
  data.content = data.content.replace(
    /<a\s+([^>]*?href="https?:\/\/[^"]+"[^>]*)>\[([^[\]\n]{1,40})\]<\/a>/g,
    (match, attrs, text) => {
      if (/\sdata-[\w-]+=/.test(attrs)) return match;
      const label = text.trim();
      // The text is already HTML-escaped by the Markdown renderer.
      const tooltip = SOURCE_TOKENS.has(label.toLowerCase()) ? 'Source' : label;
      return `<a ${attrs} class="citation" title="${tooltip}" aria-label="${tooltip}" target="_blank" rel="noopener noreferrer nofollow">${ICON}</a>`;
    }
  );
  return data;
});

/**
 * Sheets cite sources as `[[source]](url)` (the upstream ChatGPT sheet uses
 * the abbreviation `[[s]](url)`), which renders as a link whose text is
 * "[source]". Show those as a small external-link icon with a "Source"
 * tooltip instead. Accepted link texts: source, src, s.
 */
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

hexo.extend.filter.register('after_post_render', (data) => {
  data.content = data.content.replace(
    /<a\s+([^>]*?href="[^"]+"[^>]*)>\[(?:source|src|s)\]<\/a>/gi,
    (match, attrs) =>
      `<a ${attrs} class="citation" title="Source" aria-label="Source" target="_blank" rel="noopener noreferrer nofollow">${ICON}</a>`
  );
  return data;
});

import sanitizeHtml from 'sanitize-html'

/**
 * Sanitize Tiptap-authored HTML before it is stored and later rendered via
 * `dangerouslySetInnerHTML`. The allowlist matches what the rich-text editor can
 * produce; everything else (scripts, event handlers, unknown schemes) is dropped.
 *
 * - Allowed tags: headings, basic text formatting, lists, quotes, code, images,
 *   links, line breaks and a generic `span` (Tiptap marks/colors).
 * - Links are forced to open in a new tab with a hardened `rel`.
 * - URL schemes are restricted to http/https/mailto; `img src` additionally
 *   accepts same-origin relative paths (e.g. `/api/news/<id>/cover`).
 */
export function sanitizeNewsHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      'h1', 'h2', 'h3', 'p', 'br', 'hr', 'strong', 'em', 'u', 's', 'a',
      'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'img', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
    },
    // http/https/mailto for hrefs; relative URLs (e.g. `/api/...`) are handled
    // by `allowProtocolRelative` + the per-tag src below.
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
    },
    // Allow root-relative URLs (same-origin `/api/news/<id>/cover`).
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      }),
    },
  })
}

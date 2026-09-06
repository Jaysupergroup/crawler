// This function is serialized by Playwright. Keep it browser-only and self-contained.
export function collectDomImages() {
  return Array.from(document.querySelectorAll('img'), image => {
    const box = image.getBoundingClientRect();
    return {
      attributes: Object.fromEntries(['src', 'srcset', 'data-src', 'data-lazy-src', 'data-srcset', 'alt', 'width', 'height', 'loading'].map(name => [name, image.getAttribute(name)])),
      baseUrl: document.baseURI, currentSrc: image.currentSrc,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      renderedWidth: box.width, renderedHeight: box.height
    };
  });
}

export function normalizeImages(records, pageUrl) {
  const positive = value => Number.isFinite(value) && value > 0 ? value : null;
  const dimension = value => typeof value === 'string' && /^\d+$/.test(value.trim()) && Number(value) > 0 ? Number(value) : null;
  const httpUrl = (value, base) => {
    if (!value?.trim()) return '';
    try { const url = new URL(value, base); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
  };
  return records.map((record, index) => {
    const a = record.attributes;
    const base = httpUrl(record.baseUrl, pageUrl) || pageUrl;
    // Retain declarations, but never guess the selected srcset/picture candidate.
    const url = [record.currentSrc, a.src, a['data-src'], a['data-lazy-src']].map(value => httpUrl(value, base)).find(Boolean) || '';
    const selected = Boolean(record.currentSrc) && (!url || httpUrl(record.currentSrc, base) === url);
    const declaration = value => typeof value === 'string' && /data:/i.test(value) ? '[Inline data URL omitted]' : value || '';
    return {
      elementIndex: index + 1, url, rawSrc: declaration(a.src), currentSrc: declaration(record.currentSrc),
      srcset: declaration(a.srcset || a['data-srcset']), lazySrc: declaration(a['data-src'] || a['data-lazy-src']),
      alt: a.alt ?? null, widthAttribute: a.width ?? null, heightAttribute: a.height ?? null,
      declaredWidth: dimension(a.width), declaredHeight: dimension(a.height),
      naturalWidth: selected ? positive(record.naturalWidth) : null,
      naturalHeight: selected ? positive(record.naturalHeight) : null,
      renderedWidth: Number.isFinite(record.renderedWidth) ? record.renderedWidth : null,
      renderedHeight: Number.isFinite(record.renderedHeight) ? record.renderedHeight : null,
      loading: a.loading || '', statusCode: null, sizeBytes: null, discoveryStatus: 'Not observed'
    };
  });
}

// Only attach evidence for the actual URL; never infer broken/zero-size from
// an image blocked by the crawler or a lazy image that was not requested.
export function enrichImages(images = [], resources = []) {
  const byUrl = new Map(resources.filter(r => r.resourceType === 'Image').map(r => [r.url, r]));
  return images.map(image => {
    const resource = byUrl.get(image.url);
    return { ...image, statusCode: resource?.statusCode ?? null,
      sizeBytes: resource?.statusCode >= 200 && resource?.statusCode < 300 && Number.isFinite(resource?.sizeBytes) && resource.sizeBytes >= 0 ? resource.sizeBytes : null,
      discoveryStatus: resource?.discoveryStatus || 'Not observed' };
  });
}

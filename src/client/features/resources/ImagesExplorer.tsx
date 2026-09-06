import { useMemo, useState } from 'react';
import type { CrawlPage, CrawledImage } from '../../types/crawl';
import './images.css';

type ImageRow = CrawledImage & { sourceUrl: string };
type Filter = 'all' | 'missing' | 'empty' | 'whitespace' | 'text' | 'dimensions' | 'large' | 'unknown' | 'errors';
type Sort = 'index' | 'url' | 'alt' | 'dimensions' | 'size' | 'status' | 'source';
const filters: [Filter, string][] = [['all', 'All images'], ['missing', 'Missing alt'], ['empty', 'Empty alt'], ['whitespace', 'Whitespace alt'], ['text', 'With alt text'], ['dimensions', 'No declared dimensions'], ['large', 'Over 200 KB'], ['unknown', 'Size unknown'], ['errors', 'HTTP errors']];
const altState = (image: CrawledImage) => image.alt === null ? 'Missing attribute' : image.alt === '' ? 'Empty (review purpose)' : !image.alt.trim() ? 'Whitespace only' : image.alt;
const size = (bytes: number | null) => bytes === null ? 'Unknown' : bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
const dimensions = (width: number | null, height: number | null) => `${width ?? '?'} × ${height ?? '?'}`;
function matches(image: CrawledImage, filter: Filter) {
  if (filter === 'missing') return image.alt === null;
  if (filter === 'empty') return image.alt === '';
  if (filter === 'whitespace') return image.alt !== null && image.alt !== '' && !image.alt.trim();
  if (filter === 'text') return Boolean(image.alt?.trim());
  if (filter === 'dimensions') return !image.declaredWidth || !image.declaredHeight;
  if (filter === 'large') return image.sizeBytes !== null && image.sizeBytes > 200 * 1024;
  if (filter === 'unknown') return image.sizeBytes === null;
  if (filter === 'errors') return (image.statusCode || 0) >= 400;
  return true;
}
function ImageUrl({ value }: { value: string }) {
  return /^https?:\/\//i.test(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <span>{value || 'No selected HTTP URL'}</span>;
}
export function ImagesExplorer({ pages, search }: { pages: CrawlPage[]; search: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<{ key: Sort; desc: boolean }>({ key: 'index', desc: false });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ImageRow | null>(null);
  const images = useMemo(() => pages.flatMap(page => (page.images || []).map(image => ({ ...image, sourceUrl: page.url }))), [pages]);
  const missingHistory = pages.filter(page => !Array.isArray(page.images)).length;
  const rows = useMemo(() => {
    const query = search.toLowerCase().trim();
    const value = (image: ImageRow, index: number): string | number => {
      if (sort.key === 'index') return index;
      if (sort.key === 'url') return image.url;
      if (sort.key === 'alt') return altState(image);
      if (sort.key === 'dimensions') return image.declaredWidth ?? -1;
      if (sort.key === 'size') return image.sizeBytes ?? -1;
      if (sort.key === 'status') return image.statusCode ?? -1;
      return image.sourceUrl;
    };
    return images.map((image, index) => ({ image, index })).filter(({ image }) => matches(image, filter) && (!query || `${image.url} ${image.rawSrc} ${image.srcset} ${altState(image)} ${image.sourceUrl} ${image.discoveryStatus} ${image.statusCode ?? ''}`.toLowerCase().includes(query))).sort((a, b) => {
      const left = value(a.image, a.index), right = value(b.image, b.index);
      const compared = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right) : Number(left) - Number(right);
      return sort.desc ? -compared : compared;
    });
  }, [images, search, filter, sort]);
  const totalPages = Math.max(1, Math.ceil(rows.length / 50));
  const current = Math.min(page, totalPages);
  function header(label: string, key: Sort) {
    return <th scope="col" aria-sort={sort.key === key ? sort.desc ? 'descending' : 'ascending' : 'none'}><button className="sort-button" onClick={() => { setSort(old => ({ key, desc: old.key === key && !old.desc })); setPage(1); }}>{label} {sort.key === key ? sort.desc ? '▼' : '▲' : '↕'}</button></th>;
  }
  return <section className="image-audit" aria-label="Image SEO audit">
    <p>One row per image occurrence. Empty alt may be intentional for decorative images; review its purpose. Sizes and natural dimensions remain unknown when images are blocked or not loaded. No extra image downloads are made. CSS backgrounds and standalone SVG elements remain outside this alt audit.</p>
    {missingHistory > 0 && <p className="history-message">{missingHistory} page(s) have no image-audit details saved. Recrawl to collect them; an old image count is not an alt audit.</p>}
    <div className="sub-tabs" aria-label="Image SEO filters">{filters.map(([key, label]) => <button key={key} className={filter === key ? 'pill active' : 'pill'} onClick={() => { setFilter(key); setPage(1); }}>{label} ({images.filter(image => matches(image, key)).length})</button>)}</div>
    <div className="table-wrap images-table-wrap"><table className="images-table" aria-label="Image SEO results">
      <colgroup>{['index', 'url', 'alt', 'dimensions', 'size', 'status', 'source', 'action'].map(name => <col key={name} className={`image-column-${name}`} />)}</colgroup>
      <thead><tr>{header('#', 'index')}{header('Image URL', 'url')}{header('Alt text', 'alt')}{header('Dimensions (px)', 'dimensions')}{header('Size', 'size')}{header('Status', 'status')}{header('Source page', 'source')}<th scope="col">Action</th></tr></thead>
      <tbody>{rows.slice((current - 1) * 50, current * 50).map(({ image, index }) => <tr key={`${image.sourceUrl}|${image.elementIndex}|${index}`}>
        <td data-label="#">{index + 1}</td>
        <td data-label="Image URL"><ImageUrl value={image.url} /></td>
        <td data-label="Alt text"><span className={image.alt === null ? 'tag neutral' : ''}>{altState(image)}</span></td>
        <td data-label="Dimensions"><div>Declared: {dimensions(image.declaredWidth, image.declaredHeight)}<br />Natural: {dimensions(image.naturalWidth, image.naturalHeight)}<br />Rendered: {dimensions(image.renderedWidth, image.renderedHeight)}</div></td>
        <td data-label="Size">{size(image.sizeBytes)}</td>
        <td data-label="Status">{image.statusCode ?? image.discoveryStatus}</td>
        <td data-label="Source page">{image.sourceUrl}</td>
        <td data-label="Action"><button className="inspect" onClick={() => setSelected(image)}>Inspect</button></td>
      </tr>)}{!rows.length && <tr><td colSpan={8} className="empty">No image occurrences match this audit or filter.</td></tr>}</tbody>
    </table></div>
    {rows.length > 0 && <div className="pagination"><span>{rows.length} occurrences · 50 rows per page</span><button className="secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current} of {totalPages}</span><button className="secondary" disabled={current === totalPages} onClick={() => setPage(current + 1)}>Next</button></div>}
    {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)}><section className="inspector image-inspector" role="dialog" aria-modal="true" aria-label="Image SEO details" onMouseDown={e => e.stopPropagation()}>
      <header><h2>Image occurrence #{selected.elementIndex}</h2><button className="icon-button" aria-label="Close image inspection" onClick={() => setSelected(null)}>×</button></header>
      <dl>{Object.entries({
        'Image URL': selected.url || 'No selected HTTP URL', 'Source page': selected.sourceUrl, 'Alt text': altState(selected),
        'Raw src': selected.rawSrc, 'Selected currentSrc': selected.currentSrc, 'Lazy source': selected.lazySrc, 'Srcset': selected.srcset,
        'Width attribute': selected.widthAttribute ?? 'Missing', 'Height attribute': selected.heightAttribute ?? 'Missing',
        'Natural dimensions': dimensions(selected.naturalWidth, selected.naturalHeight), 'Rendered dimensions': dimensions(selected.renderedWidth, selected.renderedHeight),
        'Reported response size': size(selected.sizeBytes), 'HTTP status': selected.statusCode ?? 'Unknown', 'Discovery': selected.discoveryStatus, 'Loading attribute': selected.loading || 'Not set'
      }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}</dl>
    </section></div>}
  </section>;
}

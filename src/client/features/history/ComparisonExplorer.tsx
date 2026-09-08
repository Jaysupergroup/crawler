import { useMemo, useState } from 'react';
import type { CrawlComparison, CrawlComparisonChange, CrawlComparisonChangeType } from '../../types/crawl';

type Filter = 'all' | CrawlComparisonChangeType;

function date(value?: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

function value(change: CrawlComparisonChange, side: 'previous' | 'current') {
  const raw = change[side];
  if (raw === null || raw === undefined || raw === '') return '—';
  const text = String(raw).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export function ComparisonExplorer({ comparison, onBack }: { comparison: CrawlComparison; onBack: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const counts: Record<Filter, number> = {
    all: comparison.rows.length,
    changed: comparison.summary.changed,
    new: comparison.summary.new,
    missing: comparison.summary.missing
  };
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return comparison.rows.filter(row => {
      if (filter !== 'all' && row.type !== filter) return false;
      return !query || `${row.url} ${row.type} ${row.changes.map(change => `${change.field} ${change.previous} ${change.current}`).join(' ')}`.toLowerCase().includes(query);
    });
  }, [comparison.rows, filter, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const filters: Array<[Filter, string]> = [['all', 'All changes'], ['changed', 'Changed'], ['new', 'New URLs'], ['missing', 'Missing URLs']];

  function selectFilter(next: Filter) { setFilter(next); setPage(1); }

  return <section className="comparison-explorer">
    <div className="comparison-head">
      <div><p className="eyebrow">Crawl comparison</p><h3>{comparison.previous.seedUrl} <span>→</span> {comparison.current.seedUrl}</h3><small>Previous: {date(comparison.previous.completedAt || comparison.previous.startedAt || comparison.previous.createdAt)} • Current: {date(comparison.current.completedAt || comparison.current.startedAt || comparison.current.createdAt)}</small></div>
      <button className="secondary" type="button" onClick={onBack}>Choose other crawls</button>
    </div>
    <p className="comparison-summary">{comparison.summary.previousPages.toLocaleString()} previous pages • {comparison.summary.currentPages.toLocaleString()} current pages • {comparison.summary.unchanged.toLocaleString()} unchanged</p>
    <div className="comparison-toolbar"><div className="comparison-filters" aria-label="Comparison result filters">{filters.map(([value, label]) => <button key={value} type="button" className={filter === value ? 'pill active' : 'pill'} onClick={() => selectFilter(value)}>{label} ({counts[value].toLocaleString()})</button>)}</div><input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search changed URLs or values…" aria-label="Search comparison results" /></div>
    <div className="table-wrap comparison-table-wrap"><table className="comparison-table"><thead><tr><th>Change</th><th>URL</th><th>What changed</th></tr></thead><tbody>{rows.length ? rows.map(row => <tr key={`${row.type}|${row.url}`}><td><span className={`comparison-type ${row.type}`}>{row.type === 'new' ? 'New' : row.type === 'missing' ? 'Missing' : 'Changed'}</span></td><td className="url" title={row.url}><a href={row.url} target="_blank" rel="noreferrer">{row.url}</a></td><td>{row.type === 'new' ? 'New URL in the current crawl.' : row.type === 'missing' ? 'URL was not found in the current crawl.' : <ul className="comparison-change-list">{row.changes.map(change => <li key={change.field}><strong>{change.field}</strong><span>{value(change, 'previous')} <b>→</b> {value(change, 'current')}</span></li>)}</ul>}</td></tr>) : <tr><td colSpan={3} className="empty">No comparison results match this filter.</td></tr>}</tbody></table></div>
    {filtered.length > 0 && <div className="pagination"><span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length.toLocaleString()}</span><label>Rows <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="50">50</option><option value="100">100</option><option value="250">250</option></select></label><button className="secondary" disabled={currentPage === 1} onClick={() => setPage(current => current - 1)}>Previous</button><span>Page {currentPage} of {totalPages}</span><button className="secondary" disabled={currentPage === totalPages} onClick={() => setPage(current => current + 1)}>Next</button></div>}
  </section>;
}

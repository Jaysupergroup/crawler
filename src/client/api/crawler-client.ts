import type { CrawlConfig, CrawlerStatus, CrawlerSnapshot, CrawlPage, CrawledLink, CrawlHistoryDetail, CrawlHistoryRecord, HtmlComparisonCapture } from '../types/crawl';

// The browser retains only a server-issued opaque ID. The API verifies that ID
// belongs to the currently signed-in account before serving crawl data.
const SESSION_KEY = 'crawlloom-dashboard-session';
// Saved multi-thousand-page audits are much larger than routine live updates.
// Give their one-off restore enough time on a cloud-hosted connection.
const SNAPSHOT_TIMEOUT_MS = 120000;
let dashboardSessionId: string | null = sessionStorage.getItem(SESSION_KEY);
let sessionPromise: Promise<string> | null = null;

function redirectToLogin() {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/admin/login?next=${encodeURIComponent(next)}`);
}

async function ensureDashboardSession(): Promise<string> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const response = await fetch('/api/crawler/session', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        ...(dashboardSessionId ? { 'X-Crawler-Session': dashboardSessionId } : {})
      },
      body: '{}'
    });
    if (response.status === 401) {
      redirectToLogin();
      throw new Error('Your CrawlLoom session has expired. Please sign in again.');
    }
    const body = await response.json().catch(() => ({ error: 'The server returned an invalid response.' }));
    if (!response.ok || typeof body.sessionId !== 'string') throw new Error(body.error || 'Could not establish a secure dashboard session.');
    const sessionId: string = body.sessionId;
    dashboardSessionId = sessionId;
    sessionStorage.setItem(SESSION_KEY, sessionId);
    return sessionId;
  })();
  try {
    return await sessionPromise;
  } finally {
    sessionPromise = null;
  }
}

function apiUrl(path: string, sessionId: string) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('sessionId', sessionId);
  return url.toString();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const sessionId = await ensureDashboardSession();
  const response = await fetch(apiUrl(path, sessionId), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Crawler-Session': sessionId, ...init.headers }
  });
  if (response.status === 401) {
    redirectToLogin();
    throw new Error('Your CrawlLoom session has expired. Please sign in again.');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A truncated JSON body must not be treated as a valid snapshot. That
    // previously allowed missing `results` into React and caused a white page.
    throw new Error('The server returned an incomplete response. Please retry opening this audit.');
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : 'Crawler request failed.';
    throw new Error(message);
  }
  return body as T;
}

export const crawlerClient = {
  ready: () => ensureDashboardSession(),
  snapshot: (signal?: AbortSignal) => request<CrawlerSnapshot>('/api/crawler/snapshot', {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)]) : AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)
  }),
  status: () => request<CrawlerStatus>('/api/crawler/status'),
  results: () => request<{ results: CrawlPage[] }>('/api/crawler/results'),
  links: () => request<{ links: CrawledLink[] }>('/api/crawler/links'),
  pageHtml: (url: string) => request<HtmlComparisonCapture>(`/api/crawler/page-html?url=${encodeURIComponent(url)}`),
  history: () => request<{ crawls: CrawlHistoryRecord[]; storage: { configured?: boolean; connected?: boolean } }>('/api/crawler/history'),
  historyDetail: (crawlId: string) => request<CrawlHistoryDetail>(`/api/crawler/history/${encodeURIComponent(crawlId)}`),
  restoreHistory: (crawlId: string) => request<{ success: boolean; restoredPages: number; crawl: { seedUrl: string; config?: Partial<CrawlConfig> } }>(`/api/crawler/history/${encodeURIComponent(crawlId)}/restore`, { method: 'POST', body: '{}' }),
  start: (config: CrawlConfig) => request<{ success: boolean }>('/api/crawler/start', { method: 'POST', body: JSON.stringify(config) }),
  pause: () => request<{ success: boolean }>('/api/crawler/pause', { method: 'POST', body: '{}' }),
  resume: () => request<{ success: boolean }>('/api/crawler/resume', { method: 'POST', body: '{}' }),
  stop: () => request<{ success: boolean }>('/api/crawler/stop', { method: 'POST', body: '{}' }),
  reset: () => request<{ success: boolean }>('/api/crawler/reset', { method: 'POST', body: '{}' }),
  streamUrl: async () => apiUrl('/api/crawler/stream', await ensureDashboardSession()),
  exportUrl: (path: string) => dashboardSessionId ? apiUrl(path, dashboardSessionId) : '#'
};

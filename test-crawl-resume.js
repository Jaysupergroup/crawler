import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteCrawler } from './src/engine/crawler.js';
import { CrawlStorage } from './src/storage/database.js';

test('SiteCrawler preserves pending queue in getResumeState when stopped', () => {
  const crawler = new SiteCrawler({ seedUrl: 'https://example.com' });
  crawler.isRunning = true;
  crawler.abortController = new AbortController();
  crawler.queue = [
    { url: 'https://example.com/page1', depth: 1, sourceUrl: 'SEED' },
    { url: 'https://example.com/page2', depth: 2, sourceUrl: 'https://example.com/page1' }
  ];
  crawler.stop();
  assert.equal(crawler.isCancelled, true);
  assert.equal(crawler.queue.length, 0, 'Active queue should be cleared to halt workers');

  const resumeState = crawler.getResumeState();
  assert.equal(resumeState.queue.length, 2, 'Resume state must retain the stopped queue');
  assert.equal(resumeState.queue[0].url, 'https://example.com/page1');
  assert.equal(resumeState.queue[1].url, 'https://example.com/page2');
});

test('SiteCrawler initializes with resumed queue and visited set without re-adding seed URL', () => {
  const crawler = new SiteCrawler({
    seedUrl: 'https://example.com',
    isResumed: true,
    resumedVisited: ['https://example.com/'],
    resumedQueue: [
      { url: 'https://example.com/about', depth: 1, sourceUrl: 'https://example.com/' }
    ],
    resumedResults: [
      { id: 1, url: 'https://example.com/', title: 'Home' }
    ],
    resumedStats: { pagesCrawled: 1, internalLinksCount: 5 }
  });

  assert.equal(crawler.isResumed, true);
  assert.equal(crawler.results.length, 1);
  assert.equal(crawler.visited.has('https://example.com/'), true);
  assert.equal(crawler.queue.length, 1);
  assert.equal(crawler.queue[0].url, 'https://example.com/about');
  assert.equal(crawler.stats.pagesCrawled, 1);
});

test('CrawlStorage listCrawls supports isAdmin filter for legacy crawls', async () => {
  const storage = new CrawlStorage();
  let executedSql = '';
  storage.pool = {
    async execute(sql, values) {
      executedSql = sql;
      return [[]];
    }
  };
  storage.isConfigured = true;
  storage.initPromise = Promise.resolve(true);

  // Admin query should match owner_user_id or NULL
  await storage.listCrawls(25, 'administrator', true);
  assert.match(executedSql, /WHERE \(owner_user_id = \? OR owner_user_id IS NULL\)/);

  // Auditor query should only match their specific owner_user_id
  await storage.listCrawls(25, 'auditor-123', false);
  assert.match(executedSql, /WHERE owner_user_id = \?/);
  assert.doesNotMatch(executedSql, /IS NULL/);
});

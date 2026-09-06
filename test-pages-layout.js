import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { BrowserManager } from './src/engine/browser.js';
import { Extractor } from './src/engine/extractor.js';
import { normalizeImages } from './src/engine/images.js';

// Uses the compiled dashboard and synthetic API responses: no real crawl or DB.
test('Pages, Links and Image SEO retain fields without horizontal scrolling', { timeout: 60000 }, async (t) => {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', PUBLIC_APP_URL: origin,
      ADMIN_PASSWORD: 'layout-test-only', ADMIN_SESSION_SECRET: 'layout-test-only-secret',
      DB_HOST: '', DB_NAME: '', DB_USER: '', DB_PASSWORD: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  });
  const deadline = Date.now() + 10000;
  while (!output.includes('CrawlLoom is running!')) {
    assert.equal(server.exitCode, null, output);
    assert.ok(Date.now() < deadline, output);
    await delay(25);
  }
  const manager = new BrowserManager();
  t.after(() => manager.close());
  const browser = await manager.init();
  await t.test('browser extraction retains selected image, dimensions and dynamic alt text', async () => {
    const fixture = await browser.newPage();
    try {
      await fixture.route('https://images.example/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"></svg>' }));
      await fixture.setContent('<base href="https://images.example/"><img src="one.svg" width="60" height="30"><img src="one.svg" alt=""><picture><source srcset="two.svg 1x"><img alt="Responsive"></picture>');
      await fixture.waitForFunction(() => [...document.images].every(img => img.naturalWidth > 0));
      await fixture.evaluate(() => { document.images[0].setAttribute('alt', 'Added by JavaScript'); });
      const extracted = await Extractor.extractPageData(fixture, 'https://images.example/', 'https://images.example');
      assert.equal(extracted.images.length, 3);
      assert.equal(extracted.images[0].alt, 'Added by JavaScript');
      assert.equal(extracted.images[1].alt, '');
      assert.equal(extracted.images[0].naturalWidth, 120);
      assert.equal(extracted.images[0].renderedWidth, 60);
      assert.equal(extracted.images[2].url, 'https://images.example/two.svg');
    } finally { await fixture.close(); }
  });
  const page = await browser.newPage();
  const longText = 'A complete page value with enough text to wrap across multiple lines. '.repeat(8);
  const results = ['a', 'b'].map((letter, index) => ({
    url: `https://example.com/${letter}/${'long-path-segment-'.repeat(18)}`,
    statusCode: 200, title: `${letter.toUpperCase()} ${longText}`,
    metaDescription: longText, metaKeywords: 'keyword,'.repeat(60),
    h1List: [longText], h2List: [longText, 'Another heading'],
    totalWords: 1200, responseTimeMs: 123456 + index, links: [],
    customContent: { detected: true, wordCount: 1200, fullText: longText, headings: [longText] }
  }));
  const links = [200, 301, 404].map((code, index) => ({
    targetUrl: `https://example.com/destination/${index}/${'long-destination-'.repeat(18)}`,
    anchorText: `${index} ${longText}`, sourceUrl: results[0].url,
    statusCode: code, linkType: code === 404 ? 'External' : 'Internal',
    isInsideCustom: true, isNofollow: true,
    ...(code === 301 ? { redirectCount: 1, finalStatusCode: 200,
      finalUrl: `https://example.com/final/${'long-final-destination-'.repeat(15)}` } : {})
  }));
  results[0].images = normalizeImages([null, '', ' ', 'Helpful alt text', '<script>unsafe</script>'].map((alt, index) => ({
    attributes: { alt, src: `https://images.example/${index}/${'long-image-path-'.repeat(12)}.png`, width: index ? null : '800', height: index ? null : '400' }
  })), results[0].url);
  results[0].images[3].sizeBytes = 250000;
  results[0].images[3].statusCode = 200;
  results[0].images[4].statusCode = 404;
  await page.route('**/api/crawler/snapshot?*', route => route.fulfill({ json: {
    revision: 0, isRunning: false, results, links,
    stats: { pagesCrawled: 2, endTime: 1 }, engine: { mode: 'browser' }
  } }));
  await page.route('**/api/crawler/stream?*', route => route.abort());
  const login = await page.request.post(`${origin}/api/admin/login`, {
    headers: { Origin: origin }, data: { password: 'layout-test-only' }
  });
  assert.equal(login.status(), 200);
  await page.goto(`${origin}/app`);
  await page.locator('.pages-table tbody tr').first().waitFor();

  for (const width of [1920, 1440, 1024, 860, 768, 390, 320]) {
    await t.test(`all seven data tabs fit at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      const tabs = page.locator('.page-data-tabs button');
      for (let index = 0; index < 7; index++) {
        await tabs.nth(index).click();
        const layout = await page.locator('.pages-table-wrap').evaluate(wrapper => {
          const box = wrapper.getBoundingClientRect();
          const cells = [...wrapper.querySelectorAll('tbody tr:first-child td')];
          return {
            overflow: wrapper.scrollWidth - wrapper.clientWidth,
            fields: cells.length,
            clipped: cells.some(cell => cell.scrollWidth > cell.clientWidth + 1),
            outside: cells.some(cell => {
              const bounds = cell.getBoundingClientRect();
              return bounds.left < box.left - 1 || bounds.right > box.right + 1;
            }),
            inspectVisible: wrapper.querySelector('tbody .inspect').getBoundingClientRect().right <= box.right + 1,
            value: wrapper.querySelector('.page-data-value').textContent
          };
        });
        assert.ok(layout.overflow <= 1, `tab ${index}: horizontal overflow`);
        assert.equal(layout.fields, index === 0 ? 8 : 6);
        assert.equal(layout.clipped, false, `tab ${index}: clipped cell text`);
        assert.equal(layout.outside, false, `tab ${index}: column outside panel`);
        assert.equal(layout.inspectVisible, true);
        assert.ok(layout.value.length > 100, 'Full text is retained');
      }
    });
  }

  await t.test('sorting, filtering and content inspection still work', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.page-data-tabs button').nth(0).click();
    await page.locator('.pages-table .sort-button').filter({ hasText: 'Title' }).click();
    await page.locator('.pages-table .sort-button').filter({ hasText: 'Title' }).click();
    assert.ok((await page.locator('.page-data-value').first().textContent()).startsWith('B'));
    await page.locator('.page-data-toolbar input').fill('/a/');
    assert.equal(await page.locator('.pages-table tbody tr').count(), 1);
    await page.locator('.page-data-toolbar input').fill('');
    await page.locator('.page-data-tabs button').nth(6).click();
    await page.locator('.pages-table .inspect').first().click();
    assert.match(await page.locator('.page-inspector-tabs button.active').textContent(), /Content area/i);
    await page.locator('.page-inspector-header .icon-button').click();
  });
  await page.locator('.page-data-tabs button').nth(0).click();
  if (process.env.LAYOUT_SCREENSHOTS === 'true') {
    await page.locator('.pages-table-wrap').screenshot({ path: '.tmp/pages-desktop.png' });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('.pages-table-wrap').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.tmp/pages-mobile.png' });
  }

  await page.locator('.explorer-tab').filter({ hasText: 'Discovered links & anchors' }).click();
  for (const width of [1920, 1440, 1024, 860, 768, 390, 320]) {
    await t.test(`all eight link filters fit at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      for (let filter = 0; filter < 8; filter++) {
        await page.locator('.sub-tabs button').nth(filter).click();
        assert.equal(await page.locator('.sub-tabs button.active').count(), 1);
        const issues = await page.locator('.links-table-wrap').evaluate(wrapper => {
          const box = wrapper.getBoundingClientRect();
          const cells = [...wrapper.querySelectorAll('tbody td')];
          return {
            overflow: wrapper.scrollWidth - wrapper.clientWidth,
            fields: wrapper.querySelectorAll('tbody tr:first-child td').length,
            clipped: cells.some(cell => cell.scrollWidth > cell.clientWidth + 1),
            outside: cells.some(cell => {
              const bounds = cell.getBoundingClientRect();
              return bounds.left < box.left - 1 || bounds.right > box.right + 1;
            }),
            truncatedRedirect: [...wrapper.querySelectorAll('.redirect-destination')].some(el => el.scrollWidth > el.clientWidth + 1)
          };
        });
        assert.ok(issues.overflow <= 1, `filter ${filter}: horizontal overflow`);
        assert.equal(issues.fields, 9);
        assert.equal(issues.clipped, false, `filter ${filter}: clipped text`);
        assert.equal(issues.outside, false, `filter ${filter}: column outside panel`);
        assert.equal(issues.truncatedRedirect, false);
      }
    });
  }
  await t.test('link sorting, search, empty states and inspection still work', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.sub-tabs button').nth(0).click();
    const anchorSort = page.locator('.links-table .sort-button').filter({ hasText: 'Anchor text' });
    await anchorSort.click();
    await anchorSort.click();
    assert.ok((await page.locator('.links-table td[data-label="Anchor text"]').first().textContent()).startsWith('2'));
    const search = page.getByPlaceholder('Search anchor text, URLs or status codes…');
    await search.fill('/destination/1/');
    assert.equal(await page.locator('.links-table tbody tr').count(), 1);
    assert.ok((await page.locator('.redirect-destination').textContent()).includes(links[1].finalUrl));
    await page.locator('.links-table .inspect').click();
    assert.ok((await page.getByRole('dialog', { name: 'Discovered link details' }).textContent()).includes(links[1].finalUrl));
    await page.getByRole('button', { name: 'Close inspection', exact: true }).click();
    await search.fill('not-a-matching-link');
    assert.match(await page.locator('.links-table .empty').textContent(), /No links match/);
    await search.fill('');
  });
  if (process.env.LAYOUT_SCREENSHOTS === 'true') {
    await page.locator('.links-table-wrap').screenshot({ path: '.tmp/links-desktop.png' });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('.links-table-wrap').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.tmp/links-mobile.png' });
  }
  await page.locator('.explorer-tab').filter({ hasText: 'Resources & assets' }).click();
  await page.locator('.sub-tabs[aria-label="Resource filters"] button').filter({ hasText: 'Images' }).click();
  for (const width of [1440, 860, 390, 320]) {
    await t.test(`image SEO filters retain all fields at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      const filters = page.locator('[aria-label="Image SEO filters"] button');
      for (let index = 0; index < 9; index++) {
        await filters.nth(index).click();
        const state = await page.locator('.images-table-wrap').evaluate(el => ({
          overflow: el.scrollWidth - el.clientWidth,
          cells: el.querySelectorAll('tbody tr:first-child td').length,
          clipped: [...el.querySelectorAll('tbody td')].some(td => td.scrollWidth > td.clientWidth + 1)
        }));
        assert.ok(state.overflow <= 1);
        assert.equal(state.cells, 8);
        assert.equal(state.clipped, false);
      }
    });
  }
  await t.test('image distinctions, search, sorting and inspection', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const filters = page.locator('[aria-label="Image SEO filters"] button');
    await filters.nth(1).click();
    assert.equal(await page.locator('.images-table tbody tr').count(), 1);
    assert.match(await page.locator('.images-table td[data-label="Alt text"]').textContent(), /Missing/);
    await filters.nth(2).click();
    assert.match(await page.locator('.images-table td[data-label="Alt text"]').textContent(), /Empty/);
    await filters.nth(0).click();
    await page.locator('.images-table .sort-button').filter({ hasText: 'Size' }).click();
    await page.locator('.images-table .sort-button').filter({ hasText: 'Size' }).click();
    assert.match(await page.locator('.images-table td[data-label="Size"]').first().textContent(), /244.1 KB/);
    const search = page.getByPlaceholder('Search resource URLs, types, source pages or status…');
    await search.fill('Helpful alt');
    assert.equal(await page.locator('.images-table tbody tr').count(), 1);
    await page.locator('.images-table .inspect').click();
    assert.match(await page.getByRole('dialog', { name: 'Image SEO details' }).textContent(), /Helpful alt/);
    await page.getByRole('button', { name: 'Close image inspection' }).click();
    await search.fill('');
    assert.equal(await page.locator('.image-audit script').count(), 0);
    assert.match(await page.locator('.image-audit .history-message').textContent(), /Recrawl/);
    assert.equal(await page.locator('.image-audit img').count(), 0, 'No remote previews are requested');
  });
  if (process.env.LAYOUT_SCREENSHOTS === 'true') {
    await page.locator('.image-audit').screenshot({ path: '.tmp/images-desktop.png' });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('.images-table-wrap').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.tmp/images-mobile.png' });
  }
});

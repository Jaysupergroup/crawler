import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import * as cheerio from 'cheerio';
import ExcelJS from 'exceljs';
import { Extractor } from './src/engine/extractor.js';
import { normalizeImages, enrichImages } from './src/engine/images.js';
import { getSeoIssues } from './src/shared/seoIssues.js';
import { Exporter } from './src/engine/exporter.js';
import { CrawlStorage } from './src/storage/database.js';

const url = 'https://example.com/articles/page';
const html = `<base href="/assets/"><img src="same.png" width="120" height="60"><img src="same.png" alt=""><img data-src="lazy.png" alt="   " loading="lazy"><img srcset="small.png 1x, large.png 2x" alt="Useful description"><img src="javascript:alert(1)" alt="=1+1" width="50%" height="bad">`;
const extract = () => Extractor.extractFromHtml(html, url, 'https://example.com', { cheerio }).images;

test('direct extraction preserves occurrences, alt distinctions, base URL and lazy declarations', () => {
  const images = extract();
  assert.equal(images.length, 5);
  assert.equal(images[0].url, 'https://example.com/assets/same.png');
  assert.equal(images[1].url, images[0].url);
  assert.deepEqual(images.map(i => i.alt), [null, '', '   ', 'Useful description', '=1+1']);
  assert.equal(images[0].declaredWidth, 120);
  assert.equal(images[0].declaredHeight, 60);
  assert.equal(images[2].url, 'https://example.com/assets/lazy.png');
  assert.equal(images[2].loading, 'lazy');
  assert.equal(images[3].url, '', 'Do not guess a srcset candidate in direct HTML mode');
  assert.equal(images[3].srcset, 'small.png 1x, large.png 2x');
  assert.equal(images[4].url, '', 'Never make script URLs navigable');
  assert.equal(images[4].declaredWidth, null);
  for (const image of images) {
    assert.equal(image.naturalWidth, null);
    assert.equal(image.renderedWidth, null);
    assert.equal(image.sizeBytes, null);
  }
});

test('selected source, actual dimensions and observed response metadata are kept distinct', () => {
  const [image] = normalizeImages([{ attributes: { src: 'fallback.png', alt: '' }, currentSrc: 'https://cdn.example.com/selected.png', naturalWidth: 240, naturalHeight: 120, renderedWidth: 0, renderedHeight: 0 }], url);
  assert.equal(image.url, 'https://cdn.example.com/selected.png');
  assert.equal(image.naturalWidth, 240);
  assert.equal(image.renderedWidth, 0);
  const [unobserved] = enrichImages([image], [{ url: 'https://example.com/fallback.png', resourceType: 'Image', sizeBytes: 100 }]);
  assert.equal(unobserved.sizeBytes, null);
  const [observed] = enrichImages([image], [{ url: image.url, resourceType: 'Image', sizeBytes: 0, statusCode: 200, discoveryStatus: 'Loaded' }]);
  assert.equal(observed.sizeBytes, 0);
  assert.equal(observed.statusCode, 200);
  assert.equal(enrichImages([image], [{ url: image.url, resourceType: 'Image', sizeBytes: 300000, statusCode: 301 }])[0].sizeBytes, null, 'A redirect response body is not the image file');
});

test('inline image payloads are omitted while available natural dimensions remain', () => {
  const [image] = normalizeImages([{ attributes: { src: 'data:image/png;base64,AAAA', alt: '' }, currentSrc: 'data:image/png;base64,AAAA', naturalWidth: 1, naturalHeight: 1 }], url);
  assert.equal(image.url, '');
  assert.equal(image.naturalWidth, 1);
  assert.equal(image.rawSrc, '[Inline data URL omitted]');
  assert.equal(image.currentSrc, '[Inline data URL omitted]');
});

test('image issues flag only absent alt and known oversized responses', () => {
  const images = extract();
  images[1].sizeBytes = 200 * 1024;
  images[2].sizeBytes = 200 * 1024 + 1;
  const findings = getSeoIssues([{ url, statusCode: 200, images }]).filter(i => i.code.startsWith('image-'));
  assert.deepEqual(findings.map(i => i.code), ['image-missing-alt', 'image-large']);
  assert.ok(findings[0].detail.includes('Image #1'));
  assert.equal(getSeoIssues([{ url, statusCode: 200, imagesCount: 10 }]).filter(i => i.code.startsWith('image-')).length, 0);
});

test('image CSV and workbook retain per-occurrence fields and safe text', async () => {
  const results = [{ url, statusCode: 200, images: extract() }];
  const csv = await new ExcelJS.Workbook().csv.read(Readable.from([Exporter.generateImagesCSV(results)]));
  assert.equal(csv.rowCount, 6);
  assert.equal(csv.getRow(2).getCell(4).value, 'Missing attribute');
  assert.equal(csv.getRow(3).getCell(4).value, 'Empty');
  assert.equal(csv.getRow(6).getCell(5).value, "'=1+1");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await Exporter.generateMultiSheetWorkbook(results));
  const sheet = workbook.getWorksheet('Image SEO');
  assert.equal(sheet.rowCount, 6);
  assert.equal(sheet.getRow(2).getCell(6).value, 120);
  assert.equal(sheet.getRow(2).getCell(8).value, null, 'Unknown natural width is not zero');
  assert.equal(sheet.getRow(6).getCell(5).value, '=1+1', 'Excel treats this as literal text, not a formula object');
});

test('image JSON uses additive migration and survives save/history mapping', async () => {
  const storage = new CrawlStorage();
  const statements = [];
  let stored;
  let committed = false;
  const connection = {
    beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => {}, release: () => {},
    execute: async (sql, values) => {
      if (sql.startsWith('INSERT INTO crawl_pages')) {
        const columns = sql.match(/INSERT INTO crawl_pages \(([\s\S]*?)\)\s*VALUES/)[1].split(',').map(c => c.trim());
        assert.equal(columns.length, values.length);
        assert.equal(sql.match(/VALUES \(([^)]*)\)/)[1].split(',').length, values.length);
        stored = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
        return [{ insertId: 1 }];
      }
      return sql.startsWith('SELECT') ? [[{ id: 1 }]] : [{}];
    }
  };
  storage.pool = {
    getConnection: async () => connection,
    query: async sql => { statements.push(sql); return [[]]; },
    execute: async sql => sql.includes('FROM crawl_runs') ? [[{ id: 'saved' }]] : sql.includes('FROM crawl_pages') ? [[stored, { url: 'https://example.com/old', images_json: null }]] : [[]]
  };
  storage.initialize = async () => true;
  await storage.migrate();
  assert.ok(statements.some(sql => sql.startsWith('ALTER TABLE crawl_pages ADD COLUMN images_json')));
  assert.ok(statements.every(sql => !/DROP TABLE|TRUNCATE/i.test(sql)));
  const images = extract();
  await storage.savePage('saved', { id: 1, url, statusCode: 200, images, links: [] });
  assert.equal(committed, true);
  assert.deepEqual(JSON.parse(stored.images_json), images);
  const history = await storage.getCrawl('saved');
  assert.deepEqual(history.results[0].images, images);
  assert.equal(history.results[1].images, null);
});

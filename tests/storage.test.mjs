import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApiHandler } from '../server/api.mjs';

async function serve(directory) {
  const handler = createApiHandler({ directory });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

const book = {
  id: 'test-book', title: '服务端藏书', author: '测试作者', content: '第一章 开始\n正文测试。\n第二章 继续\n下一章正文。',
  chapters: [{ title: '全文', start: 0, content: '正文测试。' }], cover: 'forest', addedAt: 123,
  lastReadAt: 456, location: 12, sample: false,
};

test('books persist as files across server restarts, export TXT, and delete', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'bqread-api-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const first = await serve(directory);
  try {
    const result = await fetch(`${first.url}/api/books`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(book) });
    assert.equal(result.status, 201);
    const saved = await result.json();
    assert.equal(saved.id, book.id);
    assert.equal(saved.location, 0);
    assert.equal(saved.contentLength, book.content.length);
    assert.equal(saved.chapterCount, 1);
    assert.equal('content' in saved, false);
    assert.deepEqual(await readdir(directory), ['test-book.bqr']);
  } finally {
    await first.close();
  }
  const second = await serve(directory);
  try {
    const books = await (await fetch(`${second.url}/api/books`)).json();
    assert.equal(books.length, 1);
    assert.equal(books[0].title, book.title);
    assert.equal('chapters' in books[0], false);
    assert.equal('content' in books[0], false);
    const exported = await fetch(`${second.url}/api/books/test-book/export`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition'), /filename\*=UTF-8''/);
    assert.equal((await exported.text()).trim(), book.content);
    assert.equal((await fetch(`${second.url}/api/books/test-book`, { method: 'DELETE' })).status, 204);
    assert.deepEqual(await readdir(directory), []);
    assert.deepEqual(await (await fetch(`${second.url}/api/books`)).json(), []);
    assert.equal((await fetch(`${second.url}/api/books/test-book/export`)).status, 404);
  } finally {
    await second.close();
  }
});

test('rejects malformed books, invalid paths, and malformed JSON without writing files', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'bqread-invalid-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const server = await serve(directory);
  context.after(server.close);
  for (const invalid of [{}, { ...book, id: '../outside' }, { ...book, chapters: [null] }, { ...book, content: '' }]) {
    const response = await fetch(`${server.url}/api/books`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalid) });
    assert.equal(response.status, 400);
  }
  assert.equal((await fetch(`${server.url}/api/books`, { method: 'POST', body: '{' })).status, 400);
  assert.equal((await fetch(`${server.url}/api/books/%2E%2E%2Foutside/export`)).status, 400);
  assert.equal((await fetch(`${server.url}/api/books/missing`, { method: 'DELETE' })).status, 404);
  assert.deepEqual(await readdir(directory), []);
});

test('converts a large legacy book once and reads bounded windows at saved character offsets', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'bqread-legacy-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const server = await serve(directory);
  context.after(server.close);
  // Put an emoji across the nominal section boundary. The book has no headings.
  const content = '文'.repeat(24 * 1024 - 1) + '🌙长篇'.repeat(1_500_000);
  await writeFile(join(directory, 'test-book.json'), JSON.stringify({
    ...book, content, chapters: [{ title: '全文', start: 0, content }],
  }));
  const base = server.url + '/api/books';
  const shelf = await (await fetch(base)).text();
  assert.ok(Buffer.byteLength(shelf) < 1024);
  const [summary] = JSON.parse(shelf);
  assert.equal(summary.contentLength, content.length);
  assert.deepEqual(await readdir(directory), ['test-book.bqr']);
  const toc = await (await fetch(base + '/test-book/toc')).json();
  assert.equal(toc.length, summary.chapterCount);
  assert.ok(toc.length > 100);
  assert.equal(toc[1].start, 24 * 1024 - 1);
  const center = Math.floor(toc.length * 0.8);
  for (const target of [0, center, toc.length - 1]) {
    const response = await fetch(base + '/test-book/chapters?center=' + target);
    const body = await response.text();
    assert.ok(Buffer.byteLength(body) < 225_000);
    const { start, texts } = JSON.parse(body);
    assert.equal(start, Math.max(0, target - 1));
    assert.equal(texts.length, target === center ? 3 : 2);
    texts.forEach((text, i) => {
      const entry = toc[start + i];
      assert.equal(text, content.slice(entry.start, entry.start + entry.length));
      assert.ok(!text.includes('\uFFFD'));
    });
  }
  for (const center of ['', '-1', '1.1', String(toc.length)]) {
    assert.equal((await fetch(base + '/test-book/chapters?center=' + center)).status, 400);
  }
  assert.equal((await (await fetch(base + '/test-book/export')).text()).trim(), content);
});

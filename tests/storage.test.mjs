import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
    const file = JSON.parse(await readFile(join(directory, 'test-book.json'), 'utf8'));
    assert.equal(file.content, book.content);
    assert.deepEqual(await readdir(directory), ['test-book.json']);
  } finally {
    await first.close();
  }
  const second = await serve(directory);
  try {
    const books = await (await fetch(`${second.url}/api/books`)).json();
    assert.equal(books.length, 1);
    assert.equal(books[0].title, book.title);
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

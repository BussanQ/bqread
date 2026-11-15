import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chapterAt, createBook, normalizeText, parseChapters, titleFromFilename } from '../.test-dist/parser.js';

test('normalizes line endings, BOM, and whitespace', () => {
  assert.equal(normalizeText('\uFEFF第一章\r\n正文\r\n'), '第一章\n正文');
});

test('recognizes Chinese chapters and preserves a preface', () => {
  const source = '写给读者\n第一章 初遇\r\n第一段\n第二章 重逢\n第二段\n尾声\n终';
  const chapters = parseChapters(source);
  assert.deepEqual(chapters.map((chapter) => chapter.title), ['开篇', '第一章 初遇', '第二章 重逢', '尾声']);
  assert.equal(chapters[1].content, '第一段');
  assert.equal(chapters[3].content, '终');
  const position = chapterAt(chapters, chapters[2].start);
  assert.equal(position.index, 2);
  assert.equal(position.ratio, 0);
});

test('treats a novel without headings as one chapter', () => {
  assert.deepEqual(parseChapters('这是没有章节的小说。')[0], { title: '全文', start: 0, content: '这是没有章节的小说。' });
});

test('creates a clean book and rejects empty text', () => {
  const book = createBook('正文', '  书名  ', '', 0, 'test-id');
  assert.equal(book.id, 'test-id');
  assert.equal(book.title, '书名');
  assert.equal(book.author, '佚名');
  assert.throws(() => createBook('   ', '书名'), /没有找到可阅读的文字/);
  assert.throws(() => createBook('正文', ''), /填写一个书名/);
});

test('makes readable titles from file names', () => {
  assert.equal(titleFromFilename('my_favorite-novel.txt'), 'my favorite novel');
});

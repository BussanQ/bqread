import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chapterAt, createBook, normalizeText, parseChapters, readingChapters, titleFromFilename } from '../.test-dist/parser.js';

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

test('keeps TXT headings with full-width spacing, punctuation or an attached subtitle', () => {
  const text = '前言正文\r\n　　第０１章　山雨欲来\r\n雨落在河面上。\r\n第〇二章：渡口\r\n岸边无人。\r\n第三章归舟\r\n小船回来了。';
  const source = normalizeText(text);
  const chapters = parseChapters(text);
  assert.deepEqual(chapters.map(c => c.title), ['开篇', '第０１章　山雨欲来', '第〇二章：渡口', '第三章归舟']);
  assert.deepEqual(chapters.map(c => c.content), ['前言正文', '雨落在河面上。', '岸边无人。', '小船回来了。']);
  for (const [i, chapter] of chapters.entries()) {
    assert.equal(chapterAt(chapters, chapter.start).index, i);
    if (i) assert.ok(source.slice(chapter.start).trimStart().startsWith(chapter.title));
  }
});

test('does not split a paragraph just because it refers to a chapter', () => {
  const source = '第一章 起程\n第一章中提到的那条河，如今已经干了。\n他翻开第二章，继续读下去。';
  const chapters = parseChapters(source);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].content, source.split('\n').slice(1).join('\n'));
});

test('recognizes joined subtitles with punctuation and numbered bonus chapters', () => {
  const source = '番外二：远行\n番外正文。\n第三十章潮起，潮落\n第30章潮起，潮落\n船开了。\n第三十一章到岸了？\n快到了。';
  const chapters = parseChapters(source);
  assert.deepEqual(chapters.map(c => c.title), ['番外二：远行', '第三十章潮起，潮落', '第三十一章到岸了？']);
  assert.equal(chapters[1].content, '第30章潮起，潮落\n船开了。');
});

test('orders chapters numerically within volumes and keeps ties, sections and extras together', () => {
  const titles = ['番外二：出海', '序章', '第二卷 下', '第十章 甲', '第０２章 乙', '第一卷 上',
    '第两百零三章 丙', '第十一章 丁（第 1 节）', '第十一章 丁（第 2 节）', '第11章 戊', '尾声', '番外：归舟'];
  const source = titles.map((title, i) => ({ title, start: i * 10, length: 8 }));
  const result = readingChapters(source, titles.length * 10);
  assert.deepEqual(result.map(c => c.sourceIndex), [1, 5, 7, 8, 9, 6, 2, 4, 3, 10, 11, 0]);
  result.forEach((chapter, index) => {
    assert.equal(chapter.title, titles[chapter.sourceIndex]);
    assert.equal(chapter.readingStart, index * 10);
    assert.equal(chapterAt(source, chapter.start + 3).index, chapter.sourceIndex);
  });
});

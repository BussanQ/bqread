import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookTools, selectPassage } from '../server/book-tools.mjs';

function source(texts, content = texts.join('\n')) {
  return { title: '测试书', author: '作者', chapters: texts.map((content, i) => ({ title: `第${i + 1}章`, content })),
    readChapter: async (i) => texts[i], readText: async () => content };
}
const toolsFor = (book, onActivity) => createBookTools(book, undefined, onActivity, new AbortController().signal);

test('chapter and catalog pagination cover every page without losing surrogate pairs', async () => {
  const text = '文'.repeat(7999) + '🌙' + '雨'.repeat(9000);
  const book = source([text, ...Array(104).fill('结尾')]);
  const tools = toolsFor(book);
  const first = await tools.execute('read_catalog', {});
  assert.equal(first.chapters.length, 100);
  const rest = await tools.execute('read_catalog', { start: first.nextStart });
  assert.equal(rest.nextStart, null);
  assert.deepEqual([...first.chapters, ...rest.chapters].map(c => c.chapter), Array.from({ length: 105 }, (_, i) => i + 1));
  let offset = 0;
  let reconstructed = '';
  do {
    const result = await tools.execute('read_chapter', { chapter: 1, offset });
    assert.ok(result.text.length <= 8000);
    assert.ok(!/[\uD800-\uDBFF]$/.test(result.text));
    reconstructed += result.text;
    offset = result.nextOffset;
  } while (offset !== null);
  assert.equal(reconstructed, text);
  assert.equal((await tools.execute('read_chapter', { chapter: 105 })).text, '结尾');
});

test('search returns bounded evidence and a resumable cursor, including later chapters', async () => {
  const book = source(['线索。'.repeat(25), '风'.repeat(383) + '线索结尾', '最后的线索']);
  const steps = [];
  const tools = toolsFor(book, step => steps.push(step));
  const first = await tools.execute('search_book', { query: '线索' });
  assert.equal(first.matches.length, 20);
  assert.deepEqual(first.next, { chapter: 1, offset: 60 });
  const second = await tools.execute('search_book', { query: '线索', ...first.next });
  assert.equal(second.matches.length, 7);
  assert.equal(second.next, null);
  assert.equal(second.matches.at(-1).chapter, 3);
  const all = [...first.matches, ...second.matches].map(({ chapter, offset }) => `${chapter}:${offset}`);
  assert.equal(new Set(all).size, 27);
  assert.equal(tools.evidence.length, 27);
  const restricted = await tools.execute('search_book', { query: '线索', chapter: 2, endChapter: 2 });
  assert.equal(restricted.matches.length, 1);
  const empty = await tools.execute('search_book', { query: '线.*索' });
  assert.equal(empty.matches.length, 0);
  assert.equal(steps.at(-1).status, 'empty');
});

test('statistics count the complete stored text in Unicode code points, including original headings', async () => {
  const text = '第一章\n甲乙， A1🌙\n\t𠮷';
  const book = source(['甲乙， A1🌙\n\t𠮷'], text);
  const tools = toolsFor(book);
  const full = await tools.execute('book_stats', {});
  assert.equal(full.characters, 14);
  assert.equal(full.nonWhitespace, 10);
  assert.equal(full.han, 6);
  assert.equal(full.chapter, null);
  const chapter = await tools.execute('book_stats', { chapter: 1 });
  assert.equal(chapter.characters, 10);
  assert.equal(chapter.nonWhitespace, 7);
  assert.equal(chapter.han, 3);
  assert.match(full.basis, /完整文本/);
  assert.match(chapter.basis, /不包含/);
  assert.equal(tools.statistics.get('book'), full);
});

test('statistics cover multi-million-character books and can be canceled while counting', async () => {
  const book = source(['正文'], '中a🌙 \n'.repeat(600000));
  const result = await toolsFor(book).execute('book_stats', {});
  assert.equal(result.characters, 3000000);
  assert.equal(result.nonWhitespace, 1800000);
  assert.equal(result.han, 600000);
  const controller = new AbortController();
  const tools = createBookTools(book, undefined, undefined, controller.signal);
  const counting = tools.execute('book_stats', {});
  setImmediate(() => controller.abort());
  await assert.rejects(counting, { name: 'AbortError' });
  assert.equal(tools.statistics.size, 0);
});

test('selection validates offsets including headings and preserves long-chapter text', async () => {
  const selected = '从这里开始。\n\n  那串铜钥匙留在门口。';
  const book = source(['风'.repeat(18000) + selected + '雨'.repeat(6000)]);
  const ref = await selectPassage(book, 1, { start: 18000, end: 18000 + selected.length });
  assert.equal(ref.text, selected);
  const title = await selectPassage(book, 1, { start: 1, end: 5, fromTitle: true });
  assert.equal(title.text, '1章\n风');
  const tools = createBookTools(book, ref, undefined, new AbortController().signal);
  assert.deepEqual(tools.evidence, [{ chapter: 1, text: selected }]);
  for (const passage of [null, { start: -1, end: 1 }, { start: 0, end: 8001 }, { start: 50, end: 40 },
    { start: 30000, end: 30001 }, { start: 4, end: 6, fromTitle: true }, { start: 0, end: 1, fromTitle: false }]) {
    await assert.rejects(selectPassage(book, 1, passage), { status: 400 });
  }
});

test('book tools reject unsupported tools, foreign book paths, malformed arguments and cancellation', async () => {
  const book = source(['正文']);
  const tools = toolsFor(book);
  for (const [name, args] of [['read_file', { path: '../private' }], ['read_chapter', { chapter: 1, path: '../private' }],
    ['read_chapter', {}], ['read_chapter', { chapter: 0 }], ['read_chapter', { chapter: 2 }],
    ['read_chapter', { chapter: 1, offset: 3 }], ['read_chapter', null], ['read_catalog', []],
    ['search_book', { query: '' }], ['search_book', { query: '正文', endChapter: 0 }], ['book_stats', { chapter: null }]]) {
    await assert.rejects(tools.execute(name, args), { toolInput: true });
  }
  const controller = new AbortController();
  const canceled = createBookTools(book, undefined, undefined, controller.signal);
  controller.abort();
  await assert.rejects(canceled.execute('book_stats', {}), { name: 'AbortError' });
});

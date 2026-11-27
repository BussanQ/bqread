import { chapterOrder } from './shared/chapter-order.mjs';
import samples from './sample-books.json' with { type: 'json' };

const pageSize = 8000;
const catalogSize = 100;
const matchLimit = 20;

function tool(name, description, properties = {}, required = []) {
  return { type: 'function', function: { name, description,
    parameters: { type: 'object', properties, required, additionalProperties: false } } };
}
const chapterParameter = { type: 'integer', minimum: 1, description: '从 1 开始的章节序号。' };
export const bookTools = [
  tool('read_catalog', '分页读取本书目录，返回 nextStart 时可继续读取。', {
    start: { type: 'integer', minimum: 1, description: '起始章节，默认 1。' },
  }),
  tool('read_chapter', '分页读取指定章节原文。offset 和 nextOffset 使用 UTF-16 字符偏移；nextOffset 非空时尚未读完。', {
    chapter: chapterParameter, offset: { type: 'integer', minimum: 0, description: '正文偏移，默认 0。' },
  }, ['chapter']),
  tool('search_book', '在本书所有章节正文中搜索一个字面关键词（不使用正则，区分大小写）。返回匹配原文及位置；有 next 时用其 chapter、offset 继续。可缩小章节范围。', {
    query: { type: 'string', minLength: 1, maxLength: 200 },
    chapter: { ...chapterParameter, description: '搜索起始章节，默认 1。' },
    endChapter: { ...chapterParameter, description: '搜索结束章节，默认最后一章。' },
    offset: { type: 'integer', minimum: 0, description: '起始章节内的正文偏移，默认 0。' },
  }, ['query']),
  tool('book_stats', '由程序精确统计字数，无需逐章读给模型。默认统计导入的完整文本（包含原有标题）；指定 chapter 则只统计该章正文。返回总字符数、非空白字符数、汉字数。', {
    chapter: chapterParameter,
  }),
];

function invalid(message) { throw Object.assign(new Error(message), { toolInput: true }); }
function integer(value, fallback, min, max, name) {
  const n = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(n) || n < min || n > max) invalid(`${name}必须是 ${min} 到 ${max} 的整数。`);
  return n;
}

export async function openBook(store, id, sample) {
  if (sample) {
    const book = samples.find((entry) => entry.id === id);
    if (!book) throw Object.assign(new Error('试读书籍不存在。'), { status: 404 });
    const chapters = chapterOrder(book.chapters).map(index => book.chapters[index]);
    return { title: book.title, author: book.author, chapters,
      readChapter: async (index) => chapters[index].content,
      readText: async () => book.chapters.map(({ title, content }) => title + '\n' + content).join('\n') };
  }
  const summary = await store.read(id, 'summary');
  const source = await store.read(id, 'toc');
  const order = chapterOrder(source);
  const chapters = order.map(index => source[index]);
  return { title: summary.title, author: summary.author, chapters,
    readChapter: (index) => store.read(id, 'chapter', order[index]),
    readText: async () => (await store.read(id, 'export')).content };
}

export async function selectPassage(book, chapter, passage) {
  const { start, end, fromTitle } = passage ?? {};
  const title = book.chapters[chapter - 1].title;
  const text = await book.readChapter(chapter - 1);
  const prefix = fromTitle === true ? title + '\n' : '';
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
    (fromTitle !== undefined && (fromTitle !== true || start >= prefix.length)) ||
    end <= start || end > prefix.length + text.length || end - start > 8000) {
    throw Object.assign(new Error('选段无效或超过 8000 字，请重新选择正文。'), { status: 400 });
  }
  const selection = (prefix + text).slice(start, end);
  if (!selection.trim()) throw Object.assign(new Error('选段为空，请重新选择。'), { status: 400 });
  return { chapter, title, text: selection };
}

// Positions use the reader's UTF-16 offsets; counting uses Unicode code points.
function pageEnd(text, start, size) {
  let end = Math.min(text.length, start + size);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return end;
}

export function createBookTools(book, selection, onActivity, signal) {
  const evidence = selection ? [{ chapter: selection.chapter, text: selection.text }] : [];
  const statistics = new Map();
  let stepId = 0;
  const total = book.chapters.length;

  async function execute(name, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('工具参数必须是 JSON 对象。');
    const definition = bookTools.find((entry) => entry.function.name === name);
    if (!definition) invalid('本书对话不支持这个工具。请使用提供的查书工具。');
    for (const key of Object.keys(args)) {
      if (!Object.hasOwn(definition.function.parameters.properties, key)) invalid(`不支持参数 ${key}。`);
    }
    signal.throwIfAborted();
    let chapter;
    let offset;
    let endChapter;
    if (name === 'read_catalog') chapter = integer(args.start, 1, 1, total, 'start');
    if (name === 'read_chapter' || name === 'search_book' || (name === 'book_stats' && args.chapter !== undefined)) {
      chapter = integer(args.chapter, name === 'search_book' ? 1 : undefined, 1, total, 'chapter');
    }
    if (name === 'read_chapter' || name === 'search_book') offset = integer(args.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
    if (name === 'search_book') {
      if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200) invalid('query 必须是 1 到 200 字的关键词。');
      endChapter = integer(args.endChapter, total, chapter, total, 'endChapter');
    }
    const target = name === 'read_catalog' ? '本书目录' : name === 'search_book' ? '本书章节'
      : name === 'book_stats' ? (chapter ? book.chapters[chapter - 1].title : '全书') + ' · 字数统计'
      : book.chapters[chapter - 1].title;
    const step = { id: ++stepId, action: name === 'search_book' ? 'search' : 'read', target,
      ...(name === 'search_book' ? { query: args.query } : {}), status: 'running' };
    onActivity?.(step);
    try {
      let result;
      if (name === 'read_catalog') {
        const entries = book.chapters.slice(chapter - 1, chapter - 1 + catalogSize).map(({ title }, i) => ({ chapter: chapter + i, title }));
        result = { title: book.title, author: book.author, chapterCount: total, chapters: entries,
          nextStart: chapter + entries.length <= total ? chapter + entries.length : null };
      } else if (name === 'read_chapter') {
        const text = await book.readChapter(chapter - 1);
        if (offset > text.length) invalid('offset 超过本章正文长度。');
        const end = pageEnd(text, offset, pageSize);
        result = { chapter, title: target, offset, text: text.slice(offset, end), nextOffset: end < text.length ? end : null };
        evidence.push({ chapter, text: result.text });
      } else if (name === 'search_book') {
        const matches = [];
        let next = null;
        search: for (let number = chapter; number <= endChapter; number++) {
          signal.throwIfAborted();
          const text = await book.readChapter(number - 1);
          const start = number === chapter ? offset : 0;
          if (start > text.length) invalid('offset 超过起始章节正文长度。');
          let position = text.indexOf(args.query, start);
          while (position !== -1) {
            if (matches.length === matchLimit) { next = { chapter: number, offset: position }; break search; }
            const excerpt = text.slice(Math.max(0, position - 100), position + args.query.length + 200);
            matches.push({ chapter: number, title: book.chapters[number - 1].title, offset: position, text: excerpt });
            evidence.push({ chapter: number, text: excerpt });
            position = text.indexOf(args.query, position + args.query.length);
          }
        }
        result = { matches, next };
      } else {
        const key = chapter ?? 'book';
        if (!statistics.has(key)) {
          const text = chapter ? await book.readChapter(chapter - 1) : await book.readText();
          const counts = { characters: 0, nonWhitespace: 0, han: 0 };
          for (const character of text) {
            counts.characters++;
            if (!/\s/u.test(character)) counts.nonWhitespace++;
            if (/\p{Script=Han}/u.test(character)) counts.han++;
            if (counts.characters % 65536 === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
              signal.throwIfAborted();
            }
          }
          statistics.set(key, { ...counts, chapter: chapter ?? null,
            basis: chapter ? '本章正文，不包含单独保存的章节标题' : '导入后保存的完整文本，包含文本中原有的章节标题、前言和后记',
            counting: '按 Unicode 码点计数；非空白字符数包含标点、数字和字母；汉字数按 Unicode Script=Han 统计' });
        }
        result = statistics.get(key);
      }
      signal.throwIfAborted();
      onActivity?.({ ...step, status: name === 'search_book' && !result.matches.length ? 'empty' : 'done' });
      return result;
    } catch (error) {
      onActivity?.({ ...step, status: signal.aborted ? 'interrupted' : 'failed' });
      throw error;
    }
  }
  return { execute, evidence, statistics };
}

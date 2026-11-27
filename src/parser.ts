import { chapterOrder, matchNumberedHeading } from '../server/shared/chapter-order.mjs';
import type { Book, Chapter, ChapterInfo, CoverTheme } from './types';

// Match a single line. Normalize typography for detection only; keep the author's title below.
const specialHeading = /^(?:上架感言|楔子|序章|序言|序幕|尾声|尾聲|终章|終章|后记|後記|番外(?:[0-9零〇一二三四五六七八九十百]+)?)(?:$|[\s:·—-])/u;

function isChapterHeading(title: string): boolean {
  if (!title || title.length > 120) return false;
  const line = title.normalize('NFKC').replace(/^[【\[]/u, '');
  if (specialHeading.test(line)) return true;
  const match = matchNumberedHeading(title);
  if (!match) return false;
  const suffix = match[3];
  if (!suffix || /^[\s:、·—.\]】(-]/u.test(suffix)) return true;
  // A joined subtitle may be a question or contain commas. Exclude ordinary
  // sentences and explicit references to a chapter in the body.
  return !suffix.includes('。') && !/^(?:中|里|所)(?:曾|已经|就)?(?:提到|说到|写到|提及|描述)/u.test(suffix);
}
const covers: CoverTheme[] = ['forest', 'clay', 'sand', 'blue', 'plum'];

export function chapterAt(chapters: (Chapter | ChapterInfo)[], location: number): { index: number; ratio: number } {
  const index = Math.max(0, chapters.findLastIndex((chapter) => chapter.start <= location));
  const chapter = chapters[index]!;
  const length = 'length' in chapter ? chapter.length : chapter.content.length;
  return { index, ratio: Math.min(1, Math.max(0, (location - chapter.start) / Math.max(1, length))) };
}

export function readingChapters(chapters: ChapterInfo[], contentLength: number) {
  let readingStart = 0;
  return chapterOrder(chapters).map(sourceIndex => {
    const chapter = chapters[sourceIndex];
    const entry = { ...chapter, sourceIndex, readingStart };
    readingStart += (chapters[sourceIndex + 1]?.start ?? contentLength) - chapter.start;
    return entry;
  });
}

export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
}

export function parseChapters(source: string): Chapter[] {
  const content = normalizeText(source);
  const headings: { start: number; end: number; title: string }[] = [];
  for (const match of content.matchAll(/[^\n]+/g)) {
    const title = match[0].trim();
    if (isChapterHeading(title)) {
      const start = match.index;
      const previous = headings.at(-1);
      if (previous && start === previous.end + 1) {
        // Some TXT exports repeat the heading on the next line with another number.
        const subtitle = matchNumberedHeading(title)?.[3].trim();
        if (subtitle && subtitle === matchNumberedHeading(previous.title)?.[3].trim()) continue;
      }
      headings.push({ start, end: start + match[0].length, title });
    }
  }
  if (!headings.length) return [{ title: '全文', start: 0, content }];

  const chapters: Chapter[] = [];
  const preface = content.slice(0, headings[0].start).trim();
  if (preface) chapters.push({ title: '开篇', start: 0, content: preface });
  headings.forEach(({ start, end, title }, index) => {
    chapters.push({ title, start, content: content.slice(end, headings[index + 1]?.start).trim() });
  });
  return chapters;
}

export function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '未命名故事';
}

export async function decodeTextFile(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB，请选择较小的 TXT 文件。');
  if (file.size === 0) throw new Error('这个文件是空的，请选择有内容的 TXT 文件。');
  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      text = new TextDecoder('gb18030').decode(buffer);
    } catch {
      throw new Error('无法识别文件编码，请另存为 UTF-8 或 GB18030 后重试。');
    }
  }
  return text;
}

export function createBook(text: string, title: string, author = '佚名', index = 0, id?: string): Book {
  const content = normalizeText(text);
  if (!content) throw new Error('没有找到可阅读的文字，请检查文件内容。');
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error('请为这本书填写一个书名。');
  if (cleanTitle.length > 100) throw new Error('书名不能超过 100 个字。');
  if (author.trim().length > 50) throw new Error('作者名不能超过 50 个字。');
  const now = Date.now();
  return {
    id: id ?? (globalThis.crypto?.randomUUID?.() ?? `book-${now}-${Math.random().toString(36).slice(2)}`),
    title: cleanTitle,
    author: author.trim() || '佚名',
    content,
    chapters: parseChapters(content),
    cover: covers[index % covers.length],
    addedAt: now,
    lastReadAt: null,
    location: 0,
    sample: false,
  };
}

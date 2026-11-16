import type { Book, Chapter, ChapterInfo, CoverTheme } from './types';

const HEADING = /^[\t ]*(第[0-9零一二三四五六七八九十百千万两]+[章节卷回部集](?:[\t ]+[^\n]{0,60})?|楔子|序章|序言|尾声|后记)[\t ]*$/gm;
const covers: CoverTheme[] = ['forest', 'clay', 'sand', 'blue', 'plum'];

export function chapterAt(chapters: (Chapter | ChapterInfo)[], location: number): { index: number; ratio: number } {
  const index = Math.max(0, chapters.findLastIndex((chapter) => chapter.start <= location));
  const chapter = chapters[index]!;
  const length = 'length' in chapter ? chapter.length : chapter.content.length;
  return { index, ratio: Math.min(1, Math.max(0, (location - chapter.start) / Math.max(1, length))) };
}

export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
}

export function parseChapters(source: string): Chapter[] {
  const content = normalizeText(source);
  const matches = [...content.matchAll(HEADING)];
  HEADING.lastIndex = 0;

  if (matches.length === 0) {
    return [{ title: '全文', start: 0, content }];
  }

  const chapters: Chapter[] = [];
  const firstIndex = matches[0].index;
  const preface = content.slice(0, firstIndex).trim();
  if (preface) chapters.push({ title: '开篇', start: 0, content: preface });

  matches.forEach((match, index) => {
    const start = match.index;
    const heading = match[0].trim();
    const end = matches[index + 1]?.index ?? content.length;
    chapters.push({ title: heading, start, content: content.slice(start + match[0].length, end).trim() });
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

import type { Book, BookSummary, ChapterInfo, ChapterWindow } from '../types';
import { sections } from '../../server/shared/sections.mjs';

// Only these three operations cross the native SQLite bridge.
export interface Statement { statement: string; values: (string | number)[] }
export interface Database {
  execute(sql: string): Promise<unknown>;
  executeSet(statements: Statement[]): Promise<unknown>;
  query(sql: string, values?: (string | number)[]): Promise<{ values?: Record<string, any>[] }>;
}
export async function openLibrary(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY, summary TEXT NOT NULL, original TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chapters(book TEXT NOT NULL, position INTEGER NOT NULL, title TEXT NOT NULL,
      start INTEGER NOT NULL, length INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(book,position));
    CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, history TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hidden_samples(id TEXT PRIMARY KEY);
  `);
  async function rows(sql: string, values: (string | number)[] = []) {
    return (await db.query(sql, values)).values ?? [];
  }
  async function field(sql: string, values: (string | number)[], name: string) {
    const [row] = await rows(sql, values);
    if (!row) throw new Error('本机上找不到这本书或该章节。');
    return row[name] as string;
  }
  const original = (id: string) => field('SELECT original FROM books WHERE id=?', [id], 'original');
  const chapter = (id: string, index: number) => field('SELECT text FROM chapters WHERE book=? AND position=?', [id,index], 'text');
  async function toc(id: string): Promise<ChapterInfo[]> {
    return (await rows('SELECT title,start,length FROM chapters WHERE book=? ORDER BY position', [id]))
      .map(row => ({ title: row.title, start: row.start, length: row.length }));
  }
  return {
    original, toc,
    async list(): Promise<BookSummary[]> {
      return (await rows('SELECT summary FROM books')).map(row => JSON.parse(row.summary));
    },
    async put(book: Book): Promise<BookSummary> {
      const { id, title, author, cover, addedAt } = book;
      const parts = Array.from(sections(book.chapters));
      const summary = { id, title, author, cover, addedAt, sample: false, location: 0, lastReadAt: null,
        contentLength: book.content.length, chapterCount: parts.length };
      // One transaction: a failed import must never leave a partially readable book.
      await db.executeSet([
        { statement: 'INSERT INTO books(id,summary,original) VALUES(?,?,?)', values: [id, JSON.stringify(summary), book.content] },
        ...parts.map(({ title, start, text }, index) => ({ statement: 'INSERT INTO chapters VALUES(?,?,?,?,?,?)',
          values: [id, index, title, start, text.length, text] })),
      ]);
      return summary;
    },
    async window(id: string, center: number): Promise<ChapterWindow> {
      const start = Math.max(0, center - 1);
      const found = await rows('SELECT text FROM chapters WHERE book=? AND position BETWEEN ? AND ? ORDER BY position', [id,start,center+1]);
      if (!found[center-start]) throw new Error('章节不存在。');
      return { start, texts: found.map(row => row.text) };
    },
    async remove(id: string) {
      await db.executeSet([
        { statement: 'DELETE FROM chapters WHERE book=?', values: [id] },
        { statement: 'DELETE FROM books WHERE id=?', values: [id] },
        { statement: 'DELETE FROM chats WHERE id=?', values: ['book-' + id] },
      ]);
    },
    hiddenSamples: async () => (await rows('SELECT id FROM hidden_samples')).map(row => row.id as string),
    async hideSample(id: string) {
      await db.executeSet([{ statement: 'INSERT OR IGNORE INTO hidden_samples VALUES(?)', values: [id] },
        { statement: 'DELETE FROM chats WHERE id=?', values: ['sample-' + id] }]);
    },
    // Same reader contract as the server's indexed book store.
    async read(id: string, action: string, index: number) {
      if (action === 'toc') return toc(id);
      if (action === 'chapter') return chapter(id, index);
      if (action === 'export') return { content: await original(id) };
      if (action === 'summary') return JSON.parse(await field('SELECT summary FROM books WHERE id=?', [id], 'summary'));
      throw new Error('未知的书库操作。');
    },
    histories: {
      async load(id: string) {
        const [row] = await rows('SELECT history FROM chats WHERE id=?', [id]);
        return row ? JSON.parse(row.history) : null;
      },
      write: (id: string, value: unknown) => db.executeSet([{ statement: 'INSERT OR REPLACE INTO chats VALUES(?,?)', values: [id, JSON.stringify(value)] }]),
      remove: (id: string) => db.executeSet([{ statement: 'DELETE FROM chats WHERE id=?', values: [id] }]),
    },
  };
}

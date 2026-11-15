import type { Book } from './types';

const PROGRESS_KEY = 'modu-progress';

interface SavedProgress {
  location: number;
  lastReadAt: number | null;
}

function readProgress(): Record<string, SavedProgress> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, SavedProgress> : {};
  } catch {
    return {};
  }
}

function saveProgress(progress: Record<string, SavedProgress>): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    throw new Error('阅读进度保存失败，请检查浏览器的存储权限。');
  }
}

async function responseJSON(response: Response): Promise<unknown> {
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(result?.error ?? '服务端书库暂时不可用，请稍后重试。');
  }
  if (response.status === 204) return null;
  return response.json();
}

export function restoreReadingProgress(books: Book[]): Book[] {
  const progress = readProgress();
  return books.map((book) => ({ ...book, location: progress[book.id]?.location ?? 0, lastReadAt: progress[book.id]?.lastReadAt ?? null }));
}

async function legacyBooks(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('modu-reader');
    let missing = false;
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () => missing ? resolve(null) : reject(new Error('旧版书库读取失败，请稍后重试迁移。'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function migrateLegacyBooks(existing: Book[]): Promise<void> {
  const database = await legacyBooks();
  if (!database) return;
  try {
    if (database.objectStoreNames.contains('books')) {
      const books = await new Promise<Book[]>((resolve, reject) => {
        const request = database.transaction('books', 'readonly').objectStore('books').getAll();
        request.onsuccess = () => resolve(request.result as Book[]);
        request.onerror = () => reject(new Error('旧版书籍读取失败，请稍后重试迁移。'));
      });
      const savedIds = new Set(existing.map((book) => book.id));
      for (const book of books) {
        if (!book.sample && !savedIds.has(book.id)) await putBook(book);
        saveReadingProgress(book);
      }
    }
  } finally {
    database.close();
  }
  // Only remove the old database after every upload and progress save succeeds.
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('modu-reader');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('书籍已迁移，旧版书库清理失败，请刷新重试。'));
    request.onblocked = () => reject(new Error('书籍已迁移，请关闭其他旧版墨读页面后刷新以清理旧书库。'));
  });
}

export async function getBooks(): Promise<Book[]> {
  const existing = await responseJSON(await fetch('/api/books')) as Book[];
  await migrateLegacyBooks(existing);
  return await responseJSON(await fetch('/api/books')) as Book[];
}

export async function putBook(book: Book): Promise<void> {
  if (!book.sample) {
    const response = await fetch('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(book),
    });
    await responseJSON(response);
  }
}

export function saveReadingProgress(book: Book): void {
  const progress = readProgress();
  progress[book.id] = { location: book.location, lastReadAt: book.lastReadAt };
  saveProgress(progress);
}

export async function exportBook(book: Book): Promise<void> {
  const response = await fetch(`/api/books/${encodeURIComponent(book.id)}/export`);
  if (!response.ok) await responseJSON(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `${book.title} - ${book.author}.txt`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function deleteStoredBook(id: string, sample = false): Promise<void> {
  if (!sample) {
    const response = await fetch(`/api/books/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await responseJSON(response);
  }
  const progress = readProgress();
  delete progress[id];
  saveProgress(progress);
}

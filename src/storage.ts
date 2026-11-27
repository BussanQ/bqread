import { removeBookAnnotations } from './annotations';
import { onIPhone } from './mobile/platform';
import type { Book, BookSummary, ChapterInfo, ChapterWindow } from './types';

const PROGRESS_KEY = 'modu-progress';

interface SavedProgress {
  readingLocation?: number;
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
    throw new Error('阅读进度保存失败，请检查存储权限。');
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

export function restoreReadingProgress(books: BookSummary[]): BookSummary[] {
  const progress = readProgress();
  return books.map((book) => ({ ...book, location: progress[book.id]?.location ?? 0, readingLocation: progress[book.id]?.readingLocation, lastReadAt: progress[book.id]?.lastReadAt ?? null }));
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

function idbResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('旧版书籍读取失败，请稍后重试迁移。'));
  });
}

async function migrateLegacyBooks(existing: BookSummary[]): Promise<void> {
  const database = await legacyBooks();
  if (!database) return;
  try {
    if (database.objectStoreNames.contains('books')) {
      const readStore = () => database.transaction('books', 'readonly').objectStore('books');
      const keys = await idbResult(readStore().getAllKeys());
      const savedIds = new Set(existing.map((book) => book.id));
      for (const key of keys) {
        const book: Book | undefined = await idbResult(readStore().get(key));
        if (!book) continue;
        if (!book.sample && !savedIds.has(book.id)) existing.push(await putBook(book));
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

async function mobileLibrary() {
  return (await import('./mobile/device')).library();
}

export async function getBooks(): Promise<BookSummary[]> {
  if (onIPhone) return (await (await mobileLibrary()).list()).sort((a, b) => b.addedAt - a.addedAt);
  const books = await responseJSON(await fetch('/api/books')) as BookSummary[];
  await migrateLegacyBooks(books);
  return books.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getContents(id: string, signal: AbortSignal): Promise<ChapterInfo[]> {
  if (onIPhone) return (await mobileLibrary()).toc(id);
  return await responseJSON(await fetch(`/api/books/${encodeURIComponent(id)}/toc`, { signal })) as ChapterInfo[];
}

export async function getChapterWindow(id: string, center: number, signal: AbortSignal): Promise<ChapterWindow> {
  if (onIPhone) return (await mobileLibrary()).window(id, center);
  return await responseJSON(await fetch(`/api/books/${encodeURIComponent(id)}/chapters?center=${center}`, { signal })) as ChapterWindow;
}

export async function putBook(book: Book): Promise<BookSummary> {
  if (onIPhone) return (await mobileLibrary()).put(book);
  const response = await fetch('/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(book),
  });
  return await responseJSON(response) as BookSummary;
}

export function saveReadingProgress(book: Pick<BookSummary, 'id' | 'location' | 'readingLocation' | 'lastReadAt'>): void {
  const progress = readProgress();
  progress[book.id] = { location: book.location, readingLocation: book.readingLocation, lastReadAt: book.lastReadAt };
  saveProgress(progress);
}

export async function exportBook(book: BookSummary): Promise<void> {
  if (onIPhone) return (await import('./mobile/device')).shareBook(book);
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
  if (onIPhone) {
    await (await import('./mobile/chat')).removeBook(id, sample);
  } else if (!sample) {
    const response = await fetch(`/api/books/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await responseJSON(response);
  }
  const progress = readProgress();
  removeBookAnnotations(id);
  delete progress[id];
  saveProgress(progress);
}

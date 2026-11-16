export type CoverTheme = 'forest' | 'clay' | 'sand' | 'blue' | 'plum';
export type ReadingTheme = 'paper' | 'sage' | 'night';
export type FontSize = 16 | 18 | 20;
export type ShelfFilter = 'all' | 'reading' | 'unread';

export interface Chapter {
  title: string;
  start: number;
  content: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  content: string;
  chapters: Chapter[];
  cover: CoverTheme;
  addedAt: number;
  lastReadAt: number | null;
  location: number;
  sample: boolean;
}

export interface ReadingSettings {
  fontSize: FontSize;
  theme: ReadingTheme;
}

export interface BookSummary extends Omit<Book, 'content' | 'chapters'> {
  contentLength: number;
  chapterCount: number;
}

export interface ChapterInfo extends Omit<Chapter, 'content'> {
  length: number;
}

export interface ChapterWindow {
  start: number;
  texts: string[];
}

export interface ReaderState {
  chapters: ChapterInfo[];
  window: ChapterWindow;
  bookId: string;
  chapterIndex: number;
  chapterRatio: number;
  drawer: 'contents' | 'settings' | null;
}

export type ModalName = 'import' | 'help' | 'privacy' | 'delete' | null;

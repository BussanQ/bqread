import { newId } from '../server/shared/id.mjs';

export interface Annotation {
  id: string;
  kind: 'bookmark' | 'note';
  sourceIndex: number;
  ratio: number;
  text: string;
}

// Store entries separately so writes in another browser tab cannot replace the whole list.
function prefix(bookId: string): string {
  return 'modu-annotation:' + encodeURIComponent(bookId) + ':';
}

function bookKeys(bookId: string): string[] {
  const keyPrefix = prefix(bookId);
  return Object.keys(localStorage).filter(key => key.startsWith(keyPrefix));
}

export function annotations(bookId: string): Annotation[] {
  return bookKeys(bookId).map(key => JSON.parse(localStorage.getItem(key)!));
}

export function saveAnnotation(bookId: string, entry: Omit<Annotation, 'id'>, id?: string): void {
  const key = id ?? (entry.kind === 'note' ? newId() : 'bookmark-' + entry.sourceIndex + '-' + Math.round(entry.ratio * 10000));
  localStorage.setItem(prefix(bookId) + key, JSON.stringify({ ...entry, id: key }));
}

export function removeAnnotation(bookId: string, id: string): void {
  localStorage.removeItem(prefix(bookId) + id);
}

export function removeBookAnnotations(bookId: string): void {
  for (const key of bookKeys(bookId)) localStorage.removeItem(key);
}

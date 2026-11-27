import { createBook } from './parser';
import type { Book, CoverTheme } from './types';
import samples from '../server/sample-books.json' with { type: 'json' };

export function sampleBooks(): Book[] {
  return samples.map((sample, index) => {
    const text = sample.chapters.map(({ title, content }) => title + '\n' + content).join('\n');
    const book = createBook(text, sample.title, sample.author, index, sample.id);
    return { ...book, sample: true, cover: sample.cover as CoverTheme };
  });
}

import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function chapterFile(number) {
  return 'chapters/' + String(number).padStart(5, '0') + '.json';
}

// A chapter per file keeps even very large novels searchable by bqagent's grep.
// Short JSON lines also let read_file page through a chapter without truncating long paragraphs.
export async function prepareBookFiles(directory, key, version, book, chapters, readChapter) {
  const parent = join(directory, 'agent-books', key);
  const workspace = join(parent, version);
  try {
    await access(join(workspace, 'book.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temp = await mkdtemp(join(parent, '.building-'));
    try {
      await mkdir(join(temp, 'chapters'), { mode: 0o700 });
      const contents = [];
      for (let i = 0; i < chapters.length; i++) {
        const file = chapterFile(i + 1);
        const title = chapters[i].title;
        const text = await readChapter(i);
        const blocks = text.match(/[^\n]{1,384}\n?|\n/gu) ?? [];
        await writeFile(join(temp, file), JSON.stringify({ chapter: i + 1, title, blocks }, null, 2), { mode: 0o600 });
        contents.push(JSON.stringify({ chapter: i + 1, title, file }));
      }
      const header = JSON.stringify({ title: book.title, author: book.author, chapterCount: chapters.length });
      await writeFile(join(temp, 'book.json'), header.slice(0, -1) + ',"chapters":[\n' + contents.join(',\n') + '\n]}', { mode: 0o600 });
      try {
        await rename(temp, workspace);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        await access(join(workspace, 'book.json'));
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  return { workspace, title: book.title, author: book.author, chapterCount: chapters.length, chapterTitles: chapters.map(({ title }) => title) };
}

export async function readBookChapter(workspace, number) {
  const { title, blocks } = JSON.parse(await readFile(join(workspace, chapterFile(number)), 'utf8'));
  return { chapter: number, title, text: blocks.join('') };
}

export async function prepareSelection(workspace, chapter, passage) {
  const { start, end, fromTitle } = passage ?? {};
  const original = await readBookChapter(workspace, chapter);
  const prefix = fromTitle === true ? original.title + '\n' : '';
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
    (fromTitle !== undefined && (fromTitle !== true || start >= prefix.length)) ||
    end <= start || end > prefix.length + original.text.length || end - start > 8000) {
    throw Object.assign(new Error('选段无效或超过 8000 字，请重新选择正文。'), { status: 400 });
  }
  const reference = { ...original, text: (prefix + original.text).slice(start, end) };
  if (!reference.text.trim()) throw Object.assign(new Error('选段为空，请重新选择。'), { status: 400 });
  const file = 'selections/' + [chapter, fromTitle ? 'title' : 'body', start, end].join('-') + '.json';
  await mkdir(join(workspace, 'selections'), { recursive: true, mode: 0o700 });
  const dest = join(workspace, file);
  const temp = dest + '.' + randomUUID();
  try {
    await writeFile(temp, JSON.stringify(reference, null, 2), { mode: 0o600 });
    await rename(temp, dest);
  } finally {
    await rm(temp, { force: true });
  }
  return { file, reference };
}

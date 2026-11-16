import { prepareBookFiles } from './book-files.mjs';
import { randomUUID } from 'node:crypto';
import { open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

// BQR1, two uint32 byte lengths, then summary JSON, directory JSON, chapter text and original TXT.
// Offsets in the directory are UTF-8 bytes. Reading progress stays in JS string units.
const MAGIC = 'BQR1';
const HEADER_BYTES = 12;
const MAX_SECTION_LENGTH = 24 * 1024;

async function readBytes(file, position, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) throw new Error('书籍文件不完整。');
    offset += bytesRead;
  }
  return buffer;
}

function indexBook(book) {
  const entries = [];
  const texts = [];
  let offset = 0;
  const chapters = book.chapters?.length ? book.chapters : [{ title: '全文', start: 0, content: book.content }];
  for (const chapter of chapters) {
    let start = 0;
    let part = 0;
    do {
      let end = Math.min(start + MAX_SECTION_LENGTH, chapter.content.length);
      if (end < chapter.content.length) {
        const newline = chapter.content.slice(start, end).lastIndexOf('\n');
        if (newline >= MAX_SECTION_LENGTH / 2) end = start + newline + 1;
        else if (/[\uD800-\uDBFF]/.test(chapter.content[end - 1])) end--;
      }
      const text = Buffer.from(chapter.content.slice(start, end));
      const title = chapter.content.length > MAX_SECTION_LENGTH ? `${chapter.title}（第 ${++part} 节）` : chapter.title;
      entries.push({ title, start: chapter.start + start, length: end - start, offset, bytes: text.length });
      texts.push(text);
      offset += text.length;
      start = end;
    } while (start < chapter.content.length);
  }
  const { id, title, author, addedAt, cover } = book;
  const summary = { id, title, author, addedAt, cover, sample: false, location: 0, lastReadAt: null,
    contentLength: book.content.length, chapterCount: entries.length };
  return { summary, entries, texts };
}

async function writeBook(path, book) {
  const { summary, entries, texts } = indexBook(book);
  const summaryJSON = Buffer.from(JSON.stringify(summary));
  const indexJSON = Buffer.from(JSON.stringify(entries));
  const header = Buffer.alloc(HEADER_BYTES);
  header.write(MAGIC);
  header.writeUInt32BE(summaryJSON.length, 4);
  header.writeUInt32BE(indexJSON.length, 8);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try {
      await file.writeFile(Buffer.concat([header, summaryJSON, indexJSON]));
      // Batch small chapters without building another full copy of the book.
      for (let i = 0; i < texts.length; i += 64) await file.writeFile(Buffer.concat(texts.slice(i, i + 64)));
      await file.writeFile(book.content);
    } finally {
      await file.close();
    }
    await rename(temp, path);
    return summary;
  } finally {
    await rm(temp, { force: true });
  }
}

export function createBookStore(directory) {
  // Serialize legacy conversion and replacement/deletion for the same book.
  const pending = new Map();
  function withBook(id, operation) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw Object.assign(new Error('书籍编号无效。'), { status: 400 });
    const previous = pending.get(id) ?? Promise.resolve();
    const path = join(directory, id);
    const task = previous.catch(() => {}).then(() => operation(path));
    pending.set(id, task);
    return task.finally(() => {
      if (pending.get(id) === task) pending.delete(id);
    });
  }

  function read(id, action, center) {
    return withBook(id, async (path) => {
      const filename = path + '.bqr';
      let file;
      try {
        file = await open(filename);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const legacy = JSON.parse(await readFile(path + '.json', 'utf8'));
        await writeBook(filename, legacy);
        await rm(path + '.json');
        file = await open(filename);
      }
      try {
        const header = await readBytes(file, 0, HEADER_BYTES);
        const summarySize = header.readUInt32BE(4);
        const indexSize = header.readUInt32BE(8);
        const dataStart = HEADER_BYTES + summarySize + indexSize;
        const { size, ino, mtimeMs } = await file.stat();
        if (header.toString('ascii', 0, 4) !== MAGIC || dataStart > size) throw new Error('书籍索引不完整。');
        if (action === 'summary') return JSON.parse((await readBytes(file, HEADER_BYTES, summarySize)).toString());
        const index = JSON.parse((await readBytes(file, HEADER_BYTES + summarySize, indexSize)).toString());
        if (action === 'toc') return index.map(({ title, start, length }) => ({ title, start, length }));
        if (action === 'agent-files') {
          const book = JSON.parse((await readBytes(file, HEADER_BYTES, summarySize)).toString());
          return await prepareBookFiles(directory, 'book-' + id, [ino, size, mtimeMs].join('-'), book, index, async (i) => {
            const { offset, bytes } = index[i];
            return (await readBytes(file, dataStart + offset, bytes)).toString();
          });
        }
        if (action === 'export') {
          const summary = JSON.parse((await readBytes(file, HEADER_BYTES, summarySize)).toString());
          const last = index.at(-1);
          const start = dataStart + last.offset + last.bytes;
          return { ...summary, content: (await readBytes(file, start, size - start)).toString() };
        }
        if (!Number.isSafeInteger(center) || center < 0 || center >= index.length) {
          throw Object.assign(new Error('章节编号无效。'), { status: 400 });
        }
        const start = Math.max(0, center - 1);
        const entries = index.slice(start, center + 2);
        const first = entries[0];
        const last = entries.at(-1);
        const bytes = await readBytes(file, dataStart + first.offset, last.offset + last.bytes - first.offset);
        return { start, texts: entries.map((entry) => bytes.toString('utf8', entry.offset - first.offset, entry.offset - first.offset + entry.bytes)) };
      } finally {
        await file.close();
      }
    });
  }

  return {
    read,
    async list() {
      const files = await readdir(directory);
      const ids = new Set(files.filter((name) => /\.(json|bqr)$/.test(name))
        .map((name) => name.slice(0, name.lastIndexOf('.'))));
      const books = [];
      // Convert old books one at a time to bound migration memory.
      for (const id of ids) {
        try {
          books.push(await read(id, 'summary'));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return books.sort((a, b) => b.addedAt - a.addedAt);
    },
    save(book) {
      return withBook(book.id, async (path) => {
        const summary = await writeBook(path + '.bqr', book);
        await rm(join(directory, 'agent-books', 'book-' + book.id), { recursive: true, force: true });
        await rm(path + '.json', { force: true });
        return summary;
      });
    },
    remove(id) {
      return withBook(id, async (path) => {
        await rm(join(directory, 'agent-books', 'book-' + id), { recursive: true, force: true });
        let removedLegacy = false;
        try {
          await rm(path + '.json');
          removedLegacy = true;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await rm(path + '.bqr', { force: removedLegacy });
      });
    },
  };
}

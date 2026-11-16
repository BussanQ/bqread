import { createBookHistory } from './book-history.mjs';
import { createBookChat } from './book-chat.mjs';
import { mkdir } from 'node:fs/promises';
import { createBookStore } from './book-store.mjs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const MAX_BODY_SIZE = 80 * 1024 * 1024;
const covers = new Set(['forest', 'clay', 'sand', 'blue', 'plum']);

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function requestBody(request, limit = MAX_BODY_SIZE) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > limit) {
        reject(Object.assign(new Error(limit === MAX_BODY_SIZE ? '书籍数据过大，请选择不超过 10 MB 的 TXT 文件。' : '问题过长。'), { status: 413 }));
        return;
      }
      body += chunk;
    });
    request.on('end', () => resolveBody(body));
    request.on('error', reject);
  });
}

function validateBook(value) {
  if (!value || typeof value !== 'object') throw Object.assign(new Error('书籍数据无效。'), { status: 400 });
  const book = value;
  if (typeof book.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(book.id) || typeof book.title !== 'string' || !book.title.trim() || book.title.length > 100 || typeof book.author !== 'string' || book.author.length > 50 || typeof book.content !== 'string' || !book.content.trim() || Buffer.byteLength(book.content) > 30 * 1024 * 1024 || !Array.isArray(book.chapters) || book.chapters.length === 0 || !book.chapters.every((chapter) => chapter && typeof chapter.title === 'string' && typeof chapter.content === 'string' && Number.isInteger(chapter.start) && chapter.start >= 0 && chapter.start <= book.content.length) || !covers.has(book.cover)) {
    throw Object.assign(new Error('书籍数据不完整，请重新导入。'), { status: 400 });
  }
  return {
    id: book.id,
    title: book.title.trim(),
    author: book.author.trim() || '佚名',
    content: book.content,
    chapters: book.chapters,
    cover: book.cover,
    addedAt: Number.isFinite(book.addedAt) ? book.addedAt : Date.now(),
    lastReadAt: null,
    location: 0,
    sample: false,
  };
}

export function resolveBookDirectory(configured = process.env.BQREAD_DATA_DIR) {
  return resolve(configured || join(homedir(), '.bqread', 'books'));
}

export function createApiHandler(options = {}) {
  const directory = resolveBookDirectory(options.directory);
  const store = createBookStore(directory);
  const history = createBookHistory(directory, createBookChat(store, directory, options.agent));
  return async function apiHandler(request, response, next) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/books')) {
      if (next) return next();
      return json(response, 404, { error: '接口不存在。' });
    }

    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const match = url.pathname.match(/^\/api\/books(?:\/([^/]+)(?:\/(export|toc|chapters|chat))?)?$/);
      if (!match) return json(response, 404, { error: '接口不存在。' });
      const id = match[1] ? decodeURIComponent(match[1]) : null;
      const action = match[2];

      if (id && action === 'chat' && request.method === 'GET') {
        return json(response, 200, await history.list(id, url.searchParams.get('sample') === 'true'));
      }
      if (id && action === 'chat' && request.method === 'POST') {
        const input = JSON.parse(await requestBody(request, 16384));
        const reply = await history.ask(id, input);
        if (!response.destroyed) return json(response, 200, reply);
        return;
      }
      if (!id && request.method === 'GET') return json(response, 200, await store.list());
      if (!id && request.method === 'POST') {
        const book = validateBook(JSON.parse(await requestBody(request)));
        return json(response, 201, await store.save(book));
      }
      if (id && !action && request.method === 'DELETE') {
        await history.removeBook(id, store.remove);
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (id && request.method === 'GET' && (action === 'toc' || action === 'chapters')) {
        const center = url.searchParams.get('center');
        return json(response, 200, await store.read(id, action, center && Number(center)));
      }
      if (id && action === 'export' && request.method === 'GET') {
        const book = await store.read(id, 'export');
        const filename = `${book.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')} - ${book.author.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}.txt`;
        response.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="book.txt"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}`,
          'Cache-Control': 'no-store',
        });
        return response.end(`\uFEFF${book.content}\n`);
      }

      return json(response, 405, { error: '不支持这个操作。' });
    } catch (error) {
      if (response.headersSent) return response.end();
      if (error.code === 'ENOENT') return json(response, 404, { error: '这本书已经不存在。' });
      const status = error instanceof SyntaxError || error instanceof URIError ? 400 : (error.status ?? 500);
      return json(response, status, { error: status === 500 ? '服务端书库暂时不可用，请检查文件夹权限。' : error.message });
    }
  };
}

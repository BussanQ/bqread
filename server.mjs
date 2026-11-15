import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './server/api.mjs';

const root = fileURLToPath(new URL('./dist', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';
const api = createApiHandler();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = createServer((request, response) => {
  if ((request.url ?? '').startsWith('/api/')) {
    void api(request, response);
    return;
  }
  void (async () => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    let file = resolve(root, `.${normalize(pathname)}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error('Not a file');
    } catch {
      file = join(root, 'index.html');
      if (!(await stat(file)).isFile()) throw new Error('Build not found');
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end('Method not allowed');
      return;
    }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  })().catch(() => response.writeHead(404).end('Not found'));
});

server.listen(port, host, () => {
  console.log(`墨读已启动：http://${host}:${server.address().port}`);
  console.log('书籍保存在 ~/.bqread/books/，可通过 BQREAD_DATA_DIR 修改。');
});

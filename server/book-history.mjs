import { createHistory } from './shared/history.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createBookHistory(directory, chat) {
  const folder = join(directory, 'chats');
  const pathFor = key => join(folder, key + '.json');
  return createHistory(chat, {
    async load(key) {
      try { return JSON.parse(await readFile(pathFor(key), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
    },
    async write(key, history) {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const path = pathFor(key);
      const temp = path + '.' + randomUUID();
      try {
        await writeFile(temp, JSON.stringify(history), { flag: 'wx', mode: 0o600 });
        await rename(temp, path);
      } finally { await rm(temp, { force: true }); }
    },
    remove: key => rm(pathFor(key), { force: true }),
  });
}

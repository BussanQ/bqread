import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createBookHistory(directory, chat) {
  const folder = join(directory, 'chats');
  const pending = new Map();

  // A second tab or a reader reopening a book must observe the previous turn's commit.
  async function serialized(id, sample, operation) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || typeof sample !== 'boolean') {
      throw Object.assign(new Error('书籍编号无效。'), { status: 400 });
    }
    const path = join(folder, (sample ? 'sample-' : 'book-') + id + '.json');
    const task = (pending.get(path) ?? Promise.resolve()).catch(() => {}).then(() => operation(path));
    pending.set(path, task);
    try {
      return await task;
    } finally {
      if (pending.get(path) === task) pending.delete(path);
    }
  }

  async function read(path) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { conversation: randomUUID(), session: '', turns: [] };
    }
  }

  return {
    list(id, sample) {
      return serialized(id, sample, async (path) => {
        const { turns } = await read(path);
        return { turns: turns.map(({ question, reply }) => ({ question, reply })) };
      });
    },
    ask(id, input) {
      return serialized(id, input?.sample ?? false, async (path) => {
        const { requestId, conversation } = input ?? {};
        if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId))) {
          throw Object.assign(new Error('对话请求编号无效。'), { status: 400 });
        }
        const history = await read(path);
        if (conversation && conversation !== history.conversation) {
          throw Object.assign(new Error('对话已更新，请重新打开对话面板。'), { status: 409 });
        }
        if (requestId) {
          const index = history.turns.findIndex((turn) => turn.requestId === requestId);
          if (index !== -1) {
            const saved = history.turns[index];
            if (typeof input.question !== 'string' || saved.question !== input.question.trim()) {
              throw Object.assign(new Error('该请求编号已用于其他问题。'), { status: 409 });
            }
            return { ...saved.reply, conversation: history.conversation, index };
          }
        }
        const { session, workspaceId, ...reply } = await chat(id, input, history);
        history.workspaceId = workspaceId;
        history.session = session;
        const index = history.turns.length;
        history.turns.push({ requestId, question: input.question.trim(), reply });

        await mkdir(folder, { recursive: true, mode: 0o700 });
        const temp = path + '.' + randomUUID() + '.tmp';
        try {
          await writeFile(temp, JSON.stringify(history), { flag: 'wx', mode: 0o600 });
          await rename(temp, path);
        } finally {
          await rm(temp, { force: true });
        }
        return { ...reply, conversation: history.conversation, index };
      });
    },
    removeBook(id, removeBook) {
      return serialized(id, false, async (path) => {
        await removeBook(id);
        await rm(path, { force: true });
      });
    },
  };
}

import { newId } from './id.mjs';
export function createHistory(chat, { load, write, remove }) {
  const pending = new Map();
  const outstanding = new Set();

  function historyPath(id, sample) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || typeof sample !== 'boolean') {
      throw Object.assign(new Error('书籍编号无效。'), { status: 400 });
    }
    return (sample ? 'sample-' : 'book-') + id;
  }

  // A second tab or a reader reopening a book must observe the previous turn's commit.
  async function serialized(path, operation) {
    const task = (pending.get(path) ?? Promise.resolve()).catch(() => {}).then(() => operation(path));
    pending.set(path, task);
    try {
      return await task;
    } finally {
      if (pending.get(path) === task) pending.delete(path);
    }
  }

  function newHistory() {
    return { conversation: newId(), turns: [] };
  }

  async function read(path) {
    const saved = await load(path);
    if (saved) return saved;
    const history = newHistory();
    await write(path, history);
    return history;
  }

  return {
    list(id, sample) {
      return serialized(historyPath(id, sample), async (path) => {
        const { turns, conversation } = await read(path);
        return { conversation, turns: turns.map(({ question, reply }) => ({ question, reply })) };
      });
    },
    clear(id, sample, conversation) {
      const path = historyPath(id, sample);
      if (!conversation || typeof conversation !== 'string') throw Object.assign(new Error('缺少对话编号。'), { status: 400 });
      for (const turn of outstanding) {
        if (turn.path === path && turn.conversation === conversation) turn.controller.abort();
      }
      return serialized(path, async () => {
        if ((await read(path)).conversation !== conversation) {
          throw Object.assign(new Error('对话已更新，请重新打开对话面板。'), { status: 409 });
        }
        const history = newHistory();
        await write(path, history);
        return { conversation: history.conversation, turns: [] };
      });
    },
    ask(id, input, onActivity) {
      const path = historyPath(id, input?.sample ?? false);
      const turn = { path, conversation: input?.conversation, controller: new AbortController() };
      outstanding.add(turn);
      return serialized(path, async () => {
        const { requestId, conversation } = input ?? {};
        if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId))) {
          throw Object.assign(new Error('对话请求编号无效。'), { status: 400 });
        }
        const history = await read(path);
        if (turn.controller.signal.aborted || (conversation && conversation !== history.conversation)) {
          throw Object.assign(new Error('对话已更新，请重新打开对话面板。'), { status: 409 });
        }
        if (requestId) {
          const index = history.turns.findIndex((turn) => turn.requestId === requestId);
          if (index !== -1) {
            const saved = history.turns[index];
            if (typeof input.question !== 'string' || saved.question !== input.question.trim() ||
              saved.passage?.start !== input.passage?.start || saved.passage?.end !== input.passage?.end ||
              saved.passage?.fromTitle !== input.passage?.fromTitle ||
              (saved.passage && saved.reply.reference.chapter !== input.chapter + 1)) {
              throw Object.assign(new Error('该请求编号已用于其他问题。'), { status: 409 });
            }
            return { ...saved.reply, conversation: history.conversation, index };
          }
        }
        const steps = new Map();
        turn.conversation = history.conversation;
        const reply = await chat(id, input, history, (step) => {
          steps.set(step.id, step);
          onActivity?.(step);
        }, turn.controller.signal);
        turn.controller.signal.throwIfAborted();
        if (steps.size) reply.activity = [...steps.values()].map((step) => step.status === 'running' ? { ...step, status: 'interrupted' } : step);
        // Older histories can still be read; external agent state is no longer used.
        delete history.workspaceId;
        delete history.session;
        const index = history.turns.length;
        const passage = reply.reference ? { start: input.passage.start, end: input.passage.end, fromTitle: input.passage.fromTitle } : undefined;
        history.turns.push({ requestId, question: input.question.trim(), chapter: input.chapter, passage, reply });

        await write(path, history);
        return { ...reply, conversation: history.conversation, index };
      }).finally(() => outstanding.delete(turn));
    },
    removeBook(id, removeBook, sample = false) {
      const key = historyPath(id, sample);
      for (const turn of outstanding) if (turn.path === key) turn.controller.abort();
      return serialized(key, async (path) => {
        await removeBook(id);
        await remove(path);
      });
    },
  };
}

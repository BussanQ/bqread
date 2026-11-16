import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createBookChat } from '../server/book-chat.mjs';
import { createBookHistory } from '../server/book-history.mjs';
import { createApiHandler, resolveBookDirectory } from '../server/api.mjs';

async function library(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bqread-chat-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, workspace: { id: 'books-workspace', path: await realpath(directory) } };
}

async function listen(handler, t) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

async function readAgentFile(res, workspacePath, turn) {
  const { book } = JSON.parse(turn.message.split('\n').at(-1));
  const file = book.selectionFile || book.currentFile;
  const contents = JSON.parse(await readFile(join(workspacePath, file), 'utf8'));
  const event = (kind, data) => res.write('event: ' + kind + '\ndata: ' + JSON.stringify(data) + '\n\n');
  event('tool_start', { id: 'read', name: 'read_file', arguments: { path: file } });
  event('tool_result', { id: 'read', name: 'read_file', status: 'succeeded' });
  return contents;
}

test('book chat authenticates, uses the selected book, scopes follow-ups and verifies evidence', async (t) => {
  const { directory, workspace } = await library(t);
  const turns = [];
  const quote = '她已经离开这座小岛十五年';
  let workspacePath;
  let readFileResult;
  let reply = { scope: 'book', answer: '十五年。', chapter: 1, quote };
  const upstream = await listen(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    if (req.url.endsWith('/auth')) {
      assert.deepEqual(JSON.parse(data), { password: 'test-only' });
      res.setHeader('set-cookie', 'bqagent_webui_session=test; HttpOnly');
      return res.end('{}');
    }
    if (!req.headers.cookie) return res.writeHead(401).end();
    if (req.url.endsWith('/workspaces')) return res.end(JSON.stringify({
      default: { id: 'project', path: '/project' }, roots: [{ id: 'parent', path: dirname(workspace.path) }],
    }));
    if (req.url.endsWith('/workspaces/open')) {
      const opened = JSON.parse(data);
      assert.equal(opened.root_id, 'parent');
      workspacePath = join(dirname(workspace.path), opened.path);
      assert.ok(workspacePath.startsWith(join(workspace.path, 'agent-books') + '/'));
      return res.end(JSON.stringify({ id: workspace.id, path: workspacePath }));
    }
    assert.equal(req.url, '/api/v1/webui/chat?compact=1');
    turns.push(JSON.parse(data));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    readFileResult = await readAgentFile(res, workspacePath, turns.at(-1));
    res.write('event: turn_start\r\ndata: {"mode":"ask","agent":"bqagent"}\r\n\r\nevent: do');
    res.end('ne\r\ndata: ' + JSON.stringify({ reply: JSON.stringify(reply), workspace_id: workspace.id, mode: 'ask', session_id: 'upstream-session', outcome: { status: 'completed' } }) + '\r\n\r\n');
  }, t);
  const original = process.env.BQREAD_DATA_DIR;
  let handler;
  try {
    delete process.env.BQREAD_DATA_DIR;
    assert.equal(resolveBookDirectory(), join(homedir(), '.bqread', 'books'));
    process.env.BQREAD_DATA_DIR = relative(process.cwd(), directory);
    handler = createApiHandler({ agent: { baseURL: upstream, password: 'test-only' } });
  } finally {
    if (original === undefined) delete process.env.BQREAD_DATA_DIR;
    else process.env.BQREAD_DATA_DIR = original;
  }
  const url = await listen(handler, t);
  const post = (path, body) => fetch(url + '/api/books' + path, { method: 'POST', body: JSON.stringify(body) });
  const question = { chapter: 0, question: '林晚离开多久了？', sample: true, mode: 'run', agent: 'other', workspace_id: 'project' };
  const first = await (await post('/sample-0/chat', question)).json();
  assert.equal(first.answer, reply.answer);
  assert.equal(first.citation.quote, quote);
  assert.equal(turns.length, 1);
  assert.equal('agent_model' in turns[0], false);
  assert.equal(turns[0].mode, 'ask');
  assert.equal(turns[0].workspace_id, workspace.id);
  assert.equal(turns[0].agent, 'bqagent');
  assert.equal(turns[0].session_id, '');
  assert.ok(!turns[0].message.includes(quote));
  assert.ok(readFileResult.blocks.join('').includes(quote));
  assert.ok(!turns[0].message.includes('远方烘焙店'));
  assert.equal((await post('/sample-1/chat', { ...question, conversation: first.conversation })).status, 409);
  reply = { scope: 'unrelated', answer: '不应该显示' };
  const unrelated = await (await post('/sample-0/chat', { ...question, conversation: first.conversation })).json();
  assert.match(unrelated.answer, /只能围绕当前/);
  assert.equal(turns.at(-1).session_id, 'upstream-session');
  reply = { scope: 'book', answer: '不应该显示', chapter: 1, quote: '书里没有的话' };
  const unsupported = await (await post('/sample-0/chat', question)).json();
  assert.match(unsupported.answer, /原文还不足/);
  const body = '门口放着一串铜钥匙。';
  await post('', { id: 'keys', title: '钥匙', author: '作者', content: body, cover: 'blue', chapters: [{ start: 0, title: '正文', content: body }] });
  reply = { scope: 'book', answer: '铜钥匙。', chapter: 1, quote: body };
  const imported = await (await post('/keys/chat', { chapter: 0, question: '门口放着什么？' })).json();
  assert.equal(imported.citation.quote, body);
  assert.ok(!turns.at(-1).message.includes(quote));
  assert.equal((await post('/keys/chat', { chapter: 10, question: '谁？' })).status, 400);
  const passageText = '从这里开始。\n\n  那串铜钥匙留在门口。';
  const longChapter = '风'.repeat(18000) + passageText + '雨'.repeat(6000);
  await post('', { id: 'long', title: '长章', author: '作者', content: longChapter, cover: 'blue', chapters: [{ start: 0, title: '正文', content: longChapter }] });
  const request = { question: '这里写了什么？', chapter: 0, ratio: 0, requestId: 'passage1',
    passage: { start: 18000, end: 18000 + passageText.length } };
  reply = { scope: 'book', chapter: 1, quote: '那串铜钥匙', answer: '这里写到门口的钥匙。' };
  const selected = await (await post('/long/chat', request)).json();
  const reference = { chapter: 1, title: '正文', text: passageText };
  assert.deepEqual(selected.reference, reference);
  assert.equal(selected.citation.quote, reply.quote);
  const context = JSON.parse(turns.at(-1).message.split('\n').at(-1)).book;
  assert.ok(context.selectionFile.startsWith('selections/'));
  assert.deepEqual(readFileResult, reference);
  assert.ok(!turns.at(-1).message.includes(passageText));
  assert.equal(context.excerpts, undefined);
  assert.deepEqual((await (await fetch(url + '/api/books/long/chat')).json()).turns[0].reply.reference, reference);
  assert.equal((await post('/long/chat', { ...request, passage: { start: 0, end: 1 } })).status, 409);
  const calls = turns.length;
  for (const passage of [{ start: -1, end: 10 }, { start: 800, end: 200 }, { start: 0, end: 8001 }, { start: longChapter.length, end: longChapter.length + 1 }]) {
    assert.equal((await post('/long/chat', { ...request, requestId: undefined, passage })).status, 400);
  }
  assert.equal(turns.length, calls);
  for (const [end, expected] of [[2, '文'], [5, '文\n风风']]) {
    reply = { scope: 'book', chapter: 1, quote: '文', answer: '选段以章名开始。' };
    const anchored = await (await post('/long/chat', { ...request, requestId: undefined, passage: { start: 1, end, fromTitle: true } })).json();
    assert.equal(anchored.reference.text, expected);
    assert.equal(anchored.citation.quote, '文');
    assert.equal(readFileResult.text, expected);
  }
  const catalog = JSON.parse(await readFile(join(workspacePath, 'book.json'), 'utf8'));
  assert.equal(catalog.title, '长章');
  const reconstructed = [];
  for (const entry of catalog.chapters) {
    reconstructed.push(...JSON.parse(await readFile(join(workspacePath, entry.file), 'utf8')).blocks);
  }
  assert.equal(reconstructed.join(''), longChapter);
  assert.equal((await fetch(url + '/api/books/long', { method: 'DELETE' })).status, 204);
  await assert.rejects(readFile(join(workspacePath, 'book.json')), { code: 'ENOENT' });
});

test('book history restores the upstream session after restart and serializes retries and concurrent turns', async (t) => {
  const { directory, workspace } = await library(t);
  const calls = [];
  let workspacePath;
  const upstream = await listen(async (req, res) => {
    if (req.url.endsWith('/workspaces')) return res.end(JSON.stringify({ roots: [{ id: 'library', path: workspace.path }] }));
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url.endsWith('/open')) {
      workspacePath = join(workspace.path, body.path);
      return res.end(JSON.stringify({ id: workspace.id, path: workspacePath }));
    }
    assert.equal(body.workspace_id, workspace.id);
    assert.equal(body.mode, 'ask');
    const { question, previous } = JSON.parse(body.message.split('\n').at(-1));
    calls.push({ session: body.session_id, previous });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    await readAgentFile(res, workspacePath, body);
    res.end('event: done\ndata: ' + JSON.stringify({ session_id: 'continued-session', mode: 'ask', workspace_id: workspace.id, reply: JSON.stringify({
      scope: 'book', chapter: 1, quote: '书中原文', answer: question + '的回答',
    }) }) + '\n\n');
  }, t);
  const start = () => listen(createApiHandler({ directory, agent: { baseURL: upstream } }), t);
  let url = await start();
  const post = async (path, data) => {
    const res = await fetch(url + '/api/books' + path, { method: 'POST', body: JSON.stringify(data) });
    assert.ok(res.ok);
    return res.json();
  };
  const history = async (path) => (await (await fetch(url + '/api/books/' + path + '/chat')).json()).turns;
  const book = { id: 'my-book', title: '同名书', author: '作者', content: '书中原文', cover: 'blue', chapters: [{ start: 0, title: '第一章', content: '书中原文' }] };
  await post('', book);
  await post('', { ...book, id: 'other-book' });
  const ask = (question, requestId) => post('/my-book/chat', { chapter: 0, question, requestId });
  const [first, retry] = await Promise.all([ask('问题一', 'first'), ask('问题一', 'first')]);
  assert.deepEqual(first, retry);
  assert.deepEqual(calls, [{ session: '', previous: undefined }]);
  // A pre-workspace history must keep its messages but never reuse the unscoped session.
  const path = join(directory, 'chats', 'book-my-book.json');
  const legacy = JSON.parse(await readFile(path, 'utf8'));
  delete legacy.workspaceId;
  legacy.session = 'old-unscoped-session';
  await writeFile(path, JSON.stringify(legacy));
  url = await start();
  const saved = await history('my-book');
  assert.deepEqual(saved, [{ question: '问题一', reply: { answer: '问题一的回答', citation: { title: '第一章', quote: '书中原文' },
    activity: [{ id: 1, action: 'read', target: '第一章', status: 'done' }] } }]);
  await Promise.all([ask('问题二', 'second'), ask('问题三', 'third')]);
  assert.deepEqual(calls, [
    { session: '', previous: undefined },
    { session: '', previous: [{ question: '问题一', answer: '问题一的回答' }] },
    { session: 'continued-session', previous: undefined },
  ]);
  assert.equal((await history('my-book')).length, 3);
  assert.deepEqual(await history('other-book'), []);
  await post('/other-book/chat', { chapter: 0, question: '另一本书的问题' });
  const resetResponse = await fetch(url + '/api/books/my-book/chat', {
    method: 'DELETE', body: JSON.stringify({ conversation: first.conversation }),
  });
  assert.equal(resetResponse.status, 200);
  const reset = await resetResponse.json();
  assert.notEqual(reset.conversation, first.conversation);
  assert.deepEqual(reset.turns, []);
  url = await start();
  assert.deepEqual(await (await fetch(url + '/api/books/my-book/chat')).json(), reset);
  assert.equal((await history('other-book')).length, 1);
  const stale = await fetch(url + '/api/books/my-book/chat', {
    method: 'POST', body: JSON.stringify({ chapter: 0, question: '旧请求', conversation: first.conversation }),
  });
  assert.equal(stale.status, 409);
  const fresh = await post('/my-book/chat', { chapter: 0, question: '新问题', conversation: reset.conversation });
  assert.equal(fresh.index, 0);
  assert.deepEqual(calls.at(-1), { session: '', previous: undefined });
  assert.equal((await fetch(url + '/api/books/my-book', { method: 'DELETE' })).status, 204);
  await post('', book);
  assert.deepEqual(await history('my-book'), []);
});

test('clearing while answering cancels both running and queued questions of the old conversation', async (t) => {
  const { directory } = await library(t);
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  let calls = 0;
  const history = createBookHistory(directory, async (_id, _input, _history, _onActivity, signal) => {
    calls++;
    notify();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const { conversation } = await history.list('sample-0', true);
  const input = { conversation, sample: true, question: '旧问题' };
  const active = assert.rejects(history.ask('sample-0', input), /aborted/);
  await started;
  const queued = assert.rejects(history.ask('sample-0', input), /对话已更新/);
  const reset = await history.clear('sample-0', true, conversation);
  await Promise.all([active, queued]);
  assert.equal(calls, 1);
  assert.deepEqual(await history.list('sample-0', true), reset);
  assert.notEqual(reset.conversation, conversation);
});

test('book chat fails closed on workspace or mode mismatch, and stops only inside the book workspace', async (t) => {
  const { directory, workspace } = await library(t);
  let scenario = 'wrong-path';
  let chats = 0;
  let stops = 0;
  const upstream = await listen(async (req, res) => {
    if (req.url.endsWith('/workspaces')) return res.end(JSON.stringify({
      roots: [{ id: 'parent', path: dirname(workspace.path) }], default: { id: 'project', path: '/project' },
    }));
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url.endsWith('/open')) return res.end(JSON.stringify({ id: workspace.id, path: scenario === 'wrong-path' ? '/other' : join(dirname(workspace.path), body.path) }));
    assert.equal(body.workspace_id, workspace.id);
    if (req.url.endsWith('/stop')) {
      stops++;
      return res.end('{}');
    }
    chats++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (scenario === 'outside' || scenario === 'web') {
      const call = scenario === 'outside' ? { name: 'read_file', arguments: { path: '../chats/private.json' } } : { name: 'web_search' };
      return res.end('event: tool_start\ndata: ' + JSON.stringify({ ...call, id: 'forbidden' }) + '\n\n');
    }
    const event = scenario === 'wrong-mode'
      ? 'event: turn_start\ndata: {"mode":"run","agent":"bqagent"}'
      : 'event: done\ndata: {"mode":"ask","workspace_id":"project","reply":"wrong workspace"}';
    res.end(event + '\n\n');
  }, t);
  const chat = createBookChat(null, directory, { baseURL: upstream });
  const ask = () => chat('sample-0', { question: '这一章讲了什么？', sample: true, chapter: 0 });
  await assert.rejects(ask, /未确认指定的书库工作区/);
  assert.equal(chats, 0);
  scenario = 'wrong-mode';
  await assert.rejects(ask, /Ask 模式/);
  scenario = 'wrong-response-workspace';
  await assert.rejects(ask, /工作区与书库不符/);
  assert.equal(stops, 2);
  for (scenario of ['outside', 'web']) {
    const refused = await ask();
    assert.match(refused.answer, /只能围绕当前/);
    assert.equal(refused.session, '');
  }
  assert.equal(stops, 4);
});

test('streams actual book lookups before the answer and reports mid-stream errors', async (t) => {
  const { directory, workspace } = await library(t);
  let resume;
  let fail = false;
  const upstream = await listen(async (req, res) => {
    if (req.url.endsWith('/workspaces')) return res.end(JSON.stringify({ roots: [{ id: 'library', path: workspace.path }] }));
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (req.url.endsWith('/open')) return res.end(JSON.stringify({ id: workspace.id, path: join(workspace.path, JSON.parse(raw).path) }));
    if (req.url.endsWith('/stop')) return res.end('{}');
    const event = (type, data) => res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    event('tool_start', { id: 'a', name: 'grep', arguments: { path: 'chapters', pattern: '林晚|灯塔' } });
    if (fail) {
      event('error', {});
      return res.end();
    }
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 3000);
      resume = () => { clearTimeout(timeout); resolve(); };
    });
    event('tool_start', { id: 'b', name: 'read_file', arguments: { path: 'chapters/00001.json' } });
    event('tool_result', { id: 'b', name: 'read_file', status: 'succeeded', preview: 'private tool output' });
    event('tool_result', { id: 'a', name: 'grep', status: 'succeeded', preview: 'No matches found.' });
    event('done', { mode: 'ask', workspace_id: workspace.id, reply: JSON.stringify({ scope: 'book', chapter: 1, quote: '凌晨四点', answer: '凌晨四点。' }) });
    res.end();
  }, t);
  const url = await listen(createApiHandler({ directory, agent: { baseURL: upstream } }), t) + '/api/books/sample-0/chat';
  const ask = () => fetch(url, { method: 'POST', headers: { Accept: 'application/x-ndjson' },
    body: JSON.stringify({ question: '故事何时开始？', chapter: 0, sample: true }) });
  const response = await ask();
  assert.match(response.headers.get('Content-Type'), /ndjson/);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let raw = '';
  while (!raw.includes('\n')) raw += (await reader.read()).value;
  assert.deepEqual(JSON.parse(raw), { type: 'activity', step: { id: 1, action: 'search', query: '林晚|灯塔', target: '本书章节', status: 'running' } });
  resume();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    raw += next.value;
  }
  assert.ok(!raw.includes('private tool output'));
  const frames = raw.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(frames.map(frame => frame.step?.status || frame.type), ['running', 'running', 'done', 'empty', 'done']);
  const steps = frames.at(-1).reply.activity;
  assert.deepEqual(steps.map(step => [step.target, step.status]), [['本书章节', 'empty'], ['第一章 灯塔亮起', 'done']]);
  assert.deepEqual((await (await fetch(url + '?sample=true')).json()).turns[0].reply.activity, steps);
  fail = true;
  const failedFrames = (await (await ask()).text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(failedFrames.map(frame => frame.type), ['activity', 'error']);
});

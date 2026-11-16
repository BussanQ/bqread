import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createBookChat } from '../server/book-chat.mjs';
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

test('book chat authenticates, uses the selected book, scopes follow-ups and verifies evidence', async (t) => {
  const { directory, workspace } = await library(t);
  const turns = [];
  const quote = '她已经离开这座小岛十五年';
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
      assert.deepEqual(JSON.parse(data), { root_id: 'parent', path: basename(workspace.path) });
      return res.end(JSON.stringify(workspace));
    }
    assert.equal(req.url, '/api/v1/webui/chat?compact=1');
    turns.push(JSON.parse(data));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
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
  assert.ok(turns[0].message.includes(quote));
  assert.ok(!turns[0].message.includes('远方烘焙店'));
  assert.equal((await post('/sample-1/chat', { ...question, conversation: first.conversation })).status, 409);
  reply = { scope: 'unrelated', answer: '不应该显示' };
  const unrelated = await (await post('/sample-0/chat', { ...question, conversation: first.conversation })).json();
  assert.match(unrelated.answer, /只能围绕当前/);
  assert.equal(turns.at(-1).session_id, 'upstream-session');
  reply = { scope: 'book', answer: '不应该显示', chapter: 1, quote: '书里没有的话' };
  const unsupported = await (await post('/sample-0/chat', question)).json();
  assert.match(unsupported.answer, /片段还不足/);
  const body = '门口放着一串铜钥匙。';
  await post('', { id: 'keys', title: '钥匙', author: '作者', content: body, cover: 'blue', chapters: [{ start: 0, title: '正文', content: body }] });
  reply = { scope: 'book', answer: '铜钥匙。', chapter: 1, quote: body };
  const imported = await (await post('/keys/chat', { chapter: 0, question: '门口放着什么？' })).json();
  assert.equal(imported.citation.quote, body);
  assert.ok(!turns.at(-1).message.includes(quote));
  assert.equal((await post('/keys/chat', { chapter: 10, question: '谁？' })).status, 400);
});

test('book history restores the upstream session after restart and serializes retries and concurrent turns', async (t) => {
  const { directory, workspace } = await library(t);
  const calls = [];
  const upstream = await listen(async (req, res) => {
    if (req.url.endsWith('/workspaces')) return res.end(JSON.stringify({ default: workspace }));
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.workspace_id, workspace.id);
    assert.equal(body.mode, 'ask');
    const { question, previous } = JSON.parse(body.message.split('\n').at(-1));
    calls.push({ session: body.session_id, previous });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
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
  assert.deepEqual(saved, [{ question: '问题一', reply: { answer: '问题一的回答', citation: { title: '第一章', quote: '书中原文' } } }]);
  await Promise.all([ask('问题二', 'second'), ask('问题三', 'third')]);
  assert.deepEqual(calls, [
    { session: '', previous: undefined },
    { session: '', previous: [{ question: '问题一', answer: '问题一的回答' }] },
    { session: 'continued-session', previous: undefined },
  ]);
  assert.equal((await history('my-book')).length, 3);
  assert.deepEqual(await history('other-book'), []);
  assert.equal((await fetch(url + '/api/books/my-book', { method: 'DELETE' })).status, 204);
  await post('', book);
  assert.deepEqual(await history('my-book'), []);
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
    if (req.url.endsWith('/open')) return res.end(JSON.stringify(scenario === 'wrong-path' ? { ...workspace, path: '/other' } : workspace));
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.workspace_id, workspace.id);
    if (req.url.endsWith('/stop')) {
      stops++;
      return res.end('{}');
    }
    chats++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
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
});

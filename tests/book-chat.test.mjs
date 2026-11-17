import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBookChat } from '../server/book-chat.mjs';
import { createBookHistory } from '../server/book-history.mjs';
import { createApiHandler } from '../server/api.mjs';

async function library(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bqread-chat-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function listen(handler, t) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return 'http://127.0.0.1:' + server.address().port;
}

function completion(content) {
  return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }] };
}
function calls(...entries) {
  return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
    tool_calls: entries.map(([name, args], i) => ({ id: 'call-' + i, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] };
}
function inputOf(body) {
  for (const message of body.messages.toReversed()) {
    if (message.role !== 'user') continue;
    try { const data = JSON.parse(message.content); if (data.book) return data; } catch {}
  }
  throw new Error('Missing book context');
}

async function model(t, respond) {
  const requests = [];
  const url = await listen(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    assert.equal(body.model, 'test-model');
    assert.equal(body.stream, false);
    const result = await respond(body, res, requests.length);
    if (!res.writableEnded && !res.destroyed && result !== undefined) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    }
  }, t);
  return { ai: { baseURL: url + '/v1/', apiKey: 'test-key', model: 'test-model' }, requests };
}

async function api(t, directory, ai) {
  const url = await listen(createApiHandler({ directory, ai }), t) + '/api/books';
  const post = (path, body, headers) => fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { url, post };
}
const savedBook = { id: 'keys', title: '钥匙', author: '作者', content: '第一章\n门口放着一串铜钥匙。', cover: 'blue',
  chapters: [{ start: 0, title: '第一章', content: '门口放着一串铜钥匙。' }] };
const answer = (text = '铜钥匙。') => completion({ scope: 'book', answer: text, chapter: 1, quote: '铜钥匙' });
function readThenAnswer(body) {
  return body.messages.at(-1).role === 'tool' ? answer(inputOf(body).question + '的回答') : calls(['read_chapter', { chapter: 1 }]);
}

test('direct model calls search the entire selected book and verify actual returned evidence', async t => {
  const directory = await library(t);
  const quote = '她已经离开这座小岛十五年';
  const { ai, requests } = await model(t, body => {
    const last = body.messages.at(-1);
    if (last.role === 'user') return calls(['read_catalog', {}]);
    const result = JSON.parse(last.content);
    if (result.chapters) return calls(['search_book', { query: '十五年' }]);
    assert.ok(result.matches.some(match => match.text.includes(quote)));
    return completion({ scope: 'book', answer: '十五年。', chapter: 1, quote });
  });
  const { post } = await api(t, directory, ai);
  const response = await post('/sample-0/chat', { chapter: 0, question: '林晚离开多久了？', sample: true,
    model: 'ignored', baseURL: 'http://invalid', workspace_id: 'ignored' });
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.answer, '十五年。');
  assert.equal(reply.citation.quote, quote);
  assert.deepEqual(reply.activity.map(s => s.action), ['read', 'search']);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[0].tools.map(t => t.function.name), ['read_catalog', 'read_chapter', 'search_book', 'book_stats']);
  assert.ok(!JSON.stringify(requests[0]).includes(quote));
  assert.equal('session_id' in requests[0], false);
  assert.deepEqual(await readdir(directory), ['chats']);
});

test('actual statistics use the complete imported text and do not require a fictional quotation', async t => {
  const directory = await library(t);
  let wantedChapter;
  const { ai, requests } = await model(t, body => {
    if (body.messages.at(-1).role === 'tool') {
      const result = JSON.parse(body.messages.at(-1).content);
      assert.equal(result.han, wantedChapter ? 3 : 6);
      return completion({ scope: 'statistics', chapter: wantedChapter, answer: '错误的 999 万字' });
    }
    return calls(['book_stats', wantedChapter ? { chapter: wantedChapter } : {}]);
  });
  const { post } = await api(t, directory, ai);
  await post('', { ...savedBook, content: '第一章\n甲乙， A1🌙\n\t𠮷', chapters: [{ start: 0, title: '第一章', content: '甲乙， A1🌙\n\t𠮷' }] });
  const full = await (await post('/keys/chat', { chapter: 0, question: '你实际计算下这本书有多少字' })).json();
  assert.match(full.answer, /汉字数：6 字/);
  assert.match(full.answer, /非空白字符数：10 个/);
  assert.match(full.answer, /总字符数：14 个/);
  assert.ok(!full.answer.includes('999'));
  assert.equal(full.citation, undefined);
  assert.match(full.activity[0].target, /全书.*字数统计/);
  wantedChapter = 1;
  const chapter = await (await post('/keys/chat', { chapter: 0, question: '当前章呢？' })).json();
  assert.match(chapter.answer, /汉字数：3 字/);
  assert.match(chapter.answer, /不包含单独保存的章节标题/);
  assert.equal(requests.length, 4);
  assert.deepEqual((await readdir(directory)).sort(), ['chats', 'keys.bqr']);
});

test('selected text is verified locally, survives follow-ups and supports title selections', async t => {
  const directory = await library(t);
  const selection = '从这里开始。\n\n  那串铜钥匙留在门口。';
  let expected = selection;
  const { ai, requests } = await model(t, body => {
    const { selection: ref } = inputOf(body);
    assert.equal(ref.text, expected);
    return completion({ scope: 'book', chapter: 1, quote: expected === selection ? '那串铜钥匙' : '一章', answer: '这是选中的文字。' });
  });
  const { url, post } = await api(t, directory, ai);
  const content = '风'.repeat(18000) + selection + '雨'.repeat(6000);
  await post('', { ...savedBook, content, chapters: [{ start: 0, title: '第一章', content }] });
  const question = { chapter: 0, question: '这里写了什么？', requestId: 'selection1', passage: { start: 18000, end: 18000 + selection.length } };
  const first = await (await post('/keys/chat', question)).json();
  assert.deepEqual(first.reference, { chapter: 1, title: '第一章', text: selection });
  assert.equal(first.citation.quote, '那串铜钥匙');
  assert.equal((await post('/keys/chat', { ...question, passage: { start: 0, end: 1 } })).status, 409);
  assert.equal(requests.length, 1);
  for (const passage of [{ start: -1, end: 1 }, { start: 0, end: 8001 }, { start: 0, end: 50000 }, null]) {
    assert.equal((await post('/keys/chat', { ...question, requestId: undefined, passage })).status, 400);
  }
  expected = '一章';
  const title = await (await post('/keys/chat', { chapter: 0, question: '章名呢？', passage: { start: 1, end: 3, fromTitle: true } })).json();
  assert.equal(title.reference.text, expected);
  assert.equal(JSON.parse(requests.at(-1).messages[1].content).selection.text, selection);
  const history = await (await fetch(url + '/keys/chat')).json();
  assert.equal(history.turns[0].reply.reference.text, selection);
  assert.equal((await fetch(url + '/keys', { method: 'DELETE' })).status, 204);
  assert.deepEqual((await (await fetch(url + '/keys/chat')).json()).turns, []);
});

test('history persists locally, imports legacy dialogue, serializes retries and isolates books', async t => {
  const directory = await library(t);
  const { ai, requests } = await model(t, readThenAnswer);
  let { url, post } = await api(t, directory, ai);
  await post('', savedBook);
  await post('', { ...savedBook, id: 'other' });
  const ask = (question, requestId) => post('/keys/chat', { chapter: 0, question, requestId }).then(r => r.json());
  const [first, retry] = await Promise.all([ask('问题一', 'first'), ask('问题一', 'first')]);
  assert.deepEqual(first, retry);
  assert.equal(requests.length, 2);
  const path = join(directory, 'chats', 'book-keys.json');
  const legacy = JSON.parse(await readFile(path, 'utf8'));
  legacy.session = 'old-upstream-session';
  legacy.workspaceId = 'old-workspace';
  await writeFile(path, JSON.stringify(legacy));
  ({ url, post } = await api(t, directory, ai));
  await Promise.all([ask('问题二', 'second'), ask('问题三', 'third')]);
  const initials = requests.filter(body => body.messages.at(-1).role === 'user');
  assert.deepEqual(initials.map(body => body.messages.filter(m => m.role === 'assistant').length), [0, 1, 2]);
  assert.deepEqual(JSON.parse(initials[1].messages[2].content), { answer: '问题一的回答',
    citation: { title: '第一章', quote: '铜钥匙' } });
  assert.ok(!JSON.stringify(initials).includes('old-upstream-session'));
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.session, undefined);
  assert.equal(saved.workspaceId, undefined);
  assert.equal(saved.turns.length, 3);
  const other = await (await fetch(url + '/other/chat')).json();
  assert.deepEqual(other.turns, []);
  assert.equal((await post('/other/chat', { chapter: 0, question: '跨书重用', conversation: first.conversation })).status, 409);
  const resetResponse = await fetch(url + '/keys/chat', { method: 'DELETE', body: JSON.stringify({ conversation: first.conversation }) });
  const reset = await resetResponse.json();
  assert.notEqual(reset.conversation, first.conversation);
  assert.deepEqual(reset.turns, []);
  assert.equal((await post('/keys/chat', { chapter: 0, question: '旧请求', conversation: first.conversation })).status, 409);
  await ask('新问题', 'fresh');
  assert.equal(requests.at(-2).messages.length, 2);
  ({ url, post } = await api(t, directory, ai));
  assert.equal((await (await fetch(url + '/keys/chat')).json()).turns.length, 1);
  await fetch(url + '/keys', { method: 'DELETE' });
  await post('', savedBook);
  assert.deepEqual((await (await fetch(url + '/keys/chat')).json()).turns, []);
});

test('clearing cancels the model request and does not save unfinished dialogue', async t => {
  const directory = await library(t);
  let notify;
  let closed;
  const started = new Promise(resolve => { notify = resolve; });
  const disconnected = new Promise(resolve => { closed = resolve; });
  const { ai } = await model(t, async (_body, res) => {
    res.on('close', closed);
    notify();
    return undefined;
  });
  const { url, post } = await api(t, directory, ai);
  const { conversation } = await (await fetch(url + '/sample-0/chat?sample=true')).json();
  const response = post('/sample-0/chat', { sample: true, chapter: 0, question: '旧问题', conversation });
  await started;
  const reset = await fetch(url + '/sample-0/chat?sample=true', { method: 'DELETE', body: JSON.stringify({ conversation }) });
  assert.equal(reset.status, 200);
  assert.equal((await response).status, 502);
  await disconnected;
  assert.deepEqual((await (await fetch(url + '/sample-0/chat?sample=true')).json()).turns, []);
});

test('clearing while answering cancels queued questions of the old conversation', async t => {
  const directory = await library(t);
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  let count = 0;
  const history = createBookHistory(directory, async (_id, _input, _history, _onActivity, signal) => {
    count++;
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
  assert.equal(count, 1);
  assert.deepEqual(await history.list('sample-0', true), reset);
});

test('tool argument errors are returned to the model and complete call batches retain reasoning', async t => {
  const directory = await library(t);
  const { ai } = await model(t, (body, _res, count) => {
    if (count === 1) {
      const response = calls(['read_file', { path: '../private' }], ['read_chapter', { chapter: 1 }]);
      response.choices[0].message.reasoning_content = 'provider reasoning state';
      response.choices[0].message.tool_calls[1].function.arguments = '{';
      return response;
    }
    if (count === 2) {
      assert.equal(body.messages.at(-3).reasoning_content, 'provider reasoning state');
      assert.deepEqual(body.messages.slice(-2).map(m => m.tool_call_id), ['call-0', 'call-1']);
      assert.match(JSON.parse(body.messages.at(-2).content).error, /不支持/);
      assert.match(JSON.parse(body.messages.at(-1).content).error, /JSON/);
      return calls(['read_chapter', { chapter: 1 }]);
    }
    return answer();
  });
  const { post } = await api(t, directory, ai);
  await post('', savedBook);
  const response = await post('/keys/chat', { chapter: 0, question: '门口有什么？' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).answer, '铜钥匙。');
});

test('invalid evidence is corrected once and failures report the actual reason', async t => {
  const directory = await library(t);
  let scenario = 'correctable';
  const { ai, requests } = await model(t, body => {
    if (scenario === 'correctable') {
      if (body.messages.at(-1).role === 'tool') return answer();
      if (body.messages.length > 2) return calls(['read_chapter', { chapter: 1 }]);
      return answer(); // A quotation alone is not evidence that the model looked it up.
    }
    if (scenario === 'unrelated') return completion({ scope: 'unrelated' });
    if (scenario === 'statistics') return completion({ scope: 'statistics' });
    if (scenario === 'insufficient') {
      return body.messages.at(-1).role === 'tool'
        ? completion({ scope: 'insufficient', reason: '已搜索本书，未找到这位人物的名字。' })
        : calls(['search_book', { query: '不存在的人物' }]);
    }
    return completion({ scope: 'book', answer: '不应展示', chapter: 1, quote: '捏造的引文' });
  });
  const { url, post } = await api(t, directory, ai);
  await post('', savedBook);
  const ask = () => post('/keys/chat', { chapter: 0, question: '问题' });
  assert.equal((await ask()).status, 200);
  assert.equal(requests.length, 3);
  scenario = 'invalid';
  const invalid = await ask();
  assert.equal(invalid.status, 502);
  assert.match((await invalid.json()).error, /引文不在本轮/);
  scenario = 'statistics';
  const uncounted = await ask();
  assert.equal(uncounted.status, 502);
  assert.match((await uncounted.json()).error, /尚未实际统计/);
  scenario = 'unrelated';
  assert.match((await (await ask()).json()).answer, /只能围绕当前/);
  scenario = 'insufficient';
  assert.equal((await (await ask()).json()).answer, '已搜索本书，未找到这位人物的名字。');
  assert.equal((await (await fetch(url + '/keys/chat')).json()).turns.length, 3);
});

test('lookup activity streams before the model answer and upstream failures become error frames', async t => {
  const directory = await library(t);
  let resume;
  let fail = false;
  const { ai } = await model(t, async (body, res) => {
    if (body.messages.at(-1).role === 'user') return calls(['read_chapter', { chapter: 1 }]);
    if (fail) { res.writeHead(500).end('private upstream detail'); return; }
    await new Promise(resolve => { resume = resolve; });
    return answer();
  });
  const { url, post } = await api(t, directory, ai);
  await post('', savedBook);
  const ask = () => post('/keys/chat', { chapter: 0, question: '门口是什么？' }, { Accept: 'application/x-ndjson' });
  const response = await ask();
  assert.match(response.headers.get('Content-Type'), /ndjson/);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let raw = '';
  while (!raw.includes('\n')) raw += (await reader.read()).value;
  assert.equal(JSON.parse(raw.split('\n')[0]).step.status, 'running');
  // Wait for the second model request without blocking the activity stream assertion.
  while (!resume) await new Promise(resolve => setImmediate(resolve));
  resume();
  while (true) { const next = await reader.read(); if (next.done) break; raw += next.value; }
  const frames = raw.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(frames.map(frame => frame.step?.status || frame.type), ['running', 'done', 'done']);
  assert.equal(frames.at(-1).reply.citation.quote, '铜钥匙');
  fail = true;
  const failed = (await (await ask()).text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(failed.map(frame => frame.type), ['activity', 'activity', 'error']);
  assert.match(failed.at(-1).error, /HTTP 500/);
  assert.ok(!JSON.stringify(failed).includes('private upstream'));
  assert.equal((await (await fetch(url + '/keys/chat')).json()).turns.length, 1);
});

test('model errors, truncated output, missing configuration and turn limits fail explicitly', async t => {
  const directory = await library(t);
  let scenario = 'unauthorized';
  const { ai } = await model(t, (_body, res) => {
    if (scenario === 'unauthorized') { res.writeHead(401).end('secret'); return; }
    if (scenario === 'limited') { res.writeHead(429).end(); return; }
    if (scenario === 'invalid-json') { res.end('{'); return; }
    if (scenario === 'truncated') return { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] };
    if (scenario === 'loop') return calls(['read_catalog', {}]);
    return { choices: [{ finish_reason: 'tool_calls', message: { content: null } }] };
  });
  const chat = createBookChat(null, ai);
  const question = { chapter: 0, question: '问题', sample: true };
  for (const [state, expected] of [['unauthorized', /认证失败/], ['limited', /额度不足/], ['invalid-json', /无效的 JSON/],
    ['truncated', /长度上限/], ['invalid-call', /完整的工具调用/], ['loop', /次数已达上限/]]) {
    scenario = state;
    await assert.rejects(chat('sample-0', question), expected);
  }
  await assert.rejects(createBookChat(null, { ...ai, model: '' })('sample-0', question), /BQREAD_AI_MODEL/);
  await assert.rejects(createBookChat(null, { ...ai, baseURL: 'file:///private' })('sample-0', question), /BASE_URL 无效/);
  for (const invalid of [{ ...question, chapter: -1 }, { ...question, question: '' }, { ...question, ratio: 2 }, { ...question, sample: 'yes' }]) {
    await assert.rejects(chat('sample-0', invalid), { status: 400 });
  }
});

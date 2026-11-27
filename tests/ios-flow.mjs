// Run after ios:sync. Exercise the bundled UI without a Node backend or real credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect } from '@playwright/test';

const db = new DatabaseSync(':memory:');
const secrets = new Map();
const calls = [];
const unexpectedRequests = [];
const methods = {
  CapacitorSQLite: ['checkConnectionsConsistency','createConnection','isDBOpen','open','execute','executeSet','query'],
  SecureStoragePlugin: ['keys','get','set'],
  CapacitorHttp: ['post'],
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.exposeFunction('bridgeCall', (plugin, method, args) => {
    if (plugin === 'CapacitorSQLite') {
      if (method === 'execute') { db.exec(args.statements); return { changes: {} }; }
      if (method === 'query') return { values: db.prepare(args.statement).all(...args.values) };
      if (method === 'executeSet') {
        db.exec('BEGIN');
        try {
          for (const { statement, values } of args.set) db.prepare(statement).run(...values);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return { changes: {} };
      }
      if (method === 'checkConnectionsConsistency' || method === 'isDBOpen') return { result: false };
      return {};
    }
    if (plugin === 'SecureStoragePlugin') {
      if (method === 'keys') return { value: [...secrets.keys()] };
      if (method === 'get') return { value: secrets.get(args.key) };
      secrets.set(args.key, args.value);
      return { value: true };
    }
    assert.equal(plugin, 'CapacitorHttp');
    assert.equal(args.url, 'https://model.invalid/v1/chat/completions');
    assert.equal(args.headers.Authorization, 'Bearer test-only');
    assert.equal(args.disableRedirects, true);
    calls.push(args.data);
    const message = calls.length === 1
      ? { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_chapter', arguments: '{"chapter":2}' } }] }
      : { role: 'assistant', content: JSON.stringify({ scope: 'book', answer: '他在海边。', chapter: 2, quote: '在海边' }) };
    return { status: 200, data: { choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] } };
  });
  await page.addInitScript((methods) => {
    window.webkit = { messageHandlers: { bridge: {} } };
    window.Capacitor = {
      nativePromise: window.bridgeCall,
      PluginHeaders: Object.entries(methods).map(([name, entries]) => ({ name, methods: entries.map(name => ({ name, rtype: 'promise' })) })),
    };
  }, methods);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://reader.test' || !(url.pathname === '/' || /^\/assets\/[\w.-]+$/.test(url.pathname))) {
      unexpectedRequests.push(url.href);
      return route.abort();
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    await route.fulfill({ body: await readFile(new URL('../ios/App/App/public' + path, import.meta.url)),
      contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.woff2') ? 'font/woff2' : 'text/html' });
  });
  await page.goto('https://reader.test/');
  await page.locator('[data-action=import]').first().click();
  await page.locator('#novel-file').setInputFiles({ name: '旅行.txt', mimeType: 'text/plain',
    buffer: Buffer.from('第一章 出发\n他离开小镇。\n第二章 抵达\n他在海边。') });
  await page.locator('[data-action=submit-import]').click();
  const book = page.getByRole('button', { name: '阅读《旅行》' });
  await book.click();
  await page.locator('[data-action=next]').click();
  await expect(page.locator('.reading-chapter-title')).toHaveText('第二章 抵达');
  await page.reload();
  await book.click();
  await expect(page.locator('.reading-chapter-title')).toHaveText('第二章 抵达');
  await page.getByRole('button', { name: '返回书架' }).click();
  await page.getByRole('button', { name: 'AI 提供商', exact: true }).click();
  await page.getByRole('button', { name: /^API 协议 / }).click();
  await page.getByRole('option', { name: 'OpenAI Chat Completions' }).click();
  await page.getByLabel('API 基础地址').fill('https://model.invalid/v1');
  await page.getByLabel('API 密钥', { exact: true }).fill('test-only');
  await page.getByRole('combobox', { name: '模型', exact: true }).fill('fixture');
  await page.getByRole('button', { name: '保存并使用' }).click();
  await expect(page.locator('.provider-current')).toContainText('fixture');
  await page.getByRole('button', { name: '关闭 AI 提供商设置' }).click();
  await book.click();
  await page.locator('.chat-toggle').click();
  await page.locator('#chat-input').fill('他在哪里？');
  await page.locator('.chat-send').click();
  await expect(page.locator('.chat-answer')).toContainText('他在海边');
  assert.match(calls[1].messages.at(-1).content, /在海边/);
  await page.reload();
  await book.click();
  await page.locator('.chat-toggle').click();
  await expect(page.locator('.chat-answer')).toContainText('他在海边');
  await page.locator('.chat-clear').click();
  await expect(page.locator('.chat-answer')).toHaveCount(0);
  assert.equal(calls.length, 2);
  assert.deepEqual(unexpectedRequests, []);
  console.log('Passed: local TXT import, chapter restore, provider configuration, model tool call, history restore and clear.');
} finally {
  await browser.close();
  db.close();
}

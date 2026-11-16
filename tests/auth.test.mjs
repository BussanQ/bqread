import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function start(context, token = '') {
  const directory = await mkdtemp(join(tmpdir(), 'bqread-auth-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BQREAD_TOKEN: token, BQREAD_DATA_DIR: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  async function close() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
  context.after(close);
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Server exited: ${output}`)); });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timeout);
        resolve(new URL(match[0]));
      }
    });
  });
  return { url, close };
}

function cookie(response) {
  const value = response.headers.get('set-cookie');
  assert.match(value, /; Path=\/; HttpOnly; SameSite=Strict$/);
  return value.split(';')[0];
}

test('production startup generates a new token and invalidates old access after restart', async (context) => {
  const first = await start(context);
  const token = first.url.searchParams.get('token');
  assert.match(token, /^[a-f0-9]{64}$/);
  const login = await fetch(new URL(`/api/books?token=${token}`, first.url));
  assert.equal(login.status, 200);
  const session = cookie(login);
  await first.close();

  const second = await start(context);
  assert.notEqual(second.url.searchParams.get('token'), token);
  assert.equal((await fetch(new URL(`/?token=${token}`, second.url))).status, 401);
  assert.equal((await fetch(new URL('/api/books', second.url), { headers: { Cookie: session } })).status, 401);
});

test('fixed environment token protects UI, assets and API and establishes a browser session', async (context) => {
  const token = 'test token /+?&=中文';
  const { url } = await start(context, token);
  assert.equal(url.searchParams.get('token'), token);
  for (const [path, method] of [['/', 'GET'], ['/assets/app.js', 'GET'], ['/api/books', 'GET'], ['/api/books', 'POST'], ['/api/books/missing/export', 'GET'], ['/api/books/missing', 'DELETE']]) {
    assert.equal((await fetch(new URL(path, url), { method })).status, 401, `${method} ${path}`);
  }
  assert.equal((await fetch(new URL('/?token=wrong', url))).status, 401);
  const login = await fetch(new URL(`/api/books?${url.searchParams}`, url));
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await login.json(), []);
  const session = cookie(login);
  assert.equal((await fetch(new URL('/api/books', url), { headers: { Cookie: `other=1; ${session}` } })).status, 200);
  assert.equal((await fetch(new URL('/api/books', url), { headers: { Cookie: `${session}wrong` } })).status, 401);
  assert.equal((await fetch(new URL('/api/books?token=wrong', url), { headers: { Cookie: session } })).status, 401);
});

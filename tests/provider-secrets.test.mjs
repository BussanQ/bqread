import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createProviders } from '../server/providers.mjs';

const connection = { name: '本地模型', protocol: 'responses', model: 'reader', preset: 'custom', baseURL: 'http://localhost:8080/v1' };

async function library(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bqread-secrets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const folder = join(dir, 'settings');
  return { dir, folder, config: join(folder, 'ai-providers.json'), key: join(folder, '.config.key'), store: createProviders(dir) };
}

test('legacy keys migrate together, remain masked, and survive edits and restart', async t => {
  const { dir, folder, config, key, store } = await library(t);
  await mkdir(folder);
  const oldKey = 'example-legacy-token';
  const profiles = [oldKey, oldKey, ''].map((apiKey, i) => ({ ...connection, id: String(i), apiKey }));
  await writeFile(config, JSON.stringify({ profiles, active: '0' }));
  const [listed, current] = await Promise.all([store.list(), createProviders(dir).current()]);
  assert.deepEqual(listed.profiles.map(p => p.hasKey), [true, true, false]);
  assert.equal(current.apiKey, oldKey);
  const disk = await readFile(config, 'utf8');
  assert.ok(!disk.includes(oldKey));
  const [a, b] = JSON.parse(disk).profiles;
  for (const field of ['salt', 'nonce', 'ciphertext']) {
    assert.notEqual(a.apiKey[field], b.apiKey[field]);
    assert.ok(!JSON.stringify(listed).includes(a.apiKey[field]));
  }
  assert.equal((await readFile(key)).length, 32);
  if (process.platform !== 'win32') {
    for (const path of [key, config]) assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  await store.update({ ...connection, action: 'save', id: '0', model: 'updated' });
  assert.deepEqual(JSON.parse(await readFile(config, 'utf8')).profiles[0].apiKey, a.apiKey);
  assert.equal((await createProviders(dir).current()).apiKey, oldKey);
});

test('missing master key and modified ciphertext fail without replacing credentials', async t => {
  const { store, config, key } = await library(t);
  const saved = await store.update({ ...connection, action: 'save', apiKey: 'example-token' });
  const disk = await readFile(config, 'utf8');
  const master = await readFile(key);
  await rm(key);
  await assert.rejects(store.current(), /主密钥缺失/);
  await assert.rejects(store.update({ ...connection, action: 'save', apiKey: 'other' }), /主密钥缺失/);
  assert.equal(await readFile(config, 'utf8'), disk);
  await assert.rejects(stat(key), { code: 'ENOENT' });
  await writeFile(key, master);
  const state = JSON.parse(disk);
  const bytes = Buffer.from(state.profiles[0].apiKey.ciphertext, 'base64');
  bytes[0] ^= 1;
  state.profiles[0].apiKey.ciphertext = bytes.toString('base64').replace(/=+$/, '');
  await writeFile(config, JSON.stringify(state));
  await assert.rejects(store.current(), /解密失败/);
  await store.update({ ...connection, action: 'save', id: saved.active, apiKey: 'replacement' });
  assert.equal((await store.current()).apiKey, 'replacement');
});

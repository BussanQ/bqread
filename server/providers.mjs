import { publicState, updateState } from './shared/provider-state.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decryptKey, encryptKey, loadMasterKey } from './provider-secrets.mjs';

const pending = new Map();

export function createProviders(directory, fallback) {
  const folder = join(directory, 'settings');
  const file = join(folder, 'ai-providers.json');
  function run(operation) {
    const task = (pending.get(file) ?? Promise.resolve()).then(operation);
    const done = task.catch(() => {}).finally(() => {
      if (pending.get(file) === done) pending.delete(file);
    });
    pending.set(file, done);
    return task;
  }

  async function write(state) {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const temp = file + '.' + randomUUID();
    try {
      await writeFile(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
      await rename(temp, file);
    } finally { await rm(temp, { force: true }); }
  }

  function encryptionKey(state) {
    const hasEncryptedKeys = state.profiles.some(p => p.apiKey && typeof p.apiKey === 'object');
    return loadMasterKey(folder, !hasEncryptedKeys);
  }

  async function read() {
    let state;
    try { state = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { active: '', profiles: [] };
    }
    const legacy = state.profiles.filter(p => typeof p.apiKey === 'string' && p.apiKey);
    if (legacy.length) {
      const master = await encryptionKey(state);
      for (const profile of legacy) profile.apiKey = encryptKey(profile.apiKey, master);
      await write(state);
    }
    return state;
  }
  return {
    list() { return run(async () => publicState(await read(), fallback?.model ?? process.env.BQREAD_AI_MODEL)); },
    current() {
      return run(async () => {
        const state = await read();
        const profile = state.profiles.find(p => p.id === state.active);
        if (!profile) return fallback;
        return { ...profile, apiKey: profile.apiKey ? decryptKey(profile.apiKey, await loadMasterKey(folder, false)) : '' };
      });
    },
    update(input) {
      return run(async () => {
        const state = await read();
        await updateState(state, input, async value => encryptKey(value, await encryptionKey(state)));
        await write(state);
        return publicState(state, fallback?.model ?? process.env.BQREAD_AI_MODEL);
      });
    },
  };
}

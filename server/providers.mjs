import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decryptKey, encryptKey, loadMasterKey } from './provider-secrets.mjs';

function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }

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
  function publicState(state) {
    return { active: state.active, profiles: state.profiles.map(({ apiKey, ...profile }) => ({ ...profile, hasKey: Boolean(apiKey) })),
      environmentModel: fallback?.model ?? process.env.BQREAD_AI_MODEL ?? '' };
  }
  return {
    list() { return run(async () => publicState(await read())); },
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
        const old = state.profiles.find(p => p.id === input?.id);
        if (input?.id && !old) invalid('连接已不存在，请重新打开设置。');
        if (input?.action === 'remove' && old) {
          state.profiles = state.profiles.filter(p => p.id !== old.id);
          if (state.active === old.id) state.active = '';
        } else if (input?.action === 'activate' && (old || input.id === '')) {
          state.active = input.id;
        } else if (input?.action === 'save') {
          const { protocol, name, model, preset, baseURL, apiKey } = input;
          if (!['chat-completions', 'responses', 'anthropic-messages'].includes(protocol) ||
              ![name, model, preset, baseURL].every(x => typeof x === 'string' && x.trim() && x.length <= 2048)) invalid('请填写连接名称、地址、协议和模型。');
          let url;
          try { url = new URL(baseURL); } catch { invalid('API 地址无效。'); }
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) invalid('请输入 HTTP(S) API 基础地址。');
          const endpoint = url.href.replace(/\/+$/, '');
          if (apiKey !== undefined && (typeof apiKey !== 'string' || !/^[\x21-\x7e]{0,8192}$/.test(apiKey))) invalid('API 密钥格式无效。');
          if (old?.apiKey && old.baseURL !== endpoint && apiKey === undefined) invalid('地址已变更，请重新输入该地址的密钥。');
          const storedKey = apiKey ? encryptKey(apiKey, await encryptionKey(state)) : (apiKey ?? old?.apiKey ?? '');
          const profile = { id: old?.id ?? randomUUID(), name: name.trim(), model: model.trim(), preset, protocol, baseURL: endpoint,
            apiKey: storedKey };
          if (old) Object.assign(old, profile);
          else state.profiles.push(profile);
          state.active = profile.id;
        } else invalid('连接操作无效。');
        await write(state);
        return publicState(state);
      });
    },
  };
}

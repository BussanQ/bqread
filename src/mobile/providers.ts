import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { publicState, updateState } from '../../server/shared/provider-state.mjs';
import type { Settings } from '../provider-settings';

const key = 'modu-provider-connections-v1';
interface Connection {
  id: string; name: string; preset: string; protocol: string; baseURL: string; apiKey: string; model: string;
}
async function read(): Promise<{ active: string; profiles: Connection[] }> {
  // A locked Keychain is an error; only a missing item means first launch.
  if (!(await SecureStoragePlugin.keys()).value.includes(key)) return { active: '', profiles: [] };
  return JSON.parse((await SecureStoragePlugin.get({ key })).value);
}
let pending: Promise<unknown> = Promise.resolve();
export function providerSettings(input?: object): Promise<Settings> {
  const task = pending.then(async () => {
    const state = await read();
    if (input) {
      await updateState(state, input, (value: string) => value, true);
      await SecureStoragePlugin.set({ key, value: JSON.stringify(state) });
    }
    return publicState(state);
  });
  pending = task.catch(() => {});
  return task;
}
export async function currentProvider() {
  await pending;
  const state = await read();
  const profile = state.profiles.find(item => item.id === state.active);
  if (!profile) throw new Error('请先在书架的「AI 提供商」中保存并启用连接。');
  return profile;
}

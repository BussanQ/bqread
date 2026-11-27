import { CapacitorHttp } from '@capacitor/core';
import { createBookChat } from '../../server/book-chat.mjs';
import { createHistory } from '../../server/shared/history.mjs';
import { currentProvider } from './providers';
import { library } from './device';

async function modelTransport(url: string, init: { signal: AbortSignal; headers: Record<string,string>; body: string }) {
  const { signal } = init;
  signal.throwIfAborted();
  // Only the chosen HTTPS provider receives the credential, even on a redirect.
  if (new URL(url).protocol !== 'https:') throw new Error('模型服务需要 HTTPS 地址。');
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([cancelled, CapacitorHttp.post({ url, headers: init.headers,
      data: JSON.parse(init.body), disableRedirects: true, responseType: 'text', readTimeout: 120000, connectTimeout: 20000 })]);
    const body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    return new Response([204,205,304].includes(result.status) ? null : body, { status: result.status });
  } finally { signal.removeEventListener('abort', abort); }
}

let history: ReturnType<typeof createHistory> | undefined;
export async function mobileChat() {
  const store = await library();
  return history ??= createHistory(createBookChat(store, { getConfig: currentProvider, transport: modelTransport }), store.histories);
}
export async function removeBook(id: string, sample: boolean) {
  const store = await library();
  await (await mobileChat()).removeBook(id, sample ? store.hideSample : store.remove, sample);
}

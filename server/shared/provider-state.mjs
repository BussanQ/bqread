import { newId } from './id.mjs';
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }

export function publicState(state, environmentModel = '') {
  return { active: state.active, profiles: state.profiles.map(({ apiKey, ...profile }) => ({ ...profile, hasKey: Boolean(apiKey) })), environmentModel };
}

export async function updateState(state, input, protect, httpsOnly = false) {
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
    if (!(httpsOnly ? ['https:'] : ['http:', 'https:']).includes(url.protocol) || url.username || url.password || url.search || url.hash) invalid(httpsOnly ? '请输入 HTTPS API 基础地址。' : '请输入 HTTP(S) API 基础地址。');
    const endpoint = url.href.replace(/\/+$/, '');
    if (apiKey !== undefined && (typeof apiKey !== 'string' || !/^[\x21-\x7e]{0,8192}$/.test(apiKey))) invalid('API 密钥格式无效。');
    if (old?.apiKey && old.baseURL !== endpoint && apiKey === undefined) invalid('地址已变更，请重新输入该地址的密钥。');
    const storedKey = apiKey ? await protect(apiKey) : (apiKey ?? old?.apiKey ?? '');
    const profile = { id: old?.id ?? newId(), name: name.trim(), model: model.trim(), preset, protocol, baseURL: endpoint,
      apiKey: storedKey };
    if (old) Object.assign(old, profile);
    else state.profiles.push(profile);
    state.active = profile.id;
  } else invalid('连接操作无效。');
}

// Lucian UX/UI Prompt #403 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#403
// Lucian UX/UI Prompt #072 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#072
import './ui/provider-settings.css';
import { selectField, bindSelect } from './ui/provider-select';
import { modelField, bindModel } from './ui/provider-model';
import presets from './provider-presets.json';
import { escapeHTML } from './html';
import { icon } from './icons';

interface Profile {
  id: string;
  name: string;
  preset: string;
  protocol: string;
  model: string;
  baseURL: string;
  hasKey: boolean;
}
interface Settings { active: string; profiles: Profile[]; environmentModel: string }

async function settingsRequest(input?: object): Promise<Settings> {
  const response = await fetch('/api/providers', input ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '无法读取供应商设置。');
  return data;
}

const protocols = [
  { value: 'chat-completions', label: 'OpenAI Chat Completions' },
  { value: 'responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

function textField(name: string, label: string, attributes: string, accessory = '') {
  return `<div class="u403-f ${accessory ? 'u403-pw' : ''}">
    <input class="u403-in" id="provider-${name}" name="${name}" placeholder=" " ${attributes}>
    <label for="provider-${name}">${label}</label>${accessory}
  </div>`;
}

const eye = `<button type="button" class="u403-eye" aria-label="显示 API 密钥" aria-pressed="false">
  <svg viewBox="0 0 20 20" aria-hidden="true"><g class="lid"><path d="M2 10s3-5.2 8-5.2S18 10 18 10s-3 5.2-8 5.2S2 10 2 10z"/><circle cx="10" cy="10" r="2.4"/></g><g class="lash"><path d="M3 10.4c2 2.4 4.4 3.4 7 3.4s5-1 7-3.4M6 13l-1 1.6M10 14v1.8M14 13l1 1.6"/></g></svg>
</button>`;

export async function openProviderSettings(): Promise<void> {
  if (document.querySelector('.provider-dialog[open]')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'ux u403 provider-dialog';
  dialog.setAttribute('aria-labelledby', 'provider-title');
  dialog.innerHTML = `<header class="provider-header"><h2 id="provider-title">AI 提供商</h2>
    <button class="u072-x" data-close aria-label="关闭 AI 提供商设置">${icon('close')}</button></header>
    <div class="provider-body"><p role="status">正在读取设置…</p></div>
    <div class="u072-it" hidden><div><div class="u072-a">
      <span class="u072-ic" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 4.5v4M8 11.2h.01"/></svg></span>
      <div class="u072-tx" role="alert"></div><button type="button" class="u072-x" data-dismiss aria-label="关闭错误提示">${icon('close')}</button>
    </div></div></div><p class="u403-live" role="status"></p>`;
  document.body.append(dialog);
  const body = dialog.querySelector<HTMLElement>('.provider-body')!;
  const alert = dialog.querySelector<HTMLElement>('.u072-it')!;
  const live = dialog.querySelector<HTMLElement>('.u403-live')!;
  let state: Settings;
  let feedbackTimer: ReturnType<typeof setTimeout>;
  dialog.addEventListener('close', () => { clearTimeout(feedbackTimer); dialog.remove(); }, { once: true });
  const closeButton = dialog.querySelector<HTMLButtonElement>('[data-close]')!;
  closeButton.onclick = () => dialog.close();
  dialog.querySelector<HTMLButtonElement>('[data-dismiss]')!.onclick = () => {
    closeButton.focus({ preventScroll: true });
    alert.classList.add('gone');
    alert.inert = true;
    alert.setAttribute('aria-hidden', 'true');
  };
  dialog.onkeydown = event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const model = body.querySelector<HTMLInputElement>('[name=model]');
      model?.focus();
      model?.select();
    }
  };
  dialog.showModal();

  function report(error: unknown) {
    alert.removeAttribute('aria-hidden');
    alert.classList.remove('gone');
    alert.inert = false;
    alert.hidden = false;
    alert.querySelector('[role=alert]')!.textContent = error instanceof Error ? error.message : '操作失败，请重试。';
    alert.scrollIntoView({ block: 'nearest' });
  }
  async function update(input: object, trigger: HTMLButtonElement, success: string) {
    const fields = body.querySelector('fieldset')!;
    if (fields.disabled) return;
    const saving = trigger.type === 'submit';
    fields.disabled = true;
    alert.hidden = true;
    trigger.setAttribute('aria-busy', 'true');
    if (saving) trigger.classList.add('is-busy');
    live.textContent = '正在更新设置…';
    try {
      state = await settingsRequest(input);
      if (!dialog.open) return;
      render();
      live.textContent = success;
      if (saving) {
        const saved = body.querySelector<HTMLButtonElement>('.u403-go')!;
        saved.classList.add('is-ok');
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => saved.classList.remove('is-ok'), 1600);
      }
      body.querySelector<HTMLButtonElement>('[data-select=connection] button')!.focus({ preventScroll: true });
    } catch (error) {
      if (!dialog.open) return;
      fields.disabled = false;
      trigger.removeAttribute('aria-busy');
      trigger.classList.remove('is-busy');
      live.textContent = '';
      trigger.focus({ preventScroll: true });
      report(error);
    }
  }
  function render(editId = state.active) {
    const edit = state.profiles.find(p => p.id === editId);
    const current = state.profiles.find(p => p.id === state.active);
    const status = current ? current.name + ' · ' + current.model : state.environmentModel || '尚未配置';
    body.innerHTML = `<fieldset aria-label="提供商设置">
      <div class="provider-current"><div><span>当前模型</span><strong>${escapeHTML(status)}</strong></div>
        ${state.active ? '<button class="u072-again" type="button" data-env>使用服务端环境配置</button>' : ''}</div>
      ${selectField('connection', '已保存的连接')}
      <form><div class="provider-grid">${selectField('preset', '提供商')}${selectField('protocol', 'API 协议')}</div>
        ${textField('name', '连接名称', 'required maxlength="100"')}
        ${textField('baseURL', 'API 基础地址', 'type="url" required spellcheck="false"')}
        ${textField('apiKey', 'API 密钥', 'type="password" autocomplete="new-password" spellcheck="false" aria-describedby="provider-key-hint"', eye)}
        <p id="provider-key-hint"></p>
        ${modelField()}
        <div class="provider-actions">${edit ? '<button type="button" class="u072-again" data-remove>移除连接</button>' : ''}
          <button class="u403-go" type="submit"><span>保存并使用</span><i aria-hidden="true"></i><svg viewBox="0 0 22 22" aria-hidden="true"><path d="M5.5 11.5l4 4L17 7.5"/></svg></button>
        </div></form></fieldset>`;
    const form = body.querySelector('form')!;
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    const initialPreset = presets.find(p => p.id === edit?.preset)?.id ?? (edit ? 'custom' : 'openai');
    const sameConnection = () => edit && initialPreset === field('preset').value &&
      edit.baseURL === field('baseURL').value.trim().replace(/\/+$/, '');
    const updateKeyHint = () => {
      form.querySelector('#provider-key-hint')!.textContent = edit?.hasKey && sameConnection() ? '已保存密钥，留空沿用。' : '本地免密服务可留空。';
    };

    bindSelect(body, 'connection', [
      { value: '', label: '添加新连接' },
      ...state.profiles.map(p => ({ value: p.id, label: p.name, detail: p.model })),
    ], edit?.id ?? '', id => {
      alert.hidden = true;
      render(id);
      body.querySelector<HTMLButtonElement>('[data-select=connection] button')!.focus({ preventScroll: true });
    });
    const setProtocol = bindSelect(body, 'protocol', protocols, edit?.protocol ?? protocols[0]!.value);
    const reveal = form.querySelector<HTMLButtonElement>('.u403-eye')!;
    const setVisible = (show: boolean) => {
      reveal.setAttribute('aria-pressed', String(show));
      field('apiKey').type = show ? 'text' : 'password';
    };
    reveal.onclick = () => setVisible(field('apiKey').type === 'password');
    let preset = presets.find(p => p.id === initialPreset)!;
    bindSelect(body, 'preset', presets.map(p => ({ value: p.id, label: p.name })), initialPreset, id => {
      preset = presets.find(p => p.id === id)!;
      field('name').value = preset.name;
      setProtocol(preset.protocol);
      field('baseURL').value = preset.baseURL;
      field('model').value = '';
      field('apiKey').value = '';
      setVisible(false);
      updateKeyHint();
    });
    field('name').value = edit?.name ?? preset.name;
    field('baseURL').value = edit?.baseURL ?? preset.baseURL;
    field('model').value = edit?.model ?? '';
    setProtocol(edit?.protocol ?? preset.protocol);
    updateKeyHint();
    field('baseURL').oninput = updateKeyHint;
    bindModel(form, () => preset.models);
    const save = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    form.onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      if (edit && sameConnection()) {
        // The server can still use authentication specific to a retired preset.
        values.preset = edit.preset;
        if (!values.apiKey) delete values.apiKey;
      }
      void update({ ...values, action: 'save', id: edit?.id }, save, '已保存并使用此连接。');
    };
    const remove = body.querySelector<HTMLButtonElement>('[data-remove]');
    if (remove && edit) remove.onclick = () => void update({ action: 'remove', id: edit.id }, remove, '已移除连接。');
    const env = body.querySelector<HTMLButtonElement>('[data-env]');
    if (env) env.onclick = () => void update({ action: 'activate', id: '' }, env, '已切换到服务端环境配置。');
  }
  try { state = await settingsRequest(); if (dialog.open) render(); }
  catch (error) { if (dialog.open) { body.replaceChildren(); report(error); } }
}

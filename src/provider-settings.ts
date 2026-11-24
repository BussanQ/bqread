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

export async function openProviderSettings(): Promise<void> {
  if (document.querySelector('.provider-dialog[open]')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal provider-dialog';
  dialog.setAttribute('aria-labelledby', 'provider-title');
  dialog.innerHTML = `<header class="modal-header"><h2 class="modal-title" id="provider-title">AI 提供商</h2><button class="icon-button modal-close" aria-label="关闭">${icon('close')}</button></header>
    <div class="provider-body">正在读取设置…</div><p role="alert" class="form-error" hidden></p>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('button')!.onclick = () => dialog.close();
  dialog.showModal();
  const body = dialog.querySelector<HTMLElement>('.provider-body')!;
  const alert = dialog.querySelector<HTMLElement>('[role=alert]')!;
  let state: Settings;
  function report(error: unknown) {
    alert.hidden = false;
    alert.textContent = error instanceof Error ? error.message : '操作失败，请重试。';
  }
  async function update(input: object) {
    const fields = body.querySelector<HTMLFieldSetElement>('fieldset')!;
    fields.disabled = true;
    alert.hidden = true;
    try { state = await settingsRequest(input); render(); }
    catch (error) { fields.disabled = false; report(error); }
  }
  function render(editId = state.active) {
    const edit = state.profiles.find(p => p.id === editId);
    const current = state.profiles.find(p => p.id === state.active);
    const status = current ? current.name + ' · ' + current.model : state.environmentModel || '尚未配置';
    body.innerHTML = `<p class="provider-current">当前模型　<strong>${escapeHTML(status)}</strong></p><fieldset>
      <label class="field">已保存的连接<select class="text-input" name="connection"><option value="">添加新连接</option>${state.profiles.map(p => `<option value="${escapeHTML(p.id)}" ${p.id === editId ? 'selected' : ''}>${escapeHTML(p.name)} · ${escapeHTML(p.model)}</option>`).join('')}</select></label>
      <form><div class="provider-grid"><label class="field">提供商<select class="text-input" name="preset">${presets.map(p => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('')}</select></label>
      <label class="field">连接名称<input class="text-input" name="name" required maxlength="100"></label></div>
      <label class="field">API 协议<select class="text-input" name="protocol"><option value="chat-completions">OpenAI Chat Completions</option><option value="responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
      <label class="field">API 基础地址<input class="text-input" name="baseURL" type="url" placeholder="https://example.com/v1" required></label>
      <label class="field">API 密钥<input class="text-input" name="apiKey" type="password" autocomplete="new-password"></label>
      <label class="field">模型<input class="text-input" name="model" list="provider-models" placeholder="选择或输入模型 ID" required></label><datalist id="provider-models"></datalist>
      <div class="modal-actions">${edit ? '<button type="button" class="secondary-button" data-remove>移除连接</button>' : ''}<button class="primary-button" type="submit">保存并使用</button></div></form>
      ${state.active ? '<button type="button" class="footer-link" data-env>使用服务端环境配置</button>' : ''}</fieldset>`;
    const form = body.querySelector('form')!;
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
    const initialPreset = edit ? (presets.find(p => p.id === edit.preset)?.id ?? 'custom') : 'openai';
    const sameConnection = () => edit && initialPreset === field('preset').value &&
      edit.baseURL === field('baseURL').value.trim().replace(/\/+$/, '');
    const updateKeyHint = () => {
      (field('apiKey') as HTMLInputElement).placeholder = edit?.hasKey && sameConnection() ? '已保存，留空沿用' : '本地免密服务可留空';
    };
    const selectPreset = (id: string) => {
      const preset = presets.find(p => p.id === id) ?? presets[0]!;
      field('preset').value = preset.id;
      field('name').value = preset.name;
      field('protocol').value = preset.protocol;
      field('baseURL').value = preset.baseURL;
      field('model').value = '';
      field('apiKey').value = '';
      updateKeyHint();
      form.querySelector('datalist')!.innerHTML = preset.models.map(m => `<option value="${escapeHTML(m)}"></option>`).join('');
    };
    selectPreset(initialPreset);
    if (edit) {
      for (const key of ['name','protocol','baseURL','model'] as const) field(key).value = edit[key];
      updateKeyHint();
    }
    field('preset').onchange = () => selectPreset(field('preset').value);
    field('baseURL').oninput = updateKeyHint;
    body.querySelector<HTMLSelectElement>('[name=connection]')!.onchange = event => { alert.hidden = true; render((event.target as HTMLSelectElement).value); };
    form.onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      if (edit && sameConnection()) {
        // Existing connections may still use authentication specific to a retired preset.
        values.preset = edit.preset;
        if (!values.apiKey) delete values.apiKey;
      }
      void update({ ...values, action: 'save', id: edit?.id });
    };
    const remove = body.querySelector<HTMLButtonElement>('[data-remove]');
    if (remove) remove.onclick = () => void update({ action: 'remove', id: edit!.id });
    const env = body.querySelector<HTMLButtonElement>('[data-env]');
    if (env) env.onclick = () => void update({ action: 'activate', id: '' });
  }
  try { state = await settingsRequest(); render(); }
  catch (error) { body.replaceChildren(); report(error); }
}

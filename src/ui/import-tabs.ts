// Lucian UX/UI Prompt #039 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#039
import { icon } from '../icons';

export type ImportTab = 'file' | 'paste';

export function importTabs(selected: ImportTab): string {
  const tabs = (['file', 'paste'] as const).map((tab) => `
    <button type="button" class="u039-tab" id="import-tab-${tab}" role="tab" aria-controls="import-panel"
      aria-selected="${selected === tab}" tabindex="${selected === tab ? 0 : -1}" data-action="import-tab" data-tab="${tab}">
      ${icon(tab)}${tab === 'file' ? '选择文件' : '粘贴文本'}
    </button>`).join('');
  return `<div class="ux u039-tabs" role="tablist" aria-label="导入方式" data-selected="${selected}">
    <span class="u039-pill" aria-hidden="true"></span>${tabs}
  </div>`;
}

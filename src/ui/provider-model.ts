// Lucian UX/UI Prompt #429 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#429
import { escapeHTML } from '../html';
import { icon } from '../icons';

export function modelField(): string {
  return `<div class="u429">
    <label class="u031-lab" for="provider-model">模型</label>
    <div class="u429-f">${icon('search')}<input class="u429-in" id="provider-model" name="model" required
      role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="provider-model-list"
      placeholder="选择或输入模型 ID" autocomplete="off" autocapitalize="none" spellcheck="false">
      <kbd class="u429-kb" aria-hidden="true">${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd></div>
    <div class="u429-dd" inert><i class="u429-pill" aria-hidden="true"></i><div class="u429-lb" id="provider-model-list" role="listbox" aria-label="模型候选"></div></div>
    <span class="u429-live" role="status"></span>
  </div>`;
}

export function bindModel(form: HTMLFormElement, getModels: () => string[]) {
  const root = form.querySelector<HTMLElement>('.u429')!;
  const input = root.querySelector('input')!;
  const dropdown = root.querySelector<HTMLElement>('.u429-dd')!;
  const list = root.querySelector<HTMLElement>('[role=listbox]')!;
  const live = root.querySelector<HTMLElement>('[role=status]')!;
  let matches: string[] = [];
  let active = -1;
  function close() {
    root.classList.remove('is-open');
    dropdown.inert = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function mark(index: number, scroll = false) {
    list.children[active]?.setAttribute('aria-selected', 'false');
    active = index;
    const item = list.children[index] as HTMLElement | undefined;
    dropdown.style.setProperty('--po', item ? '1' : '0');
    dropdown.style.setProperty('--py', Math.max(index, 0) * 40 + 'px');
    if (item) {
      input.setAttribute('aria-activedescendant', item.id);
      item.setAttribute('aria-selected', 'true');
      if (scroll) item.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function render() {
    const query = input.value.trim().toLowerCase();
    matches = getModels().filter(model => model.toLowerCase().includes(query));
    if (!matches.length) { close(); live.textContent = ''; return; }
    list.innerHTML = matches.map((model, index) => {
      const at = model.toLowerCase().indexOf(query);
      const label = escapeHTML(model.slice(0, at)) + '<mark>' + escapeHTML(model.slice(at, at + query.length))
        + '</mark>' + escapeHTML(model.slice(at + query.length));
      return `<div class="u429-o" role="option" aria-selected="false" data-index="${index}" id="model-choice-${index}" style="--i:${Math.min(index, 3)}">
        <span class="u429-t">${label}</span><span class="u429-en" aria-hidden="true">↵</span></div>`;
    }).join('');
    const boundary = root.closest('dialog')!.getBoundingClientRect();
    const field = input.getBoundingClientRect();
    const menuHeight = Math.min(172, innerHeight * .36, matches.length * 40 + 12) + 8;
    root.classList.toggle('opens-above', boundary.bottom - field.bottom < menuHeight &&
      field.top - boundary.top > boundary.bottom - field.bottom);
    dropdown.inert = false;
    root.classList.add('is-open');
    input.setAttribute('aria-expanded', 'true');
    dropdown.scrollTop = 0;
    mark(-1);
    live.textContent = `${matches.length} 个候选模型`;
  }
  function choose(index: number) {
    input.value = matches[index]!;
    live.textContent = input.value;
    close();
  }
  input.onfocus = render;
  input.onclick = () => { if (dropdown.inert) render(); };
  input.oninput = render;
  input.onblur = close;
  input.onkeydown = event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (dropdown.inert) render();
      if (matches.length) {
        const next = event.key === 'ArrowDown' ? active + 1 : active <= 0 ? matches.length - 1 : active - 1;
        mark(next % matches.length, true);
      }
    } else if (!dropdown.inert && event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(active);
    } else if (!dropdown.inert && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close();
    }
  };
  dropdown.onmousedown = event => event.preventDefault();
  list.onpointermove = event => {
    const option = (event.target as Element).closest<HTMLElement>('[role=option]');
    if (option) mark(Number(option.dataset.index));
  };
  list.onclick = event => {
    const option = (event.target as Element).closest<HTMLElement>('[role=option]');
    if (option) choose(Number(option.dataset.index));
  };
}

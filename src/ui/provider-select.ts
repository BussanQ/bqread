// Lucian UX/UI Prompt #031 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#031
import { escapeHTML } from '../html';

interface Option { value: string; label: string; detail?: string }

export function selectField(name: string, label: string): string {
  return `<div class="u031 u031-f" data-select="${name}">
    <span class="u031-lab" id="label-${name}">${label}</span>
    <input type="hidden" name="${name}">
    <button class="u031-btn" type="button" aria-haspopup="listbox" aria-expanded="false"
      aria-controls="list-${name}" aria-labelledby="label-${name} value-${name}">
      <span class="u031-v" id="value-${name}"><b></b><small></small></span>
      <svg class="u031-car" viewBox="0 0 18 18" aria-hidden="true"><path d="M4.5 7l4.5 4.5L13.5 7"/></svg>
    </button>
    <ul class="u031-list" id="list-${name}" role="listbox" aria-labelledby="label-${name}" tabindex="-1" inert></ul>
  </div>`;
}

export function bindSelect(container: HTMLElement, name: string, options: Option[], value: string, change?: (value: string) => void) {
  const root = container.querySelector<HTMLElement>(`[data-select="${name}"]`)!;
  const input = root.querySelector('input')!;
  const button = root.querySelector('button')!;
  const list = root.querySelector('ul')!;
  list.innerHTML = '<li class="u031-hl" role="presentation" aria-hidden="true"></li>' + options.map((option, index) => `
    <li class="u031-o" role="option" id="${list.id}-${index}" data-index="${index}">
      <span>${escapeHTML(option.label)}</span>${option.detail ? `<small>${escapeHTML(option.detail)}</small>` : ''}
      <svg class="u031-ck" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 9.5l3.5 3.5L14 6"/></svg></li>`).join('');
  const items = [...list.querySelectorAll<HTMLElement>('[role=option]')];
  let active = 0;
  let typed = '';
  let lastTyped = 0;

  function setValue(value: string) {
    active = Math.max(0, options.findIndex(option => option.value === value));
    const selected = options[active]!;
    input.value = selected.value;
    button.querySelector('b')!.textContent = selected.label;
    button.querySelector('small')!.textContent = selected.detail ?? '';
    items.forEach((item, i) => item.setAttribute('aria-selected', String(i === active)));
  }
  function mark(index: number, scroll = false) {
    active = index;
    list.style.setProperty('--i', String(index));
    list.setAttribute('aria-activedescendant', items[index]!.id);
    if (scroll) items[index]!.scrollIntoView({ block: 'nearest' });
  }
  function open() {
    root.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    list.inert = false;
    list.classList.add('is-open');
    mark(options.findIndex(option => option.value === input.value), true);
    list.focus({ preventScroll: true });
  }
  function close(focus = false) {
    if (focus) button.focus({ preventScroll: true });
    root.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    list.classList.remove('is-open');
    list.inert = true;
  }
  function choose(index: number) {
    const previous = input.value;
    setValue(options[index]!.value);
    close(true);
    if (previous !== input.value) change?.(input.value);
  }
  button.onclick = () => list.inert ? open() : close(true);
  button.onkeydown = event => {
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); open(); }
  };
  list.onkeydown = event => {
    if (event.isComposing) return;
    switch (event.key) {
      case 'ArrowDown': mark(Math.min(active + 1, items.length - 1), true); break;
      case 'ArrowUp': mark(Math.max(active - 1, 0), true); break;
      case 'Home': mark(0, true); break;
      case 'End': mark(items.length - 1, true); break;
      case 'Enter': case ' ': choose(active); break;
      case 'Escape': close(true); break;
      case 'Tab': close(true); return;
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey) return;
        const now = performance.now();
        typed = (now - lastTyped < 600 ? typed : '') + event.key.toLowerCase();
        lastTyped = now;
        const index = options.findIndex(option => option.label.toLowerCase().startsWith(typed));
        if (index >= 0) mark(index, true);
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };
  list.onpointermove = event => {
    const item = (event.target as Element).closest<HTMLElement>('[role=option]');
    if (item) mark(Number(item.dataset.index));
  };
  list.onmousedown = event => event.preventDefault();
  list.onclick = event => {
    const item = (event.target as Element).closest<HTMLElement>('[role=option]');
    if (item) choose(Number(item.dataset.index));
  };
  root.addEventListener('focusout', event => {
    if (!root.contains(event.relatedTarget as Node | null)) close();
  });
  setValue(value);
  return setValue;
}

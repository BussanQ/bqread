import { annotations, removeAnnotation, saveAnnotation, type Annotation } from '../annotations';
import { escapeHTML } from '../html';
import { icon } from '../icons';
import type { ReaderState } from '../types';

const tabs = { chapters: '目录', note: '笔记', bookmark: '书签' } as const;
type Tab = keyof typeof tabs;

export function contentsDrawer(reader: ReaderState, title: string): string {
  const chapters = reader.chapters.map((chapter, index) => {
    const active = index === reader.chapterIndex;
    return `<li><button class="chapter-link title-4 ${active ? 'active' : ''}" data-action="chapter" data-chapter="${index}" ${active ? 'aria-current="location"' : ''}>
      <span class="chapter-number">${String(index + 1).padStart(2, '0')}</span><span>${escapeHTML(chapter.title)}</span></button></li>`;
  }).join('');
  const tabButtons = Object.entries(tabs).map(([key, label]) =>
    `<button role="tab" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${key === 'chapters'}" tabindex="${key === 'chapters' ? 0 : -1}" data-tab="${key}">${label}</button>`).join('');
  return `<aside class="reader-drawer contents-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
    <div class="drawer-header"><h2 class="drawer-title" id="drawer-title">${escapeHTML(title)}</h2>
      <button class="icon-button" data-action="close-drawer" aria-label="关闭目录">${icon('close')}</button></div>
    <div class="catalog-tabs" role="tablist" aria-label="阅读导航">${tabButtons}</div>
    <section role="tabpanel" id="panel-chapters" aria-labelledby="tab-chapters">
      <div class="catalog-tools"><span>共 ${reader.chapters.length} 章</span><div>
        <button type="button" data-catalog="top" aria-label="到顶部" title="到顶部">${icon('arrowUpToLine')}</button>
        <button type="button" data-catalog="bottom" aria-label="到底部" title="到底部">${icon('arrowDownToLine')}</button></div></div>
      <div class="catalog-scroll" tabindex="0" aria-label="章节列表"><ol class="chapter-list">${chapters}</ol></div>
    </section>
    ${(['note', 'bookmark'] as const).map(kind => `<section role="tabpanel" id="panel-${kind}" aria-labelledby="tab-${kind}" hidden>
      <div class="catalog-tools"><span>${kind === 'note' ? '本书笔记' : '本书书签'}</span><button data-catalog="add">${icon('plus')}${kind === 'note' ? '写笔记' : '添加当前位置'}</button></div>
      ${kind === 'note' ? `<form class="note-editor" hidden><label for="reader-note">笔记内容</label>
        <textarea id="reader-note" rows="3" required></textarea><div><button type="button" data-catalog="cancel">取消</button>
        <button type="submit">保存笔记</button></div></form>` : ''}
      <div class="catalog-scroll annotation-list" aria-live="polite"></div></section>`).join('')}
    </aside>`;
}

export function bindContents(drawer: HTMLElement, reader: ReaderState, jump: (index: number, ratio: number) => void,
  notify: (message: string) => void, startNote = false): void {
  const buttons = [...drawer.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const chapterList = drawer.querySelector<HTMLElement>('#panel-chapters .catalog-scroll')!;
  const editor = drawer.querySelector<HTMLFormElement>('.note-editor')!;
  const input = editor.querySelector('textarea')!;
  const current = reader.chapters[reader.chapterIndex];
  const position = { sourceIndex: current.sourceIndex, ratio: reader.chapterRatio };
  const chapterIndices = new Map(reader.chapters.map((c, index) => [c.sourceIndex, index]));
  let selected: Tab = 'chapters';
  let editing: Annotation | undefined;
  let entries: Annotation[] = [];

  function displayEntries(kind: Annotation['kind']): void {
    const list = drawer.querySelector<HTMLElement>('#panel-' + kind + ' .annotation-list')!;
    try {
      entries = annotations(reader.bookId);
    } catch {
      list.textContent = '读取失败，请重新打开此标签。';
      return;
    }
    const items = entries.filter(e => e.kind === kind && chapterIndices.has(e.sourceIndex)).sort((a, b) =>
      chapterIndices.get(a.sourceIndex)! - chapterIndices.get(b.sourceIndex)! || a.ratio - b.ratio);
    list.innerHTML = items.length ? items.map(entry => {
      const title = reader.chapters[chapterIndices.get(entry.sourceIndex)!].title;
      return `<div class="annotation-row" data-entry="${escapeHTML(entry.id)}"><button class="annotation-jump" data-catalog="jump">
        <strong>${escapeHTML(title)}</strong><small>章内 ${Math.round(entry.ratio * 100)}%</small>
        ${kind === 'note' ? `<span>${escapeHTML(entry.text)}</span>` : ''}</button><div class="annotation-actions">
        ${kind === 'note' ? '<button data-catalog="edit">编辑</button>' : ''}
        <button data-catalog="delete" aria-label="删除${tabs[kind]}">${icon('trash')}</button></div></div>`;
    }).join('') : `<p class="annotation-empty">暂无${tabs[kind]}</p>`;
  }

  function select(tab: Tab): void {
    selected = tab;
    for (const button of buttons) {
      const active = tab === button.dataset.tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      drawer.querySelector<HTMLElement>('#' + button.getAttribute('aria-controls'))!.hidden = !active;
      if (active) button.focus({ preventScroll: true });
    }
    if (tab !== 'chapters') displayEntries(tab);
  }

  function edit(entry?: Annotation): void {
    editing = entry;
    input.value = entry?.text ?? '';
    editor.hidden = false;
    input.focus();
  }

  editor.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    try {
      saveAnnotation(reader.bookId, { ...(editing ?? position), text, kind: 'note' }, editing?.id);
    } catch { notify('笔记保存失败，请检查设备存储后重试。'); return; }
    editor.hidden = true;
    editing = undefined;
    displayEntries('note');
    drawer.querySelector<HTMLButtonElement>('#panel-note [data-catalog="add"]')?.focus();
  });

  drawer.addEventListener('keydown', event => {
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const keys: Record<string, number> = { ArrowLeft: (index + 2) % 3, ArrowRight: (index + 1) % 3, Home: 0, End: 2 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(buttons[keys[event.key]].dataset.tab as Tab);
  });
  drawer.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.tab) { select(button.dataset.tab as Tab); return; }
    const action = button.dataset.catalog;
    if (action === 'top' || action === 'bottom') {
      chapterList.scrollTop = action === 'top' ? 0 : chapterList.scrollHeight;
      return;
    }
    if (selected === 'chapters' || !action) return;
    const id = button.closest<HTMLElement>('[data-entry]')?.dataset.entry;
    const entry = entries.find(item => item.id === id);
    if (action === 'jump' && entry) jump(chapterIndices.get(entry.sourceIndex)!, entry.ratio);
    if (action === 'cancel') editor.hidden = true;
    if (action === 'edit' && entry) edit(entry);
    if (action === 'add' && selected === 'note') {
      if (editor.hidden) edit();
      else input.focus();
    }
    try {
      if (action === 'add' && selected === 'bookmark') {
        saveAnnotation(reader.bookId, { ...position, kind: 'bookmark', text: '' });
        displayEntries('bookmark');
        notify('已保存当前位置的书签。');
      }
      if (action === 'delete' && entry) {
        removeAnnotation(reader.bookId, entry.id);
        if (editing?.id === entry.id) editor.hidden = true;
        displayEntries(selected);
      }
    } catch { notify('保存更改失败，请检查设备存储后重试。'); }
  });
  if (startNote) {
    select('note');
    edit();
    return;
  }
  const active = chapterList.querySelector<HTMLElement>('[aria-current="location"]');
  if (active) chapterList.scrollTop = active.offsetTop - (chapterList.clientHeight - active.offsetHeight) / 2;
}

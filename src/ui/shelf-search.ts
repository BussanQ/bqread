// Lucian UX/UI Prompt #092 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#092
import { escapeHTML } from '../html';
import { icon } from '../icons';

export function shelfSearch(value: string): string {
  return `<div class="ux u092-q">
    ${icon('search')}<input class="u092-in" id="book-search" type="search" aria-label="搜索书名或作者" placeholder="搜索书名或作者" value="${escapeHTML(value)}">
    <button type="button" class="u092-x" data-action="clear-search" aria-label="清除搜索" ${value ? '' : 'hidden'}>${icon('close')}</button>
  </div>`;
}

export interface SearchSuggestion {
  label: string;
  action: 'clear-search' | 'all-books' | 'reset-search';
  count: number;
}

export function emptyShelf(hasQuery: boolean, suggestions: SearchSuggestion[]): string {
  const options = suggestions.map(({ label, action, count }, index) =>
    `<button class="u092-sg" type="button" data-action="${action}" style="--i:${index}">
      <span>${label}</span><b>${count} 本</b>${icon('right')}
    </button>`).join('');
  return `<div class="ux u092-none">
    <div class="u092-art" aria-hidden="true"><svg viewBox="0 0 150 92"><path class="u092-shelf" d="M8 30h134M8 56h134M8 82h134"/><g class="u092-lens"><circle cx="34" cy="38" r="20"/><path class="gl" d="M24 30a12 12 0 0 1 8-5"/><path d="M48 52l14 14"/></g></svg></div>
    <h3 class="u092-nt">${hasQuery ? '没有找到这本书' : '这个分类还没有书籍'}</h3>
    <p class="u092-ns">${hasQuery ? '试试其他书名、作者，或调整筛选。' : '可以到全部书籍里挑一本。'}</p>
    <div class="u092-sgs">${options || '<button class="u092-sg" data-action="import">导入小说</button>'}</div>
  </div>`;
}

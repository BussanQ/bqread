import { BookChatPanel } from './book-chat';
import { escapeHTML } from './html';
import './style.css';
import { icon, logo } from './icons';
import { chapterAt, createBook, decodeTextFile, titleFromFilename } from './parser';
import { sampleBooks } from './samples';
import { deleteStoredBook, exportBook, getBooks, getChapterWindow, getContents, putBook, restoreReadingProgress, saveReadingProgress } from './storage';
import type { BookSummary, ChapterWindow, FontSize, ModalName, ReaderState, ReadingSettings, ShelfFilter } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const toastRegion = document.querySelector<HTMLDivElement>('#toast-region')!;
const SETTINGS_KEY = 'modu-settings';

let books: BookSummary[] = [];
const samples = sampleBooks();
let loading = true;
let openingBook: BookSummary | null = null;
let chapterRequest: AbortController | null = null;
let pendingChapter: number | null = null;
let search = '';
let filter: ShelfFilter = 'all';
let reader: ReaderState | null = null;
let chat: BookChatPanel | null = null;
let modal: ModalName = null;
let importTab: 'file' | 'paste' = 'file';
let importFile: File | null = null;
let importTitle = '';
let importAuthor = '';
let pasteText = '';
let importError = '';
let importing = false;
let deleteId: string | null = null;
let previousFocus: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let scrollFrame: number | null = null;
let restoringScroll = false;

function loadSettings(): ReadingSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<ReadingSettings>;
    const fontSize = stored.fontSize;
    const theme = stored.theme;
    return {
      fontSize: fontSize === 16 || fontSize === 20 ? fontSize : 18,
      theme: theme === 'sage' || theme === 'night' ? theme : 'paper',
    };
  } catch {
    return { fontSize: 18, theme: 'paper' };
  }
}
let settings = loadSettings();


function coverArt(book: BookSummary): string {
  const theme = book.cover;
  if (theme === 'clay') {
    return '<svg class="cover-art" viewBox="0 0 200 112" fill="none" aria-hidden="true"><circle cx="100" cy="37" r="18" fill="currentColor" opacity=".25"/><path d="M0 88c30-24 54-24 78-3 25-24 50-29 122-4v31H0V88Z" fill="currentColor" opacity=".15"/><path d="M80 84V51h40v33M76 51l24-18 24 18M94 84V65h12v19" stroke="currentColor" opacity=".55" stroke-width="1.2"/><path d="M110 42V28h6v10" stroke="currentColor" opacity=".4"/><path d="M117 25c-10-6 10-9 0-16" stroke="currentColor" opacity=".3"/></svg>';
  }
  if (theme === 'sand') {
    return '<svg class="cover-art" viewBox="0 0 200 112" fill="none" aria-hidden="true"><circle cx="146" cy="29" r="17" fill="currentColor" opacity=".25"/><path d="m0 99 60-59 44 46 32-31 64 51" stroke="currentColor" opacity=".4"/><path d="m0 108 81-39 38 28 37-15 44 26" stroke="currentColor" opacity=".25"/><path d="M40 29h27m-20 5h31M47 40h20" stroke="currentColor" opacity=".35"/></svg>';
  }
  return '<svg class="cover-art" viewBox="0 0 200 112" fill="none" aria-hidden="true"><circle cx="100" cy="33" r="20" fill="currentColor" opacity=".2"/><path d="M0 90c34-21 56-17 91-3 35-19 70-24 109-10M0 100c35-15 63-11 96 1 31-13 63-18 104-9" stroke="currentColor" opacity=".35"/><path d="M93 77h14l-3-35h-8l-3 35Zm7-40V20m-12 17h24" stroke="currentColor" opacity=".6"/><path d="M87 76h26l-4 7H90l-3-7Z" fill="currentColor" opacity=".35"/><path d="m99 34-60-9 60 14m2-5 61-9-61 14" fill="currentColor" opacity=".12"/><path d="M43 37c4-4 8-4 12 0 4-4 8-4 12 0m65-15c3-3 6-3 9 0 3-3 6-3 9 0" stroke="currentColor" opacity=".5"/></svg>';
}

function cover(book: BookSummary): string {
  const series = book.sample ? '墨 读 · 治 愈 系 列' : '墨 读 · 私 人 藏 书';
  return `<div class="book-cover ${book.cover}">
    <div class="cover-series">${series}</div>
    <div class="cover-title">${escapeHTML(book.title)}</div>
    <div class="cover-subtitle">${book.sample ? '在文字里，遇见生活' : '一 段 属 于 自 己 的 故 事'}</div>
    ${coverArt(book)}
    <div class="cover-author">${escapeHTML(book.author)} 著</div>
  </div>`;
}

function progress(book: BookSummary): number {
  if (book.location <= 0) return 0;
  return Math.min(100, Math.max(1, Math.floor((book.location / Math.max(1, book.contentLength - 1)) * 100)));
}

function header(): string {
  return `<header class="site-header"><div class="container header-inner">
    <button class="brand text-button" data-action="home" aria-label="墨读首页">${logo()}<span><span class="brand-name">墨读</span><span class="brand-subtitle">MO DU READER</span></span></button>
    <nav class="main-nav" aria-label="主导航"><button class="nav-link title-3 active" aria-current="page" data-action="home">我的书架</button><button class="nav-link title-3" data-action="import">导入书籍</button><button class="nav-link title-3" data-action="help">阅读指南</button><button class="nav-link title-3" data-action="providers">AI 提供商</button></nav>
    <div class="header-actions"><span class="local-status caption-5"><span class="status-dot"></span>私人书库，安心自在</span><button class="primary-button button-sm" data-action="import">${icon('plus')}导入小说</button></div>
  </div></header>`;
}

function heroArt(): string {
  return `<div class="hero-art" aria-hidden="true"><svg viewBox="0 0 360 240" fill="none">
    <ellipse cx="197" cy="205" rx="127" ry="12" fill="#dce1d0"/>
    <path d="M263 176h60v13h-60z" fill="#aab298"/><path d="m263 176 9-7h60l-9 7h-60Z" fill="#cbd1bb"/><path d="m323 176 9-7v13l-9 7v-13Z" fill="#8e9a80"/>
    <path d="M249 158h68v15h-68z" fill="#bd9e7f"/><path d="m249 158 10-7h67l-9 7h-68Z" fill="#d6c1a2"/><path d="m317 158 9-7v15l-9 7v-15Z" fill="#a7886b"/>
    <path d="M259 142h56v13h-56z" fill="#8c9d83"/><path d="m259 142 10-7h55l-9 7h-56Z" fill="#b0bea2"/><path d="m315 142 9-7v13l-9 7v-13Z" fill="#778c6e"/>
    <path d="M116 181c-4-55-31-78-51-87 28 2 56 31 51 87Z" fill="#a1b093"/><path d="M113 181c7-62 37-87 58-96-28 23-41 49-58 96Z" fill="#899e7b"/>
    <path d="M115 163c-17-36-38-46-56-47 20 14 35 29 56 47Z" fill="#7f9773"/><path d="M115 155c4-35 24-55 37-62-11 23-20 40-37 62Z" fill="#b1bb9b"/>
    <path d="M112 178c-2-39-8-65-26-84m27 85c6-49 22-73 42-87" stroke="#738766" stroke-width="1.5"/>
    <path d="M92 176h44l-5 32H97l-5-32Z" fill="#b8805f"/><path d="M90 174h48v7H90z" fill="#c59373"/>
    <path d="M162 182c19-17 73-18 96-4-6 20-79 22-96 4Z" fill="#d6d3b8"/>
    <path d="m142 144 44-13 49 24-45 15-48-26Z" fill="#faf5e5"/><path d="m142 144 3 33 44 15 1-37-48-11Z" fill="#e9e5cd"/><path d="m190 155 45-24-1 34-44 27-1-37Z" fill="#f3eedb"/>
    <path d="m142 144 48-15 45 2-45 24-48-11Z" fill="#fffbea"/><path d="m190 155 45-24 7 5-52 23v-4Z" fill="#e5e0c9"/>
    <path d="m154 145 30-8m-26 12 26-6m15 5 25-12m-21 17 23-12" stroke="#c8cbb3" stroke-width="1"/>
    <path d="M182 129c-7-16-3-27 0-37" stroke="#89967b" stroke-width="1.5"/><path d="M181 107c-14-2-19-10-18-16 12 0 19 7 18 16Zm0 10c10-9 19-7 23-3-6 9-14 11-23 3Z" fill="#95a381"/>
    <circle cx="295" cy="66" r="24" fill="#dfe4d4"/>
  </svg><div class="hero-stamp"><span>慢读</span><span>时光</span></div></div>`;
}

function filteredBooks(): BookSummary[] {
  return books.filter((book) => {
    if (filter === 'reading' && progress(book) === 0) return false;
    if (filter === 'unread' && progress(book) > 0) return false;
    const query = search.trim().toLocaleLowerCase();
    return !query || `${book.title} ${book.author}`.toLocaleLowerCase().includes(query);
  });
}

function bookCard(book: BookSummary): string {
  const percent = progress(book);
  return `<article class="book-item">
    <button class="book-open" data-action="read" data-id="${book.id}" aria-label="阅读《${escapeHTML(book.title)}》">${cover(book)}<div class="book-info"><div class="book-title-row"><h3 class="book-name">${escapeHTML(book.title)}</h3>${book.sample ? '<span class="sample-badge">试读</span>' : ''}</div><p class="book-author">${escapeHTML(book.author)}</p><div class="book-progress"><div class="progress-track" role="progressbar" aria-label="阅读进度" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${percent}%"></div></div><span class="progress-label">${percent > 0 ? `${percent}%` : '未阅读'}</span></div></div></button>
    <div class="book-actions">${book.sample ? '' : `<button class="icon-button book-menu" data-action="export" data-id="${book.id}" aria-label="导出《${escapeHTML(book.title)}》" title="导出 TXT">${icon('download', 'icon')}</button>`}<button class="icon-button book-menu delete" data-action="delete" data-id="${book.id}" aria-label="从书架移除《${escapeHTML(book.title)}》" title="移除书籍">${icon('trash', 'icon')}</button></div>
  </article>`;
}

function bookResults(): string {
  const visible = filteredBooks();
  const cards = visible.map(bookCard).join('');
  if (filter === 'all' && !search) {
    return `${cards}<button class="add-book-card" data-action="import"><span class="add-icon">${icon('plus')}</span><span class="title-3">添一本新书</span><span class="caption-5">让新的故事，在这里发生</span></button>`;
  }
  if (!cards) {
    return `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${icon(search ? 'search' : 'book')}</div><h3 class="title-2">${search ? '没有找到这本书' : '这里还没有书籍'}</h3><p class="body-3">${search ? '换个书名或作者试试看。' : '导入一本喜欢的小说，开始你的阅读时光。'}</p><button class="secondary-button button-sm" data-action="${search ? 'clear-search' : 'import'}">${search ? '清除搜索' : '导入小说'}</button></div>`;
  }
  return cards;
}

function shelf(): string {
  const readCount = books.filter((book) => progress(book) > 0).length;
  const chapters = books.reduce((total, book) => total + book.chapterCount, 0);
  return `<main id="main-content" class="container">
    <section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><p class="hero-eyebrow eyebrow">留一点时间，给自己</p><h1 id="hero-title"><span>把时光，</span><span>读成喜欢的样子。</span></h1><p class="hero-description">在文字里慢下来，在故事里，<br>遇见另一个自己。</p></div>${heroArt()}</section>
    <section class="library-summary" aria-label="书架概览"><div class="summary-item"><span class="summary-icon">${icon('book')}</span><div class="summary-text"><strong>${books.length}</strong><span>本藏书</span></div></div><div class="summary-separator"></div><div class="summary-item"><span class="summary-icon">${icon('clock')}</span><div class="summary-text"><strong>${readCount}</strong><span>本在读</span></div></div><div class="summary-separator"></div><div class="summary-item"><span class="summary-icon">${icon('file')}</span><div class="summary-text"><strong>${chapters}</strong><span>个章节</span></div></div><div class="summary-note caption-5">${icon('leaf')}今天，也给自己一页安静。</div></section>
    <section class="shelf-section" aria-labelledby="shelf-title"><div class="shelf-heading"><div class="shelf-title-group"><h2 class="shelf-title" id="shelf-title">我的书架</h2><span class="book-count" id="book-count">${books.length} 本</span></div><label class="search-box">${icon('search')}<input id="book-search" type="search" placeholder="搜索书名或作者" aria-label="搜索书名或作者" value="${escapeHTML(search)}"></label></div>
    <div class="filter-row" role="group" aria-label="按阅读状态筛选"><button class="filter-button title-4 ${filter === 'all' ? 'active' : ''}" data-action="filter" data-filter="all" aria-pressed="${filter === 'all'}">全部书籍 <span class="filter-count">${books.length}</span></button><button class="filter-button title-4 ${filter === 'reading' ? 'active' : ''}" data-action="filter" data-filter="reading" aria-pressed="${filter === 'reading'}">正在阅读 <span class="filter-count">${readCount}</span></button><button class="filter-button title-4 ${filter === 'unread' ? 'active' : ''}" data-action="filter" data-filter="unread" aria-pressed="${filter === 'unread'}">尚未开始 <span class="filter-count">${books.length - readCount}</span></button></div>
    <div class="book-grid" id="book-grid">${bookResults()}</div></section>
    <footer class="shelf-footer"><p class="footer-note caption-5">${icon('shield')}书籍保存在服务端 ~/.bqread，阅读进度保存在当前浏览器。</p><div class="footer-links"><button class="footer-link caption-5" data-action="privacy">关于书籍存储</button><button class="footer-link caption-5" data-action="help">使用帮助</button></div></footer>
  </main>`;
}

function loadingShelf(): string {
  return `<main id="main-content" class="container"><section class="hero"><div><p class="hero-eyebrow eyebrow">留一点时间，给自己</p><h1><span>把时光，</span><span>读成喜欢的样子。</span></h1><p class="hero-description">正在整理你的书架，请稍候。</p></div>${heroArt()}</section><div class="book-grid" style="margin-top:48px" aria-label="正在加载书架">${Array.from({ length: 4 }, () => '<div class="skeleton-card" aria-hidden="true"><div class="skeleton-cover"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>').join('')}</div></main>`;
}

function currentBook(): BookSummary | undefined {
  return books.find((book) => book.id === reader?.bookId);
}

function readingView(book: BookSummary): string {
  const chapter = reader!.chapters[reader!.chapterIndex]!;
  const text = reader!.window.texts[reader!.chapterIndex - reader!.window.start]!;
  const paragraphs: string[] = [];
  for (const line of text.matchAll(/[^\n]+/g)) {
    const trimmed = line[0].trimStart();
    if (!trimmed) continue;
    const start = line.index! + line[0].length - trimmed.length;
    paragraphs.push(`<p data-start="${start}">${escapeHTML(trimmed.trimEnd())}</p>`);
  }
  return `<div class="reader-shell ${chat?.open ? 'with-chat' : ''}" data-theme="${settings.theme}"><header class="reader-header"><div class="reader-brand"><button class="icon-button back-button" data-action="home" aria-label="返回书架" title="返回书架">${icon('left')}</button><span class="reader-book-title title-3">${escapeHTML(book.title)}</span></div><div class="reader-header-actions"><span class="reader-local caption-5">${icon('check')}进度已自动保存</span><nav class="header-chapter-navigation" aria-label="章节导航"><button class="chapter-button button-sm" data-action="previous" ${reader!.chapterIndex === 0 ? 'disabled' : ''}>${icon('left')}上一章</button><button class="chapter-button button-sm" data-action="next" ${reader!.chapterIndex === book.chapterCount - 1 ? 'disabled' : ''}>下一章${icon('right')}</button></nav><button class="icon-button ${reader!.drawer === 'contents' ? 'active' : ''}" data-action="contents" aria-label="章节目录" aria-expanded="${reader!.drawer === 'contents'}" title="章节目录">${icon('list')}</button><button class="icon-button ${reader!.drawer === 'settings' ? 'active' : ''}" data-action="settings" aria-label="阅读设置" aria-expanded="${reader!.drawer === 'settings'}" title="阅读设置">${icon('settings')}</button><button class="chat-toggle" data-action="chat" aria-label="对话" aria-expanded="${Boolean(chat?.open)}" aria-controls="book-chat">${icon('chat')}<span>对话</span></button></div></header>
    <div class="reading-column"><main class="reading-main" id="main-content"><p class="reading-eyebrow caption-5">${escapeHTML(book.title)} · ${escapeHTML(book.author)}</p><h1 class="reading-chapter-title">${escapeHTML(chapter.title)}</h1><article class="reading-content" data-font="${settings.fontSize}" aria-label="${escapeHTML(chapter.title)}正文">${paragraphs.join('') || '<p>本章没有正文。</p>'}</article><div class="reading-end caption-5"><span class="end-ornament">${reader!.chapterIndex === book.chapterCount - 1 ? '全书完，感谢阅读' : '本章完，稍作休息'}</span></div></main>
    <footer class="reader-footer"><div class="reader-progress-info caption-5"><span>第 ${reader!.chapterIndex + 1} / ${book.chapterCount} 章</span><span id="reader-percent">${progress(book)}% 已读</span></div><div class="reader-progress" role="progressbar" aria-label="全书阅读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress(book)}"><div id="reader-progress-fill" style="width:${progress(book)}%"></div></div></footer>
    </div><button type="button" class="passage-chat" data-action="passage-chat" aria-label="就选段对话" aria-controls="book-chat" hidden>${icon('chat')}对话</button>${chat?.open ? chat.panelHTML() : ''}
    ${reader!.drawer ? '<div class="reader-scrim" data-action="close-drawer"></div>' : ''}${readerDrawer(book)}
  </div>`;
}

function readerDrawer(book: BookSummary): string {
  if (reader?.drawer === 'contents') {
    return `<aside class="reader-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-header"><h2 class="drawer-title" id="drawer-title">目录</h2><button class="icon-button" data-action="close-drawer" aria-label="关闭目录">${icon('close')}</button></div><p class="drawer-subtitle body-3">共 ${book.chapterCount} 章 · 已读 ${progress(book)}%</p><ol class="chapter-list">${reader.chapters.map((chapter, index) => `<li><button class="chapter-link title-4 ${index === reader!.chapterIndex ? 'active' : ''}" data-action="chapter" data-chapter="${index}" ${index === reader!.chapterIndex ? 'aria-current="location"' : ''}><span class="chapter-number">${String(index + 1).padStart(2, '0')}</span><span>${escapeHTML(chapter.title)}</span></button></li>`).join('')}</ol></aside>`;
  }
  if (reader?.drawer === 'settings') {
    return `<aside class="reader-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-header"><h2 class="drawer-title" id="drawer-title">阅读设置</h2><button class="icon-button" data-action="close-drawer" aria-label="关闭阅读设置">${icon('close')}</button></div><section class="setting-section"><span class="setting-label title-4">阅读主题</span><div class="theme-options">${(['paper', 'sage', 'night'] as const).map((theme) => `<button class="theme-option caption-4 ${settings.theme === theme ? 'active' : ''}" data-action="theme" data-theme="${theme}" aria-pressed="${settings.theme === theme}"><span class="theme-swatch ${theme}">${icon(theme === 'night' ? 'moon' : 'sun')}</span>${{ paper: '暖纸白', sage: '护眼绿', night: '静谧夜' }[theme]}</button>`).join('')}</div></section><section class="setting-section"><span class="setting-label title-4">正文字号</span><div class="font-controls"><button class="icon-button" data-action="font" data-direction="smaller" aria-label="减小字号" ${settings.fontSize === 16 ? 'disabled' : ''}>${icon('left')}</button><span class="font-size-value" id="font-size-value">${settings.fontSize}</span><button class="icon-button" data-action="font" data-direction="larger" aria-label="增大字号" ${settings.fontSize === 20 ? 'disabled' : ''}>${icon('right')}</button></div></section><p class="setting-tip caption-2">设置会自动保存在当前浏览器。阅读时，使用键盘左右方向键也可以切换章节。</p></aside>`;
  }
  return '';
}

function modalView(): string {
  if (!modal) return '';
  if (modal === 'help') {
    return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 class="modal-title" id="modal-title">让阅读，简单一点</h2><p class="modal-description body-3">一份简短的墨读使用指南</p></div><button class="icon-button modal-close" data-action="close-modal" aria-label="关闭使用指南">${icon('close')}</button></div><p class="help-intro body-3">墨读是一款私人书库阅读器，无需注册。挑一本喜欢的书，就能开始。</p><ol class="help-steps"><li><div><h3 class="title-3">导入你的小说</h3><p class="body-3">选择 TXT 文件，或直接粘贴文字。支持 UTF-8 与 GB18030 编码，文件不超过 10 MB。</p></div></li><div><h3 class="title-3">找到想读的那一章</h3><p class="body-3">自动识别“第一章”等章节标题。阅读页右上角可以打开目录，随时切换。</p></div><li><div><h3 class="title-3">让页面合你的心意</h3><p class="body-3">选择暖纸白、护眼绿或静谧夜，字号也可以自由调整。</p></div></li></ol><div class="shortcuts caption-5"><span><kbd>←</kbd> 上一章</span><span><kbd>→</kbd> 下一章</span><span><kbd>Esc</kbd> 关闭面板</span></div></section></div>`;
  }
  if (modal === 'privacy') {
    return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 class="modal-title" id="modal-title">你的故事，只属于你</h2><p class="modal-description body-3">关于书籍与阅读数据的保存方式</p></div><button class="icon-button modal-close" data-action="close-modal" aria-label="关闭书籍存储说明">${icon('close')}</button></div><div class="privacy-points"><div class="privacy-point">${icon('shield')}<div><h3 class="title-3">书籍保存在服务端</h3><p class="body-3">TXT 在浏览器内解码后，按章节建立索引，保存在运行墨读的服务端 ~/.bqread/books 文件夹中。</p></div></div><div class="privacy-point">${icon('book')}<div><h3 class="title-3">阅读进度保存在浏览器</h3><p class="body-3">阅读进度与阅读偏好保存在 localStorage，清除浏览器网站数据会删除它们，但服务端书籍不受影响。</p></div></div><div class="privacy-point">${icon('file')}<div><h3 class="title-3">随时管理书籍</h3><p class="body-3">点击封面右上角的导出按钮可下载 UTF-8 TXT，点击移除按钮会删除服务端书籍。</p></div></div></div><button class="primary-button button-sm" data-action="close-modal">我知道了</button></section></div>`;
  }
  if (modal === 'delete') {
    const book = books.find((item) => item.id === deleteId);
    return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 class="modal-title" id="modal-title">从书架移除这本书？</h2><button class="icon-button modal-close" data-action="close-modal" aria-label="取消移除">${icon('close')}</button></div><p class="delete-warning body-3">《${escapeHTML(book?.title ?? '')}》的正文将从服务端删除，当前浏览器的阅读进度也会移除，原始 TXT 文件不会受到影响。</p><div class="modal-actions"><button class="secondary-button button-sm" data-action="close-modal">保留书籍</button><button class="primary-button button-sm" data-action="confirm-delete">确认移除</button></div></section></div>`;
  }
  return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 class="modal-title" id="modal-title">带一个新故事来</h2><p class="modal-description body-3">本地导入，自在阅读</p></div><button class="icon-button modal-close" data-action="close-modal" aria-label="关闭导入窗口">${icon('close')}</button></div><div class="import-tabs" role="tablist" aria-label="导入方式"><button class="import-tab button-sm ${importTab === 'file' ? 'active' : ''}" data-action="import-tab" data-tab="file" role="tab" aria-selected="${importTab === 'file'}">${icon('file')}选择文件</button><button class="import-tab button-sm ${importTab === 'paste' ? 'active' : ''}" data-action="import-tab" data-tab="paste" role="tab" aria-selected="${importTab === 'paste'}">${icon('paste')}粘贴文本</button></div>
  ${importTab === 'file' ? `<label class="drop-zone" id="drop-zone" for="novel-file"><span class="upload-icon">${icon('upload')}</span><strong class="title-3">${importFile ? escapeHTML(importFile.name) : '点击选择，或将 TXT 文件拖到这里'}</strong><span class="caption-5">支持 TXT 格式，最大 10 MB</span></label><input class="file-input" type="file" id="novel-file" accept=".txt,text/plain"><p class="import-note caption-5">${icon('shield')}文件将保存到运行墨读的服务端 ~/.bqread 文件夹</p><div class="field"><label class="field-label" for="import-title">书名</label><input class="text-input body-3" id="import-title" maxlength="100" placeholder="选择文件后自动填入" value="${escapeHTML(importTitle)}"></div><div class="field"><label class="field-label" for="import-author">作者 <span class="optional">选填</span></label><input class="text-input body-3" id="import-author" maxlength="50" placeholder="佚名" value="${escapeHTML(importAuthor)}"></div>` : `<div class="field"><label class="field-label" for="paste-text">小说正文</label><textarea class="text-area body-3" id="paste-text" placeholder="把小说文本粘贴到这里……">${escapeHTML(pasteText)}</textarea></div><div class="field"><label class="field-label" for="import-title">书名</label><input class="text-input body-3" id="import-title" maxlength="100" placeholder="给这个故事一个名字" value="${escapeHTML(importTitle)}"></div><div class="field"><label class="field-label" for="import-author">作者 <span class="optional">选填</span></label><input class="text-input body-3" id="import-author" maxlength="50" placeholder="佚名" value="${escapeHTML(importAuthor)}"></div>`}
  ${importError ? `<p class="form-error body-3" role="alert">${escapeHTML(importError)}</p>` : ''}<div class="modal-actions"><button class="secondary-button button-sm" data-action="close-modal" ${importing ? 'disabled' : ''}>取消</button><button class="primary-button button-sm" data-action="submit-import" ${importing ? 'disabled' : ''}>${icon(importing ? 'clock' : 'upload')}${importing ? '正在整理书籍' : '加入书架'}</button></div></section></div>`;
}

function render(): void {
  restoringScroll = true;
  const book = currentBook();
  if (openingBook) {
    app.innerHTML = `<div class="reader-shell" data-theme="${settings.theme}"><header class="reader-header"><div class="reader-brand"><button class="icon-button back-button" data-action="home" aria-label="返回书架">${icon('left')}</button><span class="reader-book-title title-3">${escapeHTML(openingBook.title)}</span></div></header><main class="reading-main" role="status">正在加载阅读位置附近的章节…</main></div>`;
    return;
  }
  app.innerHTML = `${book && reader ? readingView(book) : `${header()}${loading ? loadingShelf() : shelf()}`}${modalView()}`;
  document.body.style.overflow = modal || reader?.drawer ? 'hidden' : '';
  if (book && reader) {
    chat?.sync();
    const renderedReader = reader;
    requestAnimationFrame(() => {
      if (reader !== renderedReader) return;
      window.scrollTo({ top: chapterScroll(reader.chapterRatio), behavior: 'instant' });
      restoringScroll = false;
    });
    if (reader.drawer) requestAnimationFrame(() => {
      const drawer = document.querySelector<HTMLElement>('.reader-drawer');
      drawer?.querySelector<HTMLButtonElement>('.icon-button')?.focus({ preventScroll: true });
      const chapter = drawer?.querySelector<HTMLElement>('.chapter-link[aria-current="location"]');
      if (drawer && chapter) {
        drawer.scrollTo({ top: chapter.offsetTop - (drawer.clientHeight - chapter.offsetHeight) / 2, behavior: 'instant' });
      }
    });
  } else {
    restoringScroll = false;
  }
  if (modal) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.modal-close, .modal .primary-button')?.focus());
}

function chapterScroll(ratio: number): number {
  const main = document.querySelector<HTMLElement>('.reading-main');
  if (!main) return 0;
  return main.offsetTop + Math.max(0, main.scrollHeight - window.innerHeight + 160) * Math.min(1, Math.max(0, ratio));
}

function updateResults(): void {
  const grid = document.querySelector('#book-grid');
  if (grid) grid.innerHTML = bookResults();
  const count = document.querySelector('#book-count');
  if (count) count.textContent = `${search ? `${filteredBooks().length} / ` : ''}${books.length} 本`;
}

function showToast(message: string): void {
  clearTimeout(toastTimer);
  toastRegion.innerHTML = `<div class="toast body-3" role="status">${icon('check')}${escapeHTML(message)}</div>`;
  toastTimer = setTimeout(() => { toastRegion.innerHTML = ''; }, 3600);
}

function openModal(name: ModalName): void {
  previousFocus = document.activeElement as HTMLElement;
  modal = name;
  importError = '';
  if (name === 'import' && !importFile) {
    importTitle = '';
    importAuthor = '';
  }
  render();
}

function closeModal(): void {
  modal = null;
  importError = '';
  render();
  previousFocus?.focus();
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    showToast('浏览器未允许保存阅读偏好，本次设置仍然有效。');
  }
}

function flushProgress(): void {
  clearTimeout(saveTimer);
  const book = currentBook();
  if (!book || !reader) return;
  book.location = Math.max(book.location, reader.chapters[reader.chapterIndex]!.start + Math.floor(reader.chapterRatio * reader.chapters[reader.chapterIndex]!.length));
  book.lastReadAt = Date.now();
  try {
    saveReadingProgress(book);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '阅读进度保存失败。');
  }
}

function recordScroll(): void {
  scrollFrame = null;
  if (!reader || restoringScroll) return;
  const main = document.querySelector<HTMLElement>('.reading-main');
  if (!main) return;
  const range = Math.max(1, main.scrollHeight - window.innerHeight + 160);
  reader.chapterRatio = Math.min(1, Math.max(0, (window.scrollY - main.offsetTop) / range));
  const book = currentBook();
  if (!book) return;
  const chapter = reader.chapters[reader.chapterIndex]!;
  book.location = chapter.start + Math.floor(reader.chapterRatio * chapter.length);
  const percent = document.querySelector('#reader-percent');
  const fill = document.querySelector<HTMLElement>('#reader-progress-fill');
  const bar = document.querySelector('.reader-progress');
  if (percent) percent.textContent = `${progress(book)}% 已读`;
  if (fill) fill.style.width = `${progress(book)}%`;
  bar?.setAttribute('aria-valuenow', String(progress(book)));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushProgress, 500);
}

function cancelChapterRequest(): void {
  chapterRequest?.abort();
  chapterRequest = null;
  pendingChapter = null;
}

async function chapterWindow(book: BookSummary, index: number, signal: AbortSignal): Promise<ChapterWindow> {
  const sample = samples.find((item) => book.sample && item.id === book.id);
  if (!sample) return getChapterWindow(book.id, index, signal);
  const start = Math.max(0, index - 1);
  return { start, texts: sample.chapters.slice(start, index + 2).map((chapter) => chapter.content) };
}

async function openBook(book: BookSummary): Promise<void> {
  cancelChapterRequest();
  const request = new AbortController();
  chapterRequest = request;
  openingBook = book;
  render();
  try {
    const sample = samples.find((item) => book.sample && item.id === book.id);
    const chapters = sample
      ? sample.chapters.map(({ title, start, content }) => ({ title, start, length: content.length }))
      : await getContents(book.id, request.signal);
    const { index, ratio } = chapterAt(chapters, book.location);
    const window = await chapterWindow(book, index, request.signal);
    if (request.signal.aborted) return;
    chat = new BookChatPanel(book);
    reader = { bookId: book.id, chapters, window, chapterIndex: index, chapterRatio: ratio, drawer: null };
    flushProgress();
  } catch (error) {
    if (!request.signal.aborted) showToast(error instanceof Error ? error.message : '章节加载失败，请重试。');
  } finally {
    if (!request.signal.aborted) {
      chapterRequest = null;
      openingBook = null;
      render();
    }
  }
}

async function goToChapter(index: number): Promise<void> {
  const book = currentBook();
  if (!book || !reader || index < 0 || index >= reader.chapters.length) return;
  cancelChapterRequest();
  const request = new AbortController();
  chapterRequest = request;
  pendingChapter = index;
  try {
    if (reader.window.texts[index - reader.window.start] === undefined) {
      const status = document.querySelector('.reader-local');
      if (status) status.textContent = '正在加载章节…';
      const window = await chapterWindow(book, index, request.signal);
      if (request.signal.aborted) return;
      reader.window = window;
    }
    if (reader.chapterIndex !== index) chat?.setPassage();
    reader.chapterIndex = index;
    reader.chapterRatio = 0;
    reader.drawer = null;
    book.location = reader.chapters[index]!.start;
    flushProgress();
  } catch (error) {
    if (!request.signal.aborted) showToast(error instanceof Error ? error.message : '章节加载失败，请重试。');
  } finally {
    if (!request.signal.aborted) {
      chapterRequest = null;
      pendingChapter = null;
      render();
    }
  }
}

function syncImportFields(): void {
  const title = document.querySelector<HTMLInputElement>('#import-title');
  const author = document.querySelector<HTMLInputElement>('#import-author');
  const text = document.querySelector<HTMLTextAreaElement>('#paste-text');
  if (title) importTitle = title.value;
  if (author) importAuthor = author.value;
  if (text) pasteText = text.value;
}

async function selectFile(file: File | undefined): Promise<void> {
  if (!file) return;
  syncImportFields();
  importFile = null;
  importError = '';
  if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') {
    importError = '暂不支持这个格式，请选择 TXT 文本文件。';
    render();
    return;
  }
  importFile = file;
  importTitle = titleFromFilename(file.name);
  render();
}

async function submitImport(): Promise<void> {
  syncImportFields();
  importError = '';
  importing = true;
  render();
  try {
    const text = importTab === 'file' ? await decodeTextFile(importFile!) : pasteText;
    const book = createBook(text, importTitle, importAuthor, books.length);
    books.push(await putBook(book));
    importFile = null;
    importTitle = '';
    importAuthor = '';
    pasteText = '';
    importing = false;
    modal = null;
    filter = 'all';
    search = '';
    render();
    showToast(`《${book.title}》已加入书架，开始阅读吧。`);
    document.querySelector<HTMLButtonElement>(`[data-action="read"][data-id="${book.id}"]`)?.focus();
  } catch (error) {
    importing = false;
    importError = error instanceof Error ? error.message : '导入没有完成，请检查文件后重试。';
    render();
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(importTab === 'file' && !importFile ? '#novel-file' : '#import-title')?.focus();
  }
}

// Paragraphs render trimmed lines. Map DOM endpoints back to the original chapter,
// retaining intervening line breaks and indentation even for backward selections.
function passageOffset(article: HTMLElement, node: Node, offset: number, atEnd: boolean): number | undefined {
  if (!article.contains(node)) return;
  const paragraph = node === article
    ? article.children[offset - (atEnd ? 1 : 0)]
    : node instanceof Element ? node : node.parentElement;
  if (!(paragraph instanceof HTMLElement) || !paragraph.matches('p[data-start]')) return;
  const length = paragraph.firstChild?.textContent?.length ?? 0;
  let within = offset;
  if (node === article) within = atEnd ? length : 0;
  else if (node === paragraph) within = offset === 0 ? 0 : length;
  return Number(paragraph.dataset.start) + within;
}

function positionPassageButton(): void {
  const button = document.querySelector<HTMLButtonElement>('.passage-chat');
  if (!button || button.hidden) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    button.hidden = true;
    return;
  }
  const range = selection.getRangeAt(0);
  const backward = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
  const endpoint = range.cloneRange();
  endpoint.collapse(backward);
  let rect = endpoint.getBoundingClientRect();
  if (!rect.height) {
    const lines = range.getClientRects();
    if (lines.length) rect = lines[backward ? 0 : lines.length - 1]!;
  }
  const top = document.querySelector('.reader-header')!.getBoundingClientRect().bottom + 4;
  const bottom = document.querySelector('.reader-footer')!.getBoundingClientRect().top - 4;
  button.style.visibility = rect.bottom < top || rect.top > bottom || !rect.height ? 'hidden' : 'visible';
  const right = document.querySelector('.reading-column')!.getBoundingClientRect().right;
  button.style.left = Math.max(6, Math.min(rect.left - button.offsetWidth / 2, right - button.offsetWidth - 6)) + 'px';
  button.style.top = (rect.top - button.offsetHeight - 7 >= top ? rect.top - button.offsetHeight - 7 : Math.min(rect.bottom + 7, bottom - button.offsetHeight)) + 'px';
}

function capturePassage(): void {
  const selection = window.getSelection();
  const article = document.querySelector<HTMLElement>('.reading-content');
  const heading = document.querySelector<HTMLElement>('.reading-chapter-title');
  const button = document.querySelector<HTMLButtonElement>('.passage-chat');
  if (!reader || !chat || !article || !heading || !button) return;
  if (!selection?.rangeCount || selection.isCollapsed || reader.drawer) {
    button.hidden = true;
    return;
  }
  const range = selection.getRangeAt(0);
  const fromTitle = heading.contains(range.startContainer);
  const prefix = fromTitle ? heading.textContent + '\n' : '';
  function offset(node: Node, value: number, atEnd: boolean): number | undefined {
    if (fromTitle && heading!.contains(node)) return node === heading && value > 0 ? prefix.length - 1 : value;
    const index = passageOffset(article!, node, value, atEnd);
    if (index !== undefined) return prefix.length + index;
  }
  const start = offset(range.startContainer, range.startOffset, false);
  const end = offset(range.endContainer, range.endOffset, true);
  if (start === undefined || end === undefined || start >= end) {
    button.hidden = true;
    if (range.intersectsNode(article) || range.intersectsNode(heading)) chat.setPassage();
    return;
  }
  const text = reader.window.texts[reader.chapterIndex - reader.window.start]!;
  const previewEnd = Math.min(end, start + 160);
  const preview = prefix.slice(start, previewEnd) + text.slice(Math.max(0, start - prefix.length), Math.max(0, previewEnd - prefix.length));
  chat.setPassage({ start, end, fromTitle: fromTitle || undefined, preview: end > previewEnd ? preview + '…' : preview });
  button.hidden = false;
  positionPassageButton();
}

document.addEventListener('selectionchange', capturePassage);
window.addEventListener('resize', positionPassageButton);
app.addEventListener('pointerdown', (event) => {
  const target = event.target as HTMLElement;
  if (target.closest('.passage-chat')) event.preventDefault();
  else if (target.closest('.reading-content, .reading-chapter-title')) chat?.setPassage();
  else if (target.closest('.chat-toggle, #book-chat')) capturePassage();
});

app.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLElement>('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'backdrop-close') {
    if (event.target === button && !importing) closeModal();
  } else if (action === 'home') {
    flushProgress();
    cancelChapterRequest();
    openingBook = null;
    chat?.dispose();
    chat = null;
    reader = null;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else if (action === 'import') {
    openModal('import');
  } else if (action === 'providers') {
    void import('./provider-settings').then(({ openProviderSettings }) => openProviderSettings());
  } else if (action === 'help') {
    openModal('help');
  } else if (action === 'privacy') {
    openModal('privacy');
  } else if (action === 'close-modal') {
    closeModal();
  } else if (action === 'read') {
    const book = books.find((item) => item.id === button.dataset.id);
    if (book) void openBook(book);
  } else if (action === 'export') {
    const book = books.find((item) => item.id === button.dataset.id);
    if (book && !book.sample) {
      button.setAttribute('disabled', '');
      void exportBook(book).then(() => {
        showToast(`《${book.title}》已导出为 TXT。`);
      }).catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : '导出失败，请稍后重试。');
      }).finally(() => button.removeAttribute('disabled'));
    }
  } else if (action === 'delete') {
    deleteId = button.dataset.id ?? null;
    openModal('delete');
  } else if (action === 'confirm-delete') {
    const id = deleteId;
    if (id) {
      button.setAttribute('disabled', '');
      const book = books.find((item) => item.id === id);
      void deleteStoredBook(id, book?.sample).then(() => {
        books = books.filter((book) => book.id !== id);
        modal = null;
        render();
        showToast('书籍已从服务端书架移除。');
      }).catch(() => {
        button.removeAttribute('disabled');
        showToast('移除失败，请检查浏览器存储权限后重试。');
      });
    }
  } else if (action === 'filter') {
    filter = button.dataset.filter as ShelfFilter;
    document.querySelectorAll('.filter-button').forEach((element) => {
      const active = (element as HTMLElement).dataset.filter === filter;
      element.classList.toggle('active', active);
      element.setAttribute('aria-pressed', String(active));
    });
    updateResults();
  } else if (action === 'clear-search') {
    search = '';
    const input = document.querySelector<HTMLInputElement>('#book-search');
    if (input) input.value = '';
    updateResults();
    input?.focus();
  } else if (action === 'import-tab') {
    syncImportFields();
    importTab = button.dataset.tab as 'file' | 'paste';
    importError = '';
    render();
  } else if (action === 'submit-import') {
    if (importTab === 'file' && !importFile) {
    importError = '请先选择一个 TXT 文件。';
      importError = '请先选择一个 TXT 文件。';
      syncImportFields();
      render();
    } else if (!pasteText.trim() && importTab === 'paste') {
      syncImportFields();
      importError = '请先粘贴小说正文。';
      render();
    } else {
      void submitImport();
    }
  } else if ((action === 'chat' || action === 'passage-chat') && chat) {
    if (action === 'passage-chat') window.getSelection()?.removeAllRanges();
    if (action === 'chat' || !chat.open) {
      chat.open = action === 'passage-chat' || !chat.open;
      render();
      if (chat.open) void chat.loadHistory();
    }
    document.querySelector<HTMLElement>(chat.open ? '#chat-input' : '.chat-toggle')?.focus({ preventScroll: true });
  } else if (action === 'clear-chat' && chat) {
    void chat.clear();
  } else if (action === 'clear-passage' && chat) {
    chat.setPassage();
    document.querySelector<HTMLElement>('#chat-input')?.focus({ preventScroll: true });
  } else if (action === 'retry-history' && chat) {
    void chat.loadHistory();
  } else if (action === 'contents' || action === 'settings') {
    const drawer = action === 'contents' ? 'contents' : 'settings';
    if (!reader!.drawer) previousFocus = document.activeElement as HTMLElement;
    reader!.drawer = reader!.drawer === drawer ? null : drawer;
    render();
    if (!reader!.drawer) previousFocus?.focus();
  } else if (action === 'close-drawer') {
    reader!.drawer = null;
    render();
    previousFocus?.focus();
  } else if (action === 'previous') {
    void goToChapter((pendingChapter ?? reader!.chapterIndex) - 1);
  } else if (action === 'next') {
    void goToChapter((pendingChapter ?? reader!.chapterIndex) + 1);
  } else if (action === 'chapter') {
    void goToChapter(Number(button.dataset.chapter));
  } else if (action === 'theme') {
    settings.theme = button.dataset.theme as ReadingSettings['theme'];
    document.querySelector('.reader-shell')?.setAttribute('data-theme', settings.theme);
    document.querySelectorAll('.theme-option').forEach((element) => {
      const active = (element as HTMLElement).dataset.theme === settings.theme;
      element.classList.toggle('active', active);
      element.setAttribute('aria-pressed', String(active));
    });
    saveSettings();
  } else if (action === 'font') {
    settings.fontSize = Math.min(20, Math.max(16, settings.fontSize + (button.dataset.direction === 'larger' ? 2 : -2))) as FontSize;
    document.querySelector('.reading-content')?.setAttribute('data-font', String(settings.fontSize));
    const label = document.querySelector('#font-size-value');
    if (label) label.textContent = String(settings.fontSize);
    document.querySelectorAll<HTMLButtonElement>('[data-action="font"]').forEach((control) => {
      control.disabled = control.dataset.direction === 'smaller' ? settings.fontSize === 16 : settings.fontSize === 20;
    });
    saveSettings();
    requestAnimationFrame(recordScroll);
  }
});

app.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (target.id === 'chat-input' && chat) {
    chat.setDraft(target.value);
  } else if (target.id === 'book-search') {
    search = target.value;
    updateResults();
  } else if (target.id === 'import-title') {
    importTitle = target.value;
  } else if (target.id === 'import-author') {
    importAuthor = target.value;
  } else if (target.id === 'paste-text') {
    pasteText = target.value;
  }
});

app.addEventListener('submit', (event) => {
  if ((event.target as HTMLElement).id !== 'chat-form') return;
  event.preventDefault();
  if (reader && chat) void chat.send(reader.chapterIndex, reader.chapterRatio);
});

app.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'novel-file') void selectFile(target.files?.[0]);
});

app.addEventListener('dragover', (event) => {
  if ((event.target as HTMLElement).closest('#drop-zone')) {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    document.querySelector('#drop-zone')?.classList.add('dragging');
  }
});
app.addEventListener('dragleave', () => document.querySelector('#drop-zone')?.classList.remove('dragging'));
app.addEventListener('drop', (event) => {
  const zone = (event.target as HTMLElement).closest('#drop-zone');
  if (!zone) return;
  event.preventDefault();
  document.querySelector('#drop-zone')?.classList.remove('dragging');
  void selectFile(event.dataTransfer?.files[0]);
});

window.addEventListener('scroll', () => {
  positionPassageButton();
  if (reader && scrollFrame === null) scrollFrame = requestAnimationFrame(recordScroll);
}, { passive: true });
window.addEventListener('pagehide', flushProgress);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushProgress();
});

window.addEventListener('keydown', (event) => {
  if ((event.target as HTMLElement).id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    document.querySelector<HTMLFormElement>('#chat-form')?.requestSubmit();
    return;
  }
  if (event.key === 'Escape') {
    if (modal) closeModal();
    else if (reader?.drawer) {
      reader.drawer = null;
      render();
      previousFocus?.focus();
    } else if (chat?.open) {
      chat.open = false;
      render();
      document.querySelector<HTMLElement>('.chat-toggle')?.focus({ preventScroll: true });
    }
  }
  if (event.key === 'Tab' && (modal || reader?.drawer)) {
    const container = document.querySelector<HTMLElement>('.modal, .reader-drawer');
    const focusable = [...(container?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]') ?? [])];
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (reader && !reader.drawer && !modal && !(event.target as HTMLElement).closest('#book-chat') && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      void goToChapter((pendingChapter ?? reader.chapterIndex) + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      void goToChapter((pendingChapter ?? reader.chapterIndex) - 1);
    }
  }
});

async function init(): Promise<void> {
  try {
    books = await getBooks();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '服务端书库暂不可用，试读仍可正常进行。');
  }
  const existingSamples = new Set(books.filter((book) => book.sample).map((book) => book.id));
  const sampleSummaries = samples.filter((book) => !existingSamples.has(book.id)).map(({ chapters, content, ...book }) => ({
    ...book, chapterCount: chapters.length, contentLength: content.length,
  }));
  books = restoreReadingProgress([...books, ...sampleSummaries]);
  loading = false;
  render();
}

render();
void init();

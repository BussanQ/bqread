import { nativeComposer } from './mobile/chat-composer';
import { newId } from '../server/shared/id.mjs';
import { onIPhone } from './mobile/platform';
import { escapeHTML } from './html';
import { icon } from './icons';
import type { BookSummary } from './types';

interface Reply {
  answer: string;
  activity?: LookupStep[];
  citation?: { title: string; quote: string };
  reference?: { title: string; text: string };
}

interface LookupStep {
  id: number;
  action: 'search' | 'read';
  target: string;
  query?: string;
  status: 'running' | 'done' | 'failed' | 'empty' | 'interrupted';
}

function stepHTML(step: LookupStep): string {
  const labels = { running: '进行中', done: '完成', failed: '失败', empty: '未找到匹配', interrupted: '已中断' };
  const title = step.action === 'search' ? `搜索「${step.query || ''}」` : `读取${step.target}`;
  return `${icon(step.action === 'search' ? 'search' : 'book')}<span>${escapeHTML(title)}${step.action === 'search' ? `<small>${escapeHTML(step.target)}</small>` : ''}</span><small>${labels[step.status]}</small>`;
}

function lookupHTML(steps: LookupStep[], live = false): string {
  const rows = steps.map(step => `<li data-step="${step.id}">${stepHTML(step)}</li>`).join('');
  return `<details class="chat-lookup" ${live ? 'open' : ''}><summary>查书过程</summary><ol>${rows}</ol></details>`;
}

type TurnResult = Reply & { index: number; error?: string };

async function readTurn(response: Response, onStep: (step: LookupStep) => void): Promise<TurnResult> {
  if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) return response.json();
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error('查书连接已中断，请重试。');
      pending += value;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const frame = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        if (frame.type === 'activity') onStep(frame.step);
        if (frame.type === 'error') throw new Error(frame.error);
        if (frame.type === 'done') return frame.reply;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

interface Passage {
  fromTitle?: true;
  start: number;
  end: number;
  preview: string;
}

async function localChat() {
  return (await import('./mobile/chat')).mobileChat();
}

async function historyRequest(book: BookSummary, signal: AbortSignal, conversation?: string) {
  if (onIPhone) {
    const history = await localChat();
    return conversation ? history.clear(book.id, book.sample, conversation) : history.list(book.id, book.sample);
  }
  const response = await fetch(`/api/books/${encodeURIComponent(book.id)}/chat?sample=${book.sample}`, conversation
    ? { method: 'DELETE', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation }) }
    : { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '对话记录不可用。');
  return data;
}

async function askBook(book: BookSummary, input: object, signal: AbortSignal, step: (value: LookupStep) => void): Promise<TurnResult> {
  if (onIPhone) return (await localChat()).ask(book.id, input, step);
  const response = await fetch(`/api/books/${encodeURIComponent(book.id)}/chat`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(input),
  });
  const reply = await readTurn(response, step);
  if (!response.ok || !reply.answer) throw Object.assign(new Error(reply.error || '未能取得回答，请重试。'), { status: response.status });
  return reply;
}

export class BookChatPanel {
  open = false;
  private draft = '';
  readonly composerSession = newId();
  private composerRevision = 0;
  private turns: { question: string; reply: Reply }[] = [];
  private pending = '';
  private steps = new Map<number, LookupStep>();
  private conversation?: string;
  private sending?: AbortController;
  private error = '';
  private historyState: 'idle' | 'loading' | 'ready' | 'clearing' | 'error' = 'idle';
  private passage?: Passage;
  private retry: { question: string; chapter: number; ratio: number; passage?: Omit<Passage, 'preview'>; requestId: string } | null = null;
  private lifetime = new AbortController();

  constructor(private book: BookSummary) {}

  dispose(): void {
    this.lifetime.abort();
    this.sending?.abort();
  }

  private resetDraft(): void {
    this.draft = '';
    this.retry = null;
    this.passage = undefined;
    this.steps.clear();
    if (this.open && !this.lifetime.signal.aborted) window.getSelection()?.removeAllRanges();
  }

  async loadHistory(): Promise<void> {
    if (this.historyState === 'loading' || this.historyState === 'clearing' || this.pending) return;
    this.historyState = 'loading';
    this.error = '';
    this.sync();
    try {
      const data = await historyRequest(this.book, this.lifetime.signal);
      if (!Array.isArray(data.turns)) throw new Error('对话记录读取失败。');
      if (this.conversation && data.conversation !== this.conversation) this.resetDraft();
      this.turns = data.turns;
      this.conversation = data.conversation;
      this.historyState = 'ready';
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      this.historyState = 'error';
      this.error = error instanceof Error ? error.message : '对话记录读取失败。';
    } finally {
      if (!this.lifetime.signal.aborted) this.sync();
    }
  }

  async clear(): Promise<void> {
    if (this.historyState !== 'ready' || !this.conversation) return;
    this.historyState = 'clearing';
    this.sending?.abort();
    this.sending = undefined;
    this.pending = '';
    this.error = '';
    this.sync();
    try {
      const data = await historyRequest(this.book, this.lifetime.signal, this.conversation);
      if (!data.conversation) throw new Error('清理聊天失败，请重试。');
      this.conversation = data.conversation;
      this.turns = [];
      this.resetDraft();
      this.historyState = 'ready';
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      this.historyState = 'error';
      this.error = error instanceof Error ? error.message : '清理聊天失败，请重新读取。';
    } finally {
      if (!this.lifetime.signal.aborted) {
        this.sync();
        if (this.open && this.historyState === 'ready') this.focusInput();
      }
    }
  }

  focusInput(): void {
    if (nativeComposer) nativeComposer.postMessage({ action: 'focus', session: this.composerSession });
    else document.querySelector<HTMLElement>('#chat-input')?.focus({ preventScroll: true });
  }

  acceptNativeDraft(text: string, revision: number): void {
    this.composerRevision = revision;
    this.draft = text;
  }

  panelHTML(): string {
    return `<aside class="book-chat" id="book-chat" aria-labelledby="chat-title">
      <header class="chat-heading"><h2 id="chat-title">${icon('chat')}对话</h2><button class="chat-clear" data-action="clear-chat" title="清理本书聊天，开始新对话">${icon('trash')}<span>清理聊天</span></button><button class="icon-button" data-action="chat" aria-label="关闭对话">${icon('close')}</button></header>
      <div class="chat-history" role="log" aria-label="本书对话" aria-live="polite"></div>
      <div class="chat-bottom"><div class="chat-selection" hidden><div><strong>已选正文</strong><p></p></div><button class="icon-button" data-action="clear-passage" aria-label="移除选段">${icon('close')}</button></div><p class="chat-error" role="alert" hidden></p>
      ${nativeComposer ? '' : `<form id="chat-form"><textarea rows="2" maxlength="2000" id="chat-input" aria-label="关于本书的问题" placeholder="输入关于本书的问题…">${escapeHTML(this.draft)}</textarea>
      <button class="chat-send" type="submit" aria-label="发送消息" title="发送消息">${icon('arrow')}</button></form>`}</div>
    </aside>`;
  }

  setDraft(text: string): void {
    this.draft = text;
    const canSend = this.historyState === 'ready' && !this.pending && !this.passageTooLong;
    if (nativeComposer && this.open && !this.lifetime.signal.aborted && !document.querySelector('.reader-drawer')) {
      nativeComposer.postMessage({ action: 'show', session: this.composerSession, draft: text,
        revision: this.composerRevision, editable: this.historyState !== 'clearing', canSend,
        theme: document.querySelector<HTMLElement>('.reader-shell')?.dataset.theme });
    }
    const button = document.querySelector<HTMLButtonElement>('.chat-send');
    if (button) button.disabled = !canSend || !text.trim();
  }

  private get passageTooLong(): boolean {
    return !!this.passage && this.passage.end - this.passage.start > 8000;
  }

  setPassage(passage?: Passage): void {
    this.passage = passage;
    const box = document.querySelector<HTMLElement>('.chat-selection');
    if (!box) return;
    box.hidden = !passage;
    box.querySelector('p')!.textContent = this.passageTooLong ? '选段超过 8000 字，请缩短选段或移除引用。' : passage?.preview ?? '';
    this.setDraft(this.draft);
  }

  sync(): void {
    const history = document.querySelector<HTMLElement>('#book-chat .chat-history');
    if (!history) return;
    const parts = this.turns.map(({ question, reply }) => {
      const source = reply.citation;
      const ref = reply.reference;
      const lookup = reply.activity?.length ? lookupHTML(reply.activity) : '';
      return `<div class="chat-user">${ref ? `<details class="chat-reference"><summary>引用 · ${escapeHTML(ref.title)}</summary>${escapeHTML(ref.text)}</details>` : ''}${escapeHTML(question)}</div>${lookup}<div class="chat-answer">${escapeHTML(reply.answer)}${source ? `<blockquote><strong>${escapeHTML(source.title)}</strong>${escapeHTML(source.quote)}</blockquote>` : ''}</div>`;
    });
    if (this.pending) parts.push(`<p class="chat-user">${escapeHTML(this.pending)}</p><div class="chat-live">${this.steps.size ? lookupHTML([...this.steps.values()], true) : '<p class="chat-hint">正在查阅本书…</p>'}</div>`);
    else if (this.error && this.steps.size) parts.push(lookupHTML([...this.steps.values()]));
    if (this.historyState === 'loading') parts.push('<p class="chat-hint">正在读取对话记录…</p>');
    if (this.historyState === 'error') parts.push('<button class="chapter-button" data-action="retry-history">重新读取</button>');
    history.innerHTML = parts.join('') || '<p class="chat-hint">想聊聊书里的哪一段？</p>';
    history.scrollTop = history.scrollHeight;
    const input = document.querySelector<HTMLTextAreaElement>('#chat-input');
    if (input) {
      input.value = this.draft;
      input.disabled = this.historyState === 'clearing';
    }
    const clear = document.querySelector<HTMLButtonElement>('[data-action="clear-chat"]')!;
    clear.disabled = this.historyState !== 'ready' || !this.conversation;
    clear.querySelector('span')!.textContent = this.historyState === 'clearing' ? '正在清理…' : '清理聊天';
    const error = document.querySelector<HTMLElement>('.chat-error')!;
    error.hidden = !this.error;
    error.textContent = this.error;
    this.setPassage(this.passage);
  }

  private updateStep(step: LookupStep): void {
    if (this.lifetime.signal.aborted) return;
    this.steps.set(step.id, step);
    const live = document.querySelector<HTMLElement>('.chat-live');
    const history = live?.parentElement;
    if (!live || !history) return;
    const atBottom = history.scrollHeight - history.clientHeight - history.scrollTop < 32;
    if (!live.querySelector('ol')) live.innerHTML = lookupHTML([], true);
    const list = live.querySelector('ol')!;
    let row = list.querySelector(`li[data-step="${step.id}"]`);
    if (!row) {
      row = document.createElement('li');
      row.setAttribute('data-step', String(step.id));
      list.append(row);
    }
    row.innerHTML = stepHTML(step);
    if (atBottom) history.scrollTop = history.scrollHeight;
  }

  async send(chapter: number, ratio: number): Promise<void> {
    const question = this.draft.trim();
    if (!question || this.pending || this.historyState !== 'ready' || this.passageTooLong) return;
    const passage = this.passage;
    const turn = this.retry?.question === question && this.retry.chapter === chapter &&
      this.retry.passage?.start === passage?.start && this.retry.passage?.end === passage?.end &&
      this.retry.passage?.fromTitle === passage?.fromTitle ? this.retry : {
      question, chapter, ratio, passage: passage && { start: passage.start, end: passage.end, fromTitle: passage.fromTitle },
      requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join(''),
    };
    let refresh = false;
    this.pending = question;
    this.steps.clear();
    this.draft = '';
    this.error = '';
    this.sync();
    const sending = new AbortController();
    this.sending = sending;
    try {
      const reply = await askBook(this.book, { ...turn, sample: this.book.sample, conversation: this.conversation },
        sending.signal, step => { if (!sending.signal.aborted) this.updateStep(step); });
      if (sending.signal.aborted) return;
      this.retry = null;
      this.steps.clear();
      if (this.passage === passage) this.setPassage();
      if (reply.index === this.turns.length) this.turns.push({ question, reply });
      else refresh = true;
    } catch (error) {
      if (sending.signal.aborted) return;
      if (error instanceof Error && 'status' in error && error.status === 409 && error.message.includes('对话已更新')) refresh = true;
      this.retry = turn;
      for (const step of this.steps.values()) if (step.status === 'running') step.status = 'interrupted';
      if (!this.draft) this.draft = question;
      this.error = error instanceof Error ? error.message : '发送失败，请重试。';
    } finally {
      if (this.sending === sending) {
        this.pending = '';
        this.sending = undefined;
      }
      if (!sending.signal.aborted) {
        if (refresh) await this.loadHistory();
        else this.sync();
      }
    }
  }
}

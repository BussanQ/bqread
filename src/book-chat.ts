import { escapeHTML } from './html';
import { icon } from './icons';
import type { BookSummary } from './types';

interface Reply {
  answer: string;
  citation?: { title: string; quote: string };
}

export class BookChatPanel {
  open = false;
  private draft = '';
  private turns: { question: string; reply: Reply }[] = [];
  private pending = '';
  private error = '';
  private historyState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private retry: { question: string; chapter: number; ratio: number; requestId: string } | null = null;
  private lifetime = new AbortController();

  constructor(private book: BookSummary) {}

  dispose(): void { this.lifetime.abort(); }

  async loadHistory(): Promise<void> {
    if (this.historyState === 'loading' || this.pending) return;
    this.historyState = 'loading';
    this.error = '';
    this.sync();
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(this.book.id)}/chat?sample=${this.book.sample}`, { signal: this.lifetime.signal });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.turns)) throw new Error(data.error || '对话记录读取失败。');
      this.turns = data.turns;
      this.historyState = 'ready';
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      this.historyState = 'error';
      this.error = error instanceof Error ? error.message : '对话记录读取失败。';
    } finally {
      if (!this.lifetime.signal.aborted) this.sync();
    }
  }

  panelHTML(): string {
    return `<aside class="book-chat" id="book-chat" aria-labelledby="chat-title">
      <header class="chat-heading"><h2 id="chat-title">${icon('chat')}对话</h2><button class="icon-button" data-action="chat" aria-label="关闭对话">${icon('close')}</button></header>
      <div class="chat-history" role="log" aria-label="本书对话" aria-live="polite"></div>
      <div class="chat-bottom"><p class="chat-error" role="alert" hidden></p>
      <form id="chat-form"><textarea rows="2" maxlength="2000" id="chat-input" aria-label="关于本书的问题" placeholder="输入关于本书的问题…">${escapeHTML(this.draft)}</textarea>
      <button class="chat-send" type="submit" aria-label="发送消息" title="发送消息">${icon('arrow')}</button></form></div>
    </aside>`;
  }

  setDraft(text: string): void {
    this.draft = text;
    const button = document.querySelector<HTMLButtonElement>('.chat-send');
    if (button) button.disabled = this.historyState !== 'ready' || !text.trim() || !!this.pending;
  }

  sync(): void {
    const history = document.querySelector<HTMLElement>('#book-chat .chat-history');
    if (!history) return;
    const parts = this.turns.map(({ question, reply }) => {
      const source = reply.citation;
      return `<p class="chat-user">${escapeHTML(question)}</p><div class="chat-answer">${escapeHTML(reply.answer)}${source ? `<blockquote><strong>${escapeHTML(source.title)}</strong>${escapeHTML(source.quote)}</blockquote>` : ''}</div>`;
    });
    if (this.pending) parts.push(`<p class="chat-user">${escapeHTML(this.pending)}</p><p class="chat-hint">正在阅读书中片段…</p>`);
    if (this.historyState === 'loading') parts.push('<p class="chat-hint">正在读取对话记录…</p>');
    if (this.historyState === 'error') parts.push('<button class="chapter-button" data-action="retry-history">重新读取</button>');
    history.innerHTML = parts.join('') || '<p class="chat-hint">想聊聊书里的哪一段？</p>';
    history.scrollTop = history.scrollHeight;
    const input = document.querySelector<HTMLTextAreaElement>('#chat-input')!;
    input.value = this.draft;
    const error = document.querySelector<HTMLElement>('.chat-error')!;
    error.hidden = !this.error;
    error.textContent = this.error;
    this.setDraft(this.draft);
  }

  async send(chapter: number, ratio: number): Promise<void> {
    const question = this.draft.trim();
    if (!question || this.pending || this.historyState !== 'ready') return;
    const turn = this.retry?.question === question && this.retry.chapter === chapter ? this.retry : {
      question, chapter, ratio, requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join(''),
    };
    let refresh = false;
    this.pending = question;
    this.draft = '';
    this.error = '';
    this.sync();
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(this.book.id)}/chat`, {
        method: 'POST', signal: this.lifetime.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...turn, sample: this.book.sample }),
      });
      const reply = await response.json() as Reply & { index: number; error?: string };
      if (!response.ok || !reply.answer) throw new Error(reply.error || '未能取得回答，请重试。');
      this.retry = null;
      if (reply.index === this.turns.length) this.turns.push({ question, reply });
      else refresh = true;
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      this.retry = turn;
      if (!this.draft) this.draft = question;
      this.error = error instanceof Error ? error.message : '发送失败，请重试。';
    } finally {
      this.pending = '';
      if (!this.lifetime.signal.aborted) {
        if (refresh) await this.loadHistory();
        else this.sync();
      }
    }
  }
}

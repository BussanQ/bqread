import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ request, context }) => {
  expect((await request.get('/?token=bqread-browser-test-token')).ok()).toBe(true);
  await context.addCookies((await request.storageState()).cookies);
  const response = await request.get('/api/books');
  expect(response.ok()).toBe(true);
  for (const book of await response.json()) {
    expect((await request.delete(`/api/books/${book.id}`)).ok()).toBe(true);
  }
});

test('requires a valid token before opening the UI and remembers browser access', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    expect((await page.goto(baseURL!))!.status()).toBe(401);
    expect((await page.goto(`${baseURL}/?token=wrong`))!.status()).toBe(401);
    expect((await context.request.get(`${baseURL}/api/books`)).status()).toBe(401);
    await page.goto(`${baseURL}/?token=bqread-browser-test-token`);
    await expect(page.locator('.book-item')).toHaveCount(3);
    expect((await context.cookies()).find((cookie) => cookie.name === 'bqread-session')).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
    await page.goto(baseURL!);
    await expect(page.locator('.book-item')).toHaveCount(3);
    expect((await context.request.get(`${baseURL}/api/books`)).status()).toBe(200);
  } finally {
    await context.close();
  }
});

test('imports, reads, saves progress, and deletes a TXT novel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.book-item')).toHaveCount(3);

  await page.locator('#book-search').fill('不存在的书名');
  await expect(page.getByText('没有找到这本书')).toBeVisible();
  await page.locator('#book-search').fill('岛屿');
  await expect(page.locator('.book-item')).toHaveCount(1);
  await page.locator('#book-search').fill('');

  await page.getByRole('button', { name: /导入小说/ }).click();
  await page.locator('#novel-file').setInputFiles('tests/fixture-novel.txt');
  await page.locator('#import-title').fill('山间时光');
  await page.locator('#import-author').fill('许知微');
  await page.getByRole('button', { name: '加入书架' }).click();
  await expect(page.locator('.book-item')).toHaveCount(4);
  await page.getByRole('button', { name: '阅读《山间时光》' }).click();
  await expect(page.locator('.reading-chapter-title')).toHaveText('第一章 山间清晨');
  await page.getByRole('button', { name: '章节目录', exact: true }).click();
  await expect(page.locator('.chapter-link')).toHaveCount(3);
  await page.locator('.chapter-link').nth(1).click();
  await expect(page.locator('.reading-chapter-title')).toHaveText('第二章 溪边午后');

  await page.getByRole('button', { name: '阅读设置', exact: true }).click();
  await page.getByRole('button', { name: '静谧夜', exact: true }).click();
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-theme', 'night');
  await page.getByRole('button', { name: '增大字号' }).click();
  await expect(page.locator('.reading-content')).toHaveAttribute('data-font', '20');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.reading-chapter-title')).toHaveText('第三章 灯下夜读');
  await page.waitForTimeout(650);
  await page.reload();
  await expect(page.locator('.book-item')).toHaveCount(4);
  await page.getByRole('button', { name: '阅读《山间时光》' }).click();
  await expect(page.locator('.reading-chapter-title')).toHaveText('第三章 灯下夜读');
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-theme', 'night');
  await expect(page.locator('.reading-content')).toHaveAttribute('data-font', '20');
  await expect(page.locator('#reader-percent')).toHaveText(/\d{2}% 已读/);

  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: /正在阅读/ }).click();
  await expect(page.locator('.book-item')).toHaveCount(1);
  await page.getByRole('button', { name: /全部书籍/ }).click();
  await page.getByRole('button', { name: '从书架移除《山间时光》' }).click();
  await page.getByRole('button', { name: '确认移除' }).click();
  await expect(page.locator('.book-item')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.book-item')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('accepts pasted novels and fits a 390px screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.book-item')).toHaveCount(3);
  await page.getByRole('button', { name: /导入小说/ }).click();
  await page.getByRole('tab', { name: '粘贴文本' }).click();
  await page.locator('#import-title').fill('粘贴的故事');
  await page.locator('#paste-text').fill('第一章 开始\n这是一个通过粘贴文本创建的故事。\n第二章 继续\n故事还有下一章。');
  await page.getByRole('button', { name: '加入书架' }).click();
  await expect(page.locator('.book-item')).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '阅读《粘贴的故事》' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '章节目录', exact: true }).click();
  await page.locator('.chapter-link').nth(1).click();
  await expect(page.locator('.reading-chapter-title')).toHaveText('第二章 继续');
});

test('supports drag and drop, GB18030, and import errors', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.book-item')).toHaveCount(3);
  await page.getByRole('button', { name: /导入小说/ }).click();
  await page.getByRole('button', { name: '加入书架' }).click();
  await expect(page.getByRole('alert')).toHaveText('请先选择一个 TXT 文件。');
  await page.locator('#novel-file').setInputFiles({ name: 'story.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a novel') });
  await expect(page.getByRole('alert')).toHaveText('暂不支持这个格式，请选择 TXT 文本文件。');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dataTransfer.evaluate((transfer) => {
    transfer.items.add(new File(['第一章 拖放\n这是拖进阅读器的小说。'], '拖放故事.txt', { type: 'text/plain' }));
  });
  await page.locator('#drop-zone').dispatchEvent('drop', { dataTransfer });
  await expect(page.locator('#import-title')).toHaveValue('拖放故事');
  await page.getByRole('button', { name: '加入书架' }).click();
  await expect(page.locator('.book-item')).toHaveCount(4);
  await page.getByRole('button', { name: /导入小说/ }).click();
  await page.locator('#novel-file').setInputFiles({ name: '老书.txt', mimeType: 'text/plain', buffer: Buffer.from([0xC0, 0xCF, 0xB5, 0xC4, 0xD0, 0xA1, 0xCB, 0xB5, 0xA1, 0xA3]) });
  await page.locator('#import-title').fill('编码测试');
  await page.getByRole('button', { name: '加入书架' }).click();
  await page.getByRole('button', { name: '阅读《编码测试》' }).click();
  await expect(page.locator('.reading-content')).toContainText('老的小说。');
  await dataTransfer.dispose();
});

test('exports server books and retains them in a fresh browser context', async ({ page, browser }) => {
  await page.goto('/');
  await expect(page.locator('.book-item')).toHaveCount(3);
  await page.getByRole('button', { name: /导入小说/ }).click();
  await page.locator('#novel-file').setInputFiles('tests/fixture-novel.txt');
  await page.locator('#import-title').fill('服务端书库');
  await page.locator('#import-author').fill('测试作者');
  await page.getByRole('button', { name: '加入书架' }).click();
  await expect(page.locator('.book-item')).toHaveCount(4);
  const card = page.locator('.book-item').filter({ has: page.getByRole('button', { name: '阅读《服务端书库》' }) });
  await card.hover();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出《服务端书库》' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('服务端书库 - 测试作者.txt');
  const downloaded = await readFile((await download.path())!, 'utf8');
  const source = await readFile('tests/fixture-novel.txt', 'utf8');
  expect(downloaded.replace(/^\uFEFF/, '').trim()).toBe(source.replace(/\r\n?/g, '\n').trim());
  expect(await page.evaluate(() => localStorage.getItem('modu-progress'))).toBeNull();
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name))).not.toContain('modu-reader');

  const freshContext = await browser.newContext();
  const fresh = await freshContext.newPage();
  await fresh.goto(new URL('/?token=bqread-browser-test-token', page.url()).href);
  await expect(fresh.getByRole('button', { name: '阅读《服务端书库》' })).toBeVisible();
  await fresh.setViewportSize({ width: 390, height: 844 });
  await fresh.getByRole('button', { name: '导出《服务端书库》' }).scrollIntoViewIfNeeded();
  const exportBox = await fresh.getByRole('button', { name: '导出《服务端书库》' }).boundingBox();
  const deleteBox = await fresh.getByRole('button', { name: '从书架移除《服务端书库》' }).boundingBox();
  expect(exportBox!.x + exportBox!.width).toBeLessThanOrEqual(deleteBox!.x);
  await fresh.getByRole('button', { name: '从书架移除《服务端书库》' }).click();
  await expect(fresh.getByText(/的正文将从服务端删除/)).toBeVisible();
  await fresh.getByRole('button', { name: '确认移除' }).click();
  await expect(fresh.locator('.book-item')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.book-item')).toHaveCount(3);
  await freshContext.close();
});

test('migrates legacy IndexedDB books and reading progress', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.book-item')).toHaveCount(3);
  await page.evaluate(async () => {
    const content = '第一章 旧书\n旧版导入的书籍。\n第二章 继续\n迁移后仍然可读。';
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('modu-reader', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('books', { keyPath: 'id' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('books', 'readwrite');
        transaction.objectStore('books').put({
          id: 'legacy-book', title: '旧版藏书', author: '原作者', content,
          chapters: [
            { title: '第一章 旧书', start: 0, content: '旧版导入的书籍。' },
            { title: '第二章 继续', start: content.indexOf('第二章'), content: '迁移后仍然可读。' },
          ],
          cover: 'forest', addedAt: Date.now(), lastReadAt: Date.now(), location: content.indexOf('第二章'), sample: false,
        });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.route('**/api/books', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, json: { error: '测试迁移失败' } });
    } else await route.continue();
  });
  await page.reload();
  await expect(page.getByRole('status')).toContainText('测试迁移失败');
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name))).toContain('modu-reader');
  await page.unroute('**/api/books');
  await page.reload();
  await expect(page.getByRole('button', { name: '阅读《旧版藏书》' })).toBeVisible();
  const books = await (await request.get('/api/books')).json();
  expect(books.find((book: { id: string }) => book.id === 'legacy-book')).toMatchObject({ chapterCount: 2 });
  const window = await (await request.get('/api/books/legacy-book/chapters?center=0')).json();
  expect(window.texts[0]).toBe('旧版导入的书籍。');
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name))).not.toContain('modu-reader');
  await page.getByRole('button', { name: '阅读《旧版藏书》' }).click();
  await expect(page.locator('.reading-chapter-title')).toHaveText('第二章 继续');
});

test('reports failed saves and exports without reporting success', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.book-item')).toHaveCount(3);
  await page.getByRole('button', { name: /导入小说/ }).click();
  await page.locator('#novel-file').setInputFiles('tests/fixture-novel.txt');
  await page.locator('#import-title').fill('失败后重试');
  await page.route('**/api/books', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 500, json: { error: '测试文件写入失败' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: '加入书架' }).click();
  await expect(page.getByRole('alert')).toHaveText('测试文件写入失败');
  await expect(page.locator('.book-item')).toHaveCount(3);
  await page.unroute('**/api/books');
  await page.getByRole('button', { name: '加入书架' }).click();
  await expect(page.locator('.book-item')).toHaveCount(4);
  await page.route('**/api/books/*/export', (route) => route.fulfill({ status: 500, json: { error: '测试导出失败' } }));
  await page.locator('.book-item').filter({ has: page.getByRole('button', { name: '阅读《失败后重试》' }) }).hover();
  await page.getByRole('button', { name: '导出《失败后重试》' }).click();
  await expect(page.getByRole('status')).toHaveText('测试导出失败');
  await expect(page.getByRole('button', { name: '导出《失败后重试》' })).toBeEnabled();
});

test('loads one shelf summary and resumes with only nearby chapters', async ({ page, request }) => {
  const chapters = [];
  let content = '';
  for (let i = 0; i < 30; i++) {
    const title = `第${i + 1}章 测试`;
    const body = `第${i + 1}章正文。`.repeat(300);
    chapters.push({ title, start: content.length, content: body });
    content += `${title}\n${body}\n`;
  }
  const saved = await request.post('/api/books', { data: {
    id: 'long-book', title: '长篇', author: '作者', cover: 'blue', content, chapters,
  } });
  expect(saved.status()).toBe(201);
  await page.addInitScript((location) => {
    localStorage.setItem('modu-progress', JSON.stringify({ 'long-book': { location, lastReadAt: 1 } }));
  }, chapters[23].start + 100);
  const urls: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/books')) urls.push(url.pathname + url.search);
  });
  await page.goto('/');
  const read = page.getByRole('button', { name: '阅读《长篇》' });
  await expect(read).toBeVisible();
  expect(urls).toEqual(['/api/books']);
  await read.click();
  const title = page.locator('.reading-chapter-title');
  await expect(title).toHaveText(chapters[23].title);
  expect(urls.slice(1)).toEqual(['/api/books/long-book/toc', '/api/books/long-book/chapters?center=23']);
  await page.getByRole('button', { name: '下一章', exact: true }).click();
  await expect(title).toHaveText(chapters[24].title);
  expect(urls).toHaveLength(3);
  await page.getByRole('button', { name: '章节目录', exact: true }).click();
  await page.locator('.chapter-link').nth(2).click();
  await expect(title).toHaveText(chapters[2].title);
  expect(urls.at(-1)).toBe('/api/books/long-book/chapters?center=2');
  await page.getByRole('button', { name: '下一章', exact: true }).click();
  const failedWindow = '**/chapters?center=4';
  await page.route(failedWindow, (route) => route.fulfill({ status: 500, json: { error: '章节读取失败' } }));
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status')).toHaveText('章节读取失败');
  await expect(title).toHaveText(chapters[3].title);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('modu-progress')!)['long-book'].location)).toBe(chapters[3].start);
  await page.unroute(failedWindow);
  await page.keyboard.press('ArrowRight');
  await expect(title).toHaveText(chapters[4].title);
});

test('opens book chat alongside the text, retains replies across chapters and isolates books', async ({ page }) => {
  const turns: { question: string; reply: { answer: string; citation: { title: string; quote: string } } }[] = [];
  let conversation = 'first-session';
  await page.route('**/api/books/sample-0/chat?sample=true', async (route) => {
    if (route.request().method() === 'DELETE') {
      expect(route.request().postDataJSON().conversation).toBe(conversation);
      turns.length = 0;
      conversation = 'new-session';
    }
    await route.fulfill({ json: { conversation, turns } });
  });
  await page.route('**/api/books/sample-0/chat', async (route) => {
    const { question, sample, conversation: sentConversation } = route.request().postDataJSON();
    expect(sentConversation).toBe(conversation);
    expect(sample).toBe(true);
    const reply = { answer: '十五年。', citation: { title: '第一章 灯塔亮起', quote: '她已经离开这座小岛十五年' } };
    turns.push({ question, reply });
    await route.fulfill({ json: { ...reply, index: turns.length - 1 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '阅读《岛屿来信》' }).click();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '对话' });
  const reading = await page.locator('.reading-main').boundingBox();
  const bounds = await panel.boundingBox();
  expect(reading!.x + reading!.width).toBeLessThanOrEqual(bounds!.x);
  const input = panel.getByRole('textbox');
  await input.fill('她离开多久了？');
  await input.press('Enter');
  await expect(panel.locator('blockquote')).toContainText('她已经离开这座小岛十五年');
  await input.fill('下一条草稿');
  await page.getByRole('button', { name: '下一章', exact: true }).click();
  await expect(input).toHaveValue('下一条草稿');
  await input.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(panel.locator('.chat-answer')).toContainText('十五年');
  await page.getByRole('button', { name: '返回书架' }).click();
  await page.reload();
  await page.getByRole('button', { name: '阅读《岛屿来信》' }).click();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(panel.locator('.chat-user')).toHaveText('她离开多久了？');
  await expect(panel.locator('blockquote')).toContainText('第一章 灯塔亮起');
  await input.fill('可以接着讲吗？');
  await input.press('Enter');
  await expect(panel.locator('.chat-answer')).toHaveCount(2);
  await input.fill('旧草稿');
  await page.locator('.reading-content p').first().evaluate(el => window.getSelection()!.selectAllChildren(el));
  await expect(panel.locator('.chat-selection')).toBeVisible();
  await panel.getByRole('button', { name: '清理聊天' }).click();
  await expect(input).toHaveValue('');
  await expect(panel.locator('.chat-answer')).toHaveCount(0);
  await expect(panel.locator('.chat-selection')).toBeHidden();
  await input.fill('新会话的问题');
  await input.press('Enter');
  await expect(panel.locator('.chat-user')).toHaveText('新会话的问题');
  await page.getByRole('button', { name: '返回书架' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '阅读《山居日记》' }).click();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(panel.locator('.chat-answer')).toHaveCount(0);
  expect((await panel.boundingBox())!.width).toBe(390);
  await panel.getByRole('button', { name: '关闭对话' }).click();
  await expect(page.locator('.reading-main')).toBeVisible();
});

test('uses a body selection as the reference for one chat turn', async ({ page }) => {
  const book = { id: 'selection-book', title: '选段测试', author: '佚名', cover: 'blue',
    content: '序🪶言。  \n\n  第二段原文。\n下一章。',
    chapters: [{ title: '第一章', start: 0, content: '序🪶言。  \n\n  第二段原文。' }, { title: '第二章', start: 19, content: '下一章。' }] };
  expect((await page.request.post('/api/books', { data: book })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: '阅读《选段测试》' }).click();
  const article = page.locator('.reading-content');
  const select = () => article.evaluate((el) => {
    const [first, second] = el.querySelectorAll('p');
    window.getSelection()!.setBaseAndExtent(second.firstChild!, 3, first.firstChild!, 1);
  });
  const selected = '🪶言。  \n\n  第二段';
  const requests: { passage?: { start: number; end: number } }[] = [];
  await page.route('**/api/books/selection-book/chat', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { index: requests.length - 1, answer: '回答', reference: requests.length === 1 ? { title: '第一章', text: selected } : undefined } });
  });
  await select();
  const popup = page.getByRole('button', { name: '就选段对话' });
  await expect(popup).toBeVisible();
  await popup.click();
  const preview = page.locator('.chat-selection');
  await expect(preview.locator('p')).toHaveText(selected);
  const input = page.getByRole('textbox', { name: '关于本书的问题' });
  await input.fill('这段话怎么理解？');
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  await input.press('Enter');
  await expect(page.locator('.chat-reference')).toContainText('第一章');
  expect(requests[0].passage).toEqual({ start: 1, end: 1 + selected.length });
  await expect(preview).toBeHidden();
  await select();
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: '移除选段' }).click();
  await expect(preview).toBeHidden();
  await input.fill('这一章讲了什么？');
  await input.press('Enter');
  await expect(page.locator('.chat-answer')).toHaveCount(2);
  expect(requests[1].passage).toBeUndefined();
  const title = page.locator('.reading-chapter-title');
  await title.evaluate((el) => window.getSelection()!.setBaseAndExtent(el.firstChild!, 1, el.firstChild!, 3));
  const bounds = await title.boundingBox();
  await expect(popup).toBeVisible();
  const popupBounds = await popup.boundingBox();
  expect(popupBounds!.y + popupBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  await popup.click();
  await expect(input).toBeFocused();
  await expect(preview.locator('p')).toHaveText('一章');
  await expect(popup).toBeHidden();
  await input.fill('这个标题有什么含义？');
  await input.press('Enter');
  await expect(page.locator('.chat-answer')).toHaveCount(3);
  expect(requests[2].passage).toEqual({ start: 1, end: 3, fromTitle: true });
  await select();
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: '下一章', exact: true }).click();
  await expect(preview).toBeHidden();
});

test('recovers filtered searches and operates import tabs and font size by keyboard at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const search = page.getByRole('searchbox');
  await search.fill('岛屿');
  await page.getByRole('button', { name: /正在阅读/ }).click();
  await expect(page.locator('#book-count')).toHaveText('0 / 3 本');
  const suggestion = page.getByRole('button', { name: '在全部书籍中查看 1 本' });
  await suggestion.focus();
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('岛屿');
  await expect(page.locator('.book-item')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '清除搜索', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(search).toHaveValue('');
  await expect(page.locator('.book-item')).toHaveCount(3);

  await page.getByRole('button', { name: '导入小说', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭导入窗口' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tab', { name: '选择文件' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '粘贴文本', selected: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#paste-text')).toBeFocused();
  await page.locator('#paste-text').fill('第一章 草稿');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Tab');
  await expect(page.locator('#novel-file')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('End');
  await expect(page.locator('#paste-text')).toHaveValue('第一章 草稿');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '导入小说', exact: true })).toBeFocused();

  await page.locator('.book-open').first().click();
  await page.getByRole('button', { name: '阅读设置', exact: true }).click();
  for (const theme of ['护眼绿', '静谧夜', '暖纸白']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    const plus = page.getByRole('button', { name: '增大字号' });
    await plus.focus();
    await page.keyboard.press('ArrowUp');
    await expect(plus).toBeDisabled();
    await expect(page.locator('.reading-content')).toHaveAttribute('data-font', '20');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.u018-sr')).toHaveText('20 像素');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.u018-sr')).toHaveText('18 像素');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('manages AI provider connections with the keyboard and mobile controls', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 提供商', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 提供商' });
  const preset = dialog.getByRole('button', { name: /^提供商 / });
  await preset.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('d');
  await page.keyboard.press('Enter');
  await expect(preset).toBeFocused();
  await expect(dialog.getByLabel('连接名称')).toHaveValue('DeepSeek');
  await expect(dialog.getByLabel('API 基础地址')).toHaveValue('https://api.deepseek.com');
  const protocol = dialog.getByRole('button', { name: /^API 协议 / });
  await protocol.click();
  await page.keyboard.press('Escape');
  await expect(protocol).toBeFocused();
  await expect(dialog).toBeVisible();

  const model = dialog.getByRole('combobox', { name: '模型', exact: true });
  await model.fill('deepseek');
  await model.press('ArrowDown');
  await model.press('Enter');
  await expect(model).toHaveValue('deepseek-flash');
  const secret = dialog.getByLabel('API 密钥', { exact: true });
  await secret.fill('test-credential');
  const reveal = dialog.getByRole('button', { name: '显示 API 密钥' });
  await reveal.click();
  await expect(secret).toHaveAttribute('type', 'text');
  await reveal.click();
  await expect(secret).toHaveAttribute('type', 'password');
  const save = dialog.getByRole('button', { name: '保存并使用' });
  await save.click();
  await expect(dialog.locator('.provider-current strong')).toHaveText('DeepSeek · deepseek-flash');
  await expect(secret).toHaveValue('');
  await expect(dialog.locator('#provider-key-hint')).toContainText('留空沿用');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(dialog).toHaveCSS('color-scheme', 'dark');
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await dialog.getByLabel('连接名称').fill('测试连接');
  await model.fill('custom-model');
  await save.click();
  await expect(dialog.locator('.provider-current strong')).toHaveText('测试连接 · custom-model');
  expect((await (await request.get('/api/providers')).json()).profiles).toEqual([
    expect.objectContaining({ name: '测试连接', model: 'custom-model', hasKey: true }),
  ]);

  await dialog.getByRole('button', { name: '使用服务端环境配置' }).click();
  const connection = dialog.getByRole('button', { name: /^已保存的连接 / });
  await expect(connection).toContainText('添加新连接');
  await connection.click();
  await dialog.getByRole('option', { name: '测试连接 custom-model' }).click();
  await dialog.getByRole('button', { name: '移除连接' }).click();
  await expect(connection).toContainText('添加新连接');
  expect((await (await request.get('/api/providers')).json()).profiles).toEqual([]);
  await dialog.getByRole('button', { name: '关闭 AI 提供商设置' }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keeps AI provider edits on a failed save and retries without duplicating a connection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 提供商', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 提供商' });
  const model = dialog.getByRole('combobox', { name: '模型', exact: true });
  await model.fill('my-custom-model');
  let attempts = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/providers', async route => {
    if (route.request().method() === 'POST' && ++attempts === 1) {
      await pending;
      await route.fulfill({ status: 503, json: { error: '暂时无法保存。' } });
    } else await route.continue();
  });
  const save = dialog.getByRole('button', { name: '保存并使用' });
  await save.click();
  try {
    await expect(save).toHaveAttribute('aria-busy', 'true');
    await expect(save).toBeDisabled();
  } finally { release(); }
  await expect(dialog.getByRole('alert')).toHaveText('暂时无法保存。');
  await expect(model).toHaveValue('my-custom-model');
  await dialog.getByRole('button', { name: '关闭错误提示' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await save.click();
  await expect(dialog.locator('.provider-current strong')).toHaveText('OpenAI · my-custom-model');
  await dialog.getByRole('button', { name: '移除连接' }).click();
  await expect(dialog.getByRole('button', { name: /^已保存的连接 / })).toContainText('添加新连接');
  expect(attempts).toBe(3);
});

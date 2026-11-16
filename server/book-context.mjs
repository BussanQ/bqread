// Use UTF-16 offsets for reading position, just like the reader.
export async function bookContext(book, chapters, readChapter, { chapter, ratio, question }) {
  if (!Number.isInteger(chapter) || chapter < 0 || chapter >= chapters.length) {
    throw Object.assign(new Error('阅读章节无效，请重新打开书籍。'), { status: 400 });
  }
  const selected = new Set([chapter]);
  const smallBook = chapters.length <= 16 && book.contentLength <= 16000;
  const mentioned = question.match(/第[零〇一二两三四五六七八九十百千万\d]+[章节回卷]/g) ?? [];
  for (const match of question.matchAll(/第\s*(\d+)\s*章/g)) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < chapters.length) selected.add(index);
  }
  for (let i = 0; i < chapters.length; i++) {
    const title = chapters[i].title;
    if (smallBook || (selected.size < 5 && (question.includes(title) || mentioned.some((label) => title.startsWith(label))))) selected.add(i);
  }
  if (/全书|整本|整部|整体|贯穿|结局/.test(question)) {
    for (const fraction of [0, 0.33, 0.66, 1]) selected.add(Math.round((chapters.length - 1) * fraction));
  }
  if (chapter > 0) selected.add(chapter - 1);
  if (chapter + 1 < chapters.length) selected.add(chapter + 1);
  const excerpts = [];
  for (const index of [...selected].slice(0, smallBook ? 16 : 7)) {
    const text = await readChapter(index);
    const length = smallBook ? text.length : 3200;
    const offset = index === chapter ? Math.max(0, Math.min(text.length - length, Math.floor(text.length * ratio - length / 2))) : 0;
    excerpts.push({ chapter: index + 1, title: chapters[index].title, text: text.slice(offset, offset + length) });
  }
  return { title: book.title, author: book.author, currentChapter: chapter + 1, chapterCount: chapters.length, excerpts };
}

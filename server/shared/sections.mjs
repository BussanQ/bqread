const MAX_SECTION_LENGTH = 24 * 1024;

export function* sections(chapters) {
  for (const chapter of chapters) {
    let start = 0;
    let part = 0;
    do {
      let end = Math.min(start + MAX_SECTION_LENGTH, chapter.content.length);
      if (end < chapter.content.length) {
        const newline = chapter.content.slice(start, end).lastIndexOf('\n');
        if (newline >= MAX_SECTION_LENGTH / 2) end = start + newline + 1;
        else if (/[\uD800-\uDBFF]/.test(chapter.content[end - 1])) end--;
      }
      const text = chapter.content.slice(start, end);
      const title = chapter.content.length > MAX_SECTION_LENGTH ? `${chapter.title}（第 ${++part} 节）` : chapter.title;
      yield { title, start: chapter.start + start, text };
      start = end;
    } while (start < chapter.content.length);
  }
}

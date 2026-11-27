// Both the reader and AI use this order. Stored indices still identify the original text.
const digits = '零一二三四五六七八九';
const aliases = {
  〇: '零', '○': '零', 两: '二', 兩: '二', 壹: '一', 贰: '二', 貳: '二',
  叁: '三', 參: '三', 肆: '四', 伍: '五', 陆: '六', 陸: '六', 柒: '七',
  捌: '八', 玖: '九', 拾: '十', 佰: '百', 仟: '千', 萬: '万', 億: '亿',
};
const units = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 };
const numerals = '0-9' + digits + Object.keys(aliases).join('') + Object.keys(units).join('') + '廿卅';
const numbered = new RegExp('^第\\s*([' + numerals + ']+)\\s*([章節节卷回部集])(.*)$', 'u');
const extra = new RegExp('^番外\\s*([' + numerals + ']+)?', 'u');

export function matchNumberedHeading(title) {
  return numbered.exec(title.normalize('NFKC').replace(/^[【\[]/u, ''));
}

function ordinal(text) {
  let total = 0;
  let group = 0;
  let value = 0;
  for (const char of text.replaceAll('廿', '二十').replaceAll('卅', '三十')) {
    const digit = aliases[char] ?? char;
    const unit = units[digit];
    if (unit === undefined) {
      value = value * 10 + (digits.includes(digit) ? digits.indexOf(digit) : Number(digit));
    } else if (unit < 10000) {
      group += (value || 1) * unit;
      value = 0;
    } else {
      const section = group + value;
      total = unit === units.亿 ? (total + section) * unit : total + section * unit;
      group = 0;
      value = 0;
    }
  }
  return total + group + value;
}

/** @param {{title: string}[]} chapters @returns {number[]} Original indices in reading order. */
export function chapterOrder(chapters) {
  let volume = 0;
  const keys = chapters.map(({ title }, index) => {
    const line = title.normalize('NFKC').replace(/^[【\[]/u, '');
    const match = numbered.exec(line);
    const bonus = extra.exec(line) ?? (match && extra.exec(match[3].trimStart()));
    if (bonus) return { index, group: 3, volume: 0, number: ordinal(bonus[1] ?? match?.[1] ?? '0') };
    if (match) {
      const number = ordinal(match[1]);
      if (match[2] === '卷' || match[2] === '部') {
        volume = number;
        return { index, group: 1, volume, number: -1 };
      }
      return { index, group: 1, volume, number };
    }
    const group = /^(?:尾[声聲]|[终終]章|[后後][记記]|上架感言)/u.test(line) ? 2 : 0;
    return { index, group, volume: 0, number: 0 };
  });
  return keys.sort((a, b) => a.group - b.group || a.volume - b.volume || a.number - b.number)
    .map(key => key.index);
}

const paths = {
  chat: '<path d="M20 11.5a8 8 0 0 1-8 8c-1.3 0-2.5-.3-3.6-.8L4 20l1.1-4.2A8 8 0 1 1 20 11.5Z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"/>',
  upload: '<path d="M12 16V3m-4 4 4-4 4 4"/><path d="M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  download: '<path d="M12 3v13m-4-4 4 4 4-4"/><path d="M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  arrowUpToLine: '<path d="M5 4h14M12 20V8m-5 5 5-5 5 5"/>',
  arrowDownToLine: '<path d="M5 20h14M12 4v12m-5-5 5 5 5-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="m12 3 8 3v6c0 4.5-8 9-8 9s-8-4.5-8-9V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  leaf: '<path d="M19.5 4.5c-9-1-15 2-15 8a6 6 0 0 0 6 6c6 0 9-6 9-14Z"/><path d="M4 21c3-6 7-9 12-12"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v5h5M9 12h6M9 16h6"/>',
  paste: '<rect x="5" y="5" width="14" height="17" rx="2"/><path d="M9 5V2h6v3M9 11h6M9 15h4"/>',
  settings: '<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  quote: '<path d="M5 11h5v6H4v-5c0-4 2-6 5-7m9 6h5v6h-6v-5c0-4 2-6 5-7"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  moon: '<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
} as const;

export type IconName = keyof typeof paths;
export function icon(name: IconName, className = ''): string {
  return `<svg class="icon ${className}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export function logo(): string {
  return '<svg class="brand-mark" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="12" fill="currentColor"/><path d="M10 11.5c4.5-.5 8 .8 10 3.2 2-2.4 5.5-3.7 10-3.2v18c-4.5-.5-8 .6-10 2.8-2-2.2-5.5-3.3-10-2.8v-18Z" stroke="#fffdf7" stroke-width="1.5" stroke-linejoin="round"/><path d="M20 14.7v17.6" stroke="#fffdf7" stroke-width="1.5"/></svg>';
}

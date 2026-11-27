export function pageEdgeWidth(width: number): number {
  return Math.min(112, Math.max(44, width * 0.15));
}

export function bindAnnotationMenu(root: HTMLElement, canOpen: () => boolean) {
  let tap: { id: number; x: number; y: number; start: number } | undefined;
  let pointerType = '';
  let visible: HTMLElement | undefined;
  let openedAtScrollY = 0;
  function dismiss() {
    tap = undefined;
    if (visible) visible.hidden = true;
    visible = undefined;
  }
  function inCenter(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element) || !canOpen() || target.closest('button, a, input, textarea, .reader-footer')) return false;
    if (!target.closest('.reading-column') && !target.matches('.reader-shell')) return false;
    const width = document.documentElement.clientWidth;
    const edge = pageEdgeWidth(width);
    return event.clientX >= edge && event.clientX < width - edge;
  }
  function open(x: number, y: number) {
    if (!canOpen()) { dismiss(); return; }
    const menu = root.querySelector<HTMLElement>('.annotation-menu');
    if (!menu) return;
    visible = menu;
    openedAtScrollY = window.scrollY;
    menu.hidden = false;
    const top = root.querySelector('.reader-header')!.getBoundingClientRect().bottom + 4;
    const bottom = root.querySelector('.reader-footer')!.getBoundingClientRect().top - 4;
    menu.style.left = Math.max(6, Math.min(x - menu.offsetWidth / 2, document.documentElement.clientWidth - menu.offsetWidth - 6)) + 'px';
    const above = y - menu.offsetHeight - 12;
    menu.style.top = Math.max(top, Math.min(above >= top ? above : y + 12, bottom - menu.offsetHeight)) + 'px';
    menu.querySelector('button')?.focus({ preventScroll: true });
  }

  document.addEventListener('pointerdown', event => {
    pointerType = event.pointerType;
    if (visible?.contains(event.target as Node)) return;
    const wasOpen = Boolean(visible);
    dismiss();
    if (wasOpen || event.pointerType !== 'touch' || !event.isPrimary || !inCenter(event) || window.getSelection()?.isCollapsed === false) return;
    tap = { id: event.pointerId, x: event.clientX, y: event.clientY, start: event.timeStamp };
  });
  document.addEventListener('pointermove', event => {
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) tap = undefined;
  });
  document.addEventListener('pointerup', event => {
    const press = tap;
    tap = undefined;
    if (press?.id === event.pointerId && event.timeStamp - press.start < 350 && inCenter(event) &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 8 && window.getSelection()?.isCollapsed !== false) {
      open(event.clientX, event.clientY);
    }
  });
  document.addEventListener('pointercancel', () => { tap = undefined; });
  root.addEventListener('contextmenu', event => {
    // Some WebKit versions send a MouseEvent for a touch long press.
    const source = (event as PointerEvent).pointerType || pointerType;
    if (source === 'touch' || !inCenter(event)) return;
    event.preventDefault();
    open(event.clientX, event.clientY);
  });
  window.addEventListener('scroll', () => {
    if (tap || (visible && window.scrollY !== openedAtScrollY)) dismiss();
  }, { passive: true });
  window.addEventListener('resize', dismiss);
  window.addEventListener('blur', dismiss);
  document.addEventListener('keydown', event => {
    if (!visible) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      root.querySelector<HTMLElement>('.reading-main')?.focus({ preventScroll: true });
    }
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Tab' && visible && !visible.contains(document.activeElement)) dismiss();
  });
  return dismiss;
}

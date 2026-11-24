// Lucian UX/UI Prompt #018 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#018
import type { FontSize } from '../types';

function digitOffset(digit: string): string {
  return `translateY(-${Number(digit) * 34}px)`;
}

export function fontStepper(size: FontSize): string {
  const digits = Array.from({ length: 10 }, (_, digit) => `<span>${digit}</span>`).join('');
  const columns = String(size).split('').map((digit) =>
    `<span class="u018-col" aria-hidden="true" style="transform:${digitOffset(digit)}">${digits}</span>`).join('');
  return `<div class="ux u018-step" role="group" aria-label="正文字号">
    <button class="u018-b mi" type="button" data-action="font" data-direction="smaller" aria-label="减小字号" aria-disabled="${size === 16}">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10"/></svg></button>
    <span class="u018-num" aria-live="polite" aria-atomic="true"><span class="u018-sr">${size} 像素</span>${columns}</span>
    <button class="u018-b pl" type="button" data-action="font" data-direction="larger" aria-label="增大字号" aria-disabled="${size === 20}">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10"/></svg></button>
  </div>`;
}

export function updateFontStepper(step: HTMLElement, size: FontSize): void {
  step.querySelectorAll<HTMLElement>('.u018-col').forEach((col, index) => {
    col.style.transform = digitOffset(String(size)[index]!);
  });
  step.querySelector('.u018-sr')!.textContent = `${size} 像素`;
  step.querySelector('.mi')!.setAttribute('aria-disabled', String(size === 16));
  step.querySelector('.pl')!.setAttribute('aria-disabled', String(size === 20));
}

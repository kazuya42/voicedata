// Kleine DOM-Helfer, die alle Renderer-Module teilen.
import type { VdApi } from '../shared/types';

declare global {
  interface Window {
    vd: VdApi;
  }
}

export const vd = window.vd;

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt`);
  return node as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function button(label: string, onClick: () => void, className?: string): HTMLButtonElement {
  const b = el('button', label, className);
  b.addEventListener('click', onClick);
  return b;
}

// Electron verpackt Fehler aus ipcMain.handle als „Error invoking remote method …: Error: <msg>“.
export function errorMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );
}

let bannerTimer: number | undefined;
export function showBanner(message: string): void {
  const banner = $('banner');
  banner.textContent = message;
  banner.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => banner.classList.add('hidden'), 15_000);
}

export type View = 'live' | 'meetings' | 'order' | 'orders' | 'settings';
export const VIEWS: View[] = ['live', 'meetings', 'order', 'orders', 'settings'];

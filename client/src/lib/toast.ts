import { useSyncExternalStore } from 'react';

/** A short message at the bottom of the screen, optionally with one action (a link). One at a time. */
export interface Toast {
  id: number;
  message: string;
  action?: { label: string; to: string; onClick?: () => void };
}

let current: Toast | null = null;
let timer: number | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showToast(toast: Omit<Toast, 'id'>, ms = 7000) {
  current = { ...toast, id: Date.now() };
  emit();
  window.clearTimeout(timer);
  timer = window.setTimeout(hideToast, ms);
}

export function hideToast() {
  window.clearTimeout(timer);
  current = null;
  emit();
}

export function useToast() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

import { writable } from 'svelte/store';

export interface Toast {
  id: number;
  msg: string;
  err: boolean;
}

export const toasts = writable<Toast[]>([]);
let seq = 1;

export function toast(msg: string, err = false): void {
  const id = seq++;
  toasts.update((list) => [...list, { id, msg, err }]);
  setTimeout(() => {
    toasts.update((list) => list.filter((t) => t.id !== id));
  }, 3200);
}

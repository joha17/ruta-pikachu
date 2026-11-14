// Qué hoja se ve en «Colección» (una a la vez). Se recuerda en este aparato; si no se puede
// guardar (modo privado), simplemente vuelve a la primera.

import { signal } from '@preact/signals';

const KEY = 'ruta-pikachu:hoja';

function load(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** Id de la hoja a la vista ("p", "u:s50ng", "box", "new"); '' = la primera. */
export const currentSheet = signal(load());

export function showSheet(id: string): void {
  currentSheet.value = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

import { effect } from '@preact/signals';
import { settings } from '../store';

// Tema: automático (según el aparato), claro u oscuro. Se aplica con data-theme en <html>.
effect(() => {
  const t = settings.value.theme ?? 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
});

export function nextTheme(t: 'auto' | 'light' | 'dark' | undefined): 'auto' | 'light' | 'dark' {
  return t === 'light' ? 'dark' : t === 'dark' ? 'auto' : 'light';
}
export const THEME_LABEL = { auto: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: oscuro' } as const;

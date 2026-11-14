// Navegación por hash (#/importar). En la URL nunca va nada personal.
import { signal } from '@preact/signals';

const read = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'inicio';
export const route = signal(read());
window.addEventListener('hashchange', () => {
  route.value = read();
  window.scrollTo(0, 0);
});
export function go(to: string): void {
  location.hash = `#/${to}`;
}

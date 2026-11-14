// Hojas fijas: cada archivo de ./hojas es una hoja. Para añadir una hoja nueva basta con
// crear otro JSON con la misma forma (ver README); no hace falta tocar código.
import type { Lists, SheetDef } from '../model/types';
import listas from './listas.json';

const files = import.meta.glob<{ default: Omit<SheetDef, 'fixed'> }>('./hojas/*.json', { eager: true });

export const FIXED_SHEETS: SheetDef[] = Object.keys(files)
  .sort()
  .map((f) => ({ ...files[f].default, fixed: true }))
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export const LISTS = listas as Lists;

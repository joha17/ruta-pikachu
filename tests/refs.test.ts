// Enlaces a cartas en las respuestas de Claude.
import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { adviceRefs, adviceRows, cleanAdvice } from '../src/model/advice';
import { aliases, allSheets } from '../src/model/catalog';
import { refMap, splitRefs, usedRefs } from '../src/model/refs';
import { cardTable, reportSummary } from '../src/model/report';
import { emptyCollection, emptyPrices } from '../src/model/types';
import type { ShopItem } from '../src/model/shop';

describe('ids cortos de cartas', () => {
  it('uno por carta física (con variantes y Caja), y van en el resumen y la tabla', () => {
    const col = emptyCollection();
    col.box.push({ id: 'b1', n: 'Mew' });
    const sheets = allSheets(FIXED_SHEETS, col);
    const alias = aliases(sheets);
    const map = refMap(sheets, col, alias);
    expect(map.byKey.get('r:moltres')).toMatch(/^c\d+$/);
    expect(map.byId[map.byKey.get('b:b1')!]).toBe('b:b1');
    // Una carta con espejo en otra hoja tiene un solo id.
    expect(new Set(map.byKey.values()).size).toBe(map.byKey.size);
    const pr = emptyPrices();
    pr.usd['r:moltres'] = 3;
    const inp = { sheets, col, pr, alias, day: '2026-11-19', series: [], ids: map.byKey };
    expect(reportSummary(inp)).toContain(`[${map.byKey.get('r:moltres')}] $3.00`);
    expect(cardTable(inp)).toContain(`\n${map.byKey.get('b:b1')} | Mew | - | Caja |`);
  });

  it('convierte [Nombre](c12) en enlaces y deja como texto los ids que no existen', () => {
    const refs = { c1: 'r:moltres' };
    expect(splitRefs('Compra [Moltres](c1) y [Mew](c99) ya.', refs)).toEqual(['Compra ', { t: 'Moltres', key: 'r:moltres' }, ' y Mew ya.']);
    expect(splitRefs('Sin enlaces', undefined)).toEqual(['Sin enlaces']);
    expect(usedRefs(['[A](c1) [B](c2)', 'nada'], { c1: 'x:a', c2: 'x:b', c3: 'x:c' })).toEqual({ c1: 'x:a', c2: 'x:b' });
  });

  it('el consejero usa los mismos ids de sus filas («c1») en el resumen y en las cartas', () => {
    const item = (key: string, p: number): ShopItem => ({ key, sheetId: 'r', n: key, num: '1', p, star: false, manual: false });
    const rows = adviceRows([item('x:a', 9), item('x:b', 5)], emptyPrices(), {});
    expect(adviceRefs(rows)).toEqual({ c1: 'x:a', c2: 'x:b' });
    expect(cleanAdvice({ resumen: '', cartas: [{ id: 'c2', v: 'comprar', why: '' }] }, rows).cards).toEqual({ 'x:b': { v: 'comprar', why: '' } });
  });
});

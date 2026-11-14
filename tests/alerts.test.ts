// Avisos de precio: cuándo salta un aviso y cuándo se repite.
import { describe, expect, it } from 'vitest';
import { alertHits, alertOf, freshHits } from '../src/model/alerts';
import { aliases, allSheets } from '../src/model/catalog';
import * as ops from '../src/model/ops';
import { emptyCollection, emptyPrices } from '../src/model/types';
import { emptyDoc, explode, implode, seqsOf, stamp } from '../src/sync/merge';
import { FIXED_SHEETS as FIXED } from '../src/data';

const sheets = allSheets(FIXED, emptyCollection());
const AL = aliases(sheets);

describe('avisos de precio', () => {
  it('salta cuando el precio de mercado llega al límite y la carta me falta', () => {
    const c = emptyCollection();
    const p = emptyPrices();
    ops.setAlert(c, AL, 'r:moltres', 15);
    expect(alertOf(c, AL, 'r:moltres')).toBe(15);
    p.usd['r:moltres'] = 16;
    expect(alertHits(sheets, c, p, AL)).toEqual([]);
    p.usd['r:moltres'] = 15;
    const h = alertHits(sheets, c, p, AL);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ key: 'r:moltres', limit: 15, now: 15 });
    expect(h[0]!.name).toContain('Moltres');
  });

  it('no avisa si ya la tengo ni usa el precio puesto a mano', () => {
    const c = emptyCollection();
    const p = emptyPrices();
    ops.setAlert(c, AL, 'r:moltres', 15);
    p.usd['r:moltres'] = 20;
    ops.setManual(c, AL, 'r:moltres', 5);
    expect(alertHits(sheets, c, p, AL)).toEqual([]);
    p.usd['r:moltres'] = 10;
    c.owned['r:moltres'] = true;
    expect(alertHits(sheets, c, p, AL)).toEqual([]);
  });

  it('quitar el aviso y valores raros', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, 'r:moltres', 12.345);
    expect(c.alerts['r:moltres']).toBe(12.35);
    ops.setAlert(c, AL, 'r:moltres', null);
    expect(alertOf(c, AL, 'r:moltres')).toBeNull();
    ops.setAlert(c, AL, 'r:moltres', 0);
    expect(c.alerts).toEqual({});
  });

  it('notifica una vez y se repite solo si baja otro 10 %', () => {
    const h = (now: number) => [{ key: 'r:moltres', name: 'Moltres', limit: 15, now }];
    const a = freshHits(h(14), {});
    expect(a.fresh).toHaveLength(1);
    expect(a.next).toEqual({ 'r:moltres': 14 });
    expect(freshHits(h(13), a.next).fresh).toHaveLength(0);
    const b = freshHits(h(12.5), a.next);
    expect(b.fresh).toHaveLength(1);
    expect(b.next['r:moltres']).toBe(12.5);
    // Si deja de estar por debajo, se olvida y vuelve a avisar la próxima vez.
    expect(freshHits([], b.next).next).toEqual({});
  });

  it('el aviso viaja en la sincronización', () => {
    const c = emptyCollection();
    ops.setAlert(c, AL, 'r:moltres', 9.5);
    const { doc } = stamp(emptyDoc(), explode(c), seqsOf(c), 1000);
    expect(implode(doc).alerts).toEqual({ 'r:moltres': 9.5 });
  });
});

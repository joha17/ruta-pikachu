// Exportar la colección a CSV y Excel.
import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets } from '../src/model/catalog';
import { exportName, exportRows, toCsv, toXlsx, totals, zipStore } from '../src/model/exportTable';
import { emptyCollection, emptyPrices } from '../src/model/types';

const sheets = allSheets(FIXED_SHEETS, emptyCollection());
const AL = aliases(sheets);
const moltres = sheets.find((s) => s.id === 'r')!.cards.find((c) => c.k === 'moltres')!;

function setup() {
  const c = emptyCollection();
  c.owned['r:moltres'] = true;
  c.box = [
    { id: 'b1', n: moltres.n, tcg: moltres.tcg, set: moltres.set, num: moltres.num, rar: moltres.rar },
    { id: 'b2', n: 'Mew; "el bueno"', set: 'Base', num: '1', deal: 'sell' },
    { id: 'b3', n: '=Eevee', graded: 'PSA 9' },
  ];
  const p = emptyPrices();
  p.date = '2026-11-17';
  p.usd['r:moltres'] = 10;
  p.usd['b:b1'] = 12; // se usa el primero que tenga precio
  c.manual['b:b2'] = { v: 3.5, d: '2026-11-01' };
  return { c, p };
}

describe('exportar colección', () => {
  it('junta copias iguales y suma cantidad y total', () => {
    const { c, p } = setup();
    const rows = exportRows(sheets, c, p, AL);
    const m = rows.find((r) => r.tcg === moltres.tcg)!;
    expect(m.cantidad).toBe(2);
    expect(m.precio).toBe(10);
    expect(m.total).toBe(20);
    expect(m.ubicacion).toContain('Caja');
    expect(m.estado).toBe('Repetida');
    expect(m.fuente).toBe('TCGplayer (17/11/2026)');
    const mew = rows.find((r) => r.nombre.startsWith('Mew'))!;
    expect(mew).toMatchObject({ precio: 3.5, estado: 'Para vender', fuente: 'A mano (01/11/2026)' });
    expect(rows[0]).toBe(m); // ordenado por total
    expect(totals(rows)).toEqual({ cantidad: 4, total: 23.5, sinPrecio: 1 });
  });

  it('CSV con BOM, comillas, fórmulas neutralizadas y separador elegido', () => {
    const { c, p } = setup();
    const rows = exportRows(sheets, c, p, AL);
    const csv = toCsv(rows);
    expect(csv.startsWith('﻿Nombre,Número,Set')).toBe(true);
    expect(csv).toContain('"Mew; ""el bueno"""');
    expect(csv).toContain("'=Eevee");
    expect(csv).toContain(',23.5,');
    const es = toCsv(rows, ';');
    expect(es).toContain('Nombre;Número');
    expect(es).toContain(';3,5;');
    expect(es.trimEnd().split('\r\n')).toHaveLength(rows.length + 2);
  });

  it('xlsx es un ZIP válido con la hoja', () => {
    const { c, p } = setup();
    const bytes = toXlsx(exportRows(sheets, c, p, AL), new Date(2026, 10, 17));
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('Mew; &quot;el bueno&quot;');
    expect(text).toContain('<v>23.5</v>');
    expect(exportName('xlsx', new Date(2026, 10, 7))).toBe('ruta-pikachu-coleccion-2026-11-07.xlsx');
  });

  it('crc del zip coincide con el estándar', () => {
    const z = zipStore({ 'a.txt': 'hola' });
    const v = new DataView(z.buffer);
    expect(v.getUint32(14, true)).toBe(0x6fa0f988);
  });
});

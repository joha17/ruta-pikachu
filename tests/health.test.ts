import { describe, expect, it } from 'vitest';
import { parseTokenExpiry, problems } from '../src/model/health';
// @ts-expect-error: script de Node sin tipos
import { expiryNotice } from '../scripts/alertas.mjs';

const now = new Date('2026-11-19T12:00:00Z');
const off = { status: 'off', last: '' };
const ids = (n: Parameters<typeof problems>[0]) => problems(n).map((p) => p.id);

describe('parseTokenExpiry', () => {
  it('lee el formato de GitHub', () => {
    expect(parseTokenExpiry('2026-12-01 00:00:00 UTC')).toBe('2026-12-01T00:00:00.000Z');
    expect(parseTokenExpiry('2026-12-01 10:30:00 +0000')).toBe('2026-12-01T10:30:00.000Z');
    expect(parseTokenExpiry(null)).toBeUndefined();
    expect(parseTokenExpiry('basura')).toBeUndefined();
  });
});

describe('problems', () => {
  it('sin aviso ni Drive no hay nada que decir', () => {
    expect(problems({ nube: null, sync: off, now })).toEqual([]);
    expect(problems({ nube: { token: 't', last: '2026-11-19T10:00:00Z', remoteLast: '2026-11-18' }, sync: { status: 'ok', last: '' }, now })).toEqual([]);
  });

  it('token rechazado (401) o ya vencido', () => {
    expect(ids({ nube: { token: 't', error: 'x', status: 401 }, sync: off, now })).toEqual(['token-vencido']);
    expect(ids({ nube: { token: 't', expires: '2026-11-18T00:00:00Z' }, sync: off, now })).toEqual(['token-vencido']);
  });

  it('avisa 7 días antes de que venza, no antes', () => {
    const p = problems({ nube: { token: 't', expires: '2026-11-24T00:00:00Z' }, sync: off, now });
    expect(p.map((x) => x.id)).toEqual(['token-por-vencer']);
    expect(p[0]!.text).toContain('en 5 días');
    expect(ids({ nube: { token: 't', expires: '2026-12-10T00:00:00Z' }, sync: off, now })).toEqual([]);
  });

  it('la revisión nocturna parada, comparada con la última lectura del gist', () => {
    expect(ids({ nube: { token: 't', last: '2026-11-19T10:00:00Z', remoteLast: '2026-11-12' }, sync: off, now })).toEqual(['noche']);
    // Si la app no leyó el gist hace mucho, no se sabe: no se avisa.
    expect(ids({ nube: { token: 't', last: '2026-11-13T10:00:00Z', remoteLast: '2026-11-12' }, sync: off, now })).toEqual([]);
  });

  it('Drive con error, o en pausa por más de 2 días', () => {
    expect(ids({ nube: null, sync: { status: 'error', last: '', msg: 'falló' }, now })).toEqual(['drive']);
    expect(ids({ nube: null, sync: { status: 'login', last: '2026-11-19T08:00:00Z' }, now })).toEqual([]);
    expect(ids({ nube: null, sync: { status: 'login', last: '2026-11-15T08:00:00Z' }, now })).toEqual(['drive']);
    expect(ids({ nube: null, sync: { status: 'offline', last: '2026-11-01T08:00:00Z' }, now })).toEqual([]);
  });
});

describe('expiryNotice (Telegram)', () => {
  const t = now.getTime();
  it('avisa una vez por fecha de vencimiento', () => {
    expect(expiryNotice('2026-11-22T00:00:00.000Z', undefined, t)).toContain('vence en 3 días');
    expect(expiryNotice('2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z', t)).toBeNull();
    expect(expiryNotice('2026-12-22T00:00:00.000Z', undefined, t)).toBeNull();
    expect(expiryNotice(undefined, undefined, t)).toBeNull();
  });
});

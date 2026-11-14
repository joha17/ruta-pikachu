import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXED_SHEETS } from '../src/data';
import { aliases, allSheets, haveAndMissing, sheetCount } from '../src/model/catalog';
import { migrate, parseArtifactHtml, type LegacyState } from '../src/model/migrate';

describe('migración (datos de ejemplo)', () => {
  const st: LegacyState = {
    pika: [5, 8],
    rocket: { moltres: true, wobbuffet: true, meowth: false },
    ill: {},
    goals: { energias: true, zapdos: true },
    trade: { '0': true },
    variant: { 'r:moltres': 'mewtwo', 'u:s1.c1': 's1.c2' },
    img: { '5': 'c26a779459f72a0a4e45a6b84ce4f86a', 'r-moltres': '4fb0b0666da898552e24825dd006519e', 'u-s1.c1': 'a375a89e1116cbd2ba7eb841a73768dd', 'b-b1': '0000000000000000000000000000000z', zz: 'x' },
    custom: [{ id: 's1', name: 'Hoja de N', seq: 2, cards: [{ id: 'c1', n: 'N', alts: [{ id: 'c2', n: 'N alt' }] }], own: { c2: true, c1: false } }],
    customSeq: 1,
    order: { i: ['lycanroc'] },
    box: [{ id: 'b1', n: 'Tyranitar ex', tcg: 'sv03-211' }],
    boxSeq: 1,
    manual: { 'f:treecko': { v: 5.58, d: '2026-11-12' } },
  };
  const r = migrate(FIXED_SHEETS, st, {
    date: '2026-11-13',
    usd: { 'p:1': 0.5, 'r:moltres': 57.39 },
    hist: { keys: ['p:1', 'r:moltres'], days: { '2026-11-12': [0.48, null], '2026-11-13': [0.5, 57.39] } },
  });
  const c = r.collection;
  it('pasa marcadas de todas las hojas a una sola lista', () => {
    expect(Object.keys(c.owned).sort()).toEqual(['i:zapdos', 'p:5', 'p:8', 'r:moltres', 'r:wobbuffet', 'u:s1.c2']);
    expect(c.goals).toEqual({ energias: true });
    expect(c.trade).toEqual({ '0': true });
  });
  it('variantes con clave completa, orden, caja y precios a mano', () => {
    expect(c.variant).toEqual({ 'r:moltres': 'r:mewtwo', 'u:s1.c1': 'u:s1.c2' });
    expect(c.order).toEqual({ i: ['lycanroc'] });
    expect(c.box[0].tcg).toBe('sv03-211');
    expect(c.manual['f:treecko'].v).toBe(5.58);
    expect(c.custom[0].cards[0]).toEqual({ k: 'c1', n: 'N', alts: [{ k: 'c2', n: 'N alt' }] });
  });
  it('historial por fecha y fotos por clave, con problemas en el informe', () => {
    expect(r.prices.hist['2026-11-12']).toEqual({ 'p:1': 0.48, 'r:moltres': null });
    expect(r.report.histValues).toBe(3);
    expect(r.photoIds).toEqual({ 'p:5': 'c26a779459f72a0a4e45a6b84ce4f86a', 'r:moltres': '4fb0b0666da898552e24825dd006519e', 'u:s1.c1': 'a375a89e1116cbd2ba7eb841a73768dd' });
    expect(r.report.problems.some((p) => p.includes('b:b1'))).toBe(true);
    expect(r.report.problems.some((p) => p.includes('«zz»'))).toBe(true);
  });
});

const REF = resolve(__dirname, '../../referencia/ruta-pikachu-artefacto.html');
describe.skipIf(!existsSync(REF))('migración (copia real del Artifact)', () => {
  const { state, prices } = parseArtifactHtml(readFileSync(REF, 'utf8'));
  const r = migrate(FIXED_SHEETS, state, prices);
  const sheets = allSheets(FIXED_SHEETS, r.collection);
  const alias = aliases(sheets);
  it('no pierde nada y no deja problemas', () => {
    expect(r.report.problems).toEqual([]);
    expect(r.report.photosListed).toBe(Object.keys(state.img ?? {}).length);
    expect(Object.keys(r.photoIds)).toHaveLength(r.report.photosListed);
    expect(r.report.pricesNow).toBe(Object.keys(prices.usd ?? {}).length);
    expect(r.report.manual).toBe(Object.keys(state.manual ?? {}).length);
  });
  it('los conteos por hoja coinciden con los del Artifact', () => {
    const count = (id: string) => sheetCount(alias, sheets.find((s) => s.id === id)!, r.collection);
    expect(count('p')).toBe(state.pika!.length);
    const legacy = (b: Record<string, boolean> | undefined) => Object.values(b ?? {}).filter(Boolean).length;
    expect(count('m')).toBe(legacy(state.mega));
    expect(count('c')).toBe(legacy(state.classic));
    expect(count('x')).toBe(legacy(state.ex));
    expect(count('i')).toBe(legacy(state.ill));
    expect(count('f')).toBe(legacy(state.partner));
    for (const sh of state.custom ?? []) {
      const shown = sh.cards.map((c) => {
        const v = state.variant?.[`u:${sh.id}.${c.id}`];
        return c.alts?.find((a) => `${sh.id}.${a.id}` === v)?.id ?? c.id;
      });
      expect(count(`u:${sh.id}`), sh.name).toBe(shown.filter((id) => sh.own?.[id]).length);
    }
    expect(haveAndMissing(sheets, r.collection).have.length).toBeGreaterThan(0);
  });
});

import { PACK_FORMAT, readArtifactFile } from '../src/model/importArtifact';
describe('importar archivo del Artifact', () => {
  const state: LegacyState = { pika: [1], img: { '1': 'c26a779459f72a0a4e45a6b84ce4f86a', '2': '545e59be2e0f3a61ba4e67da82afd600' } };
  it('del paquete .json trae las fotos y avisa las que faltan', () => {
    const pack = { formato: PACK_FORMAT, creado: '', origen: '', state, prices: {}, fotos: { c26a779459f72a0a4e45a6b84ce4f86a: { tipo: 'image/jpeg', b64: btoa('hola') } } };
    const r = readArtifactFile(FIXED_SHEETS, JSON.stringify(pack), '2026-11-13');
    expect(r.photos).toHaveLength(1);
    expect(r.photos[0].key).toBe('p:1');
    expect(r.photos[0].blob.size).toBe(4);
    expect(r.report.photosImported).toBe(1);
    expect(r.report.problems).toEqual(['Falta la foto de p:2 (asset 545e59be2e0f3a61ba4e67da82afd600).']);
  });
  it('de la página .html migra los datos y dice que las fotos quedan fuera', () => {
    const html = `<script type="application/json" id="state">${JSON.stringify(state)}</script><script type="application/json" id="prices">{}</script>`;
    const r = readArtifactFile(FIXED_SHEETS, html, '2026-11-13');
    expect(r.collection.owned).toEqual({ 'p:1': true });
    expect(r.photos).toHaveLength(0);
    expect(r.report.problems[0]).toMatch(/quedan fuera 2/);
  });
  it('rechaza archivos que no reconoce', () => {
    expect(() => readArtifactFile(FIXED_SHEETS, 'hola', '')).toThrow(/No reconozco/);
    expect(() => readArtifactFile(FIXED_SHEETS, '{"formato":"otro"}', '')).toThrow(/no es un paquete/);
  });
});

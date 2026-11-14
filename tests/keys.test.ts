import { describe, expect, it } from 'vitest';
import { keyFromImgKey, keyOf, localOfKey, sheetOfKey } from '../src/model/keys';

describe('claves', () => {
  it('arma claves de hojas fijas y propias', () => {
    expect(keyOf('r', 'moltres')).toBe('r:moltres');
    expect(keyOf('p', '5')).toBe('p:5');
    expect(keyOf('u:s1', 'c1')).toBe('u:s1.c1');
  });
  it('separa hoja e id local', () => {
    for (const [k, sh, loc] of [
      ['p:5', 'p', '5'],
      ['r:moltres', 'r', 'moltres'],
      ['u:s1.c1', 'u:s1', 'c1'],
      ['b:b1', 'b', 'b1'],
      ['i:zapdos', 'i', 'zapdos'],
    ]) {
      expect(sheetOfKey(k)).toBe(sh);
      expect(localOfKey(k)).toBe(loc);
    }
  });
  it('traduce las claves de foto del Artifact', () => {
    expect(keyFromImgKey('5')).toBe('p:5');
    expect(keyFromImgKey('r-moltres')).toBe('r:moltres');
    expect(keyFromImgKey('u-s1.c1')).toBe('u:s1.c1');
    expect(keyFromImgKey('b-b1')).toBe('b:b1');
    expect(keyFromImgKey('raro')).toBeNull();
  });
});

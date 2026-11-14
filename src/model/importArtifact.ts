// Importar desde el Artifact. Acepta dos tipos de archivo:
//  1. El paquete de migración (.json) que arma scripts/armar-migracion.mjs: estado, precios y fotos.
//  2. La página HTML del Artifact tal cual (sin fotos: las fotos se quedan fuera y el informe lo dice).

import { migrate, parseArtifactHtml, type LegacyPrices, type LegacyState, type MigrationResult } from './migrate';
import type { Photo, SheetDef } from './types';

export const PACK_FORMAT = 'ruta-pikachu/artifact-1';

export interface ArtifactPack {
  formato: typeof PACK_FORMAT;
  creado: string;
  origen: string;
  state: LegacyState;
  prices: LegacyPrices;
  /** Id del asset → foto en base64. */
  fotos: Record<string, { tipo: string; b64: string }>;
}

export interface ImportResult extends MigrationResult {
  photos: Photo[];
}

export function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function readArtifactFile(fixed: SheetDef[], text: string, now: string): ImportResult {
  const t = text.trimStart();
  let state: LegacyState;
  let prices: LegacyPrices;
  let fotos: ArtifactPack['fotos'] | null = null;
  if (t.startsWith('{')) {
    const pack = JSON.parse(t) as ArtifactPack;
    if (pack.formato !== PACK_FORMAT) throw new Error('Este archivo no es un paquete de migración del Artifact.');
    state = pack.state;
    prices = pack.prices;
    fotos = pack.fotos ?? {};
  } else if (t.startsWith('<')) {
    ({ state, prices } = parseArtifactHtml(t));
  } else {
    throw new Error('No reconozco el archivo. Elige el paquete .json o la página .html del Artifact.');
  }

  const res = migrate(fixed, state, prices);
  const photos: Photo[] = [];
  if (!fotos) {
    if (Object.keys(res.photoIds).length)
      res.report.problems.push(
        `La página HTML no trae las fotos: quedan fuera ${Object.keys(res.photoIds).length}. Usa el paquete .json para traerlas.`,
      );
  } else {
    for (const [key, id] of Object.entries(res.photoIds)) {
      const f = fotos[id];
      if (!f) {
        res.report.problems.push(`Falta la foto de ${key} (asset ${id}).`);
        continue;
      }
      photos.push({ key, blob: b64ToBlob(f.b64, f.tipo), from: 'artifact', added: now });
    }
  }
  res.report.photosImported = photos.length;
  return { ...res, photos };
}

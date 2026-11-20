// Modelo de datos de la app.
//
// Claves de carta (las mismas que usaba el Artifact, para no romper precios, fotos ni favoritos):
//   p:5            Pikachu 30C (hoja fija "p", carta "5")
//   r:moltres      hoja fija "r", carta "moltres"
//   u:s1.c1        hoja propia "s1", carta "c1"
//   b:b1           carta de la Caja
// La clave de una hoja fija es su id ("r"); la de una hoja propia, "u:" + id ("u:s1").

/** Una carta dentro de una hoja (fija o propia). */
export interface CardDef {
  /** Id local dentro de la hoja ("moltres", "5", "c1"). */
  k: string;
  /** Nombre en inglés, como sale en la carta. */
  n: string;
  /** Texto corto del bolsillo cuando no es el nombre (p. ej. "05/30"). */
  label?: string;
  /** Prefijo del título en la ficha (p. ej. "Team Rocket's "). */
  prefix?: string;
  num?: string;
  set?: string;
  rar?: string;
  /** Id de TCGdex (p. ej. "sv10-229"). */
  tcg?: string;
  lang?: string;
  graded?: string;
  url?: string;
  note?: string;
  /** Nombre de la fila (se queda con la posición al reordenar). */
  row?: string;
  star?: boolean;
  artist?: string;
  era?: string;
  gen?: string;
  /** De dónde sale (caja, colección…). */
  origin?: string;
  /** Línea pequeña sobre el nombre en el bolsillo. */
  sub?: string;
  /** Pie del bolsillo (rareza, artista…). */
  foot?: string;
  /** Texto corto para la etiqueta sobre la imagen. */
  short?: string;
  /** Texto del medio del bolsillo cuando la tengo (p. ej. el ataque). */
  mid?: string;
  /** No repetir el número en el pie (ya va arriba). */
  noNum?: boolean;
  /** Filas extra para la ficha. */
  meta?: [string, string][];
  /** Clave canónica de la misma carta física en otra hoja (p. ej. "r:moltres"). */
  same?: string;
  /** Variantes posibles para este bolsillo. */
  alts?: CardDef[];
}

export interface SheetDef {
  /** "r" para hojas fijas; "u:s1" para hojas propias. */
  id: string;
  name: string;
  /** Título largo de la sección (opcional). */
  title?: string;
  /** Nombre corto para el menú. */
  short?: string;
  /** Rótulo de la página en la hoja. */
  pageLabel?: string;
  /** Clase de color: pk, rk, ma, cc, ex, ir, fp, eg, us. */
  theme: string;
  desc?: string;
  order?: number;
  fixed: boolean;
  cards: CardDef[];
}

/** Hoja creada por el usuario (se guarda en la colección). */
export interface CustomSheet {
  id: string; // "s1"
  name: string;
  desc?: string;
  /** Último número usado para ids de carta ("c" + seq). */
  seq: number;
  cards: CardDef[];
}

/** Carta en la Caja «por acomodar». */
export interface BoxCard {
  id: string; // "b1"
  n: string;
  num?: string;
  set?: string;
  rar?: string;
  tcg?: string;
  url?: string;
  lang?: string;
  graded?: string;
  /** La aparté para cambiarla o venderla. */
  deal?: 'trade' | 'sell';
}

export interface SheetRename {
  name: string;
  desc?: string;
}

/** Objetivo propio (se marca a mano). */
export interface MyGoal {
  id: string; // "g1"
  t: string;
  d?: string;
}

export interface ManualPrice {
  v: number;
  /** Fecha AAAA-MM-DD. */
  d: string;
}

/** Todo lo que el usuario marca y crea. Se guarda en IndexedDB como un solo documento. */
export interface Collection {
  version: 1;
  /** Claves canónicas de las cartas que tengo (salvo la Caja, que siempre cuenta). */
  owned: Record<string, true>;
  /** Bolsillo → clave completa de la variante que se muestra ("r:moltres" → "r:mewtwo"). */
  variant: Record<string, string>;
  /** Hoja → ids locales de los bolsillos en el orden elegido. */
  order: Record<string, string[]>;
  custom: CustomSheet[];
  customSeq: number;
  /**
   * Cartas que agregué a hojas fijas, por hoja ("p" → cartas nuevas al final de Pikachu 30C).
   * Usa la forma de una hoja propia (sin nombre); sus ids son "n" + seq: claves "p:n1".
   */
  extra?: CustomSheet[];
  /** Orden de las hojas elegido por mí (ids "p", "u:s1"…). Sin valor = el orden de siempre. */
  sheetOrder?: string[];
  box: BoxCard[];
  boxSeq: number;
  manual: Record<string, ManualPrice>;
  wish: Record<string, true>;
  goals: Record<string, true>;
  trade: Record<string, true>;
  protect: Record<string, true>;
  /** Hojas fijas quitadas (se pueden volver a mostrar). */
  hidden: Record<string, true>;
  /** Cartas quitadas de hojas fijas, por su clave ("r:mewtwo"). Se pueden volver a mostrar. */
  hiddenCards: Record<string, true>;
  /** Nombre y descripción cambiados de hojas fijas. */
  rename: Record<string, SheetRename>;
  /** Objetivos fijos (de listas.json) quitados. */
  hiddenGoals: Record<string, true>;
  /** Objetivos agregados por mí. */
  myGoals: MyGoal[];
  goalSeq: number;
  /** Alertas de precio: clave canónica → reglas de esa carta (ver model/alerts.ts). */
  alerts: Record<string, PriceAlert>;
  /** Alertas disparadas: id (fecha|carta|motivo) → qué pasó. No se borra al cambiar o quitar la alerta. */
  alertLog: Record<string, AlertEvent>;
  /** Presupuesto mensual de compras en USD (sin valor = 70, ver model/budget.ts). */
  budget?: number;
  /** Compras registradas: id → qué compré, cuándo y cuánto pagué. */
  spend: Record<string, Spend>;
  /** «Lo pienso en frío»: cartas que quise comprar y dejé para pensarlo. */
  later: Record<string, LaterCard>;
  /** Condición de cada copia: clave → «NM», «LP»… o gradeo («PSA 10»). Ver model/condition.ts. */
  cond?: Record<string, string>;
  /** Mi perfil: nombre, avatar y desde cuándo colecciono (ver model/profile.ts). */
  profile?: Profile;
  /** Último guardado, AAAA-MM-DD. */
  saved: string;
}

/** Mi perfil. Se sincroniza por Drive y va en el respaldo. */
export interface Profile {
  /** Nombre o apodo (máximo 30). */
  name?: string;
  /** Frase corta (máximo 80). */
  about?: string;
  /** Avatar: número de Pokédex de la lista de model/profile.ts. */
  avatar?: number;
  /** Foto propia, pequeña y recortada (data:image/jpeg;base64,…). Si hay, se muestra en vez del avatar. */
  photo?: string;
  /** Desde cuándo colecciono, AAAA-MM. */
  since?: string;
  /** No poner mi nombre ni mi avatar en los enlaces que comparto. */
  hide?: true;
}

/** Una compra registrada (resta del presupuesto de su mes). */
export interface Spend {
  /** Día de la compra, AAAA-MM-DD. */
  d: string;
  /** Qué compré (nombre de la carta o lo que escribí). */
  n: string;
  /** Cuánto pagué, USD. */
  v: number;
  /** Clave de la carta, si es una carta de la colección. */
  k?: string;
}

/** Carta que dejé para pensarla en frío en vez de comprarla. */
export interface LaterCard {
  /** Día en que la dejé, AAAA-MM-DD. */
  d: string;
  n: string;
  /** Precio que tenía ese día (USD), si había. */
  p?: number;
  /** Clave de la carta si ya está en mis hojas. */
  k?: string;
  /** Datos para guardarla en la Caja si no está en mis hojas (de TCGdex o del escáner). */
  pre?: Record<string, string>;
}

/** Por qué se disparó una alerta. */
export type AlertReason = 'meta' | 'estable' | 'ambas';

/** Reglas de alerta de una carta. Cada regla se activa por separado. */
export interface PriceAlert {
  /** Precio meta en USD (o null si no puse). */
  meta: number | null;
  /** Avisar cuando el precio de mercado sea igual o menor a la meta. */
  metaOn: boolean;
  /** Avisar cuando el precio lleve estable al menos `dias_estable` días. */
  estableOn: boolean;
  /** Días seguidos que tiene que llevar estable (3 a 90, 15 por defecto). */
  dias_estable: number;
  /** Variación máxima en esos días: máximo − mínimo ≤ este % del promedio (5 por defecto). */
  umbral_pct: number;
  /** Avisar cuando esté estable Y en la meta o por debajo, a la vez. */
  ambasOn: boolean;
}

/** Una alerta disparada. */
export interface AlertEvent {
  /** Día en que se disparó, AAAA-MM-DD. */
  d: string;
  /** Clave canónica de la carta. */
  k: string;
  /** Nombre de la carta ese día (por si después se borra). */
  n: string;
  motivo: AlertReason;
  /** Precio de mercado (USD) al dispararse. */
  p: number;
  /** Reglas con las que se disparó. */
  meta?: number;
  dias?: number;
  umbral?: number;
}

/** Precios automáticos (USD, TCGplayer) e historial diario. */
export interface PriceBook {
  /** Fecha del último precio automático, AAAA-MM-DD. */
  date: string;
  usd: Record<string, number>;
  /** Fecha → clave → precio (o null si ese día no hubo dato). Máximo un año. */
  hist: Record<string, Record<string, number | null>>;
  /** Fecha → valor de lo que tenía ese día (USD) y cuántas cartas con precio. Máximo un año. */
  value?: Record<string, { v: number; n: number }>;
}

/** Foto propia de una carta, guardada en el aparato. */
export interface Photo {
  key: string;
  blob: Blob;
  /** De dónde vino: el Artifact, el escáner o subida a mano. */
  from: 'artifact' | 'scan' | 'upload';
  added: string;
  /** Huella del contenido (SHA-256, 32 hex) para sincronizar. Se calcula sola si falta. */
  h?: string;
}

export interface GoalDef {
  id: string;
  t: string;
  d?: string;
  link?: string;
  auto?: { sheet: string } | { card: string };
}

export interface ListItem {
  id: string;
  t: string;
}

export interface Lists {
  goals: GoalDef[];
  trade: ListItem[];
  protect: ListItem[];
}

export function emptyCollection(): Collection {
  return {
    version: 1,
    owned: {},
    variant: {},
    order: {},
    custom: [],
    customSeq: 0,
    extra: [],
    box: [],
    boxSeq: 0,
    manual: {},
    wish: {},
    goals: {},
    trade: {},
    protect: {},
    hidden: {},
    hiddenCards: {},
    rename: {},
    hiddenGoals: {},
    myGoals: [],
    goalSeq: 0,
    alerts: {},
    alertLog: {},
    spend: {},
    later: {},
    saved: '',
  };
}

export function emptyPrices(): PriceBook {
  return { date: '', usd: {}, hist: {} };
}

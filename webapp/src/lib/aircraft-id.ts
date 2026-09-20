/**
 * 機体IDの突合。
 *
 * OGN の機体IDは「接頭辞3文字 + 6桁の16進アドレス」で、
 *   ICA84B58E / FLRDB072C / OGNC19DCB
 * のように書く。**実体はうしろの6桁**で、接頭辞はそのアドレスの出どころ
 * （ICAO / FLARM / OGN）を表しているに過ぎない。
 *
 * 同じ送信機でも、受信機が受け取るパケットの種別と OGN DDB の登録内容で
 * 接頭辞が食い違うことがある。2026-09-20 の実測では、滝川のDBにある
 * DDB 登録済み26件のうち **6件(23%)** で食い違っていた:
 *   ローカル FLRC19DCB / FLRFD05C8 / FLRFD7A10 / FLRFD811F / FLRFD8154 ↔ DDB は O
 *   ローカル ICA84C22B ↔ DDB は F
 * 接頭辞まで一致させて引くと、この23%が「登録したのに出ない」ことになる。
 * そのため、完全一致で外れたときはアドレスだけで引き直す。
 */

const ID_RE = /^(ICA|FLR|OGN|RND)?([0-9A-F]{6})$/;

/** 機体IDから6桁の16進アドレスを取り出す。取れなければ null */
export function hexAddress(deviceId: string | null | undefined): string | null {
  if (!deviceId) return null;
  const m = ID_RE.exec(deviceId.toUpperCase());
  return m ? m[2] : null;
}

/**
 * 機体IDで引く。完全一致が無ければ、同じアドレスの別接頭辞を探す。
 * アドレス自体が送信機の識別子なので、接頭辞違いは同一機とみなしてよい。
 */
export function lookupByDeviceId<T>(
  db: Record<string, T> | null | undefined,
  deviceId: string,
): T | undefined {
  if (!db) return undefined;
  const exact = db[deviceId];
  if (exact !== undefined) return exact;
  const hex = hexAddress(deviceId);
  if (!hex) return undefined;
  for (const key of Object.keys(db)) {
    if (key !== deviceId && hexAddress(key) === hex) return db[key];
  }
  return undefined;
}

/** 同じアドレスを持つ既存のキーを返す（無ければ null）。重複行を作らないために使う */
export function findKeyByAddress(
  db: Record<string, unknown> | null | undefined,
  deviceId: string,
): string | null {
  if (!db) return null;
  if (db[deviceId] !== undefined) return deviceId;
  const hex = hexAddress(deviceId);
  if (!hex) return null;
  for (const key of Object.keys(db)) {
    if (hexAddress(key) === hex) return key;
  }
  return null;
}

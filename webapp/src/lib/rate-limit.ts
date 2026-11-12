// 送信元ごとの回数制限(R-085)。メモリ上の滑り窓で「key ごとに windowMs の間に limit 回まで」。
// ログインの制限(auth.ts の loginRateOk)と同じ考え方を、他の API でも使えるよう一般化したもの。
// 受信機は LAN 内の少数の端末から使われるので、key の数は小さい。念のため上限を設け古いものから捨てる。

const MAX_KEYS = 1000;
const buckets = new Map<string, number[]>();

export function rateOk(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let hits = buckets.get(key);
  if (!hits) {
    if (buckets.size >= MAX_KEYS) {
      // 一番古い key を落とす(Map は挿入順)
      const first = buckets.keys().next().value;
      if (first !== undefined) buckets.delete(first);
    }
    hits = [];
    buckets.set(key, hits);
  }
  // 窓の外の記録を捨てる
  while (hits.length > 0 && now - hits[0] > windowMs) hits.shift();
  if (hits.length >= limit) return false;
  hits.push(now);
  return true;
}

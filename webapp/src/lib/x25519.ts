/**
 * X25519(RFC 7748)の鍵の生成。ブラウザ側で WireGuard の鍵を作るために使う(R-112)。
 *
 * なぜ自前か: 機体の画面は LAN の平文 HTTP で、ブラウザの WebCrypto(crypto.subtle)は
 * 安全でないコンテキストでは使えない。鍵をブラウザで作れば、秘密鍵は一度も LAN を流れない
 * (サーバーへ送るのは公開鍵だけ。設定ファイルの PrivateKey 行はブラウザが埋める)。
 * crypto.getRandomValues は平文 HTTP でも使える。
 *
 * 実装は RFC 7748 §5 のモンゴメリ梯子をそのまま BigInt で書いたもの。処理は 1 回数ミリ秒。
 * 正しさはサーバー側(Node の crypto)との突き合わせ試験で確認する(tests/x25519-check.mjs)。
 */

const P = (1n << 255n) - 19n;
const A24 = 121665n;

function mod(a: bigint): bigint {
  const r = a % P;
  return r < 0n ? r + P : r;
}

function pow(b: bigint, e: bigint): bigint {
  let r = 1n;
  b = mod(b);
  while (e > 0n) {
    if (e & 1n) r = mod(r * b);
    b = mod(b * b);
    e >>= 1n;
  }
  return r;
}

function decodeLE(b: Uint8Array): bigint {
  let r = 0n;
  for (let i = b.length - 1; i >= 0; i--) r = (r << 8n) | BigInt(b[i]);
  return r;
}

function encodeLE(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
}

/** RFC 7748 §5: 秘密鍵のクランプ */
export function clampScalar(k: Uint8Array): Uint8Array {
  const c = new Uint8Array(k);
  c[0] &= 248;
  c[31] &= 127;
  c[31] |= 64;
  return c;
}

function scalarMult(k: bigint, u: bigint): bigint {
  const x1 = u;
  let x2 = 1n, z2 = 0n, x3 = u, z3 = 1n, swap = 0n;
  for (let t = 254n; t >= 0n; t--) {
    const kt = (k >> t) & 1n;
    swap ^= kt;
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
    swap = kt;
    const a = mod(x2 + z2), aa = mod(a * a);
    const b = mod(x2 - z2), bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3), d = mod(x3 - z3);
    const da = mod(d * a), cb = mod(c * b);
    const s = mod(da + cb), f = mod(da - cb);
    x3 = mod(s * s);
    z3 = mod(x1 * mod(f * f));
    x2 = mod(aa * bb);
    z2 = mod(e * mod(aa + A24 * e));
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  return mod(x2 * pow(z2, P - 2n));
}

/** 秘密鍵(32 バイト・クランプ前でも可)から公開鍵(32 バイト) */
export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) throw new Error("x25519: private key must be 32 bytes");
  return encodeLE(scalarMult(decodeLE(clampScalar(privateKey)), 9n));
}

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/** WireGuard 用の鍵ペア(base64)。乱数は crypto.getRandomValues(平文 HTTP のページでも使える) */
export function generateWireGuardKeyPair(): { privateKey: string; publicKey: string } {
  const priv = clampScalar(crypto.getRandomValues(new Uint8Array(32)));
  return { privateKey: toBase64(priv), publicKey: toBase64(x25519PublicKey(priv)) };
}

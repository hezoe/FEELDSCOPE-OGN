// FEELDSCOPE-OGN 認証コア
// - admin パスワード(scrypt)保存 / 検証 / 変更
// - HMAC 署名セッション(httpOnly cookie)
// - オペレーター判定: CATVPN オペレーターサブネット(10.66.10.0/24)からのアクセス
//   ※リモートサポートONの時のみ RPi は VPN 上に存在し、その IP に到達できるのは
//     隔離ポリシー上オペレーターだけ。よって送信元IP=10.66.10.x は本人証明になる。
import { readFile, writeFile } from "fs/promises";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";

const AUTH_PATH = process.env.FEELDSCOPE_AUTH_CONFIG
  || `${process.env.FEELDSCOPE_DIR || "/home/pi/FEELDSCOPE"}/auth.json`;
const OPERATOR_SUBNET_PREFIX = process.env.FEELDSCOPE_OPERATOR_PREFIX || "10.66.10.";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
export const SESSION_COOKIE = "feeldscope_session";
export const DEFAULT_PASSWORD = "admin";

interface AuthConfig {
  salt: string;          // hex
  hash: string;          // hex (scrypt 32B)
  sessionSecret: string; // hex (HMAC key)
  mustChange: boolean;   // 初期パスワードのまま
}

function hashPassword(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 32);
}

function makeConfig(password: string, mustChange: boolean): AuthConfig {
  const salt = randomBytes(16).toString("hex");
  return {
    salt,
    hash: hashPassword(password, salt).toString("hex"),
    sessionSecret: randomBytes(32).toString("hex"),
    mustChange,
  };
}

let cache: AuthConfig | null = null;

async function loadAuth(): Promise<AuthConfig> {
  if (cache) return cache;
  try {
    const p = JSON.parse(await readFile(AUTH_PATH, "utf-8"));
    if (p.salt && p.hash && p.sessionSecret) {
      cache = { salt: p.salt, hash: p.hash, sessionSecret: p.sessionSecret, mustChange: !!p.mustChange };
      return cache;
    }
  } catch { /* not seeded yet */ }
  // 初期化: 既定パスワード "admin"（mustChange=true）
  const cfg = makeConfig(DEFAULT_PASSWORD, true);
  await saveAuth(cfg).catch(() => { /* read-only fs 等は無視、メモリのみ */ });
  cache = cfg;
  return cfg;
}

async function saveAuth(cfg: AuthConfig): Promise<void> {
  await writeFile(AUTH_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  cache = cfg;
}

export async function verifyPassword(password: string): Promise<boolean> {
  const cfg = await loadAuth();
  const h = hashPassword(password, cfg.salt);
  const stored = Buffer.from(cfg.hash, "hex");
  return h.length === stored.length && timingSafeEqual(h, stored);
}

// current が正しければ new を設定。operatorBypass=true なら current 不要（失念時の解除用）
export async function changePassword(newPassword: string, current: string | null, operatorBypass: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 4) return { ok: false, error: "パスワードは4文字以上にしてください" };
  if (!operatorBypass) {
    if (!(await verifyPassword(current || ""))) return { ok: false, error: "現在のパスワードが違います" };
  }
  const cfg = await loadAuth();
  const salt = randomBytes(16).toString("hex");
  await saveAuth({ ...cfg, salt, hash: hashPassword(newPassword, salt).toString("hex"), mustChange: false });
  return { ok: true };
}

// ── セッション(署名トークン) ──
export async function issueSession(): Promise<string> {
  const cfg = await loadAuth();
  const b = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", cfg.sessionSecret).update(b).digest("base64url");
  return `${b}.${sig}`;
}

async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const cfg = await loadAuth();
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const b = token.slice(0, dot), sig = token.slice(dot + 1);
  const expected = createHmac("sha256", cfg.sessionSecret).update(b).digest("base64url");
  const sigBuf = Buffer.from(sig), expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false;
  try {
    const payload = JSON.parse(Buffer.from(b, "base64url").toString());
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch { return false; }
}

export function clientIpFromRequest(request: Request): string | null {
  // custom server(server.ts) が socket.remoteAddress を x-client-ip に載せる
  const ip = request.headers.get("x-client-ip") || request.headers.get("x-real-ip");
  return ip ? ip.replace(/^::ffff:/, "").trim() : null;
}

export function isOperatorIp(ip: string | null): boolean {
  return !!ip && ip.startsWith(OPERATOR_SUBNET_PREFIX);
}

export interface AuthContext {
  loggedIn: boolean;
  isOperator: boolean;  // オペレーターサブネットからのアクセス
  mustChange: boolean;
  clientIp: string | null;
}

function cookieValue(cookieHeader: string, name: string): string | undefined {
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

export async function getAuthContext(request: Request): Promise<AuthContext> {
  const token = cookieValue(request.headers.get("cookie") || "", SESSION_COOKIE);
  const [loggedIn, cfg] = await Promise.all([verifySession(token), loadAuth()]);
  const clientIp = clientIpFromRequest(request);
  return { loggedIn, isOperator: isOperatorIp(clientIp), mustChange: cfg.mustChange, clientIp };
}

// 変更系操作の許可: ログイン済み or オペレーター
export function isAuthorizedToMutate(ctx: AuthContext): boolean {
  return ctx.loggedIn || ctx.isOperator;
}

export function sessionCookieHeader(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

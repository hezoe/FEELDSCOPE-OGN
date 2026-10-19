/**
 * リモートアクセス（メンバーの PC → この FEELDSCOPE だけ）
 *
 * 滑空場の LAN にはインターネットから入れないので、メンバーの PC を CATVPN のハブへつなぎ、
 * ハブが「その PC → この FEELDSCOPE の画面(80)とライブデータ(9001)だけ」を中継する。
 * 台帳と関所はハブ側(catvpn-hub の members.py)にあり、ここはその管理 API の窓口。
 *
 *  - 管理 API はハブの VPN 側(10.66.0.1:18081)だけで受ける。ハブは送り元アドレス(この機の
 *    CATVPN アドレス)で FEELDSCOPE を確かめるので、ここから操作できるのはこの機のメンバーだけ。
 *  - 鍵はここで作る。ハブへ送るのは公開鍵だけ。秘密鍵は設定ファイルに入れて一度だけ画面へ返し、
 *    この機にもハブにも残さない(なくしたら削除して追加し直す)。
 *  - リモートサポート(wg0)が止まっているとハブへ届かない(メンバーもつながらない)。
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "crypto";
import { readFile } from "fs/promises";
import { runShell } from "@/lib/run";

const HUB_API = process.env.CATVPN_MEMBERS_API || "http://10.66.0.1:18081";
const IDENTITY_PATH = process.env.CATVPN_IDENTITY || "/etc/catvpn/identity";
const HUB_TIMEOUT_MS = 8000;

export interface Member {
  id: string;
  name: string;
  device: string;
  ip: string;
  state: "active" | "paused";
  created_at: string;
  updated_at?: string;
  last_handshake: string | null;
}

export interface VpnState {
  active: boolean;          // wg-quick@wg0 が動いている(=リモートサポート ON)
  assigned_ip?: string;     // この機の CATVPN アドレス(メンバーが開く URL)
}

export class HubError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export async function vpnState(): Promise<VpnState> {
  let active = false;
  try {
    const { stdout } = await runShell("systemctl is-active wg-quick@wg0 2>/dev/null || true");
    active = stdout.trim() === "active";
  } catch { /* ignore */ }
  let assigned_ip: string | undefined;
  try {
    const m = (await readFile(IDENTITY_PATH, "utf-8")).match(/^assigned_ip=(.+)$/m);
    if (m) assigned_ip = m[1].trim();
  } catch { /* 未登録 */ }
  return { active, assigned_ip };
}

async function hub<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${HUB_API}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
    });
  } catch {
    throw new HubError("ハブに接続できません（リモートサポートが OFF か、インターネットにつながっていません）", 503);
  }
  let data: { error?: string } & Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch { /* 本文なし */ }
  if (!res.ok) {
    // 404 = ハブがまだリモートアクセスに対応していない(古いハブ)か、メンバーが見つからない
    throw new HubError(data.error || `ハブがエラーを返しました（${res.status}）`, res.status === 403 || res.status === 404 || res.status === 400 ? res.status : 502);
  }
  return data as T;
}

export interface MemberList {
  owner_ip: string;
  owner_host: string;
  limit: number;
  members: Member[];
}

export async function listMembers(): Promise<MemberList> {
  const r = await hub<MemberList & { hub?: unknown }>("GET", "/v1/members");
  return { owner_ip: r.owner_ip, owner_host: r.owner_host, limit: r.limit, members: r.members || [] };
}

/** WireGuard の鍵(Curve25519)。DER の末尾32バイトが生の鍵 */
function rawKey(k: KeyObject, type: "pkcs8" | "spki"): string {
  const der = k.export({ format: "der", type }) as Buffer;
  return der.subarray(der.length - 32).toString("base64");
}

export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return { privateKey: rawKey(privateKey, "pkcs8"), publicKey: rawKey(publicKey, "spki") };
}

/** 生の秘密鍵(base64)から公開鍵を出す(試験用) */
export function publicKeyOf(privateKeyB64: string): string {
  const der = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), Buffer.from(privateKeyB64, "base64")]);
  return rawKey(createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" })), "spki");
}

interface AddResponse {
  member: Member;
  client: { address: string; allowed_ips: string; hub: { endpoint?: string; pubkey?: string } };
}

export interface AddResult {
  member: Member;
  config: string;       // メンバーの PC に入れる WireGuard の設定(秘密鍵入り・一度だけ返す)
  filename: string;
  url: string;          // つないだあとに開く URL
}

export async function addMember(name: string, device: string): Promise<AddResult> {
  const keys = generateKeyPair();
  const r = await hub<AddResponse>("POST", "/v1/members", { name, device, pubkey: keys.publicKey });
  const { address, allowed_ips, hub: h } = r.client;
  if (!h?.endpoint || !h?.pubkey) throw new HubError("ハブの接続先が分かりません（ハブの設定を確認してください）");
  const target = allowed_ips.replace(/\/32$/, "");
  const config = [
    "[Interface]",
    // QR(英数字)と各 OS の WireGuard で確実に読めるよう、設定の中は ASCII だけにする(氏名は入れない)
    `# FEELDSCOPE remote access ${target} (${r.member.id})`,
    `PrivateKey = ${keys.privateKey}`,
    `Address = ${address}`,
    "",
    "[Peer]",
    `PublicKey = ${h.pubkey}`,
    `Endpoint = ${h.endpoint}`,
    `AllowedIPs = ${allowed_ips}`,
    "PersistentKeepalive = 25",
    "",
  ].join("\n");
  // WireGuard はファイル名をトンネル名にする。Linux のインターフェース名は15文字まで
  return { member: r.member, config, filename: `feeldscope-${r.member.id.slice(1, 5)}.conf`, url: `http://${target}/` };
}

export async function changeMember(id: string, action: "pause" | "resume" | "delete"): Promise<{ id: string; state: string }> {
  if (!/^m[0-9a-f]{10}$/.test(id)) throw new HubError("ID が正しくありません", 400);
  return hub("POST", `/v1/members/${id}/${action}`);
}

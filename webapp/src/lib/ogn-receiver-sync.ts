/**
 * /boot/OGN-receiver.conf を直接書き換えたときも、受信機名・座標・標高を受信機に反映する。
 *
 * 背景（2026-10-06 長野の受信局）: OGN の設定マネージャ(/root/OGN-receiver-config-manager)は
 * /boot/rtlsdr-ogn.conf があるとそれだけを使い、OGN-receiver.conf の受信機名・座標・標高を
 * 無視する（"ignoring other reciver parameters"）。FEELDSCOPE のインストーラーがこのファイルを
 * 作るので、インストール後に OGN-receiver.conf を直しても受信機には届かず、ogn.ezoe.net には
 * 古い名前・座標のまま表示されていた。
 *
 * 決まり:
 *  - 設定画面で保存すると両方のファイルを書く（/api/ogn。保存後に markReceiverConfSynced()）
 *  - OGN-receiver.conf の 受信機名・緯度・経度・標高 が前回反映したときから変わっていたら、
 *    /boot/rtlsdr-ogn.conf（正本）と /home/pi のコピーに書いて受信機を再起動する
 *  - 空欄・コメントアウトの項目は触らない（標高を書いていない機体は今の標高のまま）
 *  - 値がおかしいとき（英数字9文字を超える名前・範囲外の座標など）は反映せず、設定画面に出す
 *  - この版に更新して初めて見たときに食い違っていたら、OGN-receiver.conf のほうが新しい
 *    （インストール後に書き換えた）ときだけ反映する。そうでなければ今の受信機の設定のまま
 * 起動の30秒後と、以後1分ごとに見る。SD カードを PC で書き換えた場合は次の起動時に、
 * SSH で書き換えた場合は1分以内に反映される。
 */
import { mkdir, readFile, rmdir, stat, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { isHostLocked } from "@/lib/host-guard";
import { run } from "@/lib/run";
import {
  OGN_RECEIVER_CONF_PATH, RTLSDR_OGN_CONF_AUTHORITY, RTLSDR_OGN_CONF_PATHS,
  errMsg, extractField, normalizeNewlines, restartOgnReceiver, writeConfFile,
} from "@/lib/ogn-conf";

const FEELDSCOPE_DIR = process.env.FEELDSCOPE_DIR || "/home/pi/FEELDSCOPE";
const STATE_PATH = process.env.FEELDSCOPE_OGN_SYNC_STATE || `${FEELDSCOPE_DIR}/ogn-receiver-sync.json`;
const LOCK_DIR = "/tmp/feeldscope-ogn-conf.lock";
const FIRST_DELAY_MS = 30_000;
const POLL_MS = 60_000;
/** 設定画面で保存した直後は、その保存の再起動と重ならないよう見送る */
const AFTER_SAVE_QUIET_MS = 3 * 60_000;

/** OGN-receiver.conf の4項目（bash で読んだ生の文字列。空欄は ""） */
export interface ReceiverRaw { ReceiverName: string; Latitude: string; Longitude: string; Altitude: string }

export interface SyncState {
  /** 最後に反映（または確認）した OGN-receiver.conf の4項目 */
  fingerprint?: string;
  checkedAt?: string;
  savedAt?: string;
  lastApplied?: { at: string; changes: string[]; restart: string };
  /** 値がおかしくて反映しなかったとき */
  error?: { at: string; fingerprint: string; message: string };
  note?: string;
}

/**
 * OGN の設定マネージャと同じ読み方（CR を除いて bash で source）で4項目を読む。
 * 自前の正規表現で読むと、bash では読めるのに読めない書き方（行頭の空白など）で食い違う。
 * インストーラーの経度が東京駅の既定値になったのはこのため。
 */
export async function readReceiverRaw(): Promise<ReceiverRaw | null> {
  if (!existsSync(OGN_RECEIVER_CONF_PATH)) return null;
  const script =
    'source <(tr -d "\\r" < "$1") >/dev/null 2>&1; ' +
    'printf "%s\\0" "$ReceiverName" "$Latitude" "$Longitude" "$Altitude"';
  const { stdout } = await run(
    "env", ["-i", "PATH=/usr/bin:/bin", "bash", "--noprofile", "--norc", "-c", script, "_", OGN_RECEIVER_CONF_PATH],
    { timeout: 10_000 },
  );
  const [ReceiverName = "", Latitude = "", Longitude = "", Altitude = ""] = stdout.split("\0").map((v) => v.trim());
  return { ReceiverName, Latitude, Longitude, Altitude };
}

const NUM = /^[+-]?\d+(\.\d+)?$/;

/** 空欄でない項目を検査し、受信機の設定に書く値にする。おかしければ理由を返す */
export function validateReceiverRaw(r: ReceiverRaw): { values: Partial<Record<keyof ReceiverRaw, string>>; problems: string[] } {
  const values: Partial<Record<keyof ReceiverRaw, string>> = {};
  const problems: string[] = [];
  if (r.ReceiverName) {
    if (/^[A-Za-z0-9]{1,9}$/.test(r.ReceiverName)) values.ReceiverName = r.ReceiverName;
    else problems.push(`受信機名「${r.ReceiverName}」は英数字9文字以内にしてください`);
  }
  const num = (key: "Latitude" | "Longitude" | "Altitude", label: string, min: number, max: number) => {
    const s = r[key];
    if (!s) return;
    const v = Number(s);
    if (NUM.test(s) && v >= min && v <= max) values[key] = String(v);
    else problems.push(`${label}「${s}」は ${min}〜${max} の数字にしてください（例 36.6270）`);
  };
  num("Latitude", "緯度", -90, 90);
  num("Longitude", "経度", -180, 180);
  num("Altitude", "標高", -500, 9000);
  return { values, problems };
}

/** 受信機の設定(rtlsdr-ogn.conf)から4項目を読む */
export function readRtlsdrValues(text: string): ReceiverRaw {
  return {
    ReceiverName: extractField(text, /Call\s*=\s*"([^"]*)"/),
    Latitude: extractField(text, /\bLatitude\s*=\s*([+\-0-9.]+)/),
    Longitude: extractField(text, /\bLongitude\s*=\s*([+\-0-9.]+)/),
    Altitude: extractField(text, /\bAltitude\s*=\s*([+\-0-9.]+)/),
  };
}

/** rtlsdr-ogn.conf の該当行の値だけを書き換える（他の設定には触らない） */
export function applyToRtlsdrConf(text: string, values: Partial<Record<keyof ReceiverRaw, string>>): string {
  let out = text;
  // re は「値の前」を1つ目のグループにする。値の後ろ(閉じ引用符など)は置き換えない
  const swap = (re: RegExp, v: string, label: string) => {
    if (!re.test(out)) throw new Error(`rtlsdr-ogn.conf に ${label} の行がありません`);
    out = out.replace(re, (_m: string, pre: string) => `${pre}${v}`);
  };
  if (values.ReceiverName !== undefined) swap(/(\bCall\s*=\s*")[^"]*(?=")/, values.ReceiverName, "Call");
  if (values.Latitude !== undefined) swap(/(\bLatitude\s*=\s*)[+\-0-9.]+/, values.Latitude, "Latitude");
  if (values.Longitude !== undefined) swap(/(\bLongitude\s*=\s*)[+\-0-9.]+/, values.Longitude, "Longitude");
  if (values.Altitude !== undefined) swap(/(\bAltitude\s*=\s*)[+\-0-9.]+/, values.Altitude, "Altitude");
  return out;
}

/** 書き換えが必要な項目（数値は値として比べる。36.6270 と 36.627 は同じ） */
export function diffValues(want: Partial<Record<keyof ReceiverRaw, string>>, cur: ReceiverRaw): string[] {
  const out: string[] = [];
  for (const k of Object.keys(want) as (keyof ReceiverRaw)[]) {
    const w = want[k] as string;
    const same = k === "ReceiverName" ? w === cur[k] : NUM.test(cur[k]) && Number(w) === Number(cur[k]);
    if (!same) out.push(`${k}: ${cur[k] || "（なし）"} → ${w}`);
  }
  return out;
}

const fingerprintOf = (r: ReceiverRaw) => JSON.stringify([r.ReceiverName, r.Latitude, r.Longitude, r.Altitude]);

export async function loadSyncState(): Promise<SyncState> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf-8")) as SyncState;
  } catch {
    return {};
  }
}

async function saveSyncState(s: SyncState): Promise<void> {
  try {
    await writeFile(STATE_PATH, JSON.stringify(s, null, 2));
  } catch (e) {
    console.error("[ogn-receiver-sync] 状態を保存できません", errMsg(e));
  }
}

/** 設定画面で保存した直後に呼ぶ。保存した値を「反映済み」として覚える */
export async function markReceiverConfSynced(): Promise<void> {
  try {
    const raw = await readReceiverRaw();
    if (!raw) return;
    const s = await loadSyncState();
    const now = new Date().toISOString();
    await saveSyncState({ ...s, fingerprint: fingerprintOf(raw), savedAt: now, checkedAt: now, error: undefined });
  } catch (e) {
    console.error("[ogn-receiver-sync] 保存後の記録に失敗", errMsg(e));
  }
}

/** 同時に2つ走らないように（mkdir は原子的）。古い印は5分で捨てる */
async function withLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    await mkdir(LOCK_DIR);
  } catch {
    try {
      const st = await stat(LOCK_DIR);
      if (Date.now() - st.mtimeMs < 5 * 60_000) return undefined;
      await rmdir(LOCK_DIR).catch(() => {});
      await mkdir(LOCK_DIR);
    } catch {
      return undefined;
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(LOCK_DIR).catch(() => {});
  }
}

export type SyncResult =
  | { action: "none" | "baseline" | "invalid" | "skipped"; detail?: string }
  | { action: "applied"; changes: string[]; restart: string };

/** 1回分の確認と反映 */
export async function syncReceiverConfOnce(): Promise<SyncResult> {
  if (isHostLocked()) return { action: "skipped", detail: "デモ機" };
  if (!existsSync("/etc/init.d/rtlsdr-ogn")) return { action: "skipped", detail: "受信機なし" };
  const r = await withLock(async (): Promise<SyncResult> => {
    const raw = await readReceiverRaw();
    if (!raw) return { action: "skipped", detail: "OGN-receiver.conf がありません" };
    const fp = fingerprintOf(raw);
    const state = await loadSyncState();
    const now = new Date().toISOString();
    if (state.fingerprint === fp) return { action: "none" };
    if (state.savedAt && Date.now() - Date.parse(state.savedAt) < AFTER_SAVE_QUIET_MS) {
      return { action: "skipped", detail: "設定画面で保存した直後" };
    }

    const { values, problems } = validateReceiverRaw(raw);
    if (problems.length) {
      const message = problems.join(" / ");
      if (state.error?.fingerprint !== fp) {
        console.warn(`[ogn-receiver-sync] OGN-receiver.conf の値を反映しませんでした: ${message}`);
      }
      await saveSyncState({ ...state, checkedAt: now, error: { at: state.error?.fingerprint === fp ? state.error.at : now, fingerprint: fp, message } });
      return { action: "invalid", detail: message };
    }

    const text = normalizeNewlines(await readFile(RTLSDR_OGN_CONF_AUTHORITY, "utf-8"));
    const changes = diffValues(values, readRtlsdrValues(text));

    // この版で初めて見たとき: 食い違っていても、OGN-receiver.conf のほうが新しいときだけ反映する
    if (!state.fingerprint && changes.length) {
      const [mr, mc] = await Promise.all([stat(OGN_RECEIVER_CONF_PATH), stat(RTLSDR_OGN_CONF_AUTHORITY)]);
      if (mr.mtimeMs <= mc.mtimeMs + 2_000) {   // FAT の時刻は2秒刻み
        const note = `初回確認: 受信機の設定(${RTLSDR_OGN_CONF_AUTHORITY})のほうが新しいため反映せず（${changes.join(", ")}）`;
        console.log(`[ogn-receiver-sync] ${note}`);
        await saveSyncState({ ...state, fingerprint: fp, checkedAt: now, error: undefined, note });
        return { action: "baseline", detail: note };
      }
    }
    if (!changes.length) {
      await saveSyncState({ ...state, fingerprint: fp, checkedAt: now, error: undefined });
      return { action: state.fingerprint ? "none" : "baseline" };
    }

    // 正本(/boot)に書けなければ再起動しても戻るだけなので、正本を先に書いて確かめる
    const next = applyToRtlsdrConf(text, values);
    await writeConfFile(RTLSDR_OGN_CONF_AUTHORITY, next);
    for (const p of RTLSDR_OGN_CONF_PATHS) {
      if (p !== RTLSDR_OGN_CONF_AUTHORITY) await writeConfFile(p, next).catch((e) => console.warn(`[ogn-receiver-sync] ${p}: ${errMsg(e)}`));
    }
    const back = readRtlsdrValues(normalizeNewlines(await readFile(RTLSDR_OGN_CONF_AUTHORITY, "utf-8")));
    if (diffValues(values, back).length) throw new Error("書き込んだ値を読み戻すと一致しません");

    const port = parseInt(extractField(next, /HTTP:\s*\{\s*Port\s*=\s*(\d+)/, "8082"), 10);
    console.log(`[ogn-receiver-sync] OGN-receiver.conf の変更を反映します: ${changes.join(", ")}`);
    const rs = await restartOgnReceiver(port);
    await run("sudo", ["-n", "/usr/local/sbin/feeldscope-wpa-dedupe"]).catch(() => {});
    const restart = rs.ok ? `受信機を再起動（${rs.detail}）` : `受信機の再起動を確認できません（${rs.detail}）`;
    console.log(`[ogn-receiver-sync] ${restart}`);
    await saveSyncState({ ...state, fingerprint: fp, checkedAt: now, error: undefined, note: undefined, lastApplied: { at: now, changes, restart } });
    return { action: "applied", changes, restart };
  });
  return r ?? { action: "skipped", detail: "別の処理が実行中" };
}

let started = false;
export function startOgnReceiverSync(): void {
  if (started) return;
  started = true;
  const tick = () => {
    syncReceiverConfOnce().catch((e) => console.error("[ogn-receiver-sync]", errMsg(e)));
  };
  setTimeout(() => {
    tick();
    setInterval(tick, POLL_MS);
  }, FIRST_DELAY_MS);
}

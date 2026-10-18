/**
 * 起動の記録（/boot/feeldscope、feeldscope-bootlog が書く）を読む。
 *
 * 固定化(OverlayFS)の外に残るので、再起動・電源断のあとでも「いつ起動したか」
 * 「前回は正常に止まったか（電源断・固まりではないか）」「前回最後に動いていた時刻」が分かる。
 * 2026-10-18 関宿で1日に5回再起動したが、原因を確定できなかったのがきっかけ。
 */
import { readFile } from "fs/promises";

const DIR = process.env.FEELDSCOPE_BOOTLOG_DIR || "/boot/feeldscope";
const SHOW = 20;

export interface BootRecord {
  /** 起動時刻(ISO・時計が合ってから求めた値) */
  boot: string;
  /** 前回の止まり方: clean=正常な停止・再起動 / unclean=電源断か固まり / unknown=初回 */
  prev: "clean" | "unclean" | "unknown";
  /** 前回最後に動いていた時刻(5分ごとの記録。電源が切れたおおよその時刻) */
  prev_alive: string;
}

export interface BootHistory {
  /** 新しい順 */
  boots: BootRecord[];
  /** 最後に動いていた時刻(今の起動で5分ごとに更新) */
  last_alive: string | null;
}

export async function readBootHistory(): Promise<BootHistory | null> {
  let raw: string;
  try {
    raw = await readFile(`${DIR}/boots.log`, "utf-8");
  } catch {
    return null;   // 記録の仕組みが入っていない(更新前・デモ機)
  }
  const boots: BootRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (typeof j.boot === "string") {
        boots.push({
          boot: j.boot,
          prev: j.prev === "clean" || j.prev === "unclean" ? j.prev : "unknown",
          prev_alive: typeof j.prev_alive === "string" ? j.prev_alive : "",
        });
      }
    } catch { /* 壊れた行は飛ばす */ }
  }
  let lastAlive: string | null = null;
  try { lastAlive = (await readFile(`${DIR}/alive`, "utf-8")).trim() || null; } catch { /* 無い */ }
  return { boots: boots.slice(-SHOW).reverse(), last_alive: lastAlive };
}

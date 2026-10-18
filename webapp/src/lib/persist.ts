/**
 * 固定化(OverlayFS)中でも、画面で変えた設定を再起動のあとに残す。
 *
 * 固定化が有効だと書き込みは RAM にしか残らず、電源断・再起動で消える
 * (2026-10-18 関宿: 登録番号を入れても再起動で消え、一覧が ID のままに)。
 * 設定ファイルを書いたあとに persistFiles() を呼ぶと、そのファイルだけを
 * 下の SD にも書き写す(root の /usr/local/sbin/feeldscope-persist を sudo で呼ぶ)。
 *
 * - 固定化が無効なら何もしない(書いた時点で SD に残っている)。
 * - 失敗しても画面の操作は失敗にしない(RAM 上には書けているので、少なくとも
 *   次の再起動までは効く)。ログにだけ残す。
 * - 書き写しは1本ずつ順に(SD を書き込み可能にする/戻すが重ならないように)。
 */
import { existsSync } from "fs";
import { run } from "./run";

const ROBASE_MARK = "/overlay/robase/overlay";   // overlayctl と同じ「固定化中」の判定
const HELPER = "/usr/local/sbin/feeldscope-persist";

let chain: Promise<void> = Promise.resolve();

export function overlayActive(): boolean {
  try { return existsSync(ROBASE_MARK); } catch { return false; }
}

/** 書いたファイルを下の SD にも書き写す(固定化中だけ)。終わるまで待たなくてよい */
export function persistFiles(...paths: string[]): Promise<void> {
  if (!overlayActive() || !existsSync(HELPER)) return Promise.resolve();
  const job = chain.then(async () => {
    try {
      await run("sudo", ["-n", HELPER, ...paths], { timeout: 60_000 });
    } catch (e) {
      console.warn(`[persist] 固定化中の書き写しに失敗: ${paths.join(" ")} ${(e as Error).message}`);
    }
  });
  chain = job;
  return job;
}

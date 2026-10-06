/**
 * OGN 受信機（rtlsdr-ogn）の設定ファイルの読み書きと再起動。
 * 設定画面(/api/ogn)と、OGN-receiver.conf の直接編集を反映する処理(ogn-receiver-sync)の両方から使う。
 */
import { access, constants, readFile, rename, unlink, writeFile } from "fs/promises";
import { run } from "@/lib/run";

// /boot/rtlsdr-ogn.conf が正本。init.d は起動のたびにこれを /home/pi へ複製するので、
// /boot に書けていないと再起動で元に戻る。両方に書き、両方を確認する。
export const RTLSDR_OGN_CONF_PATHS = ["/home/pi/rtlsdr-ogn.conf", "/boot/rtlsdr-ogn.conf"];
export const RTLSDR_OGN_CONF_AUTHORITY = "/boot/rtlsdr-ogn.conf";
export const OGN_RECEIVER_CONF_PATH = "/boot/OGN-receiver.conf";

/** 受信機の再起動ログ。切り離して動かすので出力はここへ逃がす */
export const OGN_RESTART_LOG = "/tmp/feeldscope-ogn-restart.log";

/** 起動を待つ上限。ntpdate + OGN-receiver-config-manager で 60 秒前後かかる */
export const OGN_START_WAIT_MS = 150_000;

/** 受信機の起動・停止。値を埋め込まない固定文字列であること（sh -c に渡すため）。
 *
 *  init.d の `restart` は使わない。2026-09 に滝川で受信が4日半止まった原因が
 *  この2つの罠だった:
 *   1. `start` は procServ を上げる前に ntpdate と /root/OGN-receiver-config-manager
 *      （疎通確認・自己更新・GeoidSepar取得）を走らせるので 60 秒前後かかる。
 *      webapp のパイプに繋いだまま実行すると run() のタイムアウトで stdio を
 *      切られ、起動途中のサブシェルが次の stdout 書き込みで SIGPIPE で死ぬ。
 *      procServ が上がる直前で落ちるため、止まったまま戻らない。
 *   2. init.d の stop() は $shells(/var/run/rtlsdr-ogn) が読めないと
 *      「No shells started.」で `exit 0` し、スクリプトごと終了する。
 *      `restart) stop; sleep 1; start` なので start に到達せず、しかも
 *      終了コード 0 なので画面には「再起動しました」と出る。1 でこの状態に
 *      落ちると、以後どれだけ押しても永久に起動しない。
 *  そのため setsid で完全に切り離し、stop と start を別々に叩く。 */
const OGN_RESTART_SH =
  `/etc/init.d/rtlsdr-ogn stop; sleep 2; /etc/init.d/rtlsdr-ogn start`;

/**
 * 改行を LF に揃える。
 *
 * /boot/OGN-receiver.conf は bash が source する。CR だけで区切られた行は
 * bash から見ると1行なので、先頭が `#` なら後ろのキーごと全部コメント扱いになる。
 * 実際に滝川で `### Mandatory ###\rReceiverName="TAKIKAWA1"\r…` という並びになり、
 * ReceiverName も OGNBINARYURL も読めず、日本版(?version=japan)ではなく欧州版の
 * バイナリが入って 868MHz を受信し続けた。画面側は JS 正規表現が CR も行末と
 * みなすため、壊れているのに正常に見えてしまう。
 *
 * CR は Windows から /boot を編集すると簡単に混入する。読んだ時点で畳んでおけば、
 * 次の保存でファイルごと LF に直る（＝勝手に直る）。
 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export async function readRtlsdrConf(): Promise<string> {
  for (const p of RTLSDR_OGN_CONF_PATHS) {
    try {
      return normalizeNewlines(await readFile(p, "utf-8"));
    } catch { /* try next */ }
  }
  return "";
}

export async function readReceiverConf(): Promise<string> {
  try {
    return normalizeNewlines(await readFile(OGN_RECEIVER_CONF_PATH, "utf-8"));
  } catch {
    return "";
  }
}

/** 設定ファイルから読んだポート番号を、そのまま外部へ渡さないよう正規化する */
export function rfPort(port: number): number {
  const n = Math.trunc(Number(port));
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 8082;
}

/** デコーダ側のポート（RF ポート + 1 が慣例） */
export function decodePort(port: number): number {
  return rfPort(port) + 1;
}

/** 受信機の状態ページを読む。ローカルの HTTP なのでシェルは介さない */
export async function fetchLocalPage(port: number): Promise<string> {
  const { stdout } = await run(
    "curl",
    ["-s", "--max-time", "3", `http://localhost:${rfPort(port)}/`],
    { timeout: 8_000 },
  );
  return stdout;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 受信機を止めて起動し直し、実際に上がったところまで見届ける。
 *
 * 起動処理は setsid で切り離す（理由は OGN_RESTART_SH のコメント）。切り離すと
 * 成否が戻ってこないので、状態ページが応答するまで待って結果を判断する。
 * 「コマンドが 0 で返ったから成功」にはしない。止まっているのに成功と表示するのが
 * いちばん困る。
 */
export async function restartOgnReceiver(port: number): Promise<{ ok: boolean; detail: string }> {
  // 受信機を持たない端末（VPSのデモ機など）で 150 秒待たされないよう先に見る
  try {
    await access("/etc/init.d/rtlsdr-ogn", constants.X_OK);
  } catch {
    return { ok: false, detail: "この端末に /etc/init.d/rtlsdr-ogn がありません（受信機なし）" };
  }

  await run(
    "sudo",
    ["-n", "setsid", "sh", "-c", `${OGN_RESTART_SH} > ${OGN_RESTART_LOG} 2>&1 < /dev/null &`],
    { timeout: 20_000 },
  );

  const deadline = Date.now() + OGN_START_WAIT_MS;
  await sleep(5_000);
  while (Date.now() < deadline) {
    const page = await fetchLocalPage(port).catch(() => "");
    if (page.trim().length > 0) {
      const sec = Math.round((OGN_START_WAIT_MS - (deadline - Date.now())) / 1000);
      return { ok: true, detail: `${sec}秒で起動を確認しました` };
    }
    await sleep(5_000);
  }
  return {
    ok: false,
    detail:
      `${Math.round(OGN_START_WAIT_MS / 1000)}秒待っても状態ページ(${rfPort(port)}番)が応答しません。` +
      `${OGN_RESTART_LOG} を確認してください`,
  };
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { stderr?: string; message?: string };
    const t = (o.stderr || o.message || "").toString().trim();
    if (t) return t.split("\n")[0].slice(0, 200);
  }
  return String(e).slice(0, 200);
}

/**
 * 設定ファイルを置き換える。権限に応じて手段を変え、全部だめなら理由をまとめて投げる。
 *  1. そのまま書く（ファイルの所有者がこのプロセスなら通る）
 *  2. 同じディレクトリに作って置き換える（ファイルが root 所有でも、ディレクトリに
 *     書ければ差し替えられる）
 *  3. sudo で置く（/boot など、ディレクトリごと root のとき）
 */
export async function writeConfFile(target: string, content: string): Promise<string> {
  const tried: string[] = [];
  try {
    await writeFile(target, content);
    return "直接書き込み";
  } catch (e) { tried.push(`直接書き込み: ${errMsg(e)}`); }

  const side = `${target}.feeldscope-new`;
  try {
    await writeFile(side, content);
    await rename(side, target);
    return "同ディレクトリで差し替え";
  } catch (e) {
    tried.push(`差し替え: ${errMsg(e)}`);
    await unlink(side).catch(() => {});
  }

  const tmp = `/tmp/feeldscope-ogn-${process.pid}-${Date.now()}.conf`;
  try {
    await writeFile(tmp, content);
    await run("sudo", ["-n", "cp", tmp, target]);
    return "sudo で書き込み";
  } catch (e) {
    tried.push(`sudo: ${errMsg(e)}`);
  } finally {
    await unlink(tmp).catch(() => {});
  }

  throw new Error(tried.join(" / "));
}

export function extractField(content: string, regex: RegExp, fallback: string = ""): string {
  const m = content.match(regex);
  return m ? m[1].trim() : fallback;
}

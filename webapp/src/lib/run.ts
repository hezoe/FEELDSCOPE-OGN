/**
 * 外部コマンドの実行。
 *
 * 値を混ぜて実行するときは必ず run() を使う。execFile はシェルを通さず引数を
 * 配列のまま渡すので、値に `;` `|` `$(...)` バッククォート 改行 が入っていても
 * コマンドとして解釈されない。文字列を組み立てて exec() に渡すと、設定画面の
 * 入力欄がそのまま root 権限のコマンド実行になる（sudo 経由で動かすものが
 * 多いため）。
 *
 * runShell() はパイプ・リダイレクト・`||` が必要な「固定文字列の」コマンド専用。
 * 値を埋め込んではいけない。埋め込みたくなったら run() を使うか、ファイルへ
 * 書き出してからパスだけを渡す。
 */
import { exec, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export interface RunOptions {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
}

const DEFAULTS: Required<Pick<RunOptions, "timeout" | "maxBuffer">> = {
  timeout: 60_000,
  maxBuffer: 4 * 1024 * 1024,
};

/** シェルを通さずに実行する。args の中身は常に「データ」として扱われる */
export async function run(
  file: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(file, args, { ...DEFAULTS, ...opts });
  return { stdout: String(stdout), stderr: String(stderr) };
}

/** 失敗しても投げず、出力（stdout+stderr）だけ返す。`|| true` の代わり */
export async function runQuiet(
  file: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<string> {
  try {
    const { stdout, stderr } = await run(file, args, opts);
    return stdout + stderr;
  } catch (e) {
    const o = e as { stdout?: string; stderr?: string };
    return String(o?.stdout || "") + String(o?.stderr || "");
  }
}

/** 失敗しても投げず、stdout だけ返す。出力を機械的に読む用途向け */
export async function runQuietStdout(
  file: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<string> {
  try {
    const { stdout } = await run(file, args, opts);
    return stdout;
  } catch (e) {
    return String((e as { stdout?: string })?.stdout || "");
  }
}

/** 固定文字列のコマンド専用。値を埋め込まないこと */
export async function runShell(
  command: string,
  opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execAsync(command, { ...DEFAULTS, ...opts });
  return { stdout: String(stdout), stderr: String(stderr) };
}

// ── 値の検証 ────────────────────────────────────────────────────────────────
// シェルを通さなくなっても、systemd のユニットファイルや設定ファイルへ値を
// 書く経路は残る。改行を1つ通すだけで別のディレクティブを足せてしまうため、
// ファイルへ書く値はここで形を確かめてから使う。

/** systemd ユニットや MQTT トピックに入れてよい受信機ID */
export function assertReceiverId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
    throw new Error(
      `受信機ID「${id}」は使えません。OGN設定の受信機名を英数字・ハイフン・` +
        "アンダースコア32文字以内にしてください",
    );
  }
  return id;
}

/** 設定ファイルへ書いてよい http(s) の URL */
export function assertHttpUrl(url: string, label: string): string {
  if (typeof url !== "string" || url.length === 0 || url.length > 500) {
    throw new Error(`${label}を入力してください（500文字以内）`);
  }
  // 使ってよい文字だけを許す。弾くのは改行・空白・引用符・バックスラッシュ・
  // バッククォート（シェル由来）と、$ と %（systemd のユニットファイルで展開
  // される指定子）。URL として書ける範囲は十分に残る。
  if (!/^[A-Za-z0-9._~:/?#@!&()*+,;=[\]-]+$/.test(url)) {
    throw new Error(`${label}に使えない文字が含まれています`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label}の形式が正しくありません`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label}は http:// または https:// で始めてください`);
  }
  return url;
}

/** systemd のサービス名・init.d のスクリプト名として使ってよい形か */
export function isSafeServiceName(name: string): boolean {
  return /^[A-Za-z0-9@._-]{1,64}$/.test(name);
}

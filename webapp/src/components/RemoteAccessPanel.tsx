"use client";

// 設定画面の「リモートアクセス」: 滑空場の外(自宅など)から、登録した PC・スマホでこの FEELDSCOPE を見る。
// 登録した端末はハブ(CATVPN)経由でこの FEELDSCOPE の画面とライブデータにだけつながる(他は遮断)。
// サーバー側は /api/remote-access → lib/remote-access.ts → ハブの管理 API。

import { useCallback, useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";

interface Member {
  id: string;
  name: string;
  device: string;
  ip: string;
  state: "active" | "paused";
  created_at: string;
  last_handshake: string | null;
}

interface RemoteAccessState {
  host_locked?: boolean;
  needsAuth?: boolean;
  vpn: { active: boolean; assigned_ip?: string } | null;
  members: Member[] | null;
  limit?: number;
  url?: string;
  hub_error?: string | null;
}

interface Added {
  member: Member;
  config: string;
  filename: string;
  url: string;
}

const CONNECTED_SEC = 180;   // 最後の鍵交換がこれ以内なら「接続中」(つながっている間は2分ごとに交換する)

function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isConnected(m: Member): boolean {
  if (!m.last_handshake || m.state !== "active") return false;
  return Date.now() - new Date(m.last_handshake).getTime() < CONNECTED_SEC * 1000;
}

/** QR コード(白地・余白4マス)。暗い画面でも読めるよう背景は常に白 */
function QrCode({ text, size = 240 }: { text: string; size?: number }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { n: count + 8, d: path };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label="WireGuard の設定の QR コード"
      shapeRendering="crispEdges" style={{ background: "#fff", display: "block" }}>
      <path d={d} fill="#000" />
    </svg>
  );
}

export default function RemoteAccessPanel({ canMutate }: { canMutate: boolean }) {
  const [state, setState] = useState<RemoteAccessState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);   // 実行中の操作(ボタンの二重押し防止)
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [device, setDevice] = useState("");
  const [added, setAdded] = useState<Added | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchState = useCallback(async (): Promise<RemoteAccessState | null> => {
    try {
      const res = await fetch("/api/remote-access", { cache: "no-store" });
      return await res.json();
    } catch {
      return null;
    }
  }, []);
  const apply = useCallback((s: RemoteAccessState | null) => {
    if (s) setState(s);
    else setError("リモートアクセスの状態を取得できませんでした");
  }, []);
  const load = useCallback(async () => apply(await fetchState()), [fetchState, apply]);

  // ログイン状態が変わったら取り直す。一覧はハブに問い合わせるので30秒ごと(他の欄の5秒より遅く)
  useEffect(() => {
    let alive = true;
    const tick = () => fetchState().then((s) => { if (alive) apply(s); });
    tick();
    const t = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [fetchState, apply, canMutate]);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/remote-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `失敗しました（${res.status}）`);
    return data;
  }

  async function change(m: Member, action: "pause" | "resume" | "delete") {
    if (action === "delete" && !confirm(`${m.name}（${m.device || "端末名なし"}）を削除しますか？\nこの端末はすぐにつながらなくなります。もう一度使うには追加し直してください。`)) return;
    if (action === "pause" && !confirm(`${m.name}（${m.device || "端末名なし"}）を一時停止しますか？\n再開するまでつながらなくなります。`)) return;
    setBusy(`${action}:${m.id}`);
    setError(null);
    try {
      await post({ action, id: m.id });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作に失敗しました");
    }
    setBusy(null);
  }

  async function add() {
    if (!name.trim()) {
      setError("氏名を入れてください");
      return;
    }
    setBusy("add");
    setError(null);
    try {
      const r: Added = await post({ action: "add", name: name.trim(), device: device.trim() });
      setAdded(r);
      setCopied(false);
      setName("");
      setDevice("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    }
    setBusy(null);
  }

  function download(a: Added) {
    const url = URL.createObjectURL(new Blob([a.config], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = a.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy(a: Added) {
    try {
      await navigator.clipboard.writeText(a.config);
      setCopied(true);
    } catch {
      setError("コピーできませんでした（ファイルを保存してください）");
    }
  }

  function closeAdded() {
    if (!confirm("この画面を閉じると、設定（QR コード・ファイル）は二度と表示できません。\n端末に設定を入れましたか？")) return;
    setAdded(null);
  }

  const secondary = { color: "var(--color-text-secondary)" };
  const box = (color: string, body: React.ReactNode) => (
    <div className="rounded p-3 text-sm" style={{ border: `1px solid ${color}`, background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}>{body}</div>
  );
  const btn = (primary: boolean, disabled: boolean) => ({
    background: primary ? "var(--color-accent)" : "var(--color-bg-tertiary)",
    color: primary ? "#fff" : "var(--color-text-primary)",
    border: primary ? "none" : "1px solid var(--color-border)",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  const members = state?.members ?? null;
  const vpnOff = state?.vpn && !state.vpn.active;
  const full = !!(members && state?.limit && members.length >= state.limit);

  return (
    <div className="space-y-4">
      <p className="text-sm" style={secondary}>
        滑空場の外（自宅など）から、登録した PC・スマホでこの FEELDSCOPE の画面を見られます。
        登録した端末は<strong>この FEELDSCOPE の画面にだけ</strong>つながり、ほかのクラブの機体や、この機の保守用の入口（SSH）には入れません。
        設定の変更には、滑空場の LAN と同じく管理者ログインが必要です。
      </p>

      {!state && <p className="text-sm" style={secondary}>読み込み中...</p>}

      {state?.needsAuth && box("var(--color-border)", <>登録している端末の一覧の表示と変更には、管理者ログインが必要です。</>)}

      {vpnOff && box("var(--color-warning)", <>
        <strong>リモートサポートが OFF のため、リモートアクセスは使えません</strong>（登録した端末もつながりません）。
        上の「リモートサポート」を ON にしてください。
      </>)}

      {state?.hub_error && box("var(--color-warning)", <>一覧を取得できませんでした: {state.hub_error}</>)}

      {error && box("var(--color-danger)", <>{error}</>)}

      {added && (
        <div className="rounded p-4 space-y-3" style={{ border: "2px solid var(--color-accent)", background: "var(--color-bg-primary)" }}>
          <div className="text-sm font-semibold">
            {added.member.name}（{added.member.device || "端末名なし"}）を追加しました
          </div>
          <div className="text-sm rounded p-2" style={{ background: "var(--color-warning-dim)", color: "var(--color-text-primary)" }}>
            ⚠ この設定は<strong>今だけ</strong>表示されます。閉じたあとは二度と表示できません（なくしたら削除して追加し直してください）。
            設定には鍵が入っています。本人以外に渡さないでください。
          </div>
          <div className="flex flex-wrap gap-5 items-start">
            <div className="space-y-1">
              <QrCode text={added.config} />
              <div className="text-xs text-center" style={secondary}>スマホ・タブレットはこれを読み取る</div>
            </div>
            <ol className="list-decimal ml-5 space-y-2 text-sm flex-1" style={{ minWidth: 240 }}>
              <li>
                端末に <strong>WireGuard</strong> を入れます（無料。
                <a href="https://www.wireguard.com/install/" target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>wireguard.com/install</a>
                ・App Store・Google Play）。
              </li>
              <li>
                <strong>スマホ・タブレット</strong>: アプリの「＋」→「QR コードから作成」で左の QR を読み取ります。<br />
                <strong>PC</strong>: 下の「設定ファイルを保存」で保存し、アプリの「ファイルからトンネルをインポート」で読み込みます。
              </li>
              <li>トンネルを「有効」にして、ブラウザで次のアドレスを開きます:<br />
                <code className="font-mono font-bold select-all">{added.url}</code>
              </li>
            </ol>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => download(added)} className="px-4 py-1.5 rounded text-sm font-medium" style={btn(true, false)}>
              設定ファイルを保存（{added.filename}）
            </button>
            <button type="button" onClick={() => copy(added)} className="px-4 py-1.5 rounded text-sm font-medium" style={btn(false, false)}>
              {copied ? "コピーしました" : "設定をコピー"}
            </button>
            <button type="button" onClick={closeAdded} className="px-4 py-1.5 rounded text-sm font-medium" style={btn(false, false)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {members && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="text-sm font-medium">許可している端末</span>
            <span className="text-xs" style={secondary}>{members.length} / {state?.limit ?? "-"} 台</span>
          </div>
          {members.length === 0 ? (
            <p className="text-sm" style={secondary}>まだ登録していません。下の「端末を追加」から追加してください。</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => {
                const connected = isConnected(m);
                const paused = m.state === "paused";
                return (
                  <li key={m.id} className="rounded p-3 flex flex-wrap items-center gap-x-4 gap-y-2"
                    style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", opacity: paused ? 0.75 : 1 }}>
                    <div className="flex-1" style={{ minWidth: 180 }}>
                      <div className="text-sm font-semibold">{m.name}
                        <span className="font-normal" style={secondary}>（{m.device || "端末名なし"}）</span>
                      </div>
                      <div className="text-xs mt-0.5" style={secondary}>
                        {paused ? (
                          <span style={{ color: "var(--color-warning)" }}>⏸ 一時停止中</span>
                        ) : connected ? (
                          <span style={{ color: "var(--color-success)" }}>🟢 接続中</span>
                        ) : (
                          <span>有効</span>
                        )}
                        {" ・ "}最終接続 {m.last_handshake ? fmtTime(m.last_handshake) : "まだ接続していません"}
                        {" ・ "}追加 {fmtTime(m.created_at)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" disabled={!canMutate || !!busy}
                        onClick={() => change(m, paused ? "resume" : "pause")}
                        className="px-3 py-1 rounded text-xs font-medium" style={btn(false, !canMutate || !!busy)}>
                        {busy === `pause:${m.id}` || busy === `resume:${m.id}` ? "適用中..." : paused ? "再開" : "一時停止"}
                      </button>
                      <button type="button" disabled={!canMutate || !!busy}
                        onClick={() => change(m, "delete")}
                        className="px-3 py-1 rounded text-xs font-medium"
                        style={{ ...btn(false, !canMutate || !!busy), color: "var(--color-danger)" }}>
                        {busy === `delete:${m.id}` ? "削除中..." : "削除"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {members && (
        <div className="rounded p-3 space-y-2" style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)" }}>
          <div className="text-sm font-medium">端末を追加</div>
          <div className="flex flex-wrap gap-2">
            <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
              placeholder="氏名（必須）" disabled={!canMutate || !!busy}
              className="px-3 py-1.5 text-sm rounded flex-1" style={{ minWidth: 140, background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
            <input type="text" value={device} maxLength={40} onChange={(e) => setDevice(e.target.value)}
              placeholder="端末名（例: 自宅のPC）" disabled={!canMutate || !!busy}
              className="px-3 py-1.5 text-sm rounded flex-1" style={{ minWidth: 140, background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
            <button type="button" onClick={add} disabled={!canMutate || !!busy || full || !name.trim()}
              className="px-4 py-1.5 rounded text-sm font-medium" style={btn(true, !canMutate || !!busy || full || !name.trim())}>
              {busy === "add" ? "追加中..." : "追加"}
            </button>
          </div>
          <p className="text-xs" style={secondary}>
            {full ? `登録できるのは ${state?.limit} 台までです。使わなくなった端末を削除してください。` :
              "1人の端末1台ごとに追加します（PC とスマホの両方で使うなら2つ）。追加するとすぐに使えます。追加した記録はサポート担当にも届きます。"}
          </p>
        </div>
      )}

      {state?.vpn?.assigned_ip && !vpnOff && (
        <p className="text-xs" style={secondary}>
          つないだあとに開くアドレス: <code className="font-mono select-all">{state.url || `http://${state.vpn.assigned_ip}/`}</code>
        </p>
      )}
    </div>
  );
}

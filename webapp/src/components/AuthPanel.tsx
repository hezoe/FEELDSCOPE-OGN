"use client";
import { useEffect, useState } from "react";

interface AuthStatus {
  loggedIn: boolean;
  isOperator: boolean;
  mustChange: boolean;
  canMutate: boolean;
}

// 認証パネル: 未ログインはログインフォーム、ログイン中はログアウト＋パスワード変更、
// オペレーター(リモートサポート中)はその旨を表示。設定変更の可否はここで決まる。
export default function AuthPanel() {
  const [st, setSt] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showPwChange, setShowPwChange] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  async function refresh() {
    try {
      const r = await fetch("/api/auth/status", { cache: "no-store" });
      setSt(await r.json());
    } catch { /* ignore */ }
  }
  useEffect(() => { refresh(); }, []);

  async function login() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error || "ログインに失敗しました"); }
      else { setPassword(""); window.location.reload(); }
    } catch { setMsg("通信エラー"); }
    setBusy(false);
  }
  async function logout() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* */ }
    window.location.reload();
  }
  async function changePw() {
    setMsg(null);
    if (newPw.length < 4) { setMsg("新しいパスワードは4文字以上"); return; }
    if (newPw !== newPw2) { setMsg("新しいパスワードが一致しません"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // オペレーター時は current 省略可。通常は現在パスワードを送る。
        body: JSON.stringify(st?.isOperator ? { newPassword: newPw } : { current: curPw, newPassword: newPw }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error || "変更に失敗しました"); }
      else { setMsg("パスワードを変更しました"); setCurPw(""); setNewPw(""); setNewPw2(""); setShowPwChange(false); refresh(); }
    } catch { setMsg("通信エラー"); }
    setBusy(false);
  }

  if (!st) return null;

  const card = "rounded-lg p-3 mb-4 text-sm";
  const inputCls = "px-2 py-1 rounded border text-sm";
  const btnCls = "px-3 py-1.5 rounded text-sm font-medium";

  // オペレーター(リモートサポート)
  if (st.isOperator && !st.loggedIn) {
    return (
      <div className={card} style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-accent)" }}>
        🛠️ <strong>リモートサポート中（オペレーター）</strong> — パスワードなしで設定変更・パスワードリセットが可能です。
        <button className={btnCls + " ml-2"} style={{ background: "var(--color-accent)", color: "#fff" }}
          onClick={() => setShowPwChange((v) => !v)}>パスワードをリセット</button>
        {showPwChange && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className={inputCls} type="password" placeholder="新しいパスワード" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <input className={inputCls} type="password" placeholder="確認" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
            <button className={btnCls} disabled={busy} style={{ background: "var(--color-accent)", color: "#fff" }} onClick={changePw}>リセット</button>
          </div>
        )}
        {msg && <div className="mt-1 text-xs">{msg}</div>}
      </div>
    );
  }

  // 未ログイン
  if (!st.loggedIn) {
    return (
      <div className={card} style={{ background: "var(--color-bg-secondary)" }}>
        🔒 設定を<strong>変更</strong>するには管理者ログインが必要です（閲覧は可能）。初期パスワードは <code>admin</code>。
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={inputCls} type="password" placeholder="管理者パスワード" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") login(); }} />
          <button className={btnCls} disabled={busy} style={{ background: "var(--color-accent)", color: "#fff" }} onClick={login}>ログイン</button>
        </div>
        {msg && <div className="mt-1 text-xs" style={{ color: "var(--color-danger, #dc2626)" }}>{msg}</div>}
      </div>
    );
  }

  // ログイン中
  return (
    <div className={card} style={{ background: "var(--color-bg-secondary)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span>✅ <strong>管理者としてログイン中</strong> — 設定変更が可能です。</span>
        <button className={btnCls} style={{ background: "var(--color-bg-tertiary, #e5e7eb)" }} onClick={() => setShowPwChange((v) => !v)}>パスワード変更</button>
        <button className={btnCls} style={{ background: "var(--color-bg-tertiary, #e5e7eb)" }} onClick={logout}>ログアウト</button>
      </div>
      {st.mustChange && (
        <div className="mt-1 text-xs" style={{ color: "var(--color-warning, #d97706)" }}>
          ⚠️ 初期パスワード(admin)のままです。変更を推奨します。
        </div>
      )}
      {showPwChange && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={inputCls} type="password" placeholder="現在のパスワード" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
          <input className={inputCls} type="password" placeholder="新しいパスワード" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <input className={inputCls} type="password" placeholder="確認" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
          <button className={btnCls} disabled={busy} style={{ background: "var(--color-accent)", color: "#fff" }} onClick={changePw}>変更</button>
        </div>
      )}
      {msg && <div className="mt-1 text-xs">{msg}</div>}
    </div>
  );
}

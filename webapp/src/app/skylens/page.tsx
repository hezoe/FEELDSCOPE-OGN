"use client";

import { useEffect, useState, useCallback } from "react";
import HelpHint from "@/components/HelpHint";

interface SkylensConfig {
  stationId: string;
  latitude: number;
  longitude: number;
  elevationM: number;
  geoidSeparationM: number;
  sampleRate: number;
  gain: number;
  ppmCorrection: number;
  biasT: boolean;
  udpEnable: boolean;
  udpAddress: string;
  udpPort: number;
  tcpEnable: boolean;
  tcpPort: number;
  monitoringPort: number;
  sendHeartbeat: boolean;
  sendTraffic: boolean;
  sendAlertzone: boolean;
  sendStatistics: boolean;
  sqliteEnable: boolean;
  logVerbosity: string;
}

interface SkylensStatus {
  available: boolean;
  licensed: boolean;
  online: boolean;
  serviceActive: boolean;
  bridgeActive: boolean;
  uploaderActive: boolean;
  version?: string;
  buildDate?: string;
  instanceId?: string;
  licenseType?: string;
  licenseExpiration?: string;
  binaryExpiration?: string;
  demodulationPlan?: string;
  liveGain?: string;
  liveSampleRate?: string;
  liveSerial?: string;
  preambles?: number;
  decoded?: number;
  invalid?: number;
}

export default function SkylensPage() {
  const [config, setConfig] = useState<SkylensConfig | null>(null);
  const [status, setStatus] = useState<SkylensStatus | null>(null);
  const [gainSteps, setGainSteps] = useState<number[]>([]);
  // 変更権限: 管理者ログイン済み or リモートサポート中のオペレーターのみ
  const [canMutate, setCanMutate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 編集中の config が定期取得で上書きされないよう、初回と保存/再起動後だけ config を更新する
  const fetchAll = useCallback(async (refreshConfig: boolean = true) => {
    try {
      const res = await fetch("/api/skylens");
      const data = await res.json();
      if (refreshConfig) setConfig(data.config);
      setStatus(data.status);
      if (Array.isArray(data.gain_steps)) setGainSteps(data.gain_steps);
    } catch {
      setError("SkyLens情報の取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    fetchAll(true);
    const interval = setInterval(() => fetchAll(false), 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCanMutate(!!d.canMutate))
      .catch(() => setCanMutate(false));
  }, []);

  async function saveConfig() {
    if (!config) return;
    if (!confirm(
      "SkyLens設定を保存しますか？\n" +
      "稼働中の場合は受信機とブリッジを再起動します。受信が数十秒中断します。\n" +
      "局位置は OGN 設定にも同じ値が書き込まれます。"
    )) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/skylens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(data.message);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    }
    setSaving(false);
  }

  async function restartReceiver() {
    if (!confirm("SkyLens を再起動しますか？")) return;
    setRestarting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/skylens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(data.message);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "再起動に失敗しました");
    }
    setRestarting(false);
  }

  function update<K extends keyof SkylensConfig>(key: K, value: SkylensConfig[K]) {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  }

  const altitudeHae = config
    ? Math.round((config.elevationM + config.geoidSeparationM) * 10) / 10
    : 0;
  const inputStyle = {
    background: "var(--color-bg-primary)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-primary)",
  };
  const locked = !canMutate;

  return (
    <main className="flex-1 flex items-start justify-center overflow-y-auto py-6 px-4 rounded-md" style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)" }}>
      <div
        className="w-full max-w-3xl space-y-5 p-6 rounded"
        style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}
      >
        {error && (
          <div className="p-3 rounded text-sm" style={{ background: "var(--color-danger-dim)", color: "var(--color-danger)", border: "1px solid var(--color-danger)" }}>
            {error}
          </div>
        )}
        {message && (
          <div className="p-3 rounded text-sm" style={{ background: "var(--color-success-dim)", color: "var(--color-success)", border: "1px solid var(--color-success)" }}>
            {message}
          </div>
        )}
        {locked && (
          <div className="p-3 rounded text-sm" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
            設定を変更するには管理者ログインが必要です。設定タブからログインしてください。表示は誰でも見られます。
          </div>
        )}
        {status && !status.available && (
          <div className="p-3 rounded text-sm" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
            この端末には SkyLens の実行ファイルがありません。設定の編集はできますが受信はできません。
          </div>
        )}
        {status?.available && !status.licensed && (
          <div className="p-3 rounded text-sm" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
            ライセンスファイル（node.lic）がありません。インスタンスIDを FLARM に伝えて発行を受けてください。
          </div>
        )}

        {/* Live status */}
        <Card title="SkyLens ステータス（リアルタイム）" helpId="skylens-status">
          <div className="space-y-2 text-sm">
            <StatusRow label="受信機" value={status?.serviceActive ? "稼働中" : "停止"} highlight={status?.serviceActive} />
            <StatusRow label="ブリッジ (skylens-mqtt)" value={status?.bridgeActive ? "稼働中" : "停止"} highlight={status?.bridgeActive} />
            <StatusRow label="アップローダ (skylens-aprs)" value={status?.uploaderActive ? "稼働中" : "停止"} />
            {status?.online && (
              <>
                <div style={{ borderTop: "1px solid var(--color-border)", margin: "8px 0" }} />
                <StatusRow label="ソフトウェア版数" value={status.version || "—"} />
                <StatusRow label="ビルド日時" value={status.buildDate || "—"} />
                <StatusRow label="インスタンスID" value={status.instanceId || "—"} />
                <StatusRow label="ライセンス種別" value={status.licenseType || "—"} />
                <StatusRow label="ライセンス期限" value={status.licenseExpiration || "—"} />
                <StatusRow label="バイナリ復号期限" value={status.binaryExpiration || "—"} highlightAccent />
                <div style={{ borderTop: "1px solid var(--color-border)", margin: "8px 0" }} />
                <StatusRow
                  label="復調プラン（実測）"
                  value={status.demodulationPlan || "—"}
                  highlight={status.demodulationPlan ? status.demodulationPlan === "JAPAN" : undefined}
                />
                <StatusRow label="ゲイン（実測）" value={status.liveGain != null ? (Number(status.liveGain) === 0 ? "0 (AGC 自動)" : `${Number(status.liveGain).toFixed(1)} dB`) : "—"} highlightAccent />
                <StatusRow label="サンプルレート（実測）" value={status.liveSampleRate ? `${Number(status.liveSampleRate).toLocaleString("ja-JP")} S/s` : "—"} />
                <StatusRow label="ドングルのシリアル" value={status.liveSerial || "(未指定)"} />
                <div style={{ borderTop: "1px solid var(--color-border)", margin: "8px 0" }} />
                <StatusRow label="プリアンブル検出" value={status.preambles != null ? status.preambles.toLocaleString("ja-JP") : "—"} />
                <StatusRow label="復号成功" value={status.decoded != null ? status.decoded.toLocaleString("ja-JP") : "—"} highlightAccent />
                <StatusRow label="復号失敗" value={status.invalid != null ? status.invalid.toLocaleString("ja-JP") : "—"} />
              </>
            )}
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--color-text-secondary)" }}>
            バイナリ復号期限はライセンス期限とは別物です。これを過ぎると本体が起動しなくなります。
          </p>
        </Card>

        {/* Station identity */}
        <Card title="受信局の識別" helpId="skylens-identity">
          <Field label="局ID（英数字33文字以内。FLARM とログを共有するため中立な名前にする）">
            <input
              type="text"
              value={config?.stationId || ""}
              onChange={(e) => update("stationId", e.target.value)}
              maxLength={33}
              disabled={locked}
              placeholder="TKYEV001"
              className="w-full px-3 py-1.5 text-sm rounded font-mono"
              style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
            />
          </Field>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            OGN の受信機名（APRS 呼出符号）とは別物です。OGN へのアップロードは OGN 側の受信機名で行われます。
          </p>
        </Card>

        {/* Shared position */}
        <Card title="局位置（OGN 設定と共有）" helpId="skylens-position">
          <div className="p-2 mb-3 rounded text-xs" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)" }}>
            ★ SkyLens は局位置を復号そのものに使います。値がずれていると一切デコードできません。
            ここで保存すると OGN 設定の座標も同じ値に更新されます。
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="緯度（度）">
              <input
                type="number" step="0.0000001" value={config?.latitude ?? 0}
                onChange={(e) => update("latitude", parseFloat(e.target.value))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
            <Field label="経度（度）">
              <input
                type="number" step="0.0000001" value={config?.longitude ?? 0}
                onChange={(e) => update("longitude", parseFloat(e.target.value))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
            <Field label="標高 MSL（m）">
              <input
                type="number" step="1" value={config?.elevationM ?? 0}
                onChange={(e) => update("elevationM", parseFloat(e.target.value))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
            <Field label="ジオイド高（m。関東はおよそ 37）">
              <input
                type="number" step="0.1" value={config?.geoidSeparationM ?? 37}
                onChange={(e) => update("geoidSeparationM", parseFloat(e.target.value))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
          </div>
          <div className="mt-3">
            <StatusRow label="設定ファイルに書かれる楕円体高" value={`${altitudeHae} m`} highlightAccent />
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            SkyLens の設定は楕円体高で持ちます。標高にジオイド高を足した値を自動で書き込むため、ここでは標高を入れてください。
            GPS の実測値が収束しない場所では、実測ではなく地図読みで座標を決めてください。
          </p>
        </Card>

        {/* Demodulation */}
        <Card title="復調・受信" helpId="skylens-demod">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="ゲイン（dB。0 = AGC 自動）">
              <select
                value={String(config?.gain ?? 0)}
                onChange={(e) => update("gain", parseFloat(e.target.value))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              >
                {gainSteps.map((g) => (
                  <option key={g} value={String(g)}>{g === 0 ? "0（AGC 自動）" : `${g.toFixed(1)} dB`}</option>
                ))}
              </select>
            </Field>
            <Field label="サンプルレート（S/s。1,600,000〜2,000,000 が推奨）">
              <input
                type="number" step="100000" min={1000000} max={3200000}
                value={config?.sampleRate ?? 1600000}
                onChange={(e) => update("sampleRate", parseInt(e.target.value, 10))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
            <Field label="周波数補正（ppm）">
              <input
                type="number" step="1" value={config?.ppmCorrection ?? 0}
                onChange={(e) => update("ppmCorrection", parseFloat(e.target.value))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
            <Field label="アンテナへの電源供給（bias-T）">
              <label className="flex items-center gap-2 text-sm mt-1" style={{ opacity: locked ? 0.6 : 1 }}>
                <input
                  type="checkbox" className="w-4 h-4"
                  checked={config?.biasT ?? false}
                  onChange={(e) => update("biasT", e.target.checked)}
                  disabled={locked}
                />
                <span>DC 給電を有効にする（アクティブアンテナ用）</span>
              </label>
            </Field>
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            ゲインは R820T が実際に持つ段のみ選べます。歩行試験では AGC のまま 1m から 191m まで欠測なく受信できました。
            復調プランは局位置から自動で決まるため設定項目はありません。保存後にステータスで JAPAN を確認してください。
          </p>
        </Card>

        {/* Output */}
        <Card title="出力" helpId="skylens-output">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="UDP 送信先アドレス">
              <input
                type="text" value={config?.udpAddress || "127.0.0.1"}
                onChange={(e) => update("udpAddress", e.target.value)}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
            <Field label="UDP ポート（ブリッジが待ち受けるポート）">
              <input
                type="number" value={config?.udpPort ?? 8001}
                onChange={(e) => update("udpPort", parseInt(e.target.value, 10))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
            <Field label="TCP（SSE）ポート">
              <input
                type="number" value={config?.tcpPort ?? 8002}
                onChange={(e) => update("tcpPort", parseInt(e.target.value, 10))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
            <Field label="監視（メトリクス）ポート">
              <input
                type="number" value={config?.monitoringPort ?? 8003}
                onChange={(e) => update("monitoringPort", parseInt(e.target.value, 10))}
                disabled={locked}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
              />
            </Field>
          </div>

          <div className="mt-3 space-y-2" style={{ opacity: locked ? 0.6 : 1 }}>
            <Toggle label="TCP（SSE）出力を有効にする" checked={config?.tcpEnable ?? true} disabled={locked}
              onChange={(v) => update("tcpEnable", v)} />
            <Toggle label="heartbeat を送る" checked={config?.sendHeartbeat ?? true} disabled={locked}
              onChange={(v) => update("sendHeartbeat", v)} />
            <Toggle label="statistics を送る" checked={config?.sendStatistics ?? true} disabled={locked}
              onChange={(v) => update("sendStatistics", v)} />
            <Toggle label="alertzone を送る" checked={config?.sendAlertzone ?? true} disabled={locked}
              onChange={(v) => update("sendAlertzone", v)} />
            <Toggle label="SQLite に記録する（自動削除されないので常用しない）" checked={config?.sqliteEnable ?? false} disabled={locked}
              onChange={(v) => update("sqliteEnable", v)} />
          </div>

          <p className="text-xs mt-3" style={{ color: "var(--color-warning)" }}>
            ★ traffic の送信と UDP 出力は地図表示に必須のため、この画面では止められません。
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
            SkyLens が出せるのは heartbeat・traffic・alertzone・statistics の4種類だけです。
            登録記号やコンテストナンバーを載せる info メッセージは、このビルドでは出力されません。
          </p>
        </Card>

        {/* Log */}
        <Card title="ログ" helpId="skylens-log">
          <Field label="ログの詳細度">
            <select
              value={config?.logVerbosity || "info"}
              onChange={(e) => update("logVerbosity", e.target.value)}
              disabled={locked}
              className="w-full px-3 py-1.5 text-sm rounded font-mono"
              style={{ ...inputStyle, opacity: locked ? 0.6 : 1 }}
            >
              {["error", "warn", "info", "debug", "trace"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </Field>
        </Card>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={saveConfig}
            disabled={saving || locked || !config}
            className="px-4 py-2 rounded font-semibold text-sm"
            style={{
              background: "var(--color-accent)", color: "#fff",
              opacity: saving || locked || !config ? 0.5 : 1,
              cursor: saving ? "wait" : locked ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "保存中..." : "保存して再起動"}
          </button>
          <button
            onClick={restartReceiver}
            disabled={restarting || locked || !status?.serviceActive}
            className="px-4 py-2 rounded font-semibold text-sm"
            style={{
              background: "var(--color-warning-dim)", color: "var(--color-warning)",
              border: "1px solid var(--color-warning)",
              opacity: restarting || locked || !status?.serviceActive ? 0.5 : 1,
              cursor: restarting ? "wait" : "pointer",
            }}
          >
            {restarting ? "再起動中..." : "SkyLens を再起動"}
          </button>
        </div>

        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          設定は <code>/home/pi/skylens/config.yml</code> に書き込まれます。保存時に生成し直すため、
          手で書き加えた内容は失われます。局位置は <code>/boot/rtlsdr-ogn.conf</code> と
          <code>/boot/OGN-receiver.conf</code> にも同じ値が書かれます。
          固定化（OverlayFS）がONの場合、変更は再起動時にリセットされます。
        </p>
      </div>
    </main>
  );
}

function Card({ title, children, helpId }: { title: string; children: React.ReactNode; helpId?: string }) {
  return (
    <fieldset
      className="p-5"
      style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 4 }}
    >
      <legend className="text-sm font-semibold px-2 inline-flex items-center" style={{ color: "var(--color-text-primary)" }}>
        {title}
        {helpId && <HelpHint sectionId={helpId} />}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox" className="w-4 h-4"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function StatusRow({ label, value, highlight, highlightAccent }: { label: string; value: string; highlight?: boolean; highlightAccent?: boolean }) {
  const color = highlight === true
    ? "var(--color-success)"
    : highlight === false
      ? "var(--color-danger)"
      : highlightAccent
        ? "var(--color-accent)"
        : "var(--color-text-primary)";
  return (
    <div className="flex items-center justify-between py-1 px-3 rounded" style={{ background: "var(--color-bg-card)" }}>
      <span style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      <span className="font-mono font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

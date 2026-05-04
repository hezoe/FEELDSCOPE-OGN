"use client";

import { useEffect, useState, useCallback } from "react";
import HelpHint from "@/components/HelpHint";

interface OgnConfig {
  receiverName: string;
  latitude: number;
  longitude: number;
  altitude: number;
  freqCorr: number;
  httpPort: number;
  gain: number;
  minNoise: number;
  maxNoise: number;
  detectSNR: number;
  enableBias: boolean;
  ognBinaryUrl: string;
}

interface OgnStatus {
  online: boolean;
  software?: string;
  hostname?: string;
  cpuLoad?: string;
  cpuTemp?: string;
  ramFree?: string;
  ntpError?: string;
  ntpFreqCorr?: string;
  rtlsdrName?: string;
  rtlsdrTuner?: string;
  rtlsdrSerial?: string;
  centerFreq?: string;
  sampleRate?: string;
  freqCorrLive?: string;
  freqPlan?: string;
  ognGain?: string;
  noise?: string;
  liveTime?: string;
  detectSNR?: string;
  aircraftsLast12h?: string;
  aircraftsLastHour?: string;
  aircraftsLastMinute?: string;
  positionsLastMinute?: string;
}

export default function OgnPage() {
  const [config, setConfig] = useState<OgnConfig | null>(null);
  const [status, setStatus] = useState<OgnStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch("/api/ogn");
      const data = await res.json();
      setConfig(data.config);
      setStatus(data.status);
    } catch {
      setError("OGN情報の取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  async function saveConfig() {
    if (!config) return;
    if (!confirm("OGN設定を保存して受信機を再起動しますか？\n受信が一時的に中断され、AGCの再収束に約1分かかります。")) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/ogn", {
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
    if (!confirm("OGN受信機を再起動しますか？")) return;
    setRestarting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/ogn", {
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

  function update<K extends keyof OgnConfig>(key: K, value: OgnConfig[K]) {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  }

  function applyPreset(preset: "default" | "weak-signal" | "noisy-env") {
    if (!config) return;
    if (preset === "default") {
      setConfig({ ...config, gain: 7.7, minNoise: 5.0, maxNoise: 10.0, detectSNR: 3.0 });
    } else if (preset === "weak-signal") {
      setConfig({ ...config, gain: 7.7, minNoise: 8.0, maxNoise: 15.0, detectSNR: 2.5 });
    } else if (preset === "noisy-env") {
      setConfig({ ...config, gain: 7.7, minNoise: 3.0, maxNoise: 8.0, detectSNR: 5.0 });
    }
  }

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

        {/* Receiver Status */}
        <Card title="受信機ステータス（リアルタイム）" helpId="ogn-status">
          <div className="space-y-2 text-sm">
            <StatusRow label="受信機" value={status?.online ? "稼働中" : "停止"} highlight={status?.online} />
            {status?.online && (
              <>
                <StatusRow label="ソフトウェアバージョン" value={status.software || "—"} />
                <StatusRow label="ホスト名" value={status.hostname || "—"} />
                <StatusRow label="CPU負荷" value={status.cpuLoad || "—"} />
                <StatusRow label="CPU温度" value={status.cpuTemp || "—"} />
                <StatusRow label="RAM (空き/合計)" value={status.ramFree || "—"} />
                <StatusRow label="NTP誤差" value={status.ntpError || "—"} />
                <StatusRow label="NTP周波数補正" value={status.ntpFreqCorr || "—"} />
                <div style={{ borderTop: "1px solid var(--color-border)", margin: "8px 0" }} />
                <StatusRow label="RTL-SDR名称" value={status.rtlsdrName || "—"} />
                <StatusRow label="チューナー" value={status.rtlsdrTuner || "—"} />
                <StatusRow label="シリアル" value={status.rtlsdrSerial || "—"} />
                <StatusRow label="中心周波数（実測）" value={status.centerFreq || "—"} />
                <StatusRow label="サンプルレート" value={status.sampleRate || "—"} />
                <StatusRow label="周波数補正（実測）" value={status.freqCorrLive || "—"} />
                <StatusRow label="周波数プラン" value={status.freqPlan || "—"} />
                <div style={{ borderTop: "1px solid var(--color-border)", margin: "8px 0" }} />
                <StatusRow label="AGC実行中ゲイン" value={status.ognGain || "—"} highlightAccent />
                <StatusRow label="ノイズレベル（実測）" value={status.noise || "—"} highlightAccent />
                <StatusRow label="DetectSNR" value={status.detectSNR || "—"} />
                <div style={{ borderTop: "1px solid var(--color-border)", margin: "8px 0" }} />
                <StatusRow label="受信機体数（直近1分）" value={status.aircraftsLastMinute || "0/0"} highlightAccent />
                <StatusRow label="受信機体数（直近1時間）" value={status.aircraftsLastHour || "0/0"} />
                <StatusRow label="受信機体数（直近12時間）" value={status.aircraftsLast12h || "0/0"} />
                <StatusRow label="ポジション受信数（直近1分）" value={status.positionsLastMinute || "0/0"} highlightAccent />
                <div style={{ borderTop: "1px solid var(--color-border)", margin: "8px 0" }} />
                <StatusRow label="Live Time" value={`${status.liveTime || "—"} (※ v0.3.3.ARMの表示バグで常に0%)`} />
              </>
            )}
          </div>
        </Card>

        {/* Receiver Identity */}
        <Card title="受信機識別" helpId="ogn-identity">
          <div className="space-y-3">
            <Field label="受信機名（APRS Call、英数字9文字以内）">
              <input
                type="text"
                value={config?.receiverName || ""}
                onChange={(e) => update("receiverName", e.target.value)}
                maxLength={9}
                placeholder="RJTTTK001"
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                OGN命名規則: 日本の場合は「ICAO空港コード + 連番」を推奨（例: RJTT + TK001）
              </p>
            </Field>
          </div>
        </Card>

        {/* Position */}
        <Card title="アンテナ設置位置" helpId="ogn-position">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="緯度（°）">
              <input
                type="number"
                step="0.0001"
                value={config?.latitude ?? 0}
                onChange={(e) => update("latitude", parseFloat(e.target.value))}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
            </Field>
            <Field label="経度（°）">
              <input
                type="number"
                step="0.0001"
                value={config?.longitude ?? 0}
                onChange={(e) => update("longitude", parseFloat(e.target.value))}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
            </Field>
            <Field label="高度（m）">
              <input
                type="number"
                step="1"
                value={config?.altitude ?? 0}
                onChange={(e) => update("altitude", parseFloat(e.target.value))}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
            </Field>
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            アンテナの実際の設置位置を入力してください。OGNネットワーク上の受信局位置として公開されます。
          </p>
        </Card>

        {/* RF Settings (basic) */}
        <Card title="RF（無線）基本設定" helpId="ogn-rf">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="周波数補正 FreqCorr (ppm)">
              <input
                type="number"
                step="0.1"
                value={config?.freqCorr ?? 0}
                onChange={(e) => update("freqCorr", parseFloat(e.target.value))}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                RTL-SDRドングルの水晶誤差補正。R820T系は通常 40〜80 ppm。0でも実用上問題なし
              </p>
            </Field>
            <Field label="HTTPポート">
              <input
                type="number"
                value={config?.httpPort ?? 8082}
                onChange={(e) => update("httpPort", parseInt(e.target.value, 10))}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                受信機ステータスHTTPサーバのポート（デフォルト: 8082）
              </p>
            </Field>
          </div>

          <div className="mt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config?.enableBias ?? false}
                onChange={(e) => update("enableBias", e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium">Bias-T 電源供給を有効にする</span>
            </label>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
              <strong style={{ color: "var(--color-warning)" }}>警告:</strong>
              Bias-T 対応のアンテナ用LNA等を使用する場合のみ有効化してください。
              通常のアンテナで有効にすると RTL-SDRドングルが故障する恐れがあります。
            </p>
          </div>
        </Card>

        {/* AGC / Demodulator (v1.1.23) */}
        <Card title="AGC（自動利得制御）・デコーダ設定" helpId="ogn-agc">
          <p className="text-xs mb-3" style={{ color: "var(--color-text-secondary)" }}>
            OGN-RFは内部AGCで受信ゲインを自動調整します。各パラメータの意味と調整指針は
            ヘルプの「AGC（自動利得制御）」セクションを参照してください。
          </p>

          {/* Presets */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-text-secondary)" }}>
              プリセット
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPreset("default")}
                className="px-3 py-1.5 text-xs rounded font-medium transition-colors"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              >
                標準（滑空場 / 郊外）
              </button>
              <button
                type="button"
                onClick={() => applyPreset("weak-signal")}
                className="px-3 py-1.5 text-xs rounded font-medium transition-colors"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              >
                弱信号（遠距離・低出力FLARM）
              </button>
              <button
                type="button"
                onClick={() => applyPreset("noisy-env")}
                className="px-3 py-1.5 text-xs rounded font-medium transition-colors"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              >
                高ノイズ環境（都市部）
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
              プリセットを選択するとフォームの値だけ更新されます。「設定を保存」を押すまで反映されません。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Initial Gain (dB)">
              <input
                type="number"
                step="0.1"
                min="0"
                max="50"
                value={config?.gain ?? 7.7}
                onChange={(e) => update("gain", parseFloat(e.target.value))}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                AGC開始時のゲイン。実動作中はAGCが自動調整。標準: <code>7.7</code>（近距離FLARM飽和回避）
              </p>
            </Field>

            <Field label="DetectSNR (dB)">
              <input
                type="number"
                step="0.5"
                min="1"
                max="20"
                value={config?.detectSNR ?? 3.0}
                onChange={(e) => update("detectSNR", parseFloat(e.target.value))}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                FLARMパケットをデコードする閾値。低いほど弱信号を拾うが誤検出も増。標準: <code>3.0</code>
              </p>
            </Field>

            <Field label="MinNoise (dB)">
              <input
                type="number"
                step="0.5"
                min="0"
                max="30"
                value={config?.minNoise ?? 5.0}
                onChange={(e) => update("minNoise", parseFloat(e.target.value))}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                AGC下限。実測ノイズがこれを下回ると AGC はゲインを上げる。標準: <code>5.0</code>
              </p>
            </Field>

            <Field label="MaxNoise (dB)">
              <input
                type="number"
                step="0.5"
                min="1"
                max="40"
                value={config?.maxNoise ?? 10.0}
                onChange={(e) => update("maxNoise", parseFloat(e.target.value))}
                className="w-full px-3 py-1.5 text-sm rounded font-mono"
                style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                AGC上限。実測ノイズがこれを上回ると AGC はゲインを下げる。標準: <code>10.0</code>
              </p>
            </Field>
          </div>
        </Card>

        {/* OGN Binary URL */}
        <Card title="OGNバイナリURL（インストール時）" helpId="ogn-binary-url">
          <Field label="OGNBINARYURL">
            <input
              type="text"
              value={config?.ognBinaryUrl || ""}
              onChange={(e) => update("ognBinaryUrl", e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded font-mono"
              style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
            />
          </Field>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            OGNバイナリのダウンロードURL。日本向けは <code>?version=japan</code> を付与。再インストール時に使用されます。
          </p>
        </Card>

        {/* Actions */}
        <div className="flex gap-3 items-center">
          <button
            onClick={saveConfig}
            disabled={saving || !config}
            className="px-4 py-2 rounded text-sm font-medium transition-colors"
            style={{ background: "var(--color-accent)", color: "#fff", opacity: saving ? 0.5 : 1, cursor: saving ? "wait" : "pointer" }}
          >
            {saving ? "保存中..." : "設定を保存して受信機を再起動"}
          </button>
          <button
            onClick={restartReceiver}
            disabled={restarting}
            className="px-4 py-2 rounded text-sm font-medium transition-colors"
            style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)", opacity: restarting ? 0.5 : 1, cursor: restarting ? "wait" : "pointer" }}
          >
            {restarting ? "再起動中..." : "受信機のみ再起動"}
          </button>
          <HelpHint sectionId="ogn-actions" />
        </div>

        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          設定は <code>/home/pi/rtlsdr-ogn.conf</code>（runtime）と <code>/boot/OGN-receiver.conf</code>（再インストール時の参照元）の両方に書き込まれます。
          固定化(OverlayFS)がONの場合、変更は再起動時にリセットされます。
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

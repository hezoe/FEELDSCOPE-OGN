"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useUnits } from "@/lib/UnitContext";

interface IGCFile {
  name: string;
  size: number;
  modified: string;
}

interface AdsbSavedConfig {
  enabled: boolean;
  url: string;
  interval: number;
}

interface SystemStatus {
  mode: "realtime" | "history" | "stopped";
  ogn_mqtt_active: boolean;
  igc_simulator_active: boolean;
  mosquitto_active: boolean;
  adsb_poller_active: boolean;
  overlay_enabled: boolean;
  adsb_config: AdsbSavedConfig | null;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [igcFiles, setIgcFiles] = useState<IGCFile[]>([]);
  const [switching, setSwitching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [powerAction, setPowerAction] = useState(false);
  const [overlayAction, setOverlayAction] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(10);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("ogn-replay-speed");
      if (stored) setReplaySpeed(Math.max(1, Math.min(20, parseInt(stored, 10) || 10)));
    } catch { /* ignore */ }
  }, []);
  const [error, setError] = useState<string | null>(null);
  const { units, unitsLoaded, setAltitudeUnit, setSpeedUnit, setClimbRateUnit, setDistanceUnit, setDisplayNameMode, setSafeGlideRatio, setAirfield, setAdsb, setMapSource } = useUnits();
  const speedChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/system");
      const data = await res.json();
      setStatus(data);
    } catch {
      setError("ステータス取得に失敗しました");
    }
  }, []);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/system/igc-files");
      const data = await res.json();
      setIgcFiles(data.files || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchFiles();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchFiles]);

  // Restore adsb settings from server-side config and sync service state
  const adsbSynced = useRef(false);
  useEffect(() => {
    if (adsbSynced.current || !unitsLoaded || !status) return;
    adsbSynced.current = true;

    // If server has a saved config, restore it to the UI (covers reboot / new browser)
    const serverCfg = status.adsb_config;
    if (serverCfg && (!units.adsb.enabled || !units.adsb.url)) {
      setAdsb(serverCfg);
    }

    // Use server config as source of truth if available, otherwise fall back to localStorage
    const cfg = serverCfg ?? units.adsb;
    const shouldRun = cfg.enabled && !!cfg.url;
    const isRunning = status.adsb_poller_active;

    if (shouldRun && !isRunning) {
      // Setting says enabled but service is stopped -> start it
      fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adsb-start", url: cfg.url, interval: cfg.interval }),
      }).then(() => fetchStatus()).catch(() => {});
    } else if (!shouldRun && isRunning) {
      // Setting says disabled but service is running -> stop it
      fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adsb-stop" }),
      }).then(() => fetchStatus()).catch(() => {});
    }
  }, [unitsLoaded, status, units.adsb, fetchStatus, setAdsb]);

  // Apply speed change to running igc-simulator (debounced)
  const applySpeed = useCallback(async (speed: number) => {
    try {
      await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "history", speed }),
      });
    } catch { /* ignore */ }
  }, []);

  function handleSpeedChange(newSpeed: number) {
    setReplaySpeed(newSpeed);
    localStorage.setItem("ogn-replay-speed", String(newSpeed));
    // If history mode is active, debounce and apply immediately
    if (status?.mode === "history") {
      if (speedChangeTimer.current) clearTimeout(speedChangeTimer.current);
      speedChangeTimer.current = setTimeout(() => applySpeed(newSpeed), 300);
    }
  }

  async function switchMode(action: string) {
    setSwitching(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { action };
      if (action === "history") payload.speed = replaySpeed;
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "切替に失敗しました");
    } finally {
      setSwitching(false);
    }
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/system/igc-files", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchFiles();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "アップロードに失敗しました"
      );
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function deleteFile(name: string) {
    if (!confirm(`${name} を削除しますか？`)) return;
    try {
      const res = await fetch("/api/system/igc-files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  }

  return (
      <main className="flex-1 flex items-start justify-center overflow-y-auto py-6 px-4 rounded-md" style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)" }}>
        <div
          className="w-full max-w-3xl space-y-5 p-6 rounded"
          style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}
        >

          {error && (
            <div
              className="p-3 rounded text-sm"
              style={{
                background: "var(--color-danger-dim)",
                color: "var(--color-danger)",
                border: "1px solid var(--color-danger)",
              }}
            >
              {error}
            </div>
          )}

          {/* Airfield Settings */}
          <Card title="滑空場設定">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                  滑空場名
                </label>
                <input
                  type="text"
                  value={units.airfield.name}
                  onChange={(e) => setAirfield({ ...units.airfield, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm rounded"
                  style={{
                    background: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                    緯度（度）
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={units.airfield.latitude}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v >= -90 && v <= 90) setAirfield({ ...units.airfield, latitude: v });
                    }}
                    className="w-full px-3 py-1.5 text-sm rounded tabular-nums"
                    style={{
                      background: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                    経度（度）
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={units.airfield.longitude}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v >= -180 && v <= 180) setAirfield({ ...units.airfield, longitude: v });
                    }}
                    className="w-full px-3 py-1.5 text-sm rounded tabular-nums"
                    style={{
                      background: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                    標高（m）
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={units.airfield.elevation_m}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v >= -500 && v <= 9000) setAirfield({ ...units.airfield, elevation_m: v });
                    }}
                    className="w-full px-3 py-1.5 text-sm rounded tabular-nums"
                    style={{
                      background: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>
              </div>
              <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                マップの中心位置、パス判定の基準点、ナビゲーションの滑空場名に反映されます
              </p>
            </div>
          </Card>

          {/* Mode Selection */}
          <Card title="データソース切替">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <ModeButton
                label="リアルタイム再生"
                description="OGN レシーバーからの実際の FLARM データをリアルタイムで受信・表示します。"
                active={status?.mode === "realtime"}
                switching={switching}
                onClick={() => switchMode("realtime")}
                activeColor="var(--color-success)"
              />
              <div>
                <ModeButton
                  label="履歴再生"
                  description="IGC フライトログファイルを読み込み、過去のフライトを再生します。"
                  active={status?.mode === "history"}
                  switching={switching}
                  onClick={() => switchMode("history")}
                  activeColor="var(--color-warning)"
                  subtext={status?.mode === "history" ? `稼働中（${replaySpeed}倍速ループ）` : undefined}
                />
                <div className="flex items-center gap-2 mt-2 ml-1">
                  <label className="text-sm" style={{ color: "var(--color-text-secondary)" }}>再生倍速:</label>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={replaySpeed}
                    onChange={(e) => handleSpeedChange(parseInt(e.target.value, 10))}
                    className="flex-1"
                  />
                  <span className="text-sm font-semibold tabular-nums w-8 text-right">{replaySpeed}x</span>
                </div>
              </div>
            </div>

            {status?.mode !== "stopped" && (
              <button
                onClick={() => switchMode("stop")}
                disabled={switching}
                className="text-sm hover:underline"
                style={{ color: "var(--color-danger)" }}
              >
                停止する
              </button>
            )}
          </Card>

          {/* System Status */}
          <Card title="システムステータス">
            <div className="space-y-2 text-sm">
              <StatusRow label="Mosquitto (MQTT ブローカー)" active={status?.mosquitto_active} />
              <StatusRow label="ogn-mqtt (リアルタイム再生)" active={status?.ogn_mqtt_active} />
              <StatusRow label="igc-simulator (履歴再生)" active={status?.igc_simulator_active} />
              <StatusRow label="adsb-poller (ADS-B 受信)" active={status?.adsb_poller_active} />
            </div>
          </Card>

          {/* Display Settings */}
          <Card title="表示設定">
            {/* Map Source */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-text-secondary)" }}>
                地図ソース
              </label>
              <div
                className="flex rounded overflow-hidden"
                style={{ border: "1px solid var(--color-border)" }}
              >
                <UnitButton
                  label="Internet地図"
                  active={units.mapSource === "internet"}
                  onClick={() => setMapSource("internet")}
                />
                <UnitButton
                  label="オフライン地図"
                  active={units.mapSource === "offline"}
                  onClick={() => setMapSource("offline")}
                />
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                {units.mapSource === "internet" && "OpenStreetMapをインターネット経由で表示します"}
                {units.mapSource === "offline" && "国土地理院の航空写真＋陰影起伏図をローカルから表示します"}
              </p>
            </div>

            {/* Display Name Mode */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-text-secondary)" }}>
                機体ラベル表示名
              </label>
              <div
                className="flex rounded overflow-hidden"
                style={{ border: "1px solid var(--color-border)" }}
              >
                <UnitButton
                  label="コンテスト番号"
                  active={units.displayName === "competition_id"}
                  onClick={() => setDisplayNameMode("competition_id")}
                />
                <UnitButton
                  label="登録番号"
                  active={units.displayName === "registration"}
                  onClick={() => setDisplayNameMode("registration")}
                />
                <UnitButton
                  label="パイロット名"
                  active={units.displayName === "pilot"}
                  onClick={() => setDisplayNameMode("pilot")}
                />
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                {units.displayName === "competition_id" && "マップとサイドバーにコンテスト番号（CN）を表示します"}
                {units.displayName === "registration" && "マップとサイドバーに登録番号（JA番号）を表示します"}
                {units.displayName === "pilot" && "マップとサイドバーにパイロット名を表示します"}
              </p>
            </div>

            {/* Unit Preferences */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {/* Altitude */}
              <div>
                <label className="block text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
                  高度
                </label>
                <div
                  className="flex rounded overflow-hidden"
                  style={{ border: "1px solid var(--color-border)" }}
                >
                  <UnitButton label="m" active={units.altitude === "m"} onClick={() => setAltitudeUnit("m")} />
                  <UnitButton label="ft" active={units.altitude === "ft"} onClick={() => setAltitudeUnit("ft")} />
                </div>
              </div>

              {/* Speed */}
              <div>
                <label className="block text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
                  速度
                </label>
                <div
                  className="flex rounded overflow-hidden"
                  style={{ border: "1px solid var(--color-border)" }}
                >
                  <UnitButton label="km/h" active={units.speed === "km/h"} onClick={() => setSpeedUnit("km/h")} />
                  <UnitButton label="knot" active={units.speed === "knot"} onClick={() => setSpeedUnit("knot")} />
                </div>
              </div>

              {/* Climb Rate */}
              <div>
                <label className="block text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
                  上昇率
                </label>
                <div
                  className="flex rounded overflow-hidden"
                  style={{ border: "1px solid var(--color-border)" }}
                >
                  <UnitButton label="m/s" active={units.climbRate === "m/s"} onClick={() => setClimbRateUnit("m/s")} />
                  <UnitButton label="knot/s" active={units.climbRate === "knot/s"} onClick={() => setClimbRateUnit("knot/s")} />
                </div>
              </div>

              {/* Distance */}
              <div>
                <label className="block text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
                  距離
                </label>
                <div
                  className="flex rounded overflow-hidden"
                  style={{ border: "1px solid var(--color-border)" }}
                >
                  <UnitButton label="km" active={units.distance === "km"} onClick={() => setDistanceUnit("km")} />
                  <UnitButton label="nm" active={units.distance === "nm"} onClick={() => setDistanceUnit("nm")} />
                </div>
              </div>
            </div>

            {/* Safe Glide Ratio */}
            <div className="mt-6">
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-text-secondary)" }}>
                安全滑空比（パス判定）
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={units.safeGlideRatio}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1 && v <= 100) setSafeGlideRatio(v);
                  }}
                  className="w-20 px-3 py-1.5 text-sm rounded"
                  style={{
                    background: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
                <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>: 1</span>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                滑空場までの距離÷高度が設定値を超えた場合、パス不足として赤点滅で警告します（デフォルト: 15）
              </p>
            </div>
          </Card>

          {/* ADS-B Settings */}
          <Card title="ADS-B 受信設定">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={units.adsb.enabled}
                    onChange={async (e) => {
                      const enabled = e.target.checked;
                      setAdsb({ ...units.adsb, enabled });
                      try {
                        if (enabled && units.adsb.url) {
                          await fetch("/api/system", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "adsb-start", url: units.adsb.url, interval: units.adsb.interval }),
                          });
                        } else {
                          await fetch("/api/system", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "adsb-stop" }),
                          });
                        }
                        await fetchStatus();
                      } catch { /* ignore */ }
                    }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium">ADS-B 受信を有効にする</span>
                </label>
                {status?.adsb_poller_active && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: "var(--color-success-dim)", color: "var(--color-success)" }}>
                    稼働中
                  </span>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                  tar1090 / dump1090 URL
                </label>
                <input
                  type="text"
                  value={units.adsb.url}
                  placeholder="http://192.168.190.148/tar1090/data/aircraft.json"
                  onChange={(e) => setAdsb({ ...units.adsb, url: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm rounded font-mono"
                  style={{
                    background: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                  ポーリング間隔（秒）
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={units.adsb.interval}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1 && v <= 30) setAdsb({ ...units.adsb, interval: v });
                  }}
                  className="w-20 px-3 py-1.5 text-sm rounded"
                  style={{
                    background: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>
              <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                同一ネットワーク上の FlightRadar24 フィーダー等から ADS-B データを取得し、マップに表示します。フライトログには記録されません。
              </p>
            </div>
          </Card>

          {/* System Power */}
          <Card title="システム電源">
            <div className="flex gap-4">
              <button
                onClick={async () => {
                  if (!confirm("システムを再起動しますか？")) return;
                  setPowerAction(true);
                  setError(null);
                  try {
                    const res = await fetch("/api/system", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "reboot" }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "再起動に失敗しました");
                    setPowerAction(false);
                  }
                }}
                disabled={powerAction}
                className="px-4 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  background: "var(--color-warning-dim)",
                  color: "var(--color-warning)",
                  border: "1px solid var(--color-warning)",
                  opacity: powerAction ? 0.5 : 1,
                  cursor: powerAction ? "wait" : "pointer",
                }}
              >
                {powerAction ? "処理中..." : "再起動"}
              </button>
              <button
                onClick={async () => {
                  if (!confirm("システムをシャットダウンしますか？\n再度起動するには電源の抜き差しが必要です。")) return;
                  setPowerAction(true);
                  setError(null);
                  try {
                    const res = await fetch("/api/system", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "shutdown" }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "シャットダウンに失敗しました");
                    setPowerAction(false);
                  }
                }}
                disabled={powerAction}
                className="px-4 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  background: "var(--color-danger-dim)",
                  color: "var(--color-danger)",
                  border: "1px solid var(--color-danger)",
                  opacity: powerAction ? 0.5 : 1,
                  cursor: powerAction ? "wait" : "pointer",
                }}
              >
                {powerAction ? "処理中..." : "シャットダウン"}
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
              シャットダウン後に再度起動するには電源の抜き差しが必要です
            </p>
          </Card>

          {/* Overlay FS */}
          <Card title="システム固定化">
            <div className="flex items-center gap-4">
              <button
                onClick={async () => {
                  if (!confirm("システムを固定化しますか？\n現在の設定が保存され、再起動後にオーバーレイモードになります。")) return;
                  setOverlayAction(true);
                  setError(null);
                  try {
                    const res = await fetch("/api/system", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "overlay-enable" }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    await fetchStatus();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "固定化の有効化に失敗しました");
                  }
                  setOverlayAction(false);
                }}
                disabled={overlayAction || status?.overlay_enabled === true}
                className="px-4 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  background: status?.overlay_enabled ? "var(--color-accent)" : "var(--color-bg-card)",
                  color: status?.overlay_enabled ? "#fff" : "var(--color-text-primary)",
                  border: status?.overlay_enabled ? "2px solid var(--color-accent)" : "2px solid var(--color-border)",
                  opacity: overlayAction ? 0.5 : 1,
                }}
              >
                ON
              </button>
              <button
                onClick={async () => {
                  if (!confirm("固定化を解除しますか？\n再起動後に通常モードに戻ります。")) return;
                  setOverlayAction(true);
                  setError(null);
                  try {
                    const res = await fetch("/api/system", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "overlay-disable" }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    await fetchStatus();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "固定化の解除に失敗しました");
                  }
                  setOverlayAction(false);
                }}
                disabled={overlayAction || status?.overlay_enabled === false}
                className="px-4 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  background: !status?.overlay_enabled ? "var(--color-accent)" : "var(--color-bg-card)",
                  color: !status?.overlay_enabled ? "#fff" : "var(--color-text-primary)",
                  border: !status?.overlay_enabled ? "2px solid var(--color-accent)" : "2px solid var(--color-border)",
                  opacity: overlayAction ? 0.5 : 1,
                }}
              >
                OFF
              </button>
              <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                （デフォルトOFF。変更にはシステム再起動が必要）
              </span>
            </div>
            {status?.overlay_enabled && (
              <p className="text-xs mt-2" style={{ color: "var(--color-warning)" }}>
                固定化が有効です。設定変更は再起動までの間有効ですが、再起動時にリセットされます。
              </p>
            )}
          </Card>

          {/* IGC Files */}
          <Card title="IGC ファイル管理（履歴再生用）">
            <div className="mb-4">
              <label
                className="inline-flex items-center gap-2 px-4 py-2 rounded cursor-pointer text-sm transition-colors"
                style={{
                  background: "var(--color-accent)",
                  color: "#fff",
                }}
              >
                {uploading ? "アップロード中..." : "IGC ファイルをアップロード"}
                <input
                  type="file"
                  accept=".igc"
                  onChange={uploadFile}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                OLC (onlinecontest.org) などから IGC ファイルをダウンロードしてアップロードしてください
              </p>
            </div>

            {igcFiles.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                IGC ファイルがありません。アップロードしてください。
              </p>
            ) : (
              <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--color-bg-primary)" }}>
                      <th
                        className="text-left px-4 py-2 font-semibold text-xs"
                        style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}
                      >
                        ファイル名
                      </th>
                      <th
                        className="text-right px-4 py-2 font-semibold text-xs"
                        style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}
                      >
                        サイズ
                      </th>
                      <th
                        className="text-right px-4 py-2 font-semibold text-xs"
                        style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}
                      >
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {igcFiles.map((f) => (
                      <tr
                        key={f.name}
                        className="hover:bg-[var(--color-accent-light)]"
                        style={{ borderBottom: "1px solid var(--color-border)" }}
                      >
                        <td className="px-4 py-2 font-mono text-xs">{f.name}</td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--color-text-secondary)" }}>
                          {(f.size / 1024).toFixed(0)} KB
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => deleteFile(f.name)}
                            className="text-xs hover:underline"
                            style={{ color: "var(--color-danger)" }}
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset
      className="p-5"
      style={{
        background: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
        borderRadius: 4,
      }}
    >
      <legend
        className="text-sm font-semibold px-2"
        style={{ color: "var(--color-text-primary)" }}
      >
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function ModeButton({
  label,
  description,
  active,
  switching,
  onClick,
  activeColor,
  subtext,
}: {
  label: string;
  description: string;
  active: boolean;
  switching: boolean;
  onClick: () => void;
  activeColor: string;
  subtext?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={switching}
      className={`p-4 rounded-lg text-left transition-all ${switching ? "opacity-50 cursor-wait" : ""}`}
      style={{
        background: active ? "var(--color-accent-light)" : "var(--color-bg-card)",
        border: active ? `2px solid ${activeColor}` : "2px solid var(--color-border)",
      }}
    >
      <div className="flex items-center gap-3 mb-2">
        <span
          className="w-3 h-3 rounded-full"
          style={{ background: active ? activeColor : "var(--color-text-secondary)" }}
        />
        <span className="font-semibold text-base">{label}</span>
      </div>
      <p className="text-sm ml-6" style={{ color: "var(--color-text-secondary)" }}>
        {description}
      </p>
      {active && (
        <p className="text-xs font-medium mt-2 ml-6" style={{ color: activeColor }}>
          {subtext || "稼働中"}
        </p>
      )}
    </button>
  );
}

function UnitButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 px-4 py-2 text-sm font-semibold transition-colors"
      style={{
        background: active ? "var(--color-accent)" : "var(--color-bg-primary)",
        color: active ? "#fff" : "var(--color-text-secondary)",
      }}
    >
      {label}
    </button>
  );
}

function StatusRow({
  label,
  active,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between py-1.5 px-3 rounded"
      style={{ background: "var(--color-bg-card)" }}
    >
      <span>{label}</span>
      <span
        className="px-2 py-0.5 rounded text-xs font-medium"
        style={{
          background: active ? "var(--color-success-dim)" : "rgba(160,160,176,0.15)",
          color: active ? "var(--color-success)" : "var(--color-text-secondary)",
        }}
      >
        {active ? "稼働中" : "停止"}
      </span>
    </div>
  );
}

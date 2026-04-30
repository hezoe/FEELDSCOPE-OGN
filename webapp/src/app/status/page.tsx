"use client";

import { useEffect, useState, useCallback } from "react";
import HelpHint from "@/components/HelpHint";

interface SystemSummary {
  uptime: string;
  load: string;
  cpu_temp_c: number | null;
  ram_total_mb: number | null;
  ram_used_mb: number | null;
  ram_available_mb: number | null;
  disk_total: string;
  disk_used: string;
  disk_used_pct: string;
}

interface OgnReceiver {
  online: boolean;
  software?: string;
  cpu_temp?: string;
  ntp_error?: string;
  ntp_freq_corr?: string;
  rtlsdr_name?: string;
  rtlsdr_tuner?: string;
  center_freq?: string;
  freq_corr_live?: string;
  freq_plan?: string;
  ogn_gain?: string;
  noise?: string;
  live_time?: string;
}

interface AdsbStatus {
  service_active?: boolean;
  url?: string;
  interval_sec?: number;
  last_attempt_utc?: string;
  last_fetch_ok?: boolean;
  last_error?: string | null;
  last_latency_ms?: number;
  poll_count?: number;
  success_count?: number;
  consecutive_failures?: number;
  aircraft_with_position?: number;
  aircraft_without_position?: number;
  aircraft_total?: number;
  started_at_utc?: string;
}

interface ServiceState {
  name: string;
  active: boolean;
  uptime: string | null;
}

interface FlightLogStats {
  total: number;
  flying: number;
  landed: number;
}

interface StatusPayload {
  receiver_id: string;
  system: SystemSummary | null;
  ogn_receiver: OgnReceiver;
  adsb_status: AdsbStatus | null;
  services: ServiceState[];
  flight_log: FlightLogStats;
}

function timeSince(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "—";
  const sec = Math.floor((Date.now() - d) / 1000);
  if (sec < 0) return "—";
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分${sec % 60}秒前`;
  return `${Math.floor(sec / 3600)}時間${Math.floor((sec % 3600) / 60)}分前`;
}

export default function StatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const d = await res.json();
      setData(d);
    } catch {
      setError("ステータス取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 5000);
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => { clearInterval(i); clearInterval(t); };
  }, [fetchData]);

  return (
    <main className="flex-1 flex items-start justify-center overflow-y-auto py-6 px-4 rounded-md" style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)" }}>
      <div
        className="w-full max-w-4xl space-y-5 p-6 rounded"
        style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}
      >
        {error && (
          <div className="p-3 rounded text-sm" style={{ background: "var(--color-danger-dim)", color: "var(--color-danger)", border: "1px solid var(--color-danger)" }}>
            {error}
          </div>
        )}

        {/* System Summary */}
        <Card title="システム概要" helpId="status-system">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <Stat label="受信機名" value={data?.receiver_id || "—"} />
            <Stat label="稼働時間" value={data?.system?.uptime || "—"} />
            <Stat label="CPU負荷" value={data?.system?.load || "—"} mono />
            <Stat label="CPU温度" value={data?.system?.cpu_temp_c != null ? `${data.system.cpu_temp_c.toFixed(1)} °C` : "—"} mono
              accent={data?.system?.cpu_temp_c != null && data.system.cpu_temp_c >= 70 ? "danger" : data?.system?.cpu_temp_c != null && data.system.cpu_temp_c >= 60 ? "warning" : undefined} />
            <Stat label="RAM 使用" value={data?.system ? `${data.system.ram_used_mb} / ${data.system.ram_total_mb} MB` : "—"} mono />
            <Stat label="RAM 空き" value={data?.system?.ram_available_mb != null ? `${data.system.ram_available_mb} MB` : "—"} mono />
            <Stat label="ディスク使用" value={data?.system ? `${data.system.disk_used} / ${data.system.disk_total} (${data.system.disk_used_pct})` : "—"} mono />
          </div>
        </Card>

        {/* System Status */}
        <Card title="システムステータス" helpId="status-services">
          <div className="space-y-2 text-sm">
            {[
              { label: "Mosquitto (MQTT ブローカー)", name: "mosquitto" },
              { label: "ogn-mqtt (リアルタイム再生)", name: "ogn-mqtt" },
              { label: "igc-simulator (履歴再生)", name: "igc-simulator" },
              { label: "adsb-poller (ADS-B 受信)", name: "adsb-poller" },
            ].map(({ label, name }) => {
              const svc = data?.services.find(s => s.name === name);
              return (
                <div
                  key={name}
                  className="flex items-center justify-between py-1.5 px-3 rounded"
                  style={{ background: "var(--color-bg-card)" }}
                >
                  <span>{label}</span>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-medium"
                    style={{
                      background: svc?.active ? "var(--color-success-dim)" : "rgba(160,160,176,0.15)",
                      color: svc?.active ? "var(--color-success)" : "var(--color-text-secondary)",
                    }}
                  >
                    {svc?.active ? "稼働中" : "停止"}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* OGN Receiver */}
        <Card title="OGN 受信機" helpId="status-ogn-receiver">
          <div className="space-y-2">
            <Stat label="状態" value={data?.ogn_receiver?.online ? "稼働中" : "停止"} accent={data?.ogn_receiver?.online ? "success" : "danger"} />
            {data?.ogn_receiver?.online && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Stat label="ソフトウェア" value={data.ogn_receiver.software || "—"} mono />
                <Stat label="Live Time" value={data.ogn_receiver.live_time || "—"} mono />
                <Stat label="中心周波数（実測）" value={data.ogn_receiver.center_freq || "—"} mono />
                <Stat label="周波数補正（実測）" value={data.ogn_receiver.freq_corr_live || "—"} mono />
                <Stat label="周波数プラン" value={data.ogn_receiver.freq_plan || "—"} mono />
                <Stat label="OGN受信ゲイン" value={data.ogn_receiver.ogn_gain || "—"} mono />
                <Stat label="ノイズレベル" value={data.ogn_receiver.noise || "—"} mono />
                <Stat label="NTP誤差" value={data.ogn_receiver.ntp_error || "—"} mono />
                <Stat label="NTP周波数補正" value={data.ogn_receiver.ntp_freq_corr || "—"} mono />
                <Stat label="RTL-SDR" value={`${data.ogn_receiver.rtlsdr_name || "—"} (${data.ogn_receiver.rtlsdr_tuner || "—"})`} />
              </div>
            )}
          </div>
        </Card>

        {/* ADS-B Reception */}
        <Card title="ADS-B 受信ステータス" helpId="status-adsb">
          <div className="space-y-2">
            {!data?.adsb_status ? (
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                ADS-B受信は未設定または停止中です。設定 → 「ADS-B 受信設定」から有効化してください。
              </p>
            ) : !data.adsb_status.last_attempt_utc ? (
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                ADS-B受信を起動中です。データ到着までしばらくお待ちください…
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <Stat
                    label="状態"
                    value={data.adsb_status.last_fetch_ok ? "正常受信中" : `失敗（連続 ${data.adsb_status.consecutive_failures || 0} 回）`}
                    accent={data.adsb_status.last_fetch_ok ? "success" : "danger"}
                  />
                  <Stat label="最終取得" value={timeSince(data.adsb_status.last_attempt_utc)} />
                  <Stat label="取得元URL" value={data.adsb_status.url || "—"} mono small />
                  <Stat label="ポーリング間隔" value={data.adsb_status.interval_sec ? `${data.adsb_status.interval_sec}秒` : "—"} mono />
                  <Stat label="応答時間" value={data.adsb_status.last_latency_ms != null ? `${data.adsb_status.last_latency_ms} ms` : "—"} mono />
                  <Stat label="累計ポーリング" value={`${data.adsb_status.success_count ?? 0} 成功 / ${data.adsb_status.poll_count ?? 0} 回`} mono />
                  <Stat label="位置あり機体" value={String(data.adsb_status.aircraft_with_position ?? 0)} mono accent="success" />
                  <Stat label="位置なし機体（Mode-S/C）" value={String(data.adsb_status.aircraft_without_position ?? 0)} mono />
                  <Stat label="合計受信機体" value={String(data.adsb_status.aircraft_total ?? 0)} mono />
                  <Stat label="受信開始" value={timeSince(data.adsb_status.started_at_utc)} />
                </div>
                {data.adsb_status.last_error && (
                  <div className="mt-2 p-2 rounded text-xs font-mono" style={{ background: "var(--color-danger-dim)", color: "var(--color-danger)", border: "1px solid var(--color-danger)" }}>
                    最終エラー: {data.adsb_status.last_error}
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        {/* Services */}
        <Card title="サービス稼働状況" helpId="status-services">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data?.services.map(s => (
              <div key={s.name} className="flex items-center justify-between py-1.5 px-3 rounded" style={{ background: "var(--color-bg-card)" }}>
                <span className="text-sm font-mono">{s.name}</span>
                <div className="flex items-center gap-2">
                  {s.uptime && <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>{s.uptime}</span>}
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: s.active ? "var(--color-success-dim)" : "rgba(160,160,176,0.15)", color: s.active ? "var(--color-success)" : "var(--color-text-secondary)" }}>
                    {s.active ? "稼働中" : "停止"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Flight Log */}
        <Card title="フライトログ統計（本日）" helpId="status-flight-log-stats">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="総記録数" value={String(data?.flight_log.total ?? 0)} mono />
            <Stat label="飛行中" value={String(data?.flight_log.flying ?? 0)} mono accent={data && data.flight_log.flying > 0 ? "success" : undefined} />
            <Stat label="着陸済み" value={String(data?.flight_log.landed ?? 0)} mono />
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            フライトログは毎日 日本時間 AM 5:00 に自動リセットされます。
          </p>
        </Card>

        <p className="text-xs text-center" style={{ color: "var(--color-text-secondary)" }}>
          5秒間隔で自動更新
        </p>
      </div>
    </main>
  );
}

function Card({ title, children, helpId }: { title: string; children: React.ReactNode; helpId?: string }) {
  return (
    <fieldset className="p-5" style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 4 }}>
      <legend className="text-sm font-semibold px-2 inline-flex items-center" style={{ color: "var(--color-text-primary)" }}>
        {title}
        {helpId && <HelpHint sectionId={helpId} />}
      </legend>
      {children}
    </fieldset>
  );
}

function Stat({ label, value, mono, small, accent }: { label: string; value: string; mono?: boolean; small?: boolean; accent?: "success" | "warning" | "danger" }) {
  const colorMap = { success: "var(--color-success)", warning: "var(--color-warning)", danger: "var(--color-danger)" };
  return (
    <div className="flex items-center justify-between py-1 px-3 rounded" style={{ background: "var(--color-bg-card)" }}>
      <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      <span
        className={`font-semibold ${mono ? "font-mono" : ""} ${small ? "text-xs" : "text-sm"}`}
        style={{ color: accent ? colorMap[accent] : "var(--color-text-primary)", textAlign: "right", maxWidth: "65%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {value}
      </span>
    </div>
  );
}

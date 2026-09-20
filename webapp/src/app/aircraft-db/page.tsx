"use client";

import { useEffect, useState, useCallback } from "react";
import type { AircraftRecord, AircraftTypeCode, AircraftDatabase } from "@/lib/types";
import { AIRCRAFT_TYPE_OPTIONS } from "@/lib/types";
import HelpHint from "@/components/HelpHint";

/** オンライン取得の結果（/api/aircraft-db の fetch-online が返す形） */
interface OnlineResult {
  added: string[];
  updated: { device_id: string; changes: string[] }[];
  unchanged: number;
  optedOut: number;
  dupSkipped: number;
  sources: { ddb: number; ddbJa: number; flarmnet: number; flarmnetJa: number };
}

const EMPTY_RECORD: Omit<AircraftRecord, "device_id"> = {
  glider_type: "",
  registration: "",
  competition_id: "",
  pilot: "",
  aircraft_type: "glider",
};

export default function AircraftDbPage() {
  const [db, setDb] = useState<AircraftDatabase>({});
  const [loading, setLoading] = useState(true);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AircraftRecord | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newId, setNewId] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<OnlineResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchDb = useCallback(async () => {
    try {
      const res = await fetch("/api/aircraft-db");
      const data = await res.json();
      setDb(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDb();
    fetch("/api/system").then(r => r.json()).then(d => setOverlayEnabled(d.overlay_enabled === true)).catch(() => {});
  }, [fetchDb]);

  /**
   * OGN DDB と FlarmNet から JA 登録機を引いて、既存のDBに合流させる。
   * ネット側に値がある項目は手入力でも上書きし、ネット側に無い項目は残す。
   * 機体種別（グライダー/曳航機など）はどちらの源にも無いので触らない。
   */
  const fetchOnline = async () => {
    if (!confirm(
      "OGN DDB と FlarmNet から JA 登録機の情報を取り込みます。\n\n" +
      "・登録記号、機種、コンテストナンバー、操縦者名は、手で入れた値でもネット側の値で上書きされます\n" +
      "・ネット側に無い項目はそのまま残ります\n" +
      "・機体種別（グライダー/曳航機など）は変更されません\n\n" +
      "実行しますか？"
    )) return;
    setFetching(true);
    setFetchResult(null);
    setFetchError(null);
    try {
      const res = await fetch("/api/aircraft-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch-online" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFetchResult(data as OnlineResult);
      await fetchDb();
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "オンライン取得に失敗しました");
    }
    setFetching(false);
  };

  const saveRecord = async (record: AircraftRecord) => {
    await fetch("/api/aircraft-db", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    setEditingId(null);
    setDraft(null);
    setAddingNew(false);
    setNewId("");
    await fetchDb();
  };

  const deleteRecord = async (deviceId: string) => {
    if (!confirm(`${deviceId} を削除しますか？`)) return;
    await fetch("/api/aircraft-db", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId }),
    });
    await fetchDb();
  };

  const startEdit = (record: AircraftRecord) => {
    setEditingId(record.device_id);
    setDraft({ ...record });
    setAddingNew(false);
  };

  const startAdd = () => {
    setAddingNew(true);
    setEditingId(null);
    setDraft({ device_id: "", ...EMPTY_RECORD });
    setNewId("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
    setAddingNew(false);
    setNewId("");
  };

  const sorted = Object.values(db).sort((a, b) => a.device_id.localeCompare(b.device_id));
  const typeLabel = (code: AircraftTypeCode) => AIRCRAFT_TYPE_OPTIONS.find(o => o.value === code)?.label ?? code;

  const inputStyle: React.CSSProperties = {
    background: "var(--color-bg-primary)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-primary)",
    borderRadius: 4,
    padding: "2px 4px",
    fontSize: 13,
    width: "auto",
    minWidth: 60,
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    minWidth: "auto",
  };

  return (
      <div className="flex-1 overflow-auto p-4" style={{ background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold inline-flex items-center">
            機体情報データベース
            <HelpHint sectionId="manual-aircraft-db" />
          </h2>
          <div className="flex items-center gap-3">
            {overlayEnabled && <span className="text-xs" style={{ color: "var(--color-warning)" }}>固定化中 — 変更は再起動時にリセット</span>}
            <button
              onClick={fetchOnline}
              disabled={fetching || overlayEnabled}
              title={overlayEnabled
                ? "固定化(OverlayFS)が有効なので、取り込んでも再起動で消えます"
                : "OGN DDB と FlarmNet から JA 登録機の情報を取り込みます"}
              className="px-3 py-1 text-sm rounded font-semibold"
              style={{
                background: "var(--color-bg-tertiary)",
                color: "var(--color-text-primary)",
                border: "1px solid var(--color-border)",
                opacity: fetching || overlayEnabled ? 0.5 : 1,
                cursor: fetching || overlayEnabled ? "not-allowed" : "pointer",
              }}
            >
              {fetching ? "取得中..." : "オンライン取得"}
            </button>
            <button
              onClick={startAdd}
              disabled={addingNew}
              className="px-3 py-1 text-sm rounded font-semibold"
              style={{ background: "var(--color-accent)", color: "#fff", opacity: addingNew ? 0.5 : 1 }}
            >
              + 追加
            </button>
            <HelpHint sectionId="aircraft-db-ops" title="操作の説明を表示" />
          </div>
        </div>

        {fetchError && (
          <div className="mb-3 px-3 py-2 rounded text-sm"
               style={{ background: "var(--color-danger)", color: "#fff" }}>
            オンライン取得に失敗しました: {fetchError}
            <div className="text-xs mt-1" style={{ opacity: 0.9 }}>
              受信機がインターネットに出られるか確認してください。
            </div>
          </div>
        )}

        {fetchResult && (
          <div className="mb-3 px-3 py-2 rounded text-sm"
               style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}>
            <div className="font-semibold mb-1">
              オンライン取得: 新規 {fetchResult.added.length} 件 / 更新 {fetchResult.updated.length} 件 / 変更なし {fetchResult.unchanged} 件
            </div>
            <div className="text-xs mb-1" style={{ color: "var(--color-text-secondary)" }}>
              OGN DDB {fetchResult.sources.ddb.toLocaleString()} 件中 JA {fetchResult.sources.ddbJa} 件 ／
              FlarmNet {fetchResult.sources.flarmnet.toLocaleString()} 件中 JA {fetchResult.sources.flarmnetJa} 件
              {fetchResult.optedOut > 0 && ` ／ 識別の公開を拒否している ${fetchResult.optedOut} 件は取り込みません`}
              {fetchResult.dupSkipped > 0 && ` ／ 同じ登録記号が別アドレスで重複していた ${fetchResult.dupSkipped} 件は見送りました`}
            </div>
            {fetchResult.added.length > 0 && (
              <div className="text-xs mt-1">
                <span style={{ color: "var(--color-text-secondary)" }}>新規: </span>
                {fetchResult.added.join(", ")}
              </div>
            )}
            {fetchResult.updated.length > 0 && (
              <ul className="text-xs mt-1 ml-4 list-disc">
                {fetchResult.updated.map((u) => (
                  <li key={u.device_id}>
                    <span className="font-medium">{u.device_id}</span>
                    <span style={{ color: "var(--color-text-secondary)" }}> — {u.changes.join(" / ")}</span>
                  </li>
                ))}
              </ul>
            )}
            {fetchResult.added.length > 0 && (
              <div className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
                ※ 新規の機体IDの接頭辞（ICA / FLR / OGN）は登録元の情報から推定しています。
                受信時に別の接頭辞で届いても、同じアドレスであれば同じ機体として扱います。
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8" style={{ color: "var(--color-text-secondary)" }}>読み込み中...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="text-sm" style={{ borderCollapse: "collapse", width: "auto", border: "1px solid var(--color-border)" }}>
              <thead>
                <tr style={{ background: "var(--color-bg-tertiary)" }}>
                  {["識別番号", "航空機タイプ", "機種名", "登録番号", "CN", "パイロット", ""].map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap" style={{ borderBottom: "2px solid var(--color-border)", borderRight: i < 6 ? "1px solid var(--color-border)" : "none", color: "var(--color-text-secondary)", width: i < 6 ? "1%" : "auto" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {addingNew && draft && (
                  <tr style={{ background: "var(--color-accent-light)" }}>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                      <input
                        style={inputStyle}
                        value={newId}
                        onChange={e => setNewId(e.target.value.toUpperCase())}
                        placeholder="FLRXXXXXX"
                        autoFocus
                      />
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                      <select style={selectStyle} value={draft.aircraft_type} onChange={e => setDraft({ ...draft, aircraft_type: e.target.value as AircraftTypeCode })}>
                        {AIRCRAFT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                      <input style={inputStyle} value={draft.glider_type} onChange={e => setDraft({ ...draft, glider_type: e.target.value })} />
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                      <input style={inputStyle} value={draft.registration} onChange={e => setDraft({ ...draft, registration: e.target.value })} />
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                      <input style={inputStyle} value={draft.competition_id} onChange={e => setDraft({ ...draft, competition_id: e.target.value })} />
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                      <input style={inputStyle} value={draft.pilot} onChange={e => setDraft({ ...draft, pilot: e.target.value })} />
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                      <button
                        onClick={() => { if (newId) saveRecord({ ...draft, device_id: newId }); }}
                        disabled={!newId}
                        className="px-2 py-0.5 text-xs rounded mr-1"
                        style={{ background: "var(--color-success)", color: "#fff", opacity: newId ? 1 : 0.5 }}
                      >保存</button>
                      <button onClick={cancelEdit} className="px-2 py-0.5 text-xs rounded" style={{ background: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}>取消</button>
                    </td>
                  </tr>
                )}
                {sorted.map(rec => {
                  const isEditing = editingId === rec.device_id;
                  const d = isEditing && draft ? draft : rec;
                  return (
                    <tr key={rec.device_id} style={{ background: isEditing ? "var(--color-accent-light)" : "transparent" }}>
                      <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                        {rec.device_id}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                        {isEditing ? (
                          <select style={selectStyle} value={d.aircraft_type} onChange={e => setDraft({ ...d, aircraft_type: e.target.value as AircraftTypeCode })}>
                            {AIRCRAFT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : typeLabel(rec.aircraft_type)}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                        {isEditing ? <input style={inputStyle} value={d.glider_type} onChange={e => setDraft({ ...d, glider_type: e.target.value })} /> : rec.glider_type || "—"}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                        {isEditing ? <input style={inputStyle} value={d.registration} onChange={e => setDraft({ ...d, registration: e.target.value })} /> : rec.registration || "—"}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                        {isEditing ? <input style={inputStyle} value={d.competition_id} onChange={e => setDraft({ ...d, competition_id: e.target.value })} /> : rec.competition_id || "—"}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                        {isEditing ? <input style={inputStyle} value={d.pilot} onChange={e => setDraft({ ...d, pilot: e.target.value })} /> : rec.pilot || "—"}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                        {isEditing ? (
                          <>
                            <button onClick={() => saveRecord(d)} className="px-2 py-0.5 text-xs rounded mr-1" style={{ background: "var(--color-success)", color: "#fff" }}>保存</button>
                            <button onClick={cancelEdit} className="px-2 py-0.5 text-xs rounded" style={{ background: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}>取消</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(rec)} className="px-2 py-0.5 text-xs rounded mr-1" style={{ background: "var(--color-bg-tertiary)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}>編集</button>
                            <button onClick={() => deleteRecord(rec.device_id)} className="px-2 py-0.5 text-xs rounded" style={{ background: "var(--color-danger)", color: "#fff" }}>削除</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && !addingNew && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>
                      機体情報が登録されていません。マップ表示で検知された機体は自動的に登録されます。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
  );
}

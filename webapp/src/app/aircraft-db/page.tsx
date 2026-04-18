"use client";

import { useEffect, useState, useCallback } from "react";
import type { AircraftRecord, AircraftTypeCode, AircraftDatabase } from "@/lib/types";
import { AIRCRAFT_TYPE_OPTIONS } from "@/lib/types";
import HelpHint from "@/components/HelpHint";

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

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import mqtt from "mqtt";
import {
  MQTT_WS_URL,
  detectReceiverId,
  topicFor,
} from "@/lib/mqtt-config";
import { useUnits } from "@/lib/UnitContext";
import { formatAltitude, formatSpeed, formatClimbRate, type DisplayNameMode, type DistanceUnit } from "@/lib/units";
import type {
  AircraftPosition,
  AircraftList,
  ReceiverStatus,
  AircraftDatabase,
  AircraftRecord,
} from "@/lib/types";
import { AIRCRAFT_TYPE_OPTIONS } from "@/lib/types";
import HelpHint from "@/components/HelpHint";
import { lookupByDeviceId, hexAddress } from "@/lib/aircraft-id";
// 飛行記録の検知と保持はサーバ側 (src/lib/flight-tracker.ts)。ここは表示と手動編集のみ。
import type { FlightLogEntry, FlightPhase } from "@/lib/flight-tracker";

// ── Colors ──
const COLOR_NORMAL = "#2e7d32";   // green
const COLOR_LOW    = "#e67e22";   // orange
const COLOR_DANGER = "#d32f2f";   // red
const COLOR_GROUND = "#888";
const COLOR_ADSB   = "#1565c0";   // blue for ADS-B
const COLOR_MODES  = "#222";      // black for Mode-S/C

function adsbColor(pos: AircraftPosition): string {
  return pos.adsb_mode === "adsb" ? COLOR_ADSB : COLOR_MODES;
}

// ── Feeldscope SVG icons ──
function svgGlider(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M0,-11 Q0.6,-9 1.05,-6 L0.9,-3.5 Q1,-1 0.85,1 L0.6,5.5 Q0.3,8.5 0,10.5 Q-0.3,8.5 -0.6,5.5 L-0.85,1 Q-1,-1 -0.9,-3.5 L-1.05,-6 Q-0.6,-9 0,-11Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6"/><path d="M0.8,-2.2 L15,-2.2 L14.5,-1.5 L0.8,0.2Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6"/><path d="M-0.8,-2.2 L-15,-2.2 L-14.5,-1.5 L-0.8,0.2Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6"/><path d="M0.5,7.5 L5.5,9 L5.5,9.5 L0.5,9.5Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6"/><path d="M-0.5,7.5 L-5.5,9 L-5.5,9.5 L-0.5,9.5Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6"/></svg>`;
}

function svgTow(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M0.35,-9.41 L2.89,-9.06 L0.98,-8.77 L0.93,-5.7 L12.16,-5.59 L13.2,-4.49 L13.2,-3.56 L12.68,-2.63 L11.06,-1.77 L0.75,-1.65 L0.23,4.26 L2.78,5.12 L3.42,5.93 L3.42,6.51 L2.72,7.15 L1.33,7.44 L0.35,6.8 L0.06,9.81 L-0.35,6.8 L-0.98,7.38 L-3.18,6.92 L-3.53,5.99 L-2.95,5.18 L-0.41,4.31 L-0.98,-1.71 L-11.29,-1.88 L-12.97,-3.1 L-13.2,-4.49 L-12.68,-5.41 L-11.58,-5.76 L-1.04,-5.76 L-1.04,-8.83 L-3.13,-9.18 L-0.41,-9.41 L-0.06,-9.81 Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`;
}

function svgJet(color: string, heading: number): string {
  return `<svg width="24" height="24" viewBox="-12 -12 24 24" style="transform:rotate(${heading}deg)"><path d="M0,-10 L1.5,-4 L8,-1 L8,0.5 L1.5,1.5 L1,6 L3.5,7.5 L3.5,8.5 L-3.5,8.5 L-3.5,7.5 L-1,6 L-1.5,1.5 L-8,0.5 L-8,-1 L-1.5,-4Z" fill="${color}" stroke="rgba(255,255,255,.5)" stroke-width=".5"/></svg>`;
}

function svgPowered(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M-0.02,-10.34 L0.68,-9.59 L3.07,-9.21 L0.73,-9.12 L1.29,-8.75 L1.66,-5.51 L3.92,-4.71 L7.85,-4.71 L13.2,-4.1 L13.2,-1.66 L7.9,0.02 L1.66,-0.02 L0.49,7.85 L0.87,6.96 L4.67,7.06 L4.9,7.43 L4.71,9.5 L3.02,9.54 L2.6,9.92 L0.63,9.87 L0.3,9.45 L0.3,8.7 L0.02,10.34 L-0.26,8.79 L-0.3,9.68 L-0.68,9.92 L-2.51,9.92 L-3.07,9.5 L-4.71,9.45 L-4.71,7.1 L-0.59,7.1 L-1.52,0.07 L-7.67,0.02 L-13.01,-1.57 L-13.2,-4.06 L-8.04,-4.71 L-3.87,-4.71 L-1.62,-5.51 L-1.24,-8.79 L-0.59,-9.12 L-2.88,-9.21 L-0.59,-9.59 Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`;
}

function svgHelicopter(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M-0.21,-9.1 L0.41,-9 L1.09,-8.07 L1.71,-6.41 L1.97,-4.64 L10.01,-8.79 L10.58,-8.58 L10.63,-8.27 L10.06,-7.81 L2.02,-3.55 L2.02,-2.1 L1.87,-0.91 L5.71,7.34 L5.81,8.12 L5.34,8.32 L4.98,7.96 L1.45,0.54 L0.99,2.26 L0.67,7.39 L3.58,7.91 L3.58,8.58 L0.67,8.58 L0.52,11.23 L0.31,11.38 L0.21,13.2 L0.1,11.38 L-0.36,11.02 L-0.52,12.47 L-0.57,9.67 L-0.41,10.76 L-0.16,10.76 L-0.36,8.64 L-3.16,8.64 L-3.22,7.96 L-0.36,7.55 L-0.57,4.9 L-0.62,3.81 L-0.88,1.79 L-1.24,0.65 L-1.66,-0.91 L-10.06,3.24 L-10.63,3.09 L-10.53,2.46 L-2.59,-1.43 L-1.82,-1.89 L-1.92,-2.36 L-1.92,-2.88 L-2.02,-3.09 L-1.97,-3.81 L-1.87,-4.69 L-6.07,-12.73 L-5.91,-13.1 L-5.34,-13.2 L-1.66,-6.3 L-0.88,-8.32 L-0.26,-9.05 Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`;
}

function svgParaglider(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M2.44,-5.28 C4.1,-5.2 6.3,-5.0 7.57,-4.87 C8.8,-4.7 9.4,-4.5 10.08,-4.31 C10.8,-4.1 11.5,-3.7 11.94,-3.47 C12.4,-3.2 12.5,-3.1 12.73,-2.77 C12.9,-2.5 13.2,-2.5 13.2,-1.65 C13.2,-0.8 13.7,1.5 12.78,2.35 C11.9,3.2 9.5,3.1 7.89,3.38 C6.3,3.7 4.3,3.7 2.96,3.98 C1.7,4.3 1.1,5.3 0.07,5.28 C-0.9,5.3 -1.7,4.3 -3,3.98 C-4.3,3.7 -6.4,3.7 -8.03,3.38 C-9.7,3.1 -11.9,3.2 -12.78,2.35 C-13.6,1.5 -13.2,-0.7 -13.2,-1.56 C-13.2,-2.4 -13.1,-2.2 -12.87,-2.54 C-12.7,-2.9 -12.5,-3.1 -11.99,-3.42 C-11.5,-3.7 -10.7,-4.1 -10.03,-4.31 C-9.3,-4.5 -9.1,-4.7 -7.8,-4.82 C-6.5,-5.0 -4.1,-5.2 -2.35,-5.28 C-0.6,-5.4 0.8,-5.3 2.44,-5.28 Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`;
}

function svgHangglider(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M0.05,-4.51 L-11.02,0.28 L-11.99,0.98 C-12.4,1.3 -13.0,2.1 -13.2,2.46 C-13.4,2.8 -13.3,2.8 -13.2,2.93 C-13.1,3.1 -12.9,3.3 -12.74,3.44 C-12.5,3.6 -12.5,3.7 -12.04,3.72 C-11.6,3.8 -11.5,4.0 -10.04,3.67 L-3.35,1.77 L-0.51,1.35 L-0.14,2.84 L-0.05,4.51 L0.09,2.84 L0.51,1.35 L7.62,3.3 L8.83,3.72 L10.83,4.28 C11.4,4.4 12.1,4.3 12.5,4.14 C12.9,4.0 13.1,3.7 13.2,3.44 C13.3,3.2 13.1,2.9 12.83,2.56 C12.6,2.2 12.3,1.8 11.81,1.39 L9.95,0.19 L0.09,-4.51 L0.05,-4.51 Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`;
}

function svgSkydiver(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><circle cx="0" cy="-6" r="3" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="0" y1="-3" x2="0" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="-7" y1="-1" x2="7" y2="-1" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="-5" y2="11" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="5" y2="11" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

function svgBalloon(color: string): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30"><ellipse cx="0" cy="-3" rx="8" ry="10" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="7" x2="-2" y2="10" stroke="${color}" stroke-width=".7"/><line x1="3" y1="7" x2="2" y2="10" stroke="${color}" stroke-width=".7"/><rect x="-3" y="10" width="6" height="4" rx="1" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".4"/></svg>`;
}

function svgUav(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M-0.59,-11.66 L-0.81,-4.07 L-5.98,-6.98 L-5.44,-8.27 L-5.39,-9.94 L-5.98,-11.4 L-7.33,-12.63 L-8.73,-13.12 L-10.34,-13.01 L-11.69,-12.31 L-12.77,-11.02 L-13.15,-9.89 L-13.09,-8.27 L-11.75,-6.17 L-9.75,-5.31 L-8.46,-5.36 L-6.95,-5.95 L-2.37,-2.51 L-2.48,2.61 L-6.68,6.22 L-8.08,5.47 L-10.02,5.36 L-11.75,6.17 L-12.93,7.79 L-13.2,9.4 L-12.72,11.13 L-11.64,12.36 L-9.86,13.12 L-7.87,12.9 L-6.14,11.61 L-5.33,9.46 L-5.76,7.35 L-0.97,3.74 L1.51,3.8 L5.98,6.98 L5.39,8.65 L5.5,10.32 L6.2,11.66 L7.76,12.85 L10.34,13.01 L11.8,12.26 L12.66,11.23 L13.15,9.99 L13.15,8.43 L12.55,7.03 L11.75,6.17 L9.7,5.31 L8.51,5.36 L6.95,5.95 L2.86,2.61 L2.86,-2.45 L7.33,-5.74 L9.81,-5.31 L12.12,-6.49 L13.2,-8.76 L13.04,-10.43 L12.23,-11.83 L11.31,-12.58 L9.81,-13.12 L7.33,-12.63 L6.09,-11.5 L5.39,-9.78 L5.5,-8.16 L6.2,-6.6 L1.24,-4.07 L1.08,-11.66 C0.8,-12.9 -0.3,-12.9 -0.59,-11.66 Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`;
}

function svgByType(typeCode: string | undefined, color: string, heading: number): string {
  switch (typeCode) {
    case "glider": return svgGlider(color, heading);
    case "tow": return svgTow(color, heading);
    case "powered": return svgPowered(color, heading);
    case "helicopter": return svgHelicopter(color, heading);
    case "paraglider": return svgParaglider(color, heading);
    case "hangglider": return svgHangglider(color, heading);
    case "skydiver": return svgSkydiver(color, heading);
    case "balloon": return svgBalloon(color);
    case "uav": return svgUav(color, heading);
    case "jet": return svgJet(color, heading);
    default: return svgGlider(color, heading);
  }
}

// RND(ランダムID/EPRA)機の匿名マーカー。追跡不可なので個体表示はせず、これ1個で「?」を出す。
function makeAnonIcon() {
  return L.divIcon({
    html: '<div title="匿名機(追跡不可)" style="width:16px;height:16px;border-radius:50%;background:rgba(120,120,120,.35);border:1px solid rgba(90,90,90,.6);color:#444;font-size:11px;font-weight:700;line-height:14px;text-align:center">?</div>',
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function makeAircraftIcon(heading: number, color: string, blink: boolean, gliderType?: string, isAdsb?: boolean, registration?: string, aircraftType?: string, dbType?: string, labels?: { top?: string; bot?: string }) {
  let svg: string;
  if (dbType) {
    svg = svgByType(dbType, color, heading);
  } else if (isAdsb) {
    svg = svgJet(color, heading);
  } else {
    svg = isTowPlane(gliderType, registration, aircraftType)
      ? svgTow(color, heading)
      : svgGlider(color, heading);
  }
  const blinkClass = blink ? " aircraft-blink" : "";
  const size = isAdsb ? 24 : 30;
  const anchor = isAdsb ? 12 : 15;
  // ラベルは機体アイコンの上(表示名)・下(高度+速度)に配置(ogn.ezoe.net と同様)。
  const top = labels?.top ? `<span class="ac-top">${labels.top}</span>` : "";
  const bot = labels?.bot ? `<span class="ac-bot">${labels.bot}</span>` : "";
  return L.divIcon({
    html: `<div class="ac-mk">${top}<div class="aircraft-icon${blinkClass}">${svg}</div>${bot}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
}

// ── マーカーのスムーズ移動（対地速度ベースの推測航法。ogn-web v0.9.0 と同方式） ──
// 方針: 航空機は常に対地速度で動いているので、アイコンも「平均化した対地速度」で
// 機首方向へ前進し続ければ自然に次の検知位置の近くへ来る。ズレの吸収は
//  ・前後方向 = 速度の増減だけで行う(遅れていれば最大+40%増速、進み過ぎなら減速〜停止)。
//    **後退(バック)は絶対にしない**。追い越したら減速して実機に追い付かれるのを待つ。
//  ・横方向   = レート制限つきで経路へ寄せる(横滑りは後退ではない)。
// ずれすぎ防止: 目標点はfixから最大 DR_EXTRAP_MAX_MS ぶんの外挿で頭打ち。
// 大ジャンプ(受信ギャップ)・タブ非表示時は従来どおり即時スナップ。
const DR_TAU_MS = 1200;         // 静止時/横ズレの収束時定数
const DR_EXTRAP_MAX_MS = 10000; // 目標点の外挿上限 = 検知位置から最大10秒ぶん
const DR_SNAP_M = 5000;         // これ以上の誤差はスナップ
const DR_SPD_EMA = 0.3;         // fix毎の対地速度の平均化係数(直近3〜4fixの移動平均相当)
const DR_CATCH_S = 8;           // 前後ズレを増減速で吸収する時定数
const DR_SPD_MIN = 1.5;         // m/s。これ未満は静止扱い(収束のみ)

interface SmoothMarkerRec {
  marker: L.Marker;
  /** 最新の受信fix(位置+速度ベクトル+実測定時刻)。推測航法の基準 */
  fix?: { lat: number; lon: number; vN: number; vE: number; t: number };
  /** アイコンの巡航速度(対地速度のEMA) */
  vAvg?: number | null;
  dispHeading?: number;
  iconKey?: string;
}

const drItems = new Set<SmoothMarkerRec>();  // 推測航法の対象レコード(全レイヤ共通)

function drSetFix(
  rec: SmoothMarkerRec, lat: number, lon: number,
  speedMs: number | null | undefined, trackDeg: number | null | undefined, fixTime?: number,
): void {
  const spd = speedMs != null && speedMs > 1 ? speedMs : 0;
  let vN = 0, vE = 0;
  if (spd && trackDeg != null) {
    const r = (trackDeg * Math.PI) / 180;
    vN = spd * Math.cos(r);
    vE = spd * Math.sin(r);
  }
  // 1回の外れ値で暴れないよう速度は指数移動平均
  rec.vAvg = rec.vAvg == null ? spd : rec.vAvg + (spd - rec.vAvg) * DR_SPD_EMA;
  const now = Date.now();
  // fix時刻は分かる範囲で実測定時刻(OGN=ビーコン時刻)。クロックずれで未来にならないよう now でクランプ
  rec.fix = { lat, lon, vN, vE, t: Math.min(fixTime || now, now) };
  drItems.add(rec);
  const cur = rec.marker.getLatLng();
  if ((typeof document !== "undefined" && document.hidden) || cur.distanceTo([lat, lon]) > DR_SNAP_M) {
    rec.marker.setLatLng([lat, lon]);
    rec.vAvg = spd; // スナップ時は平均もリセット
  }
}

function drDrop(rec: SmoothMarkerRec): void { drItems.delete(rec); }

/** 機首を最短弧で回す。350°→10° は +20° になり長回りしない。instant はタブ復帰時のスナップ用 */
function rotateMarkerSmooth(rec: SmoothMarkerRec, heading: number, instant: boolean): void {
  const el = rec.marker.getElement();
  const svg = el?.querySelector(".aircraft-icon svg") as SVGElement | null;
  if (!svg) return;
  if (rec.dispHeading == null) rec.dispHeading = heading;
  const cur = ((rec.dispHeading % 360) + 360) % 360;
  const delta = ((heading - cur + 540) % 360) - 180;
  rec.dispHeading += delta;
  const deg = rec.dispHeading;
  if (instant || (typeof document !== "undefined" && document.hidden)) {
    svg.style.transition = "none";
    svg.style.transform = `rotate(${deg}deg)`;
    requestAnimationFrame(() => { svg.style.transition = ""; });
  } else {
    svg.style.transform = `rotate(${deg}deg)`;
  }
}

/**
 * アイコンDOMを保ったままラベル・機首だけ更新する。形（色/種別/点滅/ラベル有無）が
 * 変わったとき（iconKey 不一致）だけ作り直す。
 */
function applyIconSmooth(
  rec: SmoothMarkerRec, iconKey: string, heading: number,
  top: string | undefined, bot: string | undefined, build: () => L.DivIcon,
): void {
  const el = rec.marker.getElement();
  if (!el || rec.iconKey !== iconKey) {
    rec.marker.setIcon(build());
    rec.iconKey = iconKey;
    rec.dispHeading = heading;
    return;
  }
  const topEl = el.querySelector(".ac-top");
  if (topEl && top !== undefined && topEl.textContent !== top) topEl.textContent = top;
  const botEl = el.querySelector(".ac-bot");
  if (botEl && bot !== undefined && botEl.textContent !== bot) botEl.textContent = bot;
  rotateMarkerSmooth(rec, heading, false);
}

// ── Thresholds ──
const GROUND_ALT_M = 100;
const LOW_ALT_FT = 1500;
const LOST_SIGNAL_SEC = 10;
/**
 * 地上にいる機体を地図から消すまでの無受信時間。
 * FLARM の電源を切った機体は受信機の機体リストから落ちない
 * （たきかわ実測 2026-09-12: 運用終了1時間後も10機が残り、うち1機は
 * 4か月前の位置のままだった）。リストの `last_seen_sec` は経過時間と
 * 対応しないので、位置の時刻で判断する。
 *
 * 上空で受信が途切れた機体は消さない。最後に見えた場所は捜す側に必要な
 * 情報で、勝手に消してはいけない。翌朝のログブック更新まで残す。
 */
const GROUND_STALE_MS = 10 * 60_000;
// 離着陸・離脱の判定に使う閾値はサーバ側 (src/lib/flight-tracker.ts) にある。

// Haversine distance in meters
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Check if glide path is insufficient
// glide ratio needed = distance / height_above_field
// danger when needed ratio > safe ratio (can't reach field)
function isDanger(pos: AircraftPosition, safeGlideRatio: number, fieldLat: number, fieldLon: number, fieldElev: number): boolean {
  if (pos.altitude_m < GROUND_ALT_M + fieldElev) return false; // on ground
  const heightAboveField = pos.altitude_m - fieldElev;
  if (heightAboveField <= 0) return false;
  const distM = haversineM(fieldLat, fieldLon, pos.latitude, pos.longitude);
  const neededRatio = distM / heightAboveField;
  return neededRatio > safeGlideRatio;
}

// Determine aircraft status
type AircraftAlert = "normal" | "low" | "danger";

function getAlert(pos: AircraftPosition, safeGlideRatio: number, fieldLat: number, fieldLon: number, fieldElev: number): AircraftAlert {
  if (pos.altitude_m < GROUND_ALT_M + fieldElev) return "normal";
  if (isDanger(pos, safeGlideRatio, fieldLat, fieldLon, fieldElev)) return "danger";
  const lowAltM = LOW_ALT_FT * 0.3048 + fieldElev;
  if (pos.altitude_m < lowAltM) return "low";
  return "normal";
}

function alertColor(alert: AircraftAlert): string {
  if (alert === "danger") return COLOR_DANGER;
  if (alert === "low") return COLOR_LOW;
  return COLOR_NORMAL;
}

function nowClockStr(): string {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ── Flight-log persistence (client localStorage mirror) ──
// The overlay server keeps the flight log only in memory, so a mid-day restart
// would lose the morning's flights. We mirror the log to localStorage keyed by
// the "logbook day" and merge it back on load. localStorage is only valid for
// the current logbook day; yesterday's data is discarded (not needed).
const FLIGHT_LOG_LS_KEY = "ogn-flight-log";

/** Logbook day (YYYY-MM-DD). Rolls over at 05:00 JST, matching the server-side
 *  daily reset, so evening flights stay valid through the night until 05:00. */
function logbookDay(): string {
  // JST (UTC+9) shifted back 5h so the date label flips at 05:00 JST.
  return new Date(Date.now() + (9 - 5) * 3600_000).toISOString().slice(0, 10);
}

function loadLocalFlightLog(): FlightLogEntry[] {
  try {
    const raw = localStorage.getItem(FLIGHT_LOG_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.day !== logbookDay() || !Array.isArray(parsed.entries)) {
      localStorage.removeItem(FLIGHT_LOG_LS_KEY); // stale (previous logbook day)
      return [];
    }
    // 旧版の控えには id が無いので補う（サーバ側は id で飛行を追う）
    return (parsed.entries as FlightLogEntry[]).map((e, i) => ({
      ...e,
      id: e.id || `ls${e.deviceId}-${e.takeoffTime}-${i}`,
    }));
  } catch {
    return [];
  }
}

function saveLocalFlightLog(entries: FlightLogEntry[]): void {
  try {
    localStorage.setItem(FLIGHT_LOG_LS_KEY, JSON.stringify({ day: logbookDay(), entries }));
  } catch { /* ignore quota/availability errors */ }
}

function calcFlightDuration(takeoff: string, landing: string | null): string | null {
  if (landing === "") return null; // 着陸済みだが時刻が分からない（空欄）
  const end = landing || nowClockStr();
  const [th, tm] = takeoff.split(":").map(Number);
  const [lh, lm] = end.split(":").map(Number);
  if (isNaN(th) || isNaN(tm) || isNaN(lh) || isNaN(lm)) return null;
  let diffMin = (lh * 60 + lm) - (th * 60 + tm);
  if (diffMin < 0) diffMin += 24 * 60; // across midnight
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `${String(h).padStart(2, "0")}+${String(m).padStart(2, "0")}`;
}

function isTowPlane(gliderType?: string, registration?: string, aircraftType?: string, dbType?: string): boolean {
  // Aircraft DB type takes highest priority
  if (dbType === "tow") return true;
  if (dbType && dbType !== "tow") return false;
  // OGN aircraft_type from FLARM beacon
  if (aircraftType === "Tow Plane") return true;
  // Glider type name (IGC/simulator)
  const t = (gliderType || "").toLowerCase();
  if (t.includes("hk-36") || t.includes("husky") || t.includes("pawnee") || t.includes("piper") || t.includes("tow")) return true;
  // IGC replay: no glider_type available — use registration prefix
  const reg = (registration || "").toUpperCase();
  return reg.startsWith("JA4");
}

interface TrailPoint {
  latlng: L.LatLng;
  /** 受信した時刻（航跡の表示時間窓に使う。機体側の時計ずれの影響を受けない） */
  arrivalMs: number;
  /** 位置そのものの時刻（並び順と重複判定に使う） */
  posMs: number;
}

interface TrackedAircraft extends SmoothMarkerRec {
  position: AircraftPosition;
  marker: L.Marker;
  trail: L.Polyline;
  trailPoints: TrailPoint[];
  label: string;
  lastUpdateMs: number;
  adsb?: boolean;
}

/** /api/open-adsb (公開 adsb.lol) が返す1機ぶん */
interface OpenAdsbAircraft {
  device_id: string;
  hex: string;
  flight: string | null;
  reg: string | null;
  type: string | null;
  latitude: number;
  longitude: number;
  altitude_m: number;
  heading_deg: number;
  ground_speed_ms: number;
  adsb_mode: "adsb" | "modes";
  trail: [number, number][];
}

/** /api/open-ogn (ogn.ezoe.net) が返す1機ぶん */
interface OpenOgnAircraft {
  device_id: string;
  hex: string;
  registration: string | null;
  cn: string | null;
  model: string | null;
  latitude: number;
  longitude: number;
  altitude_m: number | null;
  heading_deg: number;
  ground_speed_ms: number;
  aircraft_type: number | null;
}

const TRAIL_DURATION_MS = 60_000; // 1 minute trail
const ANON_TTL_MS = 90_000; // RND(匿名)マーカーの保持。この間 無受信なら消す

// 航跡として受け付ける最大の見かけ速度。これを超える点は、別機体の位置が
// 混入した／座標が壊れた、と判断して航跡には足さない（マーカーは動かす）。
const MAX_TRAIL_SPEED_MS = 140;       // FLARM: 504 km/h
const MAX_TRAIL_SPEED_ADSB_MS = 350;  // ADS-B: 1260 km/h

/**
 * 位置の「発生時刻」をミリ秒で返す。送信側が timestamp_epoch を持たない
 * 古い版や、値が壊れている場合は受信時刻で代用する。
 */
function positionTimeMs(pos: AircraftPosition, fallbackMs: number): number {
  const epoch = pos.timestamp_epoch;
  if (typeof epoch === "number" && Number.isFinite(epoch) && epoch > 0) {
    return Math.round(epoch * 1000);
  }
  if (pos.timestamp_utc) {
    const t = Date.parse(pos.timestamp_utc);
    if (Number.isFinite(t)) return t;
  }
  return fallbackMs;
}

/** 復号エラーの位置を弾くための現実的な上限（送信側 ogn-mqtt.py と同じ考え方） */
const MAX_ALTITUDE_M = 15000;
const MIN_ALTITUDE_M = -500;
/** 直前の位置がこれより古いと、動いたのか壊れたのか判断できないので通す */
const JUMP_MAX_GAP_SEC = 300;
/** 連続でこれだけ弾いたら基準側が怪しいので取り直す */
const MAX_CONSECUTIVE_REJECTS = 5;

/**
 * 直前の位置から見て、物理的にありえる動きかを返す。
 *
 * 受信が弱くなると復号エラーで座標や高度が壊れる。地図に出すと機体が
 * とんでもない場所へ飛ぶので、見かけの速度がありえない値なら採用しない。
 */
function isPlausiblePosition(
  prev: AircraftPosition,
  pos: AircraftPosition,
  prevMs: number,
  nowMs: number,
  adsb: boolean,
): boolean {
  const dtSec = Math.max(1, (nowMs - prevMs) / 1000);
  if (dtSec > JUMP_MAX_GAP_SEC) return true;
  const distM = haversineM(prev.latitude, prev.longitude, pos.latitude, pos.longitude);
  if (distM / dtSec > (adsb ? MAX_TRAIL_SPEED_ADSB_MS : MAX_TRAIL_SPEED_MS)) return false;
  if (Math.abs(pos.altitude_m - prev.altitude_m) / dtSec > 40) return false;
  return true;
}

/**
 * 航跡へ1点追加する。
 *
 * MQTT は QoS 0 で、送信側の不具合や再接続で「同じ点の再送」「順序の乱れ」が
 * 起き得る。到着順にそのまま繋ぐと航跡がジグザグになり、ブラウザごとに
 * 取りこぼす点が違うため見え方まで変わる。ここで時刻順に整列・重複除去し、
 * ありえない飛躍を弾くことで、表示はブラウザによらず同じになる。
 */
function addTrailPoint(
  ac: TrackedAircraft,
  latlng: L.LatLng,
  posMs: number,
  arrivalMs: number,
): void {
  const pts = ac.trailPoints;

  // 同じ時刻の点は捨てる（再送）
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].posMs === posMs) return;
    if (pts[i].posMs < posMs) break;
  }

  // ありえない飛躍（別機体の位置の混入など）を弾く
  const last = pts[pts.length - 1];
  if (last) {
    const dtSec = Math.max(1, Math.abs(posMs - last.posMs) / 1000);
    const distM = haversineM(last.latlng.lat, last.latlng.lng, latlng.lat, latlng.lng);
    const limit = ac.adsb ? MAX_TRAIL_SPEED_ADSB_MS : MAX_TRAIL_SPEED_MS;
    if (distM / dtSec > limit) {
      console.warn(
        `[TRAIL] implausible jump ignored: ${(distM / 1000).toFixed(1)}km in ${dtSec.toFixed(0)}s`,
      );
      return;
    }
  }

  // 時刻順に挿入する（通常は末尾）
  let i = pts.length;
  while (i > 0 && pts[i - 1].posMs > posMs) i--;
  pts.splice(i, 0, { latlng, arrivalMs, posMs });

  // 表示時間窓の外へ出た点を落とす。並びは時刻順なので、遅れて届いた点が
  // 先頭に入ることがある。先頭だけ見ると取りこぼすので全体を見る。
  const cutoff = arrivalMs - TRAIL_DURATION_MS;
  if (pts.some((p) => p.arrivalMs < cutoff)) {
    ac.trailPoints = pts.filter((p) => p.arrivalMs >= cutoff);
  }

  ac.trail.setLatLngs(ac.trailPoints.map((p) => p.latlng));
}

function resolveLabel(pos: AircraftPosition, deviceId: string, mode: DisplayNameMode): string {
  if (mode === "pilot" && pos.pilot) return pos.pilot;
  if (mode === "registration" && pos.glider_id) return pos.glider_id;
  if (mode === "competition_id" && pos.competition_id) return pos.competition_id;
  return pos.competition_id || pos.glider_id || deviceId;
}

/** Look up aircraft DB record by deviceId, falling back to registration match */
function lookupDbRecord(db: AircraftDatabase, deviceId: string, gliderId?: string): AircraftRecord | undefined {
  // 接頭辞違いでも同じアドレスなら同じ機体（flight-tracker と同じ扱い）
  const rec = lookupByDeviceId(db, deviceId);
  if (rec && rec.registration) return rec;
  if (gliderId) {
    const regUpper = gliderId.toUpperCase();
    for (const r of Object.values(db)) {
      if (r.registration && r.registration.toUpperCase() === regUpper) return r;
    }
  }
  return rec; // return the (possibly empty) record if no registration match
}

export default function FlightMap() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const aircraftRef = useRef<Map<string, TrackedAircraft>>(new Map());
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [receiverStatus, setReceiverStatus] = useState<ReceiverStatus | null>(null);
  const [aircraftCount, setAircraftCount] = useState(0);
  const [selectedAircraft, setSelectedAircraft] = useState<string | null>(null);
  const [, setUpdateTick] = useState(0);
  const [now, setNow] = useState(0);
  const { units, unitsLoaded } = useUnits();
  const [flightLog, setFlightLogRaw] = useState<FlightLogEntry[]>([]);
  /** 手動編集を保存する。検知はサーバ側が行うので、ここは編集の反映だけ */
  const setFlightLog = useCallback((log: FlightLogEntry[]) => {
    lastManualEditRef.current = Date.now();
    setFlightLogRaw(log);
    // サーバの再起動で当日ぶんが消えないよう、ブラウザ側にも控えを置く。
    // 端末は OverlayFS で SD カードへ書けないため、控えはここにしか作れない。
    saveLocalFlightLog(log);
    fetch("/api/flight-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set", entries: log }),
    }).catch(() => {});
  }, []);
  const flightLogRef = useRef<FlightLogEntry[]>([]);
  /** 機体ごとの状態（サーバ側の検知結果）。地図の着陸進入表示に使う */
  const phasesRef = useRef<Record<string, FlightPhase>>({});
  /** 機体ごとに、ありえない位置を連続で弾いた回数 */
  const rejectCountsRef = useRef<Record<string, number>>({});
  /** 前回の掃除で見たログブック日。変わったら地図を片付ける */
  const lastSweepDayRef = useRef<string>("");
  /** 手動編集の直後はサーバの取得結果で上書きしない（入力中の値が消えるため） */
  const lastManualEditRef = useRef(0);
  const logTableRef = useRef<HTMLDivElement>(null);
  /** フライトログを末尾まで送って見ているか。遡っている間は自動で戻さない */
  const logAtBottomRef = useRef(true);
  // Position-unknown ADS-B/Mode-S aircraft (sidebar only)
  const [noPositionAircraft, setNoPositionAircraft] = useState<AircraftPosition[]>([]);

  // Aircraft database
  const aircraftDbRef = useRef<AircraftDatabase>({});
  const pendingAutoRegister = useRef<Set<string>>(new Set());

  // Open ADS-B (公開 adsb.lol) の独立レイヤ。MQTT の aircraft_adsb とは別管理。
  const openAdsbRef = useRef<Map<string, SmoothMarkerRec & { trail: L.Polyline }>>(new Map());

  // RND(ランダムID)機の匿名クラスタ。device_id ではなく場所(小数3桁≒100m)キーで集約。
  const anonRef = useRef<Map<string, { marker: L.Marker; lastMs: number }>>(new Map());

  // 選択機体の「このフライト」航跡(実線)。選択解除で消す。
  const trackLineRef = useRef<L.Polyline | null>(null);

  // Open OGN (ogn.ezoe.net) の独立レイヤ。hex キー。ローカル OGN とは別管理。
  const openOgnRef = useRef<Map<string, SmoothMarkerRec>>(new Map());

  // Home view state
  const [homeView, setHomeView] = useState<{ lat: number; lng: number; zoom: number }>({ lat: 0, lng: 0, zoom: 11 });

  // Becomes true once the Leaflet map instance is ready. Effects that read
  // mapRef.current must list this as a dependency so they re-run after init.
  const [mapReady, setMapReady] = useState(false);

  // Resizable panels
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [logHeight, setLogHeight] = useState(160);

  /**
   * 地上で受信が途絶えた機体を地図から下ろす。
   * 上空で消えた機体は残し、ログブックの日が変わったところで全部片付ける。
   */
  useEffect(() => {
    const sweep = () => {
      const aircraft = aircraftRef.current;
      const map = mapRef.current;
      const nowMs = Date.now();
      const day = logbookDay();
      const newDay = lastSweepDayRef.current !== "" && lastSweepDayRef.current !== day;
      lastSweepDayRef.current = day;
      let changed = false;
      for (const [id, ac] of aircraft) {
        const silentMs = nowMs - ac.lastUpdateMs;
        const airborne = phasesRef.current[id]
          ? phasesRef.current[id] !== "ground"
          : ac.position.altitude_m >= GROUND_ALT_M + unitsRef.current.airfield.elevation_m;
        // 上空で消えた機体は日が変わるまで残す
        if (!newDay && (airborne || silentMs < GROUND_STALE_MS)) continue;
        map?.removeLayer(ac.marker);
        map?.removeLayer(ac.trail);
        aircraft.delete(id);
        changed = true;
      }
      if (changed) setAircraftCount(aircraft.size);
    };
    const id = setInterval(sweep, 30_000);
    return () => clearInterval(id);
  }, []);

  // Hydration-safe: restore client-only state in useEffect
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    // 飛行記録はサーバ側で検知・保持している。ここでは定期的に取得して表示する。
    // 記録はサーバのメモリ上にしかないので（端末は OverlayFS で SD カードへ
    // 書けない）、webapp を再起動すると当日ぶんが消える。ブラウザ側の控えを
    // 唯一の受け皿として、サーバが空になっていたら戻す。
    let disposed = false;
    const pull = async () => {
      let server: FlightLogEntry[] = [];
      let phases: Record<string, FlightPhase> = {};
      try {
        const res = await fetch("/api/flight-log");
        const data = await res.json();
        server = data.entries || [];
        phases = data.phases || {};
      } catch {
        return; // サーバに届かない間は今の表示のまま
      }
      if (disposed) return;
      phasesRef.current = phases;

      // サーバが空＝再起動直後。控えがあれば戻す。
      // 件数が減っただけの場合は戻さない（利用者が消した行を復活させないため）。
      if (server.length === 0) {
        const local = loadLocalFlightLog();
        if (local.length > 0) {
          fetch("/api/flight-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "set", entries: local }),
          }).catch(() => {});
          return; // 次回の取得で戻ったものを表示する
        }
      }

      // 手動編集の直後は、入力中の値が消えるので取得結果を当てない
      if (Date.now() - lastManualEditRef.current < 8000) return;
      // 中身が変わっていなければ差し替えない。毎回作り直すと、3秒ごとに
      // 描き直しと自動スクロールが走ってしまう。
      if (JSON.stringify(flightLogRef.current) === JSON.stringify(server)) return;
      flightLogRef.current = server;
      setFlightLogRaw(server);
      // ここへ来る空の server は「控えも空」の場合だけなので、潰す心配はない
      saveLocalFlightLog(server);
    };
    void pull();
    const logPollId = setInterval(() => void pull(), 3000);
    // Restore panel sizes
    try {
      const sw = localStorage.getItem("ogn-sidebar-width");
      if (sw) setSidebarWidth(Math.max(200, Math.min(500, parseInt(sw, 10) || 280)));
      const lh = localStorage.getItem("ogn-log-height");
      if (lh) setLogHeight(Math.max(60, Math.min(400, parseInt(lh, 10) || 160)));
    } catch { /* ignore */ }
    // Restore home view
    try {
      const hv = localStorage.getItem("ogn-home-view");
      if (hv) setHomeView(JSON.parse(hv));
    } catch { /* ignore */ }
    // Load aircraft database
    async function loadAircraftDb() {
      try {
        const res = await fetch("/api/aircraft-db");
        const data = await res.json();
        aircraftDbRef.current = data;
      } catch { /* ignore */ }
    }
    loadAircraftDb();
    const dbInterval = setInterval(loadAircraftDb, 30000);
    return () => {
      disposed = true;
      clearInterval(id);
      clearInterval(dbInterval);
      clearInterval(logPollId);
    };
  }, []);

  const airfield = units.airfield;
  const fieldMarkerRef = useRef<L.CircleMarker | null>(null);
  const ognReceiverMarkerRef = useRef<L.Marker | null>(null);
  const tileLayersRef = useRef<L.TileLayer[]>([]);

  // Initialize map (wait for units to load so airfield reflects server config)
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current || !unitsLoaded) return;

    // Saved home view takes precedence over the airfield default.
    let savedHome: { lat: number; lng: number; zoom: number } | null = null;
    try {
      const hv = localStorage.getItem("ogn-home-view");
      if (hv) savedHome = JSON.parse(hv);
    } catch { /* ignore */ }

    const center: L.LatLngExpression = savedHome
      ? [savedHome.lat, savedHome.lng]
      : [airfield.latitude, airfield.longitude];
    const initialZoom = savedHome?.zoom ?? 11;

    const map = L.map(mapContainerRef.current, {
      center,
      zoom: initialZoom,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Create a low-z pane for the airfield marker so aircraft icons stay on top
    const airfieldPane = map.createPane("airfieldPane");
    airfieldPane.style.zIndex = "350";

    const marker = L.circleMarker([airfield.latitude, airfield.longitude], {
      radius: 8,
      color: "#d32f2f",
      fillColor: "#ef5350",
      fillOpacity: 0.6,
      weight: 2,
      pane: "airfieldPane",
    })
      .addTo(map)
      .bindTooltip(airfield.name, {
        permanent: true,
        direction: "top",
        offset: [0, -10],
        className: "airfield-tooltip",
        pane: "airfieldPane",
      });

    fieldMarkerRef.current = marker;
    // 機体以外(地図の余白)をクリックしたら選択解除(詳細パネル・航跡を自動で閉じる)
    map.on("click", () => setSelectedAircraft(null));
    mapRef.current = map;
    setMapReady(true);
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
      fieldMarkerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitsLoaded]);

  // Swap tile layers when mapSource changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Remove existing tile layers
    for (const layer of tileLayersRef.current) {
      map.removeLayer(layer);
    }
    tileLayersRef.current = [];

    if (units.mapSource === "offline") {
      map.setMinZoom(0);
      map.setMaxZoom(17);
      if (map.getZoom() > 17) map.setZoom(17);
      const ort = L.tileLayer("/tiles/ort/{z}/{x}/{y}.jpg", {
        attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>国土地理院</a>",
        maxZoom: 17,
        pane: "tilePane",
      }).addTo(map);
      const hillshade = L.tileLayer("/tiles/hillshademap/{z}/{x}/{y}.png", {
        attribution: "",
        maxZoom: 17,
        opacity: 0.3,
        pane: "tilePane",
      }).addTo(map);
      tileLayersRef.current = [ort, hillshade];
    } else {
      map.setMinZoom(0);
      map.setMaxZoom(18);
      const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
        pane: "tilePane",
      }).addTo(map);
      tileLayersRef.current = [osm];
    }
    // Ensure markers stay above tiles
    const markerPane = map.getPane("markerPane");
    if (markerPane) markerPane.style.zIndex = "650";
  }, [units.mapSource, mapReady]);

  // OGN receiver marker: poll /api/ogn for receiver location and status
  useEffect(() => {
    if (!mapRef.current) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function update() {
      try {
        const res = await fetch("/api/ogn");
        const data = await res.json();
        if (cancelled) return;
        const currentMap = mapRef.current;
        if (!currentMap) return;
        const cfg = data.config;
        const status = data.status;
        if (!cfg || cfg.latitude == null || cfg.longitude == null) return;

        const online = status?.online === true;
        const color = online ? "#00b894" : "#888";
        const html = `<div style="display:flex;flex-direction:column;align-items:center;line-height:1;">
          <svg width="22" height="22" viewBox="-11 -11 22 22">
            <path d="M0,-9 L4,8 L0,5 L-4,8 Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width="0.7"/>
            <line x1="-3" y1="-2" x2="3" y2="-2" stroke="${color}" stroke-width="1.2"/>
            <line x1="-5" y1="-5" x2="5" y2="-5" stroke="${color}" stroke-width="1.2"/>
          </svg>
        </div>`;
        const icon = L.divIcon({ html, className: "ogn-receiver-icon", iconSize: [22, 22], iconAnchor: [11, 11] });

        const latlng = L.latLng(cfg.latitude, cfg.longitude);
        const tooltipText = `OGN受信機: ${cfg.receiverName || "—"}<br>${online ? "稼働中" : "停止"}${status?.ognGain ? `<br>Gain: ${status.ognGain}` : ""}${status?.noise ? `<br>Noise: ${status.noise}` : ""}`;

        if (!ognReceiverMarkerRef.current) {
          const m = L.marker(latlng, { icon, zIndexOffset: -100 })
            .addTo(currentMap)
            .bindTooltip(tooltipText, { direction: "top", offset: [0, -8], className: "ogn-receiver-tooltip" });
          ognReceiverMarkerRef.current = m;
        } else {
          ognReceiverMarkerRef.current.setLatLng(latlng);
          ognReceiverMarkerRef.current.setIcon(icon);
          ognReceiverMarkerRef.current.setTooltipContent(tooltipText);
        }
      } catch { /* ignore */ }
    }

    update();
    intervalId = setInterval(update, 10000);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (ognReceiverMarkerRef.current && mapRef.current) {
        mapRef.current.removeLayer(ognReceiverMarkerRef.current);
        ognReceiverMarkerRef.current = null;
      }
    };
  }, [mapReady]);

  // Update field marker when airfield settings change
  useEffect(() => {
    const marker = fieldMarkerRef.current;
    if (!marker) return;
    const latlng = L.latLng(airfield.latitude, airfield.longitude);
    marker.setLatLng(latlng);
    marker.setTooltipContent(airfield.name);
  }, [airfield]);

  const unitsRef = useRef(units);
  useEffect(() => {
    unitsRef.current = units;
    for (const [id, ac] of aircraftRef.current) {
      if (ac.adsb) {
        ac.label = ac.position.flight || ac.position.hex || id;
        const color = adsbColor(ac.position);
        const lbls = iconLabels(ac.label, ac.position, units);
        const key = [color, 0, 1, "", "", "", ""].join("|");
        applyIconSmooth(ac, key, ac.position.heading_deg, lbls.top, lbls.bot,
          () => makeAircraftIcon(ac.position.heading_deg, color, false, undefined, true, undefined, undefined, undefined, lbls));
      } else {
        ac.label = resolveLabel(ac.position, id, units.displayName);
        const { airfield: af } = units;
        const alert = getAlert(ac.position, units.safeGlideRatio, af.latitude, af.longitude, af.elevation_m);
        let color = alertColor(alert);
        const blink = alert === "danger";
        // Landing approach override
        if (phasesRef.current[id] && phasesRef.current[id] !== "ground" && alert === "normal" && ac.position.altitude_m < GROUND_ALT_M + af.elevation_m) {
          color = COLOR_LOW;
        }
        const dbRec = lookupDbRecord(aircraftDbRef.current, id, ac.position.glider_id);
        const reg = dbRec?.registration || ac.position.glider_id || ac.position.competition_id;
        const lbls = iconLabels(ac.label, ac.position, units);
        const key = [color, blink ? 1 : 0, 0, dbRec?.aircraft_type || "", ac.position.glider_type || "", reg || "", ac.position.aircraft_type || ""].join("|");
        applyIconSmooth(ac, key, ac.position.heading_deg, lbls.top, lbls.bot,
          () => makeAircraftIcon(ac.position.heading_deg, color, blink, ac.position.glider_type, false, reg, ac.position.aircraft_type, dbRec?.aircraft_type, lbls));
      }
    }
  }, [units]);

  const handlePosition = useCallback(
    (deviceId: string, pos: AircraftPosition) => {
      const map = mapRef.current;
      if (!map) return;

      const isAdsb = !!pos.adsb;
      const aircraft = aircraftRef.current;
      const existing = aircraft.get(deviceId);
      const u = unitsRef.current;

      // 復号エラーで壊れた位置は表示しない（マーカーも航跡も動かさない）
      if (
        !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude) ||
        Math.abs(pos.latitude) > 90 || Math.abs(pos.longitude) > 180 ||
        pos.altitude_m < MIN_ALTITUDE_M || pos.altitude_m > MAX_ALTITUDE_M
      ) {
        return;
      }

      // RND(ランダムID/EPRA)は毎ビーコンで別IDになり追跡不能なプライバシー機。
      // 個体マーカー/航跡/DB自動登録は作らず、場所クラスタに匿名「?」を1個だけ非永続表示する。
      // (OGN/FLARM の opt-in/opt-out 原則に準拠。ogn.ezoe.net と同じ扱い)
      if (deviceId.startsWith("RND")) {
        const key = `${pos.latitude.toFixed(3)},${pos.longitude.toFixed(3)}`;
        const anonLatLng = L.latLng(pos.latitude, pos.longitude);
        const cell = anonRef.current.get(key);
        if (cell) {
          cell.marker.setLatLng(anonLatLng);
          cell.lastMs = Date.now();
        } else {
          const marker = L.marker(anonLatLng, { icon: makeAnonIcon(), interactive: false, keyboard: false, zIndexOffset: -1000 }).addTo(map);
          anonRef.current.set(key, { marker, lastMs: Date.now() });
        }
        return;
      }

      const nowMsIn = Date.now();
      if (existing) {
        const rejects = rejectCountsRef.current[deviceId] || 0;
        if (
          rejects < MAX_CONSECUTIVE_REJECTS &&
          !isPlausiblePosition(existing.position, pos, existing.lastUpdateMs, nowMsIn, isAdsb)
        ) {
          rejectCountsRef.current[deviceId] = rejects + 1;
          console.warn(`[POS] implausible position ignored: ${deviceId}`);
          return;
        }
        rejectCountsRef.current[deviceId] = 0;
      }

      const latlng = L.latLng(pos.latitude, pos.longitude);

      // Aircraft DB lookup — first by device_id, then by registration (for history replay)
      const dbRec = lookupDbRecord(aircraftDbRef.current, deviceId, pos.glider_id);
      const dbType = dbRec?.aircraft_type;

      // Auto-register unknown non-ADS-B aircraft
      if (!isAdsb && !dbRec && !pendingAutoRegister.current.has(deviceId)) {
        pendingAutoRegister.current.add(deviceId);
        fetch("/api/aircraft-db", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_ids: [deviceId] }),
        }).then(() => fetch("/api/aircraft-db").then(r => r.json()).then(data => {
          aircraftDbRef.current = data;
        })).catch(() => {}).finally(() => pendingAutoRegister.current.delete(deviceId));
      }

      // Override pos fields from DB if available
      const effectiveRegistration = dbRec?.registration || pos.glider_id || pos.competition_id;
      const effectiveGliderType = dbRec?.glider_type || pos.glider_type;
      const effectivePilot = dbRec?.pilot || pos.pilot;
      const effectiveCompId = dbRec?.competition_id || pos.competition_id;

      let label: string;
      let color: string;
      let blink = false;

      if (isAdsb) {
        label = pos.flight || pos.hex || deviceId;
        color = adsbColor(pos);
      } else {
        // Use DB info for label resolution
        const labelPos = { ...pos, glider_id: effectiveRegistration, glider_type: effectiveGliderType, pilot: effectivePilot, competition_id: effectiveCompId };
        label = resolveLabel(labelPos, deviceId, u.displayName);
        const alert = getAlert(pos, u.safeGlideRatio, u.airfield.latitude, u.airfield.longitude, u.airfield.elevation_m);
        color = alertColor(alert);
        blink = alert === "danger";
        const phase = phasesRef.current[deviceId];
        if (phase && phase !== "ground" && alert === "normal" && pos.altitude_m < GROUND_ALT_M + u.airfield.elevation_m) {
          color = COLOR_LOW;
        }
      }

      const lbls = iconLabels(label, pos, unitsRef.current);
      const iconKey = [color, blink ? 1 : 0, isAdsb ? 1 : 0, dbType || "", pos.glider_type || "", effectiveRegistration || "", pos.aircraft_type || ""].join("|");
      if (existing) {
        existing.position = pos;
        existing.label = label;
        existing.lastUpdateMs = Date.now();
        existing.adsb = isAdsb;
        applyIconSmooth(existing, iconKey, pos.heading_deg, lbls.top, lbls.bot,
          () => makeAircraftIcon(pos.heading_deg, color, blink, pos.glider_type, isAdsb, effectiveRegistration, pos.aircraft_type, dbType, lbls));
        const nowMs = Date.now();
        drSetFix(existing, pos.latitude, pos.longitude, pos.ground_speed_ms, pos.heading_deg, positionTimeMs(pos, nowMs));
        addTrailPoint(existing, latlng, positionTimeMs(pos, nowMs), nowMs);
        existing.trail.setStyle({ color });
      } else {
        const marker = L.marker(latlng, {
          icon: makeAircraftIcon(pos.heading_deg, color, blink, pos.glider_type, isAdsb, effectiveRegistration, pos.aircraft_type, dbType, lbls),
        }).addTo(map);

        marker.on("click", () => setSelectedAircraft(deviceId));

        const trail = L.polyline([latlng], { color, weight: 2, opacity: 0.6 }).addTo(map);

        const createdMs = Date.now();
        const rec: TrackedAircraft = {
          position: pos,
          marker,
          trail,
          trailPoints: [{ latlng, arrivalMs: createdMs, posMs: positionTimeMs(pos, createdMs) }],
          label,
          lastUpdateMs: createdMs,
          adsb: isAdsb,
          dispHeading: pos.heading_deg,
          iconKey,
        };
        aircraft.set(deviceId, rec);
        drSetFix(rec, pos.latitude, pos.longitude, pos.ground_speed_ms, pos.heading_deg, positionTimeMs(pos, createdMs));
      }

      // 離着陸・離脱の検知はサーバ側 (src/lib/flight-tracker.ts) が行う。
      // ブラウザで計算すると、ページを開いていない間は記録されず、複数の
      // ブラウザが共有ログを上書きし合う。ここは表示だけを受け持つ。
      setAircraftCount(aircraft.size);
      setUpdateTick((t) => t + 1);
    },
    []
  );

  const handleAircraftList = useCallback((list: AircraftList) => {
    const isAdsbList = !!(list as unknown as Record<string, unknown>).adsb;
    const activeIds = new Set(list.aircraft.map((a) => a.device_id));
    const aircraft = aircraftRef.current;
    const map = mapRef.current;
    for (const [id, ac] of aircraft) {
      // Only remove aircraft of the same type (FLARM list removes FLARM, ADS-B list removes ADS-B)
      if (isAdsbList !== !!ac.adsb) continue;
      if (!activeIds.has(id)) {
        drDrop(ac);
        map?.removeLayer(ac.marker);
        map?.removeLayer(ac.trail);
        aircraft.delete(id);
      }
    }
    setAircraftCount(aircraft.size);

    // Extract position-unknown aircraft from ADS-B list for sidebar display
    if (isAdsbList) {
      const noPos: AircraftPosition[] = [];
      for (const ac of list.aircraft) {
        const pos = ac.latest_position;
        if (pos && pos.adsb && pos.has_position === false && pos.altitude_m > 0) {
          noPos.push(pos);
        }
      }
      setNoPositionAircraft(noPos);
    }
  }, []);

  useEffect(() => {
    const client = mqtt.connect(MQTT_WS_URL, {
      clientId: `ogn-webapp-${Math.random().toString(36).slice(2, 8)}`,
      reconnectPeriod: 3000,
    });

    client.on("connect", async () => {
      setConnected(true);
      const rid = await detectReceiverId();
      client.subscribe(topicFor(rid, "aircraft", "+", "position"));
      client.subscribe(topicFor(rid, "aircraft"));
      client.subscribe(topicFor(rid, "aircraft_adsb"));
      client.subscribe(topicFor(rid, "status"));
    });
    client.on("close", () => setConnected(false));
    client.on("message", (topic: string, payload: Buffer) => {
      try {
        const data = JSON.parse(payload.toString());
        const parts = topic.split("/");
        if (parts.length === 5 && parts[4] === "position") handlePosition(parts[3], data as AircraftPosition);
        else if (parts.length === 3 && parts[2] === "aircraft") handleAircraftList(data as AircraftList);
        else if (parts.length === 3 && parts[2] === "aircraft_adsb") handleAircraftList(data as AircraftList);
        else if (parts.length === 3 && parts[2] === "status") setReceiverStatus(data as ReceiverStatus);
      } catch { /* ignore */ }
    });

    clientRef.current = client;
    return () => { client.end(); clientRef.current = null; };
  }, [handlePosition, handleAircraftList]);

  // ── Open ADS-B (公開 adsb.lol) レイヤ ──
  // 設定「OpenなADS-Bを追加」ON のとき /api/open-adsb を5秒ごとにポーリングし、
  // 受信機不要で空港周辺(半径250nm)の ADS-B 機を青色で表示する。MQTT の
  // ローカル ADS-B(aircraft_adsb) とは独立管理で、同一機(device_id)が MQTT 側に
  // 居れば重複表示しない(MQTT を優先)。フライトログには関与しない(表示のみ)。
  const clearOpenAdsb = useCallback(() => {
    const map = mapRef.current;
    for (const [, e] of openAdsbRef.current) { drDrop(e); map?.removeLayer(e.marker); map?.removeLayer(e.trail); }
    openAdsbRef.current.clear();
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    if (!units.openAdsb) { clearOpenAdsb(); return; }
    let stopped = false;
    const lat = units.airfield.latitude;
    const lon = units.airfield.longitude;

    async function pollOpenAdsb() {
      const map = mapRef.current;
      if (!map || stopped) return;
      let data: { aircraft?: OpenAdsbAircraft[] } = {};
      try {
        const res = await fetch(`/api/open-adsb?lat=${lat}&lon=${lon}`);
        data = await res.json();
      } catch { return; }
      if (stopped) return;
      const list = data.aircraft || [];
      const seen = new Set<string>();
      for (const a of list) {
        if (a.latitude == null || a.longitude == null) continue;
        // ローカル ADS-B(MQTT) に同一機が居れば表示しない(二重回避)
        if (aircraftRef.current.has(a.device_id)) continue;
        seen.add(a.device_id);
        const latlng = L.latLng(a.latitude, a.longitude);
        const label = a.flight || a.reg || (a.hex ? a.hex.toUpperCase() : a.device_id);
        const tipPos = { altitude_m: a.altitude_m, ground_speed_ms: a.ground_speed_ms, adsb_mode: a.adsb_mode } as unknown as AircraftPosition;
        const lbls = iconLabels(label, tipPos, unitsRef.current);
        const key = ["openadsb", a.reg || ""].join("|");
        const build = () => makeAircraftIcon(a.heading_deg, COLOR_ADSB, false, undefined, true, a.reg || undefined, undefined, undefined, lbls);
        let e = openAdsbRef.current.get(a.device_id);
        if (!e) {
          const marker = L.marker(latlng, { icon: build() }).addTo(map);
          const trail = L.polyline([], { color: COLOR_ADSB, weight: 2, opacity: 0.5, dashArray: "4,3" }).addTo(map);
          e = { marker, trail, dispHeading: a.heading_deg, iconKey: key };
          openAdsbRef.current.set(a.device_id, e);
        } else {
          applyIconSmooth(e, key, a.heading_deg, lbls.top, lbls.bot, build);
        }
        drSetFix(e, a.latitude, a.longitude, a.ground_speed_ms, a.heading_deg);
        e.trail.setLatLngs((a.trail || []).map((p) => L.latLng(p[0], p[1])));
      }
      // 一覧から消えた機体を除去
      for (const [id, e] of openAdsbRef.current) {
        if (!seen.has(id)) { drDrop(e); map.removeLayer(e.marker); map.removeLayer(e.trail); openAdsbRef.current.delete(id); }
      }
    }

    pollOpenAdsb();
    const iv = setInterval(pollOpenAdsb, 5000);
    return () => { stopped = true; clearInterval(iv); clearOpenAdsb(); };
  }, [units.openAdsb, units.airfield.latitude, units.airfield.longitude, mapReady, clearOpenAdsb]);

  // ── Open OGN (ogn.ezoe.net) レイヤ ──
  // 設定「OpenなOGNを追加」ON のとき /api/open-ogn を5秒ごとにポーリングし、空港中心
  // 50海里の OGN 機を緑グライダーで表示。ローカル受信(aircraftRef)に同一機(hex一致)が
  // 居れば表示しない(=ローカル優先マージ)。表示のみでフライトログ/DB登録には不関与。
  const clearOpenOgn = useCallback(() => {
    const map = mapRef.current;
    for (const [, e] of openOgnRef.current) { drDrop(e); map?.removeLayer(e.marker); }
    openOgnRef.current.clear();
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    if (!units.openOgn) { clearOpenOgn(); return; }
    let stopped = false;
    const lat = units.airfield.latitude;
    const lon = units.airfield.longitude;

    async function pollOpenOgn() {
      const map = mapRef.current;
      if (!map || stopped) return;
      let data: { aircraft?: OpenOgnAircraft[] } = {};
      try {
        const res = await fetch(`/api/open-ogn?lat=${lat}&lon=${lon}`);
        data = await res.json();
      } catch { return; }
      if (stopped) return;
      const list = data.aircraft || [];
      // ローカル(直接受信)の hex 集合。ローカル優先で同一機は出さない。
      const localHexes = new Set<string>();
      for (const key of aircraftRef.current.keys()) {
        const h = hexAddress(key);
        if (h) localHexes.add(h);
      }
      const seen = new Set<string>();
      for (const a of list) {
        if (a.latitude == null || a.longitude == null) continue;
        const hex = hexAddress(a.device_id);
        if (!hex || localHexes.has(hex)) continue; // ローカルにあれば出さない(優先)
        seen.add(hex);
        const latlng = L.latLng(a.latitude, a.longitude);
        // APRS単体では登録番号が無いので、端末の機体DB(OGN DDB/FlarmNet)で補完する
        const dbRec = lookupDbRecord(aircraftDbRef.current, a.device_id);
        const label = dbRec?.registration || dbRec?.competition_id || hex;
        const tipPos = { altitude_m: a.altitude_m ?? 0, ground_speed_ms: a.ground_speed_ms } as unknown as AircraftPosition;
        const lbls = iconLabels(label, tipPos, unitsRef.current);
        const key = ["openogn", dbRec?.aircraft_type || "", dbRec?.glider_type || "", dbRec?.registration || ""].join("|");
        const build = () => makeAircraftIcon(a.heading_deg, COLOR_NORMAL, false, dbRec?.glider_type, false, dbRec?.registration || undefined, undefined, dbRec?.aircraft_type, lbls);
        let e = openOgnRef.current.get(hex);
        if (!e) {
          const marker = L.marker(latlng, { icon: build() }).addTo(map);
          e = { marker, dispHeading: a.heading_deg, iconKey: key };
          openOgnRef.current.set(hex, e);
        } else {
          applyIconSmooth(e, key, a.heading_deg, lbls.top, lbls.bot, build);
        }
        drSetFix(e, a.latitude, a.longitude, a.ground_speed_ms, a.heading_deg);
      }
      for (const [hex, e] of openOgnRef.current) {
        if (!seen.has(hex)) { drDrop(e); map.removeLayer(e.marker); openOgnRef.current.delete(hex); }
      }
    }

    pollOpenOgn();
    const iv = setInterval(pollOpenOgn, 5000);
    return () => { stopped = true; clearInterval(iv); clearOpenOgn(); };
  }, [units.openOgn, units.airfield.latitude, units.airfield.longitude, mapReady, clearOpenOgn]);

  // ── 推測航法の描画ループ(全レイヤ共通・単一rAF・約30fps) ──
  // タブ非表示中は停止(fix受信時に drSetFix がスナップするので復帰時も位置は正しい)。
  // 画面外の機体は補間せず直接追従して負荷を抑える。
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (tNow: number) => {
      raf = requestAnimationFrame(frame);
      if (tNow - last < 33) return; // ~30fps(多数のADS-B機でも負荷を抑える)
      const dt = tNow - last;
      last = tNow;
      const map = mapRef.current;
      if (!map || document.hidden || drItems.size === 0) return;
      const dtS = dt / 1000;
      const now = Date.now();
      const kConv = 1 - Math.exp(-dt / DR_TAU_MS); // フレーム毎の収束率(静止時/横ズレ用)
      const bounds = map.getBounds().pad(0.2);
      for (const rec of drItems) {
        const f = rec.fix;
        if (!f) { drItems.delete(rec); continue; }
        // 目標点 = fixを実測速度ベクトルで外挿(上限あり)した「今いるはずの位置」
        const ageS = Math.min(Math.max(now - f.t, 0), DR_EXTRAP_MAX_MS) / 1000;
        const mLat = 111320;
        const mLon = 111320 * Math.cos((f.lat * Math.PI) / 180);
        const tLat = f.lat + (f.vN * ageS) / mLat;
        const tLon = f.lon + (f.vE * ageS) / mLon;
        const cur = rec.marker.getLatLng();
        if (!bounds.contains(cur)) { rec.marker.setLatLng([tLat, tLon]); continue; } // 画面外は直接追従
        const dN = (tLat - cur.lat) * mLat; // 目標までのズレ(m)
        const dE = (tLon - cur.lng) * mLon;
        const vAvg = rec.vAvg || 0;
        let stepN: number, stepE: number;
        if (vAvg < DR_SPD_MIN) {
          // ほぼ静止(地上): GPSゆらぎ程度なので単純収束(後退の概念なし)
          stepN = dN * kConv;
          stepE = dE * kConv;
        } else {
          // 飛行中: 表示機首の方向へ平均速度で前進。前後ズレは増減速のみで吸収(下限0=バック禁止)
          const hd = ((rec.dispHeading != null ? rec.dispHeading : 0) * Math.PI) / 180;
          const uN = Math.cos(hd), uE = Math.sin(hd);
          const gapAlong = dN * uN + dE * uE; // 進行方向の前後ズレ(+=遅れ/-=行き過ぎ)
          const vCmd = Math.min(Math.max(vAvg + gapAlong / DR_CATCH_S, 0), vAvg * 1.4);
          stepN = uN * vCmd * dtS;
          stepE = uE * vCmd * dtS;
          // 横ズレ(進行方向と直交)はレート制限つきで経路へ寄せる
          let lN = (dN - gapAlong * uN) * kConv;
          let lE = (dE - gapAlong * uE) * kConv;
          const lMag = Math.hypot(lN, lE);
          const lMax = Math.max(0.5 * vAvg, 5) * dtS; // 横補正の最大速度
          if (lMag > lMax) { lN *= lMax / lMag; lE *= lMax / lMag; }
          stepN += lN;
          stepE += lE;
        }
        if (Math.abs(stepN) < 0.01 && Math.abs(stepE) < 0.01) continue; // 静止+収束済み
        rec.marker.setLatLng([cur.lat + stepN / mLat, cur.lng + stepE / mLon]);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); drItems.clear(); };
  }, []);

  // ── タブ復帰時のスナップ(非表示中に溜まった回転を復帰時に一気に再生しない) ──
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) return;
      const recs: SmoothMarkerRec[] = [
        ...aircraftRef.current.values(),
        ...openAdsbRef.current.values(),
        ...openOgnRef.current.values(),
      ];
      for (const rec of recs) {
        if (rec.dispHeading != null) rotateMarkerSmooth(rec, ((rec.dispHeading % 360) + 360) % 360, true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ── 同心円(滑空場中心・5km毎・30kmまで・点線)。設定「同心円表示」でON/OFF ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !units.rangeRings) return;
    const lat = units.airfield.latitude;
    const lon = units.airfield.longitude;
    const group = L.layerGroup();
    for (let km = 5; km <= 30; km += 5) {
      L.circle([lat, lon], {
        radius: km * 1000,
        color: "#607d8b", weight: 1.2, opacity: 0.55,
        fill: false, dashArray: "6,6", interactive: false,
        pane: "airfieldPane",
      }).addTo(group);
      // 距離ラベル(円の真北)
      L.marker([lat + km / 111.195, lon], {
        icon: L.divIcon({ html: `<div class="ring-label">${km}km</div>`, className: "", iconSize: [40, 14], iconAnchor: [20, 7] }),
        interactive: false, keyboard: false, pane: "airfieldPane",
      }).addTo(group);
    }
    group.addTo(map);
    return () => { map.removeLayer(group); };
  }, [mapReady, units.rangeRings, units.airfield.latitude, units.airfield.longitude]);

  // ── 選択機体の「このフライト」の航跡(実線)。地図の余白クリックで選択解除→消える ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedAircraft) return;
    const device = selectedAircraft;
    const m: L.Map = map;
    let stopped = false;
    async function draw() {
      try {
        const r = await fetch(`/api/flight-track?device=${encodeURIComponent(device)}`);
        const d = await r.json();
        if (stopped) return;
        const pts = (d.points || []) as [number, number][];
        if (pts.length > 1) {
          if (trackLineRef.current) trackLineRef.current.setLatLngs(pts);
          else trackLineRef.current = L.polyline(pts, { color: "#1565c0", weight: 3, opacity: 0.85, interactive: false }).addTo(m);
        }
      } catch { /* noop */ }
    }
    draw();
    const iv = setInterval(draw, 5000);   // 飛行中は航跡が伸びるので追随
    return () => {
      stopped = true;
      clearInterval(iv);
      if (trackLineRef.current) { map.removeLayer(trackLineRef.current); trackLineRef.current = null; }
    };
  }, [selectedAircraft, mapReady]);

  // RND(匿名)マーカーの掃除。一定時間 受信の無いクラスタを消す(非永続)。
  useEffect(() => {
    const iv = setInterval(() => {
      const map = mapRef.current;
      const now = Date.now();
      for (const [key, cell] of anonRef.current) {
        if (now - cell.lastMs > ANON_TTL_MS) { map?.removeLayer(cell.marker); anonRef.current.delete(key); }
      }
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  // フライトログの自動スクロール。
  // 記録は3秒ごとに取り直すため、無条件に末尾へ送ると、過去を遡っている最中に
  // 引き戻されて読めない。末尾に貼り付いているときだけ追従する。
  useEffect(() => {
    const el = logTableRef.current;
    if (el && logAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [flightLog]);

  /** 末尾から少しでも離れたら追従をやめ、戻ってきたら再開する */
  const onLogScroll = useCallback(() => {
    const el = logTableRef.current;
    if (!el) return;
    const slack = el.scrollHeight - el.scrollTop - el.clientHeight;
    logAtBottomRef.current = slack <= 24;
  }, []);

  // ── Resize handlers ──
  const startDragSidebar = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const w = Math.max(200, Math.min(500, startW + delta));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setSidebarWidth((w) => { localStorage.setItem("ogn-sidebar-width", String(w)); return w; });
      mapRef.current?.invalidateSize();
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const startDragLog = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = logHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const h = Math.max(60, Math.min(400, startH + delta));
      setLogHeight(h);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setLogHeight((h) => { localStorage.setItem("ogn-log-height", String(h)); return h; });
      mapRef.current?.invalidateSize();
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [logHeight]);

  // ── Categorize aircraft ──
  const allAircraft = Array.from(aircraftRef.current.entries());

  const { latitude: fLat, longitude: fLon, elevation_m: fElev } = airfield;

  // 地上か上空かは、離着陸を実際に判定しているサーバ側の phase を使う。
  // 画面側でも高度の閾値を持つと判定が二重になり、必ずどこかでずれる。
  // 実際、素の海抜 100m と比べていたため滑空場の標高が抜けており、標高 23m の
  // たきかわでは対地 77m——まだ進入中——で地上リストへ落ちていた。
  // 標高 100m を超える滑空場では全機が地上扱いになる。
  // サーバがまだ見ていない機体（受信開始時から飛んでいる等）だけ高度で補う。
  const isAirborne = (id: string, ac: TrackedAircraft): boolean => {
    const phase = phasesRef.current[id];
    if (phase) return phase !== "ground";
    return ac.position.altitude_m >= GROUND_ALT_M + fElev;
  };

  const isLost = (id: string, ac: TrackedAircraft) =>
    isAirborne(id, ac) && (now - ac.lastUpdateMs) > LOST_SIGNAL_SEC * 1000;

  // "Danger" = lost signal OR insufficient glide path (while airborne) — FLARM only
  const dangerList = allAircraft.filter(([id, ac]) =>
    !ac.adsb &&
    isAirborne(id, ac) &&
    (isLost(id, ac) || isDanger(ac.position, units.safeGlideRatio, fLat, fLon, fElev))
  );
  const airborne = allAircraft.filter(([id, ac]) =>
    !ac.adsb &&
    isAirborne(id, ac) &&
    !isLost(id, ac) &&
    !isDanger(ac.position, units.safeGlideRatio, fLat, fLon, fElev)
  );
  // ADS-B は飛行記録の検知対象外（サーバ側 phase を持たない）ので高度で見る
  const adsbAirborne = allAircraft.filter(([, ac]) => ac.adsb && ac.position.altitude_m >= GROUND_ALT_M + fElev);
  const ground = allAircraft.filter(([id, ac]) => !ac.adsb && !isAirborne(id, ac));

  const selectedDetail = selectedAircraft
    ? aircraftRef.current.get(selectedAircraft)
    : null;

  const lowAltM = LOW_ALT_FT * 0.3048 + fElev;
  function isLowAlt(alt_m: number): boolean {
    return alt_m >= GROUND_ALT_M + fElev && alt_m < lowAltM;
  }

  return (
    <>
      <div className="flex flex-1 min-h-0 rounded-md overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
        {/* Left column: Map + Flight Log */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Map */}
          <div className="flex-1 relative min-h-0">
            <div ref={mapContainerRef} className="w-full h-full" />
            <div className="absolute top-2.5 right-2.5 z-[1000] flex flex-col gap-1 items-end">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const hv = homeView.lat !== 0 ? homeView : { lat: airfield.latitude, lng: airfield.longitude, zoom: 11 };
                    mapRef.current?.setView([hv.lat, hv.lng], hv.zoom);
                  }}
                  className="px-2.5 py-1.5 text-xs rounded font-semibold"
                  style={{
                    background: "#fff",
                    color: "var(--color-text-primary)",
                    border: "1px solid var(--color-border)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                  }}
                >
                  HOME
                </button>
                <HelpHint sectionId="map-home-save" title="HOME / 保存ボタンの説明" />
              </div>
              <button
                onClick={() => {
                  const map = mapRef.current;
                  if (!map) return;
                  const c = map.getCenter();
                  const z = map.getZoom();
                  const hv = { lat: c.lat, lng: c.lng, zoom: z };
                  setHomeView(hv);
                  try { localStorage.setItem("ogn-home-view", JSON.stringify(hv)); } catch { /* ignore */ }
                }}
                className="px-2.5 py-1 text-[10px] rounded"
                style={{
                  background: "#fff",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                }}
                title="現在のビューをHOMEとして保存"
              >
                保存
              </button>
            </div>

            {/* 機体の詳細パネル(地図右上)。地図の余白クリックで自動的に閉じる */}
            {selectedDetail && (() => {
              const selDb = selectedAircraft ? lookupDbRecord(aircraftDbRef.current, selectedAircraft, selectedDetail.position.glider_id) : undefined;
              const selGliderType = selDb?.glider_type || selectedDetail.position.glider_type;
              const selRegistration = selDb?.registration || selectedDetail.position.glider_id;
              const selCompId = selDb?.competition_id || selectedDetail.position.competition_id;
              const selPilot = selDb?.pilot || selectedDetail.position.pilot;
              const selAircraftType = selDb?.aircraft_type;
              const typeLabel = selAircraftType ? (AIRCRAFT_TYPE_OPTIONS.find(o => o.value === selAircraftType)?.label) : undefined;
              return (
              <div
                className="absolute z-[1000] rounded-md p-3"
                style={{
                  top: 84,
                  right: 10,
                  width: 236,
                  maxHeight: "calc(100% - 100px)",
                  overflowY: "auto",
                  background: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>
                    {selCompId || selRegistration || selectedAircraft}
                  </span>
                  <button
                    onClick={() => setSelectedAircraft(null)}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      background: "var(--color-bg-tertiary)",
                      color: "var(--color-text-secondary)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    閉じる
                  </button>
                </div>
                {selGliderType && (
                  <DetailRow label="機種名" value={selGliderType} />
                )}
                {selRegistration && (
                  <DetailRow label="登録番号" value={selRegistration} />
                )}
                {selCompId && (
                  <DetailRow label="CN" value={selCompId} />
                )}
                {typeLabel && (
                  <DetailRow label="航空機タイプ" value={typeLabel} />
                )}
                {selPilot && (
                  <DetailRow label="パイロット" value={selPilot} />
                )}
                <DetailRow label="高度" value={formatAltitude(selectedDetail.position.altitude_m, units.altitude)} />
                <DetailRow label="速度" value={formatSpeed(selectedDetail.position.ground_speed_ms, units.speed)} />
                <DetailRow label="上昇率" value={formatClimbRate(selectedDetail.position.climb_rate_ms, units.climbRate)} />
                <DetailRow label="方位" value={`${selectedDetail.position.heading_deg.toFixed(0)}°`} />
                <DetailRow label="旋回" value={`${selectedDetail.position.turn_rate_degs.toFixed(1)}°/s`} />
                <DetailRow
                  label="パス(L/D)"
                  value={(() => {
                    const h = selectedDetail.position.altitude_m - fElev;
                    if (h <= 0) return "—";
                    const d = haversineM(fLat, fLon,
                      selectedDetail.position.latitude, selectedDetail.position.longitude);
                    return `${(d / h).toFixed(1)} (必要 ≤${units.safeGlideRatio})`;
                  })()}
                />
              </div>
              );
            })()}
          </div>

          {/* Resize handle: Map ↔ Flight Log */}
          <div
            onMouseDown={startDragLog}
            className="shrink-0 flex items-center justify-center"
            style={{
              height: 6,
              cursor: "row-resize",
              background: "var(--color-border)",
            }}
          >
            <div style={{ width: 32, height: 2, borderRadius: 1, background: "var(--color-text-secondary)", opacity: 0.4 }} />
          </div>

          {/* Flight Log Table */}
          <div
            className="shrink-0 flex flex-col"
            style={{
              height: logHeight,
              background: "var(--color-bg-secondary)",
            }}
          >
            <div
              className="px-3 py-1.5 text-xs font-semibold shrink-0 flex items-center gap-2"
              style={{ background: "var(--color-bg-tertiary)", color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)" }}
            >
              フライトログ
              <span className="font-normal" style={{ color: "var(--color-text-secondary)" }}>({flightLog.length}件)</span>
              <HelpHint sectionId="map-flight-log" title="フライトログの説明" />
            </div>
            <div
              ref={logTableRef}
              onScroll={onLogScroll}
              className="overflow-y-auto flex-1"
            >
              <table className="text-xs w-full table-striped" style={{ tableLayout: "auto", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--color-bg-tertiary)", position: "sticky", top: 0, zIndex: 1 }}>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>#</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>登録番号</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>離陸</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>着陸</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>飛行時間</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>離脱高度</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>離脱距離</th>
                    <th className="px-0.5 py-1 text-xs" style={{ borderBottom: "1px solid var(--color-border)" }} />
                  </tr>
                </thead>
                <tbody>
                  {flightLog.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-2 text-center" style={{ color: "var(--color-text-secondary)" }}>
                        フライトデータなし
                      </td>
                    </tr>
                  ) : (
                    flightLog.map((entry, i) => (
                      <tr
                        key={`${entry.deviceId}-${i}`}
                      >
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>{i + 1}</td>
                        <td className="px-1 py-0.5 font-semibold whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>{(() => {
                          // 登録番号の後ろにコンテストナンバーを括弧で併記(例: JA03KH (KH))。CN未登録は従来表示
                          const cn = lookupDbRecord(aircraftDbRef.current, entry.deviceId, entry.registration)?.competition_id;
                          return cn && cn !== entry.registration ? `${entry.registration} (${cn})` : entry.registration;
                        })()}</td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          <input
                            type="text"
                            value={entry.takeoffTime}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (/^\d{0,2}:?\d{0,2}$/.test(val) || val === "") {
                                const updated = [...flightLog];
                                updated[i] = { ...updated[i], takeoffTime: val };
                                flightLogRef.current = updated;
                                setFlightLog(updated);
                              }
                            }}
                            className="tabular-nums bg-transparent border-b px-0 py-0 text-xs w-[3.2em]"
                            style={{ borderColor: "var(--color-border)", outline: "none", color: "inherit" }}
                          />
                        </td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          {entry.landingTime != null ? (
                            <input
                              type="text"
                              value={entry.landingTime}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (/^\d{0,2}:?\d{0,2}$/.test(val) || val === "") {
                                  const updated = [...flightLog];
                                  updated[i] = { ...updated[i], landingTime: val };
                                  flightLogRef.current = updated;
                                  setFlightLog(updated);
                                }
                              }}
                              className="tabular-nums bg-transparent border-b px-0 py-0 text-xs w-[3.2em]"
                              style={{ borderColor: "var(--color-border)", outline: "none", color: "inherit" }}
                            />
                          ) : (
                            <span className="font-semibold" style={{ color: "var(--color-success)" }}>飛行中</span>
                          )}
                        </td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          {calcFlightDuration(entry.takeoffTime, entry.landingTime) || "—"}
                        </td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          <ReleaseAltInput
                                releaseAlt={entry.releaseAlt}
                                inferred={entry.releaseInferred === true}
                                altUnit={units.altitude}
                                onChange={(newAlt) => {
                                  const updated = [...flightLog];
                                  updated[i] = { ...updated[i], releaseAlt: newAlt, releaseInferred: false };
                                  flightLogRef.current = updated;
                                  setFlightLog(updated);
                                }}
                              />
                        </td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          <ReleaseDistInput
                                releaseDist={entry.releaseDist}
                                distUnit={units.distance}
                                onChange={(newDist) => {
                                  const updated = [...flightLog];
                                  // releaseInferred は離脱高度が曳航機由来かを表す印なので、
                                  // 距離だけを直したときは触らない（※の意味が変わってしまう）
                                  updated[i] = { ...updated[i], releaseDist: newDist };
                                  flightLogRef.current = updated;
                                  setFlightLog(updated);
                                }}
                              />
                        </td>
                        <td className="px-0.5 py-0.5 whitespace-nowrap text-center" style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <button
                            onClick={() => {
                              if (!confirm("本当に消しますか？")) return;
                              const updated = flightLog.filter((_, idx) => idx !== i);
                              flightLogRef.current = updated;
                              setFlightLog(updated);
                            }}
                            className="text-base leading-none hover:opacity-70 cursor-pointer"
                            style={{ color: "var(--color-danger)", filter: "drop-shadow(0 0 1px rgba(211,47,47,0.4))" }}
                            title="削除"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Resize handle: Map ↔ Sidebar */}
        <div
          onMouseDown={startDragSidebar}
          className="shrink-0 flex items-center justify-center"
          style={{
            width: 6,
            cursor: "col-resize",
            background: "var(--color-border)",
          }}
        >
          <div style={{ height: 32, width: 2, borderRadius: 1, background: "var(--color-text-secondary)", opacity: 0.4 }} />
        </div>

        {/* Status view sidebar */}
        <div
          className="shrink-0 flex flex-col overflow-y-auto"
          style={{
            width: sidebarWidth,
            background: "var(--color-bg-secondary)",
          }}
        >
          {/* Danger section (通信途絶 / パス不足) */}
          {dangerList.length > 0 && (
            <div style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div
                className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                style={{ background: "var(--color-danger-dim)", color: COLOR_DANGER }}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_DANGER }} />
                警告 ({dangerList.length})
                <HelpHint sectionId="map-path-warning" title="警告の判定基準" />
              </div>
              {dangerList.map(([id, ac]) => {
                const lost = isLost(id, ac);
                const secAgo = lost ? Math.round((now - ac.lastUpdateMs) / 1000) : 0;
                const h = ac.position.altitude_m - fElev;
                const d = haversineM(fLat, fLon, ac.position.latitude, ac.position.longitude);
                const ratio = h > 0 ? (d / h).toFixed(1) : "—";
                return (
                  <div
                    key={id}
                    onClick={() => {
                      setSelectedAircraft(id);
                      mapRef.current?.setView([ac.position.latitude, ac.position.longitude], 13);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer danger-blink"
                    style={{ borderBottom: "1px solid var(--color-border)", color: COLOR_DANGER }}
                  >
                    <span className="font-semibold min-w-[65px]">{ac.label}</span>
                    <span className="text-[11px] flex-1" style={{ opacity: 0.7 }}>
                      {lost ? `途絶 ${secAgo}秒` : `L/D ${ratio}`}
                    </span>
                    <span className="tabular-nums text-xs font-bold">
                      {formatAltitude(ac.position.altitude_m, units.altitude)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Airborne (上空) */}
          <div style={{ borderBottom: "1px solid var(--color-border)" }}>
            <div
              className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
              style={{ background: "var(--color-bg-tertiary)", color: "var(--color-text-primary)" }}
            >
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_NORMAL }} />
              上空 ({airborne.length})
              <HelpHint sectionId="map-sidebar" title="サイドバーの説明" />
            </div>
            {airborne.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs" style={{ color: "var(--color-text-secondary)" }}>
                上空の機体なし
              </div>
            ) : (
              airborne
                .sort(([, a], [, b]) => b.position.altitude_m - a.position.altitude_m)
                .map(([id, ac]) => {
                  const low = isLowAlt(ac.position.altitude_m);
                  return (
                    <StatusItem
                      key={id}
                      id={id}
                      ac={ac}
                      selected={selectedAircraft === id}
                      units={units}
                      low={low}
                      onClick={() => {
                        setSelectedAircraft(id);
                        mapRef.current?.setView([ac.position.latitude, ac.position.longitude], 13);
                      }}
                      dbGliderType={lookupDbRecord(aircraftDbRef.current, id, ac.position.glider_id)?.glider_type}
                    />
                  );
                })
            )}
          </div>

          {/* ADS-B / Mode-S */}
          {(adsbAirborne.length > 0 || noPositionAircraft.length > 0) && (
            <div style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div
                className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                style={{ background: "var(--color-bg-tertiary)", color: COLOR_ADSB }}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_ADSB }} />
                ADS-B / Mode-S ({adsbAirborne.length + noPositionAircraft.length})
              </div>
              {/* Aircraft with position (on map) */}
              {adsbAirborne
                .sort(([, a], [, b]) => b.position.altitude_m - a.position.altitude_m)
                .map(([id, ac]) => {
                  const c = adsbColor(ac.position);
                  return (
                    <div
                      key={id}
                      onClick={() => {
                        setSelectedAircraft(id);
                        mapRef.current?.setView([ac.position.latitude, ac.position.longitude], 13);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer transition-colors"
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        background: selectedAircraft === id ? "var(--color-accent-light)" : "transparent",
                      }}
                    >
                      <span className="font-semibold min-w-[65px]" style={{ color: c }}>
                        {ac.label}
                      </span>
                      <span className="text-[11px] flex-1" style={{ color: "var(--color-text-secondary)" }}>
                        {ac.position.hex || id.slice(0, 6)}
                      </span>
                      <span className="tabular-nums text-xs text-right min-w-[55px]" style={{ color: c }}>
                        {formatAltitude(ac.position.altitude_m, units.altitude)}
                      </span>
                    </div>
                  );
                })}
              {/* Aircraft without position (sidebar only) */}
              {noPositionAircraft
                .sort((a, b) => b.altitude_m - a.altitude_m)
                .map((pos) => {
                  const label = pos.flight || pos.hex || "????";
                  return (
                    <div
                      key={pos.hex}
                      className="flex items-center gap-2 px-3 py-1.5 text-[13px]"
                      style={{ borderBottom: "1px solid var(--color-border)" }}
                    >
                      <span className="font-semibold min-w-[65px]" style={{ color: COLOR_MODES }}>
                        {label}
                      </span>
                      <span className="text-[11px] flex-1" style={{ color: "var(--color-text-secondary)" }}>
                        位置不明
                      </span>
                      <span className="tabular-nums text-xs text-right min-w-[55px]" style={{ color: COLOR_MODES }}>
                        {formatAltitude(pos.altitude_m, units.altitude)}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Ground (地上) */}
          <div>
            <div
              className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
              style={{ background: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
            >
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_GROUND }} />
              地上 ({ground.length})
            </div>
            {ground.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs" style={{ color: "var(--color-text-secondary)" }}>
                地上の機体なし
              </div>
            ) : (
              ground.map(([id, ac]) => (
                <StatusItem
                  key={id}
                  id={id}
                  ac={ac}
                  selected={selectedAircraft === id}
                  units={units}
                  low={false}
                  onClick={() => {
                    setSelectedAircraft(id);
                    mapRef.current?.setView([ac.position.latitude, ac.position.longitude], 14);
                  }}
                  dbGliderType={lookupDbRecord(aircraftDbRef.current, id, ac.position.glider_id)?.glider_type}
                />
              ))
            )}
          </div>

          {/* Legend */}
          <div className="mt-auto px-3 py-2" style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-bg-tertiary)" }}>
            <div className="text-xs font-semibold mb-1.5 flex items-center" style={{ color: "var(--color-text-primary)" }}>
              凡例
              <HelpHint sectionId="map-icon-colors" title="アイコン色分けの説明" />
            </div>
            <div className="grid grid-cols-1 gap-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_NORMAL }} />
                <span style={{ color: "var(--color-text-secondary)" }}>FLARM（通常）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_LOW }} />
                <span style={{ color: "var(--color-text-secondary)" }}>FLARM（低高度）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_DANGER }} />
                <span style={{ color: "var(--color-text-secondary)" }}>FLARM（警告）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_ADSB }} />
                <span style={{ color: "var(--color-text-secondary)" }}>ADS-B</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_MODES }} />
                <span style={{ color: "var(--color-text-secondary)" }}>Mode-S/C</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div
        className="flex items-center gap-4 px-3 shrink-0 text-xs rounded-md"
        style={{
          height: 26,
          background: "var(--color-bg-tertiary)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-secondary)",
        }}
      >
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: connected ? "var(--color-success)" : "var(--color-danger)" }}
          />
          MQTT {connected ? "接続中" : "切断"}
        </span>
        <span>
          機体数: <strong style={{ color: "var(--color-accent)" }}>{aircraftCount}</strong>
        </span>
        {receiverStatus?.simulated && receiverStatus.simulator && (
          <span
            className="px-2 py-0.5 rounded font-semibold"
            style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)" }}
          >
            履歴再生 {receiverStatus.simulator.speed}x
            {receiverStatus.simulator.loop && " ループ"} — {receiverStatus.simulator.progress_pct.toFixed(0)}%
          </span>
        )}
        {receiverStatus && !receiverStatus.simulated && receiverStatus.online && (
          <span
            className="px-2 py-0.5 rounded font-semibold"
            style={{ background: "var(--color-success-dim)", color: "var(--color-success)" }}
          >
            リアルタイム再生
          </span>
        )}
      </div>
    </>
  );
}

// 機体アイコンに添えるラベル。上=表示名(機番/CN/pilot)、下=高度+速度。
// ogn.ezoe.net と同様に、アイコンの上下へ配置する(描画は makeAircraftIcon)。
function iconLabels(
  label: string,
  pos: AircraftPosition,
  units: { altitude: "m" | "ft"; speed: "km/h" | "knot" },
): { top: string; bot: string } {
  return {
    top: label,
    bot: `${formatAltitude(pos.altitude_m, units.altitude)} ${formatSpeed(pos.ground_speed_ms, units.speed)}`,
  };
}

function StatusItem({
  id,
  ac,
  selected,
  units,
  low,
  onClick,
  dbGliderType,
}: {
  id: string;
  ac: TrackedAircraft;
  selected: boolean;
  units: { altitude: "m" | "ft"; speed: "km/h" | "knot" };
  low: boolean;
  onClick: () => void;
  dbGliderType?: string;
}) {
  const pos = ac.position;
  const labelColor = low ? COLOR_LOW : COLOR_NORMAL;
  const altTextColor = low ? COLOR_LOW : "var(--color-text-primary)";

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer transition-colors ${
        selected ? "status-blink" : ""
      }`}
      style={{
        borderBottom: "1px solid var(--color-border)",
        background: selected
          ? "var(--color-accent-light)"
          : low
          ? "var(--color-warning-dim)"
          : "transparent",
        outline: selected ? "1px solid var(--color-accent)" : "none",
      }}
    >
      <span className="font-semibold min-w-[65px]" style={{ color: labelColor }}>
        {ac.label}
      </span>
      <span className="text-[11px] flex-1" style={{ color: "var(--color-text-secondary)" }}>
        {dbGliderType || pos.glider_type || id.slice(0, 6)}
      </span>
      <span
        className="tabular-nums text-xs text-right min-w-[55px]"
        style={{ color: altTextColor, fontWeight: low ? 700 : 500 }}
      >
        {formatAltitude(pos.altitude_m, units.altitude)}
      </span>
    </div>
  );
}

function ReleaseAltInput({
  releaseAlt,
  inferred,
  altUnit,
  onChange,
}: {
  releaseAlt: number | null;
  /** 曳航機から写した値。自分で測れた値と見分けが付くようにする */
  inferred?: boolean;
  altUnit: "m" | "ft";
  onChange: (alt: number | null) => void;
}) {
  const displayVal = releaseAlt != null
    ? (altUnit === "ft" ? Math.round(releaseAlt * 3.28084).toString() : releaseAlt.toString())
    : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayVal);

  return (
    <>
      <input
        type="text"
        value={editing ? draft : displayVal}
        placeholder="..."
        onFocus={() => { setEditing(true); setDraft(displayVal); }}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "" || /^\d+$/.test(val)) setDraft(val);
        }}
        onBlur={() => {
          setEditing(false);
          if (draft === "") {
            onChange(null);
          } else {
            const num = parseInt(draft, 10);
            if (!isNaN(num)) {
              onChange(altUnit === "ft" ? num / 3.28084 : num);
            }
          }
        }}
        className="tabular-nums bg-transparent border-b px-0 py-0 text-xs text-right w-[4em]"
        style={{ borderColor: "var(--color-border)", outline: "none", color: "inherit" }}
      />
      <span className="text-[10px] ml-0.5" style={{ color: "var(--color-text-secondary)" }}>
        {altUnit === "ft" ? "ft" : "m"}
      </span>
      {inferred && !editing && (
        <span
          className="text-[10px] ml-0.5"
          style={{ color: "var(--color-text-secondary)" }}
          title="曳航機の離脱高度から推定した値です（この機体自身の離脱は検知できませんでした）"
        >
          ※
        </span>
      )}
    </>
  );
}

/**
 * 離脱距離の手入力。値はメートルで持ち、表示と入力は units.distance に合わせる。
 * 高度と同じく、打っている途中では保存せず blur で確定する
 * （飛行ログの保存は配列ごとサーバへ送るので、1文字ごとに送らない）。
 */
function ReleaseDistInput({
  releaseDist,
  distUnit,
  onChange,
}: {
  releaseDist: number | null;
  distUnit: DistanceUnit;
  onChange: (dist: number | null) => void;
}) {
  const perUnit = distUnit === "nm" ? 1852 : 1000;
  const displayVal = releaseDist != null ? (releaseDist / perUnit).toFixed(1) : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayVal);

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        value={editing ? draft : displayVal}
        placeholder="..."
        onFocus={() => { setEditing(true); setDraft(displayVal); }}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "" || /^\d*\.?\d*$/.test(val)) setDraft(val);
        }}
        onBlur={() => {
          setEditing(false);
          if (draft === "" || draft === ".") {
            onChange(null);
          } else {
            const num = parseFloat(draft);
            if (!isNaN(num) && num >= 0) onChange(num * perUnit);
          }
        }}
        className="tabular-nums bg-transparent border-b px-0 py-0 text-xs text-right w-[4em]"
        style={{ borderColor: "var(--color-border)", outline: "none", color: "inherit" }}
      />
      <span className="text-[10px] ml-0.5" style={{ color: "var(--color-text-secondary)" }}>
        {distUnit === "nm" ? "nm" : "km"}
      </span>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

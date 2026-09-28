"use client";

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import {
  UnitPreferences,
  DEFAULT_UNITS,
  loadUnits,
  saveUnits,
  AltitudeUnit,
  SpeedUnit,
  ClimbRateUnit,
  DistanceUnit,
  DisplayNameMode,
  AirfieldConfig,
  AdsbConfig,
  MapSource,
} from "./units";

interface UnitContextType {
  units: UnitPreferences;
  unitsLoaded: boolean;
  setAltitudeUnit: (u: AltitudeUnit) => void;
  setSpeedUnit: (u: SpeedUnit) => void;
  setClimbRateUnit: (u: ClimbRateUnit) => void;
  setDistanceUnit: (u: DistanceUnit) => void;
  setDisplayNameMode: (u: DisplayNameMode) => void;
  setSafeGlideRatio: (v: number) => void;
  setAirfield: (a: AirfieldConfig) => void;
  setAdsb: (a: AdsbConfig) => void;
  setOpenAdsb: (v: boolean) => void;
  setOpenOgn: (v: boolean) => void;
  setRangeRings: (v: boolean) => void;
  setRainRadar: (v: boolean) => void;
  setMapSource: (m: MapSource) => void;
}

const UnitContext = createContext<UnitContextType>({
  units: DEFAULT_UNITS,
  unitsLoaded: false,
  setAltitudeUnit: () => {},
  setSpeedUnit: () => {},
  setClimbRateUnit: () => {},
  setDistanceUnit: () => {},
  setDisplayNameMode: () => {},
  setSafeGlideRatio: () => {},
  setAirfield: () => {},
  setAdsb: () => {},
  setOpenAdsb: () => {},
  setOpenOgn: () => {},
  setRangeRings: () => {},
  setRainRadar: () => {},
  setMapSource: () => {},
});

/**
 * OpenなADS-B/OGN の表示ON/OFF を端末(機体)側へ保存する。表示専用の非機微設定で、
 * サーバ側 view-save も無認証で受ける。失敗は無視（ネットワーク不通でも表示は継続）。
 */
function persistViewConfig(openAdsb: boolean, openOgn: boolean): void {
  fetch("/api/system", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "view-save", openAdsb, openOgn }),
  }).catch(() => {});
}

export function UnitProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<UnitPreferences>(DEFAULT_UNITS);
  const [unitsLoaded, setUnitsLoaded] = useState(false);
  const airfieldSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const airfieldAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const local = loadUnits();
    fetch("/api/system")
      .then((res) => res.json())
      .then((data) => {
        // Server airfield is the source of truth. Display-only unit prefs stay in localStorage.
        const airfield: AirfieldConfig = data.airfield_config ?? local.airfield;
        // OpenなADS-B/OGN は「端末(機体)ごとの設定」。端末に保存があればそれを正本に採用。
        // 無ければ(未設定/旧版) localStorage 値を尊重し、その値で端末を初期化(seed)する。
        const view = data.view_config as { openAdsb?: boolean; openOgn?: boolean } | null | undefined;
        const merged: UnitPreferences = {
          ...local,
          airfield,
          ...(view ? { openAdsb: !!view.openAdsb, openOgn: !!view.openOgn } : {}),
        };
        setUnits(merged);
        saveUnits(merged);
        setUnitsLoaded(true);
        if (!view) persistViewConfig(merged.openAdsb, merged.openOgn);
      })
      .catch(() => {
        setUnits(local);
        setUnitsLoaded(true);
      });
  }, []);

  function update(partial: Partial<UnitPreferences>) {
    const next = { ...units, ...partial };
    setUnits(next);
    saveUnits(next);
  }

  // OpenなADS-B/OGN のトグル。ローカル即時反映(地図が即反応)に加え、端末側へ保存して
  // 別ブラウザ/別URL/再訪でも維持されるようにする（オリジン単位の localStorage 依存を解消）。
  function updateView(partial: Partial<Pick<UnitPreferences, "openAdsb" | "openOgn">>) {
    const next = { ...units, ...partial };
    setUnits(next);
    saveUnits(next);
    persistViewConfig(next.openAdsb, next.openOgn);
  }

  function updateAirfield(airfield: AirfieldConfig) {
    const next = { ...units, airfield };
    setUnits(next);
    saveUnits(next);
    // Debounce save to avoid races when multiple fields are edited quickly.
    if (airfieldSaveTimer.current) clearTimeout(airfieldSaveTimer.current);
    airfieldSaveTimer.current = setTimeout(() => {
      if (airfieldAbortRef.current) airfieldAbortRef.current.abort();
      const controller = new AbortController();
      airfieldAbortRef.current = controller;
      fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "airfield-save",
          name: airfield.name,
          latitude: airfield.latitude,
          longitude: airfield.longitude,
          elevation_m: airfield.elevation_m,
        }),
        signal: controller.signal,
      }).catch(() => {});
    }, 500);
  }

  return (
    <UnitContext.Provider
      value={{
        units,
        unitsLoaded,
        setAltitudeUnit: (altitude: AltitudeUnit) => update({ altitude }),
        setSpeedUnit: (speed: SpeedUnit) => update({ speed }),
        setClimbRateUnit: (climbRate: ClimbRateUnit) => update({ climbRate }),
        setDistanceUnit: (distance: DistanceUnit) => update({ distance }),
        setDisplayNameMode: (displayName: DisplayNameMode) => update({ displayName }),
        setSafeGlideRatio: (safeGlideRatio: number) => update({ safeGlideRatio }),
        setAirfield: (airfield: AirfieldConfig) => updateAirfield(airfield),
        setAdsb: (adsb: AdsbConfig) => update({ adsb }),
        setOpenAdsb: (openAdsb: boolean) => updateView({ openAdsb }),
        setOpenOgn: (openOgn: boolean) => updateView({ openOgn }),
        setRangeRings: (rangeRings: boolean) => update({ rangeRings }),
        setRainRadar: (rainRadar: boolean) => update({ rainRadar }),
        setMapSource: (mapSource: MapSource) => update({ mapSource }),
      }}
    >
      {children}
    </UnitContext.Provider>
  );
}

export function useUnits() {
  return useContext(UnitContext);
}

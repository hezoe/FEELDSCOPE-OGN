"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
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
  setMapSource: () => {},
});

export function UnitProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<UnitPreferences>(DEFAULT_UNITS);
  const [unitsLoaded, setUnitsLoaded] = useState(false);

  useEffect(() => {
    const local = loadUnits();
    fetch("/api/system")
      .then((res) => res.json())
      .then((data) => {
        if (data.airfield_config) {
          setUnits({ ...local, airfield: data.airfield_config });
        } else {
          setUnits(local);
        }
        setUnitsLoaded(true);
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

  function updateAirfield(airfield: AirfieldConfig) {
    const next = { ...units, airfield };
    setUnits(next);
    saveUnits(next);
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
    }).catch(() => {});
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

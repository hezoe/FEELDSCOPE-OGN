export type AltitudeUnit = "m" | "ft";
export type SpeedUnit = "km/h" | "knot";
export type ClimbRateUnit = "m/s" | "knot/s";
export type DistanceUnit = "km" | "nm";
export type DisplayNameMode = "competition_id" | "registration" | "pilot";
export type MapSource = "internet" | "offline";

export interface AirfieldConfig {
  name: string;
  latitude: number;
  longitude: number;
  elevation_m: number;
}

export const DEFAULT_AIRFIELD: AirfieldConfig = {
  name: "関宿滑空場",
  latitude: 36.0095,
  longitude: 139.818,
  elevation_m: 10,
};

export interface AdsbConfig {
  enabled: boolean;
  url: string;
  interval: number;
}

export const DEFAULT_ADSB: AdsbConfig = {
  enabled: false,
  url: "",
  interval: 3,
};

export interface UnitPreferences {
  altitude: AltitudeUnit;
  speed: SpeedUnit;
  climbRate: ClimbRateUnit;
  distance: DistanceUnit;
  displayName: DisplayNameMode;
  safeGlideRatio: number;
  mapSource: MapSource;
  airfield: AirfieldConfig;
  adsb: AdsbConfig;
}

export const DEFAULT_UNITS: UnitPreferences = {
  altitude: "ft",
  speed: "knot",
  climbRate: "knot/s",
  distance: "km",
  displayName: "registration",
  safeGlideRatio: 15,
  mapSource: "internet",
  airfield: DEFAULT_AIRFIELD,
  adsb: DEFAULT_ADSB,
};

const STORAGE_KEY = "ogn-unit-preferences";

export function loadUnits(): UnitPreferences {
  if (typeof window === "undefined") return DEFAULT_UNITS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_UNITS, ...parsed };
    }
  } catch {
    // ignore
  }
  return DEFAULT_UNITS;
}

export function saveUnits(units: UnitPreferences): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(units));
}

// Conversion helpers
export function formatAltitude(meters: number, unit: AltitudeUnit): string {
  if (unit === "ft") {
    return `${Math.round(meters * 3.28084)} ft`;
  }
  return `${meters} m`;
}

export function formatSpeed(ms: number, unit: SpeedUnit): string {
  if (unit === "knot") {
    return `${(ms * 1.94384).toFixed(0)} kt`;
  }
  return `${(ms * 3.6).toFixed(0)} km/h`;
}

export function formatClimbRate(ms: number, unit: ClimbRateUnit): string {
  const sign = ms > 0 ? "+" : "";
  if (unit === "knot/s") {
    return `${sign}${(ms * 1.94384).toFixed(1)} kt/s`;
  }
  return `${sign}${ms.toFixed(1)} m/s`;
}

export function formatDistance(meters: number, unit: DistanceUnit): string {
  if (unit === "nm") {
    return `${(meters / 1852).toFixed(1)} nm`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

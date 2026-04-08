export interface AircraftPosition {
  timestamp_utc: string;
  timestamp_sod: number;
  latitude: number;
  longitude: number;
  altitude_m: number;
  climb_rate_ms: number;
  ground_speed_ms: number;
  heading_deg: number;
  turn_rate_degs: number;
  stealth: boolean;
  relay: boolean;
  no_tracking: boolean;
  flags_raw: string;
  h_accuracy_m: number;
  v_accuracy_m: number;
  frame_info: string;
  freq_offset_khz: number;
  snr_db: number;
  signal_db: number;
  channel_errors: number;
  bit_errors: number;
  distance_km: number;
  bearing_deg: number;
  elevation_deg: number;
  is_latest: boolean;
  // OGN aircraft type (from FLARM beacon)
  aircraft_type?: string;       // "Glider", "Tow Plane", "Powered Aircraft", etc.
  aircraft_type_code?: string;  // "G", "T", "F", etc.
  // Simulator-specific
  simulated?: boolean;
  pilot?: string;
  glider_type?: string;
  glider_id?: string;
  competition_id?: string;
  // ADS-B specific
  adsb?: boolean;
  adsb_mode?: "adsb" | "modes";  // adsb=ADS-B, modes=Mode-S/C
  has_position?: boolean;
  flight?: string;
  hex?: string;
  squawk?: string;
  category?: string;
}

export interface AircraftStatus {
  device_id: string;
  packets_received: number;
  latest_position: AircraftPosition | null;
  simulated?: boolean;
  pilot?: string;
  glider_type?: string;
  glider_id?: string;
  competition_id?: string;
}

export interface AircraftList {
  timestamp_utc: string;
  count: number;
  aircraft: AircraftStatus[];
  simulated?: boolean;
}

export interface ReceiverStatus {
  receiver_id: string;
  timestamp_utc: string;
  online: boolean;
  simulated?: boolean;
  simulator?: {
    progress_pct: number;
    speed: number;
    total_aircraft: number;
    loop: boolean;
  };
}

export interface SystemStatus {
  mode: "realtime" | "history";
  ogn_mqtt_active: boolean;
  igc_simulator_active: boolean;
  mosquitto_active: boolean;
}

// ── Aircraft Database ──

export type AircraftTypeCode =
  | "glider"
  | "tow"
  | "powered"
  | "helicopter"
  | "paraglider"
  | "hangglider"
  | "skydiver"
  | "balloon"
  | "uav"
  | "jet";

export interface AircraftRecord {
  device_id: string;
  glider_type: string;
  registration: string;
  competition_id: string;
  pilot: string;
  aircraft_type: AircraftTypeCode;
}

export type AircraftDatabase = Record<string, AircraftRecord>;

export const AIRCRAFT_TYPE_OPTIONS: { value: AircraftTypeCode; label: string }[] = [
  { value: "glider", label: "グライダー/モーターグライダー" },
  { value: "tow", label: "曳航機" },
  { value: "powered", label: "動力機" },
  { value: "helicopter", label: "ヘリコプター" },
  { value: "paraglider", label: "パラグライダー" },
  { value: "hangglider", label: "ハンググライダー" },
  { value: "skydiver", label: "スカイダイバー" },
  { value: "balloon", label: "バルーン" },
  { value: "uav", label: "UAV" },
  { value: "jet", label: "ジェット機" },
];

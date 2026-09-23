import { NextRequest, NextResponse } from "next/server";
import { ensureOgn, getOgnAircraft, ognStatus } from "@/lib/ogn-aprs";

// Open OGN: OGN ネットワーク(APRS-IS = aprs.glidernet.org)へ直結し、空港中心50海里の
// OGN 機を取得する。ogn.ezoe.net(ogn-collect) と同じ「APRS-IS 直接購読」方式で、
// ogn.ezoe.net には依存しない。RND(匿名) と no-tracking は取り込み側/配信側で除外。
// 接続はオンデマンド(このエンドポイントへの要求で開始、無要求が続けば自動切断)。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RADIUS_NM = 50;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // 状態照会のみ(?status=1)。ステータス画面が「実際に受信できているか」を表示する
  // ための読み取りで、購読は開始しない(勝手に受信を始めない)。
  if (sp.get("status")) {
    const st = ognStatus();
    return NextResponse.json({ now: new Date().toISOString(), source: "aprs.glidernet.org", status: st });
  }

  const latS = sp.get("lat");
  const lonS = sp.get("lon");
  const lat = latS ? Number(latS) : NaN;
  const lon = lonS ? Number(lonS) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }

  // APRS-IS 購読を(必要なら)開始・維持し、現在の受信機体を返す。
  ensureOgn(lat, lon);
  const st = ognStatus();
  const aircraft = getOgnAircraft().map((a) => ({
    device_id: a.device_id,
    hex: a.hex,
    registration: null,          // APRS 単体では未解決。表示側が端末の機体DBで補完する。
    cn: null,
    model: null,
    latitude: a.latitude,
    longitude: a.longitude,
    altitude_m: a.altitude_m,
    heading_deg: a.heading_deg,
    ground_speed_ms: a.ground_speed_ms,
    aircraft_type: a.aircraft_type,
  }));

  return NextResponse.json({
    now: new Date().toISOString(),
    source: "aprs.glidernet.org",
    connected: st.connected,
    center: { lat, lon },
    radius_nm: RADIUS_NM,
    radius_miles: RADIUS_NM, // マイル=海里で運用
    count: aircraft.length,
    aircraft,
  });
}

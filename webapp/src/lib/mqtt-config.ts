// MQTT WebSocket connection config
// Browser connects to Mosquitto via WebSocket on port 9001
export const MQTT_WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:9001`
    : "ws://localhost:9001";

export const MQTT_BASE_TOPIC = "ogn";
export const DEFAULT_RECEIVER_ID = "RJTTTK001";

export function topicFor(receiverId: string, ...parts: string[]) {
  return [MQTT_BASE_TOPIC, receiverId, ...parts].join("/");
}

/** Detect receiver ID from OGN config on the server side */
export async function detectReceiverId(): Promise<string> {
  if (typeof window === "undefined") {
    // Server-side: read from OGN config
    try {
      const fs = await import("fs");
      const content = fs.readFileSync("/boot/OGN-receiver.conf", "utf-8");
      const m = content.match(/ReceiverName="([^"#]+)"/);
      if (m) return m[1];
    } catch { /* ignore */ }
    return DEFAULT_RECEIVER_ID;
  }
  // Client-side: fetch from API
  try {
    const resp = await fetch("/api/system");
    const data = await resp.json();
    if (data.receiver_id) return data.receiver_id;
  } catch { /* ignore */ }
  return DEFAULT_RECEIVER_ID;
}

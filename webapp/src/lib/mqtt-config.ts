// MQTT WebSocket connection config
// - Direct (LAN/RPi): ws://<host>:9001
// - Reverse-proxied (HTTPS demo): wss://<host>/mqtt-ws (nginx proxies to localhost:9001)
function buildMqttUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:9001";
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}/mqtt-ws`;
  }
  return `ws://${window.location.hostname}:9001`;
}
export const MQTT_WS_URL = buildMqttUrl();

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

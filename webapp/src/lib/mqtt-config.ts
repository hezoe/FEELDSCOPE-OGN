// MQTT WebSocket connection config
// Browser connects to Mosquitto via WebSocket on port 9001
export const MQTT_WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:9001`
    : "ws://localhost:9001";

export const MQTT_BASE_TOPIC = "ogn";
export const DEFAULT_RECEIVER_ID = "TestJP";

export function topicFor(receiverId: string, ...parts: string[]) {
  return [MQTT_BASE_TOPIC, receiverId, ...parts].join("/");
}

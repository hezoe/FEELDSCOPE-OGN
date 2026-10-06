/**
 * Next.js のサーバ起動フック。
 * 離着陸・離脱の検知をここから起動して、ブラウザが開かれていなくても
 * 記録が続くようにする。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startFlightTracker } = await import("@/lib/flight-tracker");
  startFlightTracker();
  // OGN-receiver.conf を直接書き換えたときも受信機名・座標・標高を受信機へ反映する
  const { startOgnReceiverSync } = await import("@/lib/ogn-receiver-sync");
  startOgnReceiverSync();
}

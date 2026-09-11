/**
 * Next.js のサーバ起動フック。
 * 離着陸・離脱の検知をここから起動して、ブラウザが開かれていなくても
 * 記録が続くようにする。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startFlightTracker } = await import("@/lib/flight-tracker");
  startFlightTracker();
}

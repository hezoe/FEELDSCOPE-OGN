import { existsSync } from "fs";

/**
 * この webapp が機体(Raspberry Pi)そのものではなく、別のサーバ上でデモとして動いているか。
 *
 * デモ(feeldscope.ezoe.net)は EZOS VPS 上で開発ツリーを直接起動しており、その VPS は
 * CATVPN のハブでもある。機体向けの「端末本体の操作」をそのまま実行すると VPS 自身を
 * 操作してしまう。2026-09-28 に実際に起きた:
 *  - リモートサポートOFF → `systemctl disable --now wg-quick@wg0` でハブのVPNを停止(全台不通)
 *  - 自動再起動の設定(9/18) → root crontab に毎朝5時の reboot を再投入(監査で撤去済みだった)
 *
 * 判定は2重にする:
 *  - systemd ユニットで FEELDSCOPE_DEMO=1 を指定している
 *  - CATVPN ハブの実体(/opt/catvpn-api)がある(環境変数を付け忘れても止める)
 */
export function isHostLocked(): boolean {
  return process.env.FEELDSCOPE_DEMO === "1" || existsSync("/opt/catvpn-api/server.py");
}

export const HOST_LOCKED_MESSAGE =
  "このサーバはデモ機のため、端末本体の設定（リモートサポート・自動再起動・ネットワーク・電源・更新など）は変更できません。";

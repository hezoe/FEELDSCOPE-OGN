import { NextResponse } from "next/server";
import { getAuthContext, isAuthorizedToMutate } from "@/lib/auth";
import { HOST_LOCKED_MESSAGE, isHostLocked } from "@/lib/host-guard";
import { addMember, changeMember, HubError, listMembers, vpnState } from "@/lib/remote-access";

// リモートアクセス(メンバーの PC → この FEELDSCOPE だけ)の窓口。台帳と関所はハブ側にある(lib/remote-access.ts)。
// メンバーの氏名は個人情報なので、一覧も操作も管理者ログイン(またはオペレーター)が必要。

function errorResponse(err: unknown) {
  if (err instanceof HubError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[remote-access]", err);
  return NextResponse.json({ error: "処理できませんでした" }, { status: 500 });
}

// GET /api/remote-access - リモートサポート(VPN)の状態と、登録している PC の一覧
export async function GET(request: Request) {
  if (isHostLocked()) {
    return NextResponse.json({ host_locked: true, vpn: null, members: null });
  }
  const vpn = await vpnState();
  if (!isAuthorizedToMutate(await getAuthContext(request))) {
    return NextResponse.json({ vpn, members: null, needsAuth: true });
  }
  if (!vpn.active) {
    return NextResponse.json({ vpn, members: null, hub_error: null });
  }
  try {
    const list = await listMembers();
    return NextResponse.json({ vpn, ...list, url: `http://${list.owner_ip}/` });
  } catch (err) {
    // 一覧が取れなくてもパネルは出す(理由を表示する)
    return NextResponse.json({ vpn, members: null, hub_error: err instanceof Error ? err.message : String(err) });
  }
}

// POST /api/remote-access
//   { action: "add", name, device }       → 201 { member, config, filename, url }  ※ config(秘密鍵入り)は一度だけ
//   { action: "pause" | "resume" | "delete", id }
export async function POST(request: Request) {
  if (isHostLocked()) {
    return NextResponse.json({ error: HOST_LOCKED_MESSAGE, hostLocked: true }, { status: 403 });
  }
  if (!isAuthorizedToMutate(await getAuthContext(request))) {
    return NextResponse.json({ error: "設定変更には管理者ログインが必要です。", needsAuth: true }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "要求が正しくありません" }, { status: 400 });
  }
  const action = String(body.action || "");
  try {
    if (action === "add") {
      const name = String(body.name ?? "").replace(/[\x00-\x1f\x7f]/g, "").trim();
      const device = String(body.device ?? "").replace(/[\x00-\x1f\x7f]/g, "").trim();
      if (!name) return NextResponse.json({ error: "氏名を入れてください" }, { status: 400 });
      if (name.length > 40 || device.length > 40) {
        return NextResponse.json({ error: "氏名と端末名は40文字までです" }, { status: 400 });
      }
      if (!(await vpnState()).active) {
        return NextResponse.json({ error: "リモートサポートが OFF です。先にリモートサポートを ON にしてください。" }, { status: 409 });
      }
      const r = await addMember(name, device);
      return NextResponse.json(r, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (action === "pause" || action === "resume" || action === "delete") {
      const r = await changeMember(String(body.id || ""), action);
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "操作が正しくありません" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}

import { NextResponse } from "next/server";
import { readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { getAuthContext, isAuthorizedToMutate } from "@/lib/auth";

const IGC_DIR = process.env.FEELDSCOPE_IGC_DIR || "/home/pi/FEELDSCOPE/testdata";
/** 1ファイルの上限。再生用の IGC は大きくても数MB */
const MAX_IGC_BYTES = 10 * 1024 * 1024;

/** 変更系(アップロード・削除)は管理者かオペレーターだけに許す */
async function denyIfNotAuthorized(request: Request): Promise<NextResponse | null> {
  const ctx = await getAuthContext(request);
  if (isAuthorizedToMutate(ctx)) return null;
  return NextResponse.json(
    { error: "IGCファイルの変更には管理者ログインが必要です。", needsAuth: true },
    { status: 401 },
  );
}

// GET /api/system/igc-files - List IGC files in testdata
export async function GET() {
  try {
    const files = await readdir(IGC_DIR);
    const igcFiles = [];

    for (const name of files) {
      if (!name.toLowerCase().endsWith(".igc")) continue;
      const filePath = path.join(IGC_DIR, name);
      const info = await stat(filePath);
      igcFiles.push({
        name,
        size: info.size,
        modified: info.mtime.toISOString(),
      });
    }

    igcFiles.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ files: igcFiles, directory: IGC_DIR });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/system/igc-files - Upload IGC file
export async function POST(request: Request) {
  const denied = await denyIfNotAuthorized(request);
  if (denied) return denied;
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || !file.name.toLowerCase().endsWith(".igc")) {
      return NextResponse.json(
        { error: "IGC file required (.igc extension)" },
        { status: 400 }
      );
    }

    if (file.size > MAX_IGC_BYTES) {
      return NextResponse.json(
        { error: `IGCファイルが大きすぎます（上限 ${MAX_IGC_BYTES / 1024 / 1024}MB）` },
        { status: 413 }
      );
    }

    // Sanitize filename
    // 区切り文字を潰したうえで basename も通す（"..igc" のような名前で
    // 保存先ディレクトリの外に出られないようにする）
    const safeName = path.basename(file.name.replace(/[^a-zA-Z0-9._-]/g, "_"));
    if (!safeName || safeName.startsWith(".") || !safeName.toLowerCase().endsWith(".igc")) {
      return NextResponse.json({ error: "ファイル名が不正です" }, { status: 400 });
    }
    const destPath = path.join(IGC_DIR, safeName);
    if (path.dirname(destPath) !== path.resolve(IGC_DIR)) {
      return NextResponse.json({ error: "ファイル名が不正です" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(destPath, buffer);

    return NextResponse.json({ ok: true, name: safeName }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/system/igc-files - Delete IGC file
export async function DELETE(request: Request) {
  const denied = await denyIfNotAuthorized(request);
  if (denied) return denied;
  try {
    const { name } = await request.json();

    if (!name || !name.toLowerCase().endsWith(".igc")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Prevent path traversal
    const safeName = path.basename(String(name));
    const filePath = path.join(IGC_DIR, safeName);
    if (path.dirname(filePath) !== path.resolve(IGC_DIR)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }
    await unlink(filePath);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

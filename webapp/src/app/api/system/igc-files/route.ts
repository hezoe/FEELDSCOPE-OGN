import { NextResponse } from "next/server";
import { readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";

const IGC_DIR = "/home/pi/FEELDSCOPE/testdata";

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
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || !file.name.toLowerCase().endsWith(".igc")) {
      return NextResponse.json(
        { error: "IGC file required (.igc extension)" },
        { status: 400 }
      );
    }

    // Sanitize filename
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const destPath = path.join(IGC_DIR, safeName);
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
  try {
    const { name } = await request.json();

    if (!name || !name.toLowerCase().endsWith(".igc")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Prevent path traversal
    const safeName = path.basename(name);
    const filePath = path.join(IGC_DIR, safeName);
    await unlink(filePath);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

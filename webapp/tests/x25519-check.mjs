#!/usr/bin/env node
// src/lib/x25519.ts(ブラウザ側の WireGuard 鍵生成・R-112)の正しさの確認。
//   cd webapp && node tests/x25519-check.mjs
// RFC 7748 §6.1 の検証ベクタと、Node の crypto(X25519)との 200 回の突き合わせ。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { createRequire } from "node:module";

const out = mkdtempSync(join(tmpdir(), "x25519-"));
try {
  execFileSync("npx", ["tsc", "src/lib/x25519.ts", "--outDir", out, "--target", "es2020", "--module", "commonjs", "--lib", "es2020,dom", "--types", "node"], { stdio: "inherit" });
  const { x25519PublicKey, generateWireGuardKeyPair } = createRequire(import.meta.url)(join(out, "x25519.js"));
  const hex = (s) => Uint8Array.from(Buffer.from(s, "hex"));
  let ng = 0;
  const check = (c, m) => { console.log((c ? "  OK " : "  NG ") + m); if (!c) ng++; };
  check(Buffer.from(x25519PublicKey(hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"))).toString("hex")
    === "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a", "RFC 7748 Alice の公開鍵");
  check(Buffer.from(x25519PublicKey(hex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb"))).toString("hex")
    === "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f", "RFC 7748 Bob の公開鍵");
  const nodePub = (privB64) => {
    const der = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), Buffer.from(privB64, "base64")]);
    return createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  };
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const k = generateWireGuardKeyPair();
    if (nodePub(k.privateKey) !== k.publicKey || Buffer.from(k.privateKey, "base64").length !== 32) bad++;
  }
  check(bad === 0, `Node crypto との突き合わせ 200 回(不一致 ${bad})`);
  console.log(ng ? `\n${ng} 件 NG` : "\nすべて OK");
  process.exit(ng ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}

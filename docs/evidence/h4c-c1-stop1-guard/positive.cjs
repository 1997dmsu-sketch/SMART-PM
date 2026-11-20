"use strict";
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  assert.equal(
    crypto.createHmac("sha256", Buffer.alloc(32, 1)).update("abc").digest("hex"),
    "73860612aa6aadf68985b6e9c4233357cedd5f24a221eba740b2aa8350276cfc");
  assert.equal(
    crypto.createHash("sha256").update("abc").digest("hex"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "h4c-positive-"));
  await fs.writeFile(path.join(dir, "x.txt"), "hello");
  assert.equal(await fs.readFile(path.join(dir, "x.txt"), "utf8"), "hello");
  await fs.rm(dir, { recursive: true, force: true });

  const adminWeb = process.env.H4C_ADMIN_WEB;
  assert.ok(adminWeb, "H4C_ADMIN_WEB");
  const evidence = await import(
    pathToFileURL(path.join(adminWeb, "lib/face-service/h4c-evidence.mjs")).href);
  const config = evidence.evidenceKeyConfig({
    H4_EVIDENCE_HMAC_KEY_B64: Buffer.alloc(32, 2).toString("base64"),
    H4_EVIDENCE_KEY_VERSION: "1",
    H4_EVIDENCE_REALM: "h4c-positive",
  });
  assert.match(config.fingerprint, /^[0-9a-f]{64}$/);

  const { LocalStore } = await import(
    pathToFileURL(path.join(adminWeb, "lib/store.mjs")).href);
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "h4c-store-"));
  const store = await new LocalStore(storeDir).init();
  assert.ok(store.data && Array.isArray(store.data.admin_audit));
  await fs.rm(storeDir, { recursive: true, force: true });
  console.log("POSITIVE_OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

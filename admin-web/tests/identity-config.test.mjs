import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, identityKeyConfig } from "../server.mjs";

const HMAC = "live-test-hmac-key-0123456789";
const ENCRYPTION = "ab".repeat(32);

test("F01: demo defaults are explicit and never selected for live mode", async () => {
  const demo = identityKeyConfig("demo", {});
  assert.equal(demo.hmacKey, "demo-identity-hmac-key-not-for-production");
  assert.deepEqual(demo.encryptionKey, Buffer.alloc(32, 7));
  assert.throws(
    () => identityKeyConfig("live", {}),
    (e) => /IDENTITY_HMAC_KEY/.test(e.message) && !e.message.includes("demo-identity"),
  );
  assert.throws(
    () => identityKeyConfig("live", { IDENTITY_HMAC_KEY: HMAC }),
    /IDENTITY_ENCRYPTION_KEY/,
  );
  // createApp consumes the same guard before touching the supplied store.
  const oldHmac = process.env.IDENTITY_HMAC_KEY;
  const oldEncryption = process.env.IDENTITY_ENCRYPTION_KEY;
  delete process.env.IDENTITY_HMAC_KEY;
  delete process.env.IDENTITY_ENCRYPTION_KEY;
  try {
    await assert.rejects(
      createApp({ mode: "live", origin: "https://admin.example.test", store: {} }),
      /IDENTITY_HMAC_KEY/,
    );
  } finally {
    if (oldHmac === undefined) delete process.env.IDENTITY_HMAC_KEY;
    else process.env.IDENTITY_HMAC_KEY = oldHmac;
    if (oldEncryption === undefined) delete process.env.IDENTITY_ENCRYPTION_KEY;
    else process.env.IDENTITY_ENCRYPTION_KEY = oldEncryption;
  }
});

test("F01: live encryption keys require strict 64-character hex and 32 decoded bytes", () => {
  for (const invalid of ["00", "0".repeat(63), "0".repeat(65), "g".repeat(64), `0x${"0".repeat(62)}`]) {
    assert.throws(
      () => identityKeyConfig("live", {
        IDENTITY_HMAC_KEY: HMAC,
        IDENTITY_ENCRYPTION_KEY: invalid,
      }),
      (e) => /64 hexadecimal/.test(e.message) && !e.message.includes(invalid),
    );
  }
  assert.throws(
    () => identityKeyConfig("live", { IDENTITY_HMAC_KEY: "short", IDENTITY_ENCRYPTION_KEY: ENCRYPTION }),
    /at least 16 characters/,
  );
});

test("F01: a valid live configuration produces the intended 32-byte key", () => {
  const config = identityKeyConfig("live", {
    IDENTITY_HMAC_KEY: HMAC,
    IDENTITY_ENCRYPTION_KEY: ENCRYPTION,
  });
  assert.equal(config.hmacKey, HMAC);
  assert.equal(config.encryptionKey.length, 32);
  assert.equal(config.encryptionKey.toString("hex"), ENCRYPTION);
});

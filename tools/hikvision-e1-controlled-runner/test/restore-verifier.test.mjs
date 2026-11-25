import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import childProcess from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";

// Standalone restore verifier. It runs AFTER the guard-isolation suite (for
// example after a mutated copy in the negative control) in the same
// --test-isolation=none process and proves, by pure inspection, that no
// synthetic fake leaked onto the real builtin positions. No real network,
// process, listener, DNS, credential or business file call is made.

const FAKE_NAMES = new Set([
  "safeSyntheticOriginalTarget",
  "safeSyntheticResolverMethod",
  "safeSyntheticResolverConstructor",
]);

test("real builtins are restored: no synthetic fake leaked onto any captured position", () => {
  const samples = [
    ["http.request", http.request],
    ["http.get", http.get],
    ["https.get", https.get],
    ["net.connect", net.connect],
    ["tls.connect", tls.connect],
    ["dgram.createSocket", dgram.createSocket],
    ["dns.resolve4", dns.resolve4],
    ["dns.promises.resolve4", dnsPromises.resolve4],
    ["child_process.spawn", childProcess.spawn],
    ["fs.realpathSync", fs.realpathSync],
    ["fs.readFileSync", fs.readFileSync],
    ["fs.writeFileSync", fs.writeFileSync],
    ["fs.promises.readFile", fsPromises.readFile],
    ["fs.promises.stat", fsPromises.stat],
    ["fs.Stats", fs.Stats],
  ];
  for (const [label, fn] of samples) {
    assert.equal(typeof fn, "function", `${label} is a function`);
    assert.equal(FAKE_NAMES.has(fn.name), false, `${label} is not a leaked synthetic fake (name: ${fn.name})`);
  }
  if (typeof globalThis.fetch === "function") {
    assert.equal(FAKE_NAMES.has(globalThis.fetch.name), false, "fetch is not a leaked synthetic fake");
  }
});

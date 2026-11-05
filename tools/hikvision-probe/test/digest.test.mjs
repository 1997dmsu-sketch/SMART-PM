import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAuthorization, makeCnonce, nextNonceCount, parseChallenge } from "../src/digest.mjs";

const RFC_HEADER =
  'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"';

test("解析 Digest 挑战：realm/nonce/qop/opaque/algorithm", () => {
  const challenge = parseChallenge(RFC_HEADER);
  assert.equal(challenge.realm, "testrealm@host.com");
  assert.equal(challenge.nonce, "dcd98b7102dd2f0e8b11d0f600bfb0c093");
  assert.deepEqual(challenge.qop, ["auth", "auth-int"]);
  assert.equal(challenge.opaque, "5ccc069c403ebaf9f0171e9517f40e41");
  assert.equal(challenge.algorithm, "MD5");
});

test("非 Digest 挑战返回 null", () => {
  assert.equal(parseChallenge('Basic realm="x"'), null);
  assert.equal(parseChallenge(""), null);
});

test("缺少 realm/nonce 时抛错", () => {
  assert.throws(() => parseChallenge('Digest nonce="abc"'), /realm/);
});

test("RFC 2617 §3.5 标准向量", () => {
  const challenge = {
    realm: "testrealm@host.com",
    nonce: "dcd98b7102dd2f0e8b11d0f600bfb0c093",
    qop: ["auth"],
    opaque: "5ccc069c403ebaf9f0171e9517f40e41",
    algorithm: "MD5",
  };
  const header = buildAuthorization({
    username: "Mufasa",
    password: "Circle Of Life",
    method: "GET",
    uri: "/dir/index.html",
    challenge,
    cnonce: "0a4f113b",
    nc: "00000001",
  });
  assert.match(header, /response="6629fae49393a05397450978507c4ef1"/);
  assert.match(header, /qop=auth/);
  assert.match(header, /nc=00000001/);
  assert.match(header, /cnonce="0a4f113b"/);
});

test("没有 qop 时退化为 RFC 2069 形式", () => {
  const header = buildAuthorization({
    username: "u",
    password: "p",
    method: "GET",
    uri: "/x",
    challenge: { realm: "r", nonce: "n", qop: [], opaque: "", algorithm: "MD5" },
  });
  assert.doesNotMatch(header, /qop=/);
  assert.doesNotMatch(header, /nc=/);
});

test("nonce 计数只递增", () => {
  assert.deepEqual(nextNonceCount(0), { next: 1, value: "00000001" });
  assert.deepEqual(nextNonceCount(41), { next: 42, value: "00000042" });
});

test("cnonce 每次不同", () => {
  assert.notEqual(makeCnonce(), makeCnonce());
});

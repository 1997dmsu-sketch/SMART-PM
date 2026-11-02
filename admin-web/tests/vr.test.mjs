import { test } from "node:test";
import assert from "node:assert/strict";
import { vrLink, vrUpload, vrFile, VR_LIMIT } from "../lib/vr.mjs";
test("VR links require HTTPS and archive metadata rejects oversized or unsafe values", () => {
  for (const link of [
    "http://example.com",
    "javascript:alert(1)",
    "https://user:pass@example.com",
  ])
    assert.throws(() => vrLink(link));
  assert.equal(
    vrLink("https://example.com/tour?a=1"),
    "https://example.com/tour?a=1",
  );
  assert.equal(vrUpload(Buffer.from([80, 75, 5, 6, 0, 0]), "tour.zip"), "zip");
  assert.throws(() => vrUpload(Buffer.from("hello"), "tour.html"));
  assert.throws(() =>
    vrFile({ url: "/vr-files/aa.zip", name: "tour.zip", size: VR_LIMIT + 1 }),
  );
  assert.throws(() =>
    vrFile({ url: "/vr-files/aa.zip", name: "../tour.zip", size: 1 }),
  );
});

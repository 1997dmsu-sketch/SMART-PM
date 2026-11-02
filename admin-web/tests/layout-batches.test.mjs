import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLayoutBatches } from "../public/layout-batches.js";
test("whole building layout assignment processes 1000 unique rooms in bounded requests", async () => {
  const ids = Array.from({ length: 1000 }, (_, i) => String(i)),
    seen = [],
    progress = [];
  await applyLayoutBatches(
    async (path, { data }) => {
      assert.equal(path, "property/layout");
      assert.equal(data.layoutId, "A1");
      assert.ok(data.ids.length <= 30);
      seen.push(...data.ids);
      return { count: data.ids.length };
    },
    ids,
    "A1",
    (n, total) => progress.push([n, total]),
  );
  assert.deepEqual(seen, ids);
  assert.equal(progress.length, 34);
  assert.deepEqual(progress.at(-1), [1000, 1000]);
});
test("failed layout batch stops further requests and reports confirmed progress; replay uses same IDs", async () => {
  const ids = Array.from({ length: 95 }, (_, i) => String(i));
  let calls = 0;
  await assert.rejects(
    applyLayoutBatches(
      async (p, { data }) => {
        calls++;
        if (calls === 2) throw Error("断线");
        return { count: data.ids.length };
      },
      ids,
      "P1",
    ),
    /已确认设置 30 \/ 95 间.*断线/,
  );
  assert.equal(calls, 2);
  const seen = [];
  await applyLayoutBatches(
    async (p, { data }) => {
      seen.push(...data.ids);
      return { count: data.ids.length };
    },
    ids,
    "P1",
  );
  assert.deepEqual(seen, ids);
});
test("invalid selection and inconsistent responses are rejected", async () => {
  for (const ids of [[], ["1", "1"]])
    await assert.rejects(
      applyLayoutBatches(
        () => {
          throw Error("should not call");
        },
        ids,
        "A1",
      ),
      /请选择/,
    );
  await assert.rejects(
    applyLayoutBatches(async () => ({ count: 0 }), ["1"], "A1"),
    /已确认设置 0 \/ 1 间.*返回异常/,
  );
});

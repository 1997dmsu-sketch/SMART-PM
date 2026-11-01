// Exercise the installed CloudBase SDK serializers/transaction API with a fake transport.
// No network requests or cloud credentials are used.
import assert from "node:assert/strict";
import cloudbase from "@cloudbase/node-sdk";
import { Db } from "@cloudbase/database";
import { CloudStore } from "../lib/store.mjs";
const app = cloudbase.init({
  env: "test-only-env",
  secretId: "test-only",
  secretKey: "test-only",
});
const store = new CloudStore(app),
  requests = [];
let failWrite = false;
Db.reqClass = class {
  async send(action, data) {
    requests.push({ action, data });
    switch (action) {
      case "database.startTransaction":
        return { transactionId: "test-tx" };
      case "database.commitTransaction":
      case "database.abortTransaction":
        return {};
      case "database.getDocument":
        return {
          data: {
            list: [
              JSON.stringify({ _id: "test-id", title: "old", status: "下架" }),
            ],
          },
        };
      case "database.modifyDocument":
        if (failWrite) return { code: "PERMISSION_DENIED" };
        return { data: { updated: 1, upserted: [] } };
      default:
        throw Error(`Unexpected SDK action: ${action}`);
    }
  }
};
const result = await store.change(
  "houses",
  "test-id",
  () => ({ title: "updated" }),
  { actor: "test", action: "edit" },
);
assert.equal(result.title, "updated");
assert.equal(result.status, "下架");
assert.equal(
  requests.filter((r) => r.action === "database.modifyDocument").length,
  2,
);
assert.equal(requests.at(-1).action, "database.commitTransaction");
const houseWrite = requests.find(
  (r) =>
    r.action === "database.modifyDocument" &&
    r.data.collectionName === "houses",
);
assert.equal(houseWrite.data.transactionId, "test-tx");
assert.equal((await store.list("houses"))[0]._id, "test-id");
failWrite = true;
await assert.rejects(
  store.change("houses", "test-id", () => ({ title: "failed" }), {
    actor: "test",
    action: "edit",
  }),
  /写入失败/,
);
assert.equal(requests.at(-1).action, "database.abortTransaction");
console.log(
  "Installed CloudBase SDK: document serialization, list and atomic audit transaction passed with fake transport. Live cloud not invoked.",
);

failWrite = false;
await store.transact(
  [
    { collection: "rooms", id: "r1" },
    { collection: "houses", id: "h1" },
  ],
  () => [
    { collection: "rooms", id: "r1", data: { layoutCode: "A1" } },
    { collection: "houses", id: "h1", data: { layoutCode: "A1" } },
  ],
  { actor: "test", action: "batch-layout" },
);
assert.equal(requests.at(-1).action, "database.commitTransaction");
console.log(
  "Multi-document property transaction serializer passed with fake transport.",
);

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { OrgService } from "../lib/org.mjs";

const audit = { actor: "system", actorId: "system", action: "测试授权" };
let store, orgs, dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-device-perms-"));
  store = new LocalStore(dir);
  await store.init();
  orgs = new OrgService(store);
  await orgs.bootstrap({ id: "org-perm", name: "权限测试" }, audit);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const grant = (principalId, permissions) =>
  orgs.grantMembership(
    { orgId: "org-perm", principalType: "adminAccount", principalId, role: "admin", permissions },
    audit,
  );

test("设备四项权限可通过正式 OrgService 授予", async () => {
  await grant("acc-device-1", [
    "device.access.manage",
    "device.audit.read",
    "device.operation.retry",
    "device.operation.reconcile",
  ]);
  const membership = (await store.list("org_memberships", "org-perm")).find(
    (m) => m.principalId === "acc-device-1",
  );
  assert.deepEqual(membership.permissions.sort(), [
    "device.access.manage",
    "device.audit.read",
    "device.operation.reconcile",
    "device.operation.retry",
  ]);
});

test("未在可授予清单中的设备权限仍被拒绝", async () => {
  await assert.rejects(
    () => grant("acc-device-2", ["device.face.manage"]),
    /权限点|PARAM_ERROR/,
  );
});

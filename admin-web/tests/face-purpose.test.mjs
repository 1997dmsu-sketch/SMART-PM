import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LocalStore } from "../lib/store.mjs";
import { OrgService } from "../lib/org.mjs";
import { PURPOSES } from "../lib/files.mjs";

const audit = { actor: "admin", actorId: "acc-admin", action: "人脸文件用途测试" };

test("face-biometric 用途约束：仅 private、JPEG/PNG、≤200KB、读写权限分离", () => {
  const policy = PURPOSES["face-biometric"];
  assert.ok(policy, "必须存在 face-biometric 用途");
  assert.equal(policy.private, true);
  assert.equal(policy.visibility, "private");
  assert.equal(policy.maxSize, 200 * 1024);
  assert.deepEqual([...policy.accept].sort(), ["image/jpeg", "image/png"]);
  assert.equal(policy.writePermission, "device.face.submit");
  assert.equal(policy.readPermission, "device.face.readPrivate");
  assert.notEqual(policy.writePermission, policy.readPermission, "读写权限不能相同");
});

test("任何公开用途都不得包含 face-biometric", () => {
  const publicPurposes = Object.entries(PURPOSES)
    .filter(([, policy]) => !policy.private)
    .map(([name]) => name);
  assert.equal(publicPurposes.includes("face-biometric"), false);
  assert.equal(PURPOSES["face-biometric"].visibility, "private");
});

test("三个 face 权限点可显式授予，未知权限仍被拒绝", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-face-purpose-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const orgs = new OrgService(store);
  await orgs.bootstrap({ id: "org-f", name: "人脸组织", adminAccountIds: ["acc-admin"] }, audit);

  for (const [principalId, permission] of [
    ["acc-submit", "device.face.submit"],
    ["acc-review", "device.face.review"],
    ["acc-read", "device.face.readPrivate"],
  ]) {
    await orgs.grantMembership(
      { orgId: "org-f", principalType: "adminAccount", principalId, role: "admin", permissions: [permission] },
      audit,
    );
  }

  const rows = await store.list("org_memberships");
  const permissionsOf = (principalId) =>
    rows.find((row) => row.orgId === "org-f" && row.principalId === principalId).permissions;

  assert.deepEqual(permissionsOf("acc-submit"), ["device.face.submit"]);
  assert.deepEqual(permissionsOf("acc-review"), ["device.face.review"]);
  assert.deepEqual(permissionsOf("acc-read"), ["device.face.readPrivate"]);

  await assert.rejects(
    () =>
      orgs.grantMembership(
        {
          orgId: "org-f",
          principalType: "adminAccount",
          principalId: "acc-bad",
          role: "admin",
          permissions: ["device.face.superuser"],
        },
        audit,
      ),
    /权限点无效/,
  );
});

test("角色本身不隐含 face 权限（GRANTABLE 之外无法授予）", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-face-purpose-role-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const orgs = new OrgService(store);
  await orgs.bootstrap({ id: "org-g", name: "组织G", adminAccountIds: ["acc-admin"] }, audit);

  // 管理员角色、零权限点：不自动获得 device.face.*
  await orgs.grantMembership(
    { orgId: "org-g", principalType: "adminAccount", principalId: "acc-admin2", role: "admin", permissions: [] },
    audit,
  );
  const rows = await store.list("org_memberships");
  const membership = rows.find((row) => row.orgId === "org-g" && row.principalId === "acc-admin2");
  assert.deepEqual(membership.permissions, []);
});

import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { fail } from "./model.mjs";
export function hash(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    fail("密码长度需为 12–128 位");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verify(password, encoded) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [salt, digest] = encoded.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const publicAccount = (a) => ({
  _id: a._id,
  username: a.username,
  name: a.name,
  role: a.role,
  enabled: a.enabled,
});
export class Accounts {
  constructor(dir) {
    this.dir = dir;
    this.queue = Promise.resolve();
    this.dummy = hash(randomBytes(24).toString("hex"));
  }
  async init() {
    await mkdir(this.dir, { recursive: true });
    try {
      const saved = JSON.parse(
        await readFile(join(this.dir, "accounts.json"), "utf8"),
      );
      this.rows = Array.isArray(saved) ? saved : saved.accounts;
      this.events = Array.isArray(saved) ? [] : saved.events;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.rows = [];
      this.events = [];
    }
    return this;
  }
  async save(data, id, actor = "bootstrap") {
    const task = this.queue.then(async () => {
      if (!/^[a-zA-Z0-9_-]{3,40}$/.test(data.username || ""))
        fail("账号需为 3–40 位字母、数字、下划线或连字符");
      if (!["admin", "editor", "viewer"].includes(data.role)) fail("角色无效");
      const existing = this.rows.find((a) => a._id === id);
      if (id && !existing) fail("账号不存在", 404);
      if (this.rows.some((a) => a.username === data.username && a._id !== id))
        fail("账号已存在", 409);
      if (
        typeof data.name !== "string" ||
        !data.name.trim() ||
        data.name.length > 50
      )
        fail("姓名需为 1–50 字");
      const passwordHash = data.password
        ? hash(data.password)
        : existing?.passwordHash;
      if (!passwordHash) fail("请设置密码");
      const row = {
        _id: id || randomUUID(),
        username: data.username,
        name: data.name.trim(),
        role: data.role,
        enabled: data.enabled !== false,
        passwordHash,
        revision: randomUUID(),
      };
      const next = this.rows.filter((a) => a._id !== row._id).concat(row);
      const events = [
        {
          _id: randomUUID(),
          actor,
          action: id ? "更新管理员账号" : "创建管理员账号",
          target: `accounts/${row._id}`,
          createdAt: Date.now(),
        },
        ...this.events,
      ];
      await writeFile(
        join(this.dir, "accounts.json.tmp"),
        JSON.stringify({ accounts: next, events }),
        { mode: 0o600 },
      );
      await rename(
        join(this.dir, "accounts.json.tmp"),
        join(this.dir, "accounts.json"),
      );
      this.rows = next;
      this.events = events;
      return publicAccount(row);
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async login(username, password) {
    const account = this.rows.find((a) => a.username === username);
    const valid = verify(password, account?.passwordHash || this.dummy);
    return valid && account?.enabled ? account : null;
  }
}

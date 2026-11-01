import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { HttpError } from "./model.mjs";
const collections = ["houses", "content", "users", "rooms", "admin_audit"];
export function seed() {
  return {
    houses: Array.from({ length: 16 }, (_, i) => ({
      _id: `demo-house-${i + 1}`,
      title: [
        "采光充足 · 温馨两居室",
        "公园旁的精装一居",
        "宽敞三居 · 即刻入住",
        "阳光小屋 · 独立阳台",
      ][i % 4],
      community: ["宇宙花园", "星河雅苑", "云端公寓"][i % 3],
      address: `${(i % 4) + 1} 栋 ${i + 1}02 室`,
      price: [2600, 1800, 3600, 2200][i % 4],
      area: [86, 48, 118, 62][i % 4],
      rooms: ["2室1厅", "1室1厅", "3室2厅", "2室1厅"][i % 4],
      orientation: "南",
      rentType: i % 4 ? "整租" : "合租",
      status: i % 5 === 0 ? "下架" : i % 7 === 0 ? "已租" : "在租",
      description: "本地演示房源，可自由编辑。修改不会同步至微信云环境。",
      cover: `/assets/room-${(i % 3) + 1}.jpg`,
      images: [],
      tags: ["近地铁", "采光好"],
      updatedAt: Date.now() - i * 3600000,
    })),
    content: [
      {
        _id: "demo-content-1",
        title: "让每一次归家，都更安心",
        type: "share",
        description: "欢迎来到宇宙物业智联。这里是本地演示内容。",
        author: "物业服务中心",
        image: "",
        enabled: true,
        sortOrder: 1,
      },
      {
        _id: "demo-content-2",
        title: "十一月社区便民服务日",
        type: "share",
        description: "一起让社区生活更美好。活动时间与地点待发布。",
        author: "物业服务中心",
        image: "",
        enabled: false,
        sortOrder: 2,
      },
    ],
    users: [
      {
        _id: "demo-user-1",
        name: "张女士（演示）",
        phone: "演示号码 001",
        houses: ["ROOM-101"],
      },
      {
        _id: "demo-user-2",
        name: "李先生（演示）",
        phone: "演示号码 002",
        houses: [],
      },
      {
        _id: "demo-user-3",
        name: "王女士（演示）",
        phone: "演示号码 003",
        houses: ["ROOM-102"],
      },
    ],
    rooms: [
      {
        _id: "demo-room-1",
        houseId: "ROOM-101",
        name: "1 栋 101 室",
        community: "宇宙花园",
        address: "1 栋 101 室",
        sortOrder: 1,
      },
      {
        _id: "demo-room-2",
        houseId: "ROOM-102",
        name: "1 栋 102 室",
        community: "宇宙花园",
        address: "1 栋 102 室",
        sortOrder: 2,
      },
    ],
    admin_audit: [],
  };
}
export class LocalStore {
  constructor(directory) {
    this.directory = directory;
    this.queue = Promise.resolve();
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      this.data = JSON.parse(
        await readFile(join(this.directory, "demo-data.json"), "utf8"),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.data = seed();
      await this.persist(this.data);
    }
    return this;
  }
  async persist(data) {
    const file = join(this.directory, "demo-data.json");
    await writeFile(file + ".tmp", JSON.stringify(data), { mode: 0o600 });
    await rename(file + ".tmp", file);
  }
  async list(name) {
    return structuredClone(this.data[name] || []);
  }
  async change(name, id, build, audit) {
    const task = this.queue.then(async () => {
      const next = structuredClone(this.data);
      const rows = next[name];
      const old = id ? rows.find((r) => r._id === id) : null;
      if (id && !old) throw new HttpError(404, "记录不存在");
      const value = await build(old);
      if (
        name === "rooms" &&
        rows.some((r) => r.houseId === value.houseId && r._id !== id)
      )
        throw new HttpError(409, "房产编号已存在");
      id = id || randomUUID();
      const record = { ...old, ...value, _id: id, updatedAt: Date.now() };
      if (old)
        rows.splice(
          rows.findIndex((r) => r._id === id),
          1,
          record,
        );
      else rows.push(record);
      next.admin_audit.unshift({
        ...audit,
        _id: randomUUID(),
        target: `${name}/${id}`,
        createdAt: Date.now(),
      });
      await this.persist(next);
      this.data = next;
      return structuredClone(record);
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
export class CloudStore {
  constructor(app) {
    this.app = app;
    this.db = app.database({ throwOnCode: true });
  }
  async list(name) {
    if (!collections.includes(name)) throw Error("Invalid collection");
    const result = [];
    let skip = 0;
    while (true) {
      const r = await this.db
        .collection(name)
        .orderBy("_id", "asc")
        .skip(skip)
        .limit(100)
        .get();
      if (r.code || !Array.isArray(r.data))
        throw new HttpError(503, "云数据库查询失败");
      result.push(...r.data);
      if (r.data.length < 100) break;
      skip += 100;
      if (skip >= 20000)
        throw new HttpError(503, "集合超出本期查询容量，请升级服务端分页查询");
    }
    return result;
  }
  async change(name, id, build, audit) {
    const isNew = !id;
    const initial = isNew ? await build(null) : null;
    id =
      id ||
      (name === "rooms"
        ? "room-" +
          createHash("sha256")
            .update(initial.houseId)
            .digest("hex")
            .slice(0, 32)
        : randomUUID());
    return this.db.runTransaction(async (tx) => {
      const ref = tx.collection(name).doc(id);
      const found = await ref.get();
      if (found.code) throw new HttpError(503, "云数据库读取失败");
      const old = Array.isArray(found.data) ? found.data[0] : found.data;
      if (isNew && old) throw new HttpError(409, "记录已存在");
      const value = initial || (await build(old || null));
      const record = { ...old, ...value, updatedAt: Date.now() };
      delete record._id;
      const saved = await ref.set(record);
      if (saved?.code) throw new HttpError(503, "云数据库写入失败");
      const logged = await tx
        .collection("admin_audit")
        .doc(randomUUID())
        .set({ ...audit, target: `${name}/${id}`, createdAt: Date.now() });
      if (logged?.code)
        throw new HttpError(503, "操作日志保存失败，业务写入已回滚");
      return { ...record, _id: id };
    });
  }
}

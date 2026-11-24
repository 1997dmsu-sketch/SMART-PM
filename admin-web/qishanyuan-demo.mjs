/** Isolated local assembly; importing this module never initializes or listens. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { initializeQishanyuanTestData } from "./lib/qishanyuan-test-data.mjs";

export async function createQishanyuanDemo({ adminDirectory, origin, secure = false, createAppFactory } = {}) {
  const initialized = await initializeQishanyuanTestData({ adminDirectory });
  const createApp = createAppFactory || (await import("./server.mjs")).createApp;
  const app = await createApp({
    mode: "demo", directory: initialized.directory, store: initialized.store,
    origin, secure,
  });
  return { ...app, testPreset: { created: initialized.created, summary: initialized.summary } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 4173);
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("栖山苑测试实例只允许本机监听。");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT需为1–65535的整数。");
  if (process.env.ADMIN_MODE && process.env.ADMIN_MODE !== "demo") throw new Error("栖山苑测试实例不支持live模式。");
  const origin = `http://${host === "::1" ? "[::1]" : host}:${port}`;
  const app = await createQishanyuanDemo({ origin });
  app.server.listen(port, host, () => console.log(`栖山苑本地测试管理：${origin}（隔离数据；不连接生产云）`));
}

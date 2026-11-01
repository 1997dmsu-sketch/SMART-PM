import { Accounts } from "./lib/auth.mjs";
import { fileURLToPath } from "node:url";
const dir =
  process.env.ADMIN_DATA_DIR ||
  fileURLToPath(new URL(".data/live", import.meta.url));
const accounts = await new Accounts(dir).init();
if (accounts.rows.some((a) => a.role === "admin" && a.enabled))
  throw Error("管理员已存在，请登录后台管理账号；不覆盖现有账号。");
await accounts.save({
  username: process.env.ADMIN_USERNAME,
  name: process.env.ADMIN_NAME || "系统管理员",
  password: process.env.ADMIN_PASSWORD,
  role: "admin",
  enabled: true,
});
console.log("管理员已创建。请清除 ADMIN_PASSWORD 环境变量，然后启动后台。");

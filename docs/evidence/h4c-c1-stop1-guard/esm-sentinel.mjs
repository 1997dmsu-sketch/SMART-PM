import { request } from "node:http";

let blocked = false;
try {
  request("http://127.0.0.1:9/");
} catch (error) {
  blocked = error.code === "H4C_GUARD_BLOCKED";
}
if (!blocked) {
  console.error("ESM_SENTINEL_NOT_BLOCKED");
  process.exit(1);
}
console.log("ESM_SENTINEL_BLOCKED");

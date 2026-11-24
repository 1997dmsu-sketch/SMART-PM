/** Explicit, isolated local test baseline. Never seeds demo/live or publishes houses. */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { LocalStore } from "./store.mjs";

const require = createRequire(import.meta.url);
const { getPreset, PRESET_ID, SCHEMA_VERSION } = require("../../miniprogram/data/qishanyuan-test-preset.js");
const defaultAdminDirectory = fileURLToPath(new URL("../", import.meta.url));
const MARKER_FILE = "qishanyuan-test-marker.json";
const DATA_FILE = "demo-data.json";

function refuse() {
  const error = new Error("栖山苑测试目录已有未知或不完整数据；为保护记录，本次未初始化或覆盖。请人工核对专用目录。");
  error.code = "QISHANYUAN_TEST_DATA_CONFLICT";
  throw error;
}
async function requireDirectory(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) refuse();
}
async function requirePlainFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) refuse();
}
function baseline() {
  const preset = getPreset();
  return {
    houses: [], content: [], users: [], rooms: preset.rooms,
    property_catalog: preset.catalog, admin_audit: [],
    qishanyuanTestPreset: { presetId: PRESET_ID, schemaVersion: SCHEMA_VERSION, isTestData: true },
  };
}
function markerFor(data) {
  return {
    kind: "qishanyuan-local-test-baseline", presetId: PRESET_ID,
    schemaVersion: SCHEMA_VERSION, isTestData: true, dataFile: DATA_FILE,
    initialDataSha256: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
    initialRoomCount: 242, initialPublicRoomCount: 232, initialInternalRoomCount: 10,
  };
}
function sameObject(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const keys = Object.keys(expected);
  return Object.keys(actual).length === keys.length && keys.every((key) => actual[key] === expected[key]);
}

/** adminDirectory is an application root, not a freely chosen data-file path. */
export function qishanyuanTestDirectory(adminDirectory = defaultAdminDirectory) {
  return join(resolve(adminDirectory), ".data", PRESET_ID);
}

/**
 * First run creates one dedicated directory and two create-only files. A partial
 * initialization remains blocked for manual review. Recognized restarts do not
 * rewrite data: normal property edits, accounts and additional collections stay.
 */
export async function initializeQishanyuanTestData({ adminDirectory = defaultAdminDirectory } = {}) {
  const root = resolve(adminDirectory);
  await requireDirectory(root);
  const parent = join(root, ".data");
  try { await mkdir(parent, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  await requireDirectory(parent);
  const directory = qishanyuanTestDirectory(root);
  const data = baseline();
  const marker = markerFor(data);
  let created = false;
  try {
    await mkdir(directory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await requireDirectory(directory);
  if (created) {
    // Never call LocalStore.init() before these exist: its default seed differs.
    await writeFile(join(directory, DATA_FILE), JSON.stringify(data), { flag: "wx", mode: 0o600 });
    await writeFile(join(directory, MARKER_FILE), JSON.stringify(marker), { flag: "wx", mode: 0o600 });
  } else {
    let saved, savedMarker;
    try {
      await requirePlainFile(join(directory, DATA_FILE));
      await requirePlainFile(join(directory, MARKER_FILE));
      saved = JSON.parse(await readFile(join(directory, DATA_FILE), "utf8"));
      savedMarker = JSON.parse(await readFile(join(directory, MARKER_FILE), "utf8"));
    } catch { refuse(); }
    if (!sameObject(savedMarker, marker) ||
      !sameObject(saved?.qishanyuanTestPreset, data.qishanyuanTestPreset) ||
      !["houses", "content", "users", "rooms", "property_catalog", "admin_audit"].every((name) => Array.isArray(saved[name]))) refuse();
  }
  const store = await new LocalStore(directory).init();
  return { directory, store, created, summary: getPreset().summary };
}

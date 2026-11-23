/**
 * 从设备响应中抽取结构化信息，并生成**已脱敏**的报告。
 * 解析失败不抛错，而是记入 checks，保证部分成功时报告仍可用。
 */

function firstMatch(text, tag) {
  const match = String(text || "").match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

export function parseDeviceInfo(xml) {
  return {
    deviceName: firstMatch(xml, "deviceName"),
    model: firstMatch(xml, "model"),
    deviceType: firstMatch(xml, "deviceType"),
    firmwareVersion: firstMatch(xml, "firmwareVersion") || firstMatch(xml, "softwareVersion"),
    firmwareReleasedDate: firstMatch(xml, "firmwareReleasedDate"),
    serialNumber: firstMatch(xml, "serialNumber"),
    macAddress: firstMatch(xml, "macAddress"),
    encoderVersion: firstMatch(xml, "encoderVersion"),
  };
}

/**
 * 能力集：设备可能返回 XML 或 JSON。
 * XML 形态通常是 `<能力名>true</能力名>`，不支持的能力不返回。
 */
export function parseCapabilities(body) {
  const text = typeof body === "string" ? body : body?.toString?.("utf8") || "";
  const supported = [];
  const seen = new Set();

  const xmlPattern = /<([A-Za-z][A-Za-z0-9_]*)\s*(?:version="[^"]*")?\s*>\s*(true|false)\s*<\/\1>/g;
  let match;
  while ((match = xmlPattern.exec(text)) !== null) {
    const name = match[1];
    const value = match[2] === "true";
    if (seen.has(name)) continue;
    seen.add(name);
    if (value) supported.push(name);
  }

  if (!supported.length) {
    try {
      const json = JSON.parse(text);
      const walk = (node, prefix) => {
        if (!node || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node)) {
          const name = prefix ? `${prefix}.${key}` : key;
          if (value === true) {
            if (!seen.has(name)) {
              seen.add(name);
              supported.push(name);
            }
          } else if (value && typeof value === "object") {
            walk(value, name);
          }
        }
      };
      walk(json, "");
    } catch {
      // 非 JSON 且无布尔 XML：按空能力处理
    }
  }

  const faceRelated = supported.filter((name) => /face|fdlib|fdlibrary/i.test(name));
  return { supported, faceRelated, nodeCount: supported.length };
}

export function firstNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      const found = firstNumber(nested);
      if (found !== null) return found;
    }
    return null;
  }
  return null;
}

export function parseCount(body) {
  const text = typeof body === "string" ? body : body?.toString?.("utf8") || "";
  try {
    const json = JSON.parse(text);
    for (const [key, value] of Object.entries(json)) {
      if (/count|total/i.test(key) && Number.isFinite(Number(value))) return Number(value);
    }
    return firstNumber(json);
  } catch {
    const match = text.match(/>\s*(\d+)\s*</);
    return match ? Number(match[1]) : null;
  }
}

export function parseFdLibList(body) {
  const text = typeof body === "string" ? body : body?.toString?.("utf8") || "";
  try {
    const json = JSON.parse(text);
    const list = json.FDList || json.FDInfoList || json.List || [];
    if (Array.isArray(list)) {
      return list.map((item) => ({
        name: item.name || item.FDName || "",
        type: item.faceLibType || item.type || "",
        count: Number(item.count ?? item.faceCount ?? 0) || 0,
      }));
    }
  } catch {
    // XML 形态：只统计 `<FDList>` 数量
  }
  const items = (text.match(/<FDInfo>/g) || []).length;
  return { count: items };
}

/**
 * 组装报告。所有身份字段在这里脱敏，调用方不需要再处理。
 */
export function buildReport({ target, results, generatedAt }) {
  const byId = Object.fromEntries(results.map((item) => [item.id, item]));
  const deviceRaw = byId.deviceInfo?.parsed || {};
  const caps = parseCapabilities(byId.acsCapabilities?.body || "");
  const userCaps = parseCapabilities(byId.userInfoCapabilities?.body || "");
  const fdlibCaps = parseCapabilities(byId.fdlibCapabilities?.body || "");

  const checks = results.map((item) => ({
    id: item.id,
    status: item.status,
    ok: item.status === 200 && !item.error,
    contentType: item.contentType || "",
    error: item.error || "",
  }));

  return {
    generatedAt,
    target,
    device: {
      model: deviceRaw.model || "",
      deviceType: deviceRaw.deviceType || "",
      firmwareVersion: deviceRaw.firmwareVersion || "",
      firmwareReleasedDate: deviceRaw.firmwareReleasedDate || "",
    },
    capabilities: {
      acsNodeCount: caps.nodeCount,
      faceRelated: caps.faceRelated,
      supportedSample: caps.supported.slice(0, 40),
      userInfoFaceRelated: userCaps.faceRelated,
      fdlibFaceRelated: fdlibCaps.faceRelated,
      faceLibraryManagement: caps.supported.some((name) => /facelib|fdlib|facelibrary/i.test(name)),
    },
    counts: {
      faceRecords: parseCount(byId.fdlibCount?.body || ""),
    },
    checks,
    blockers: checks.filter((check) => !check.ok).map((check) => `${check.id}: ${check.error || "HTTP " + check.status}`),
  };
}

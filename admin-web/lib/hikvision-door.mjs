/** Ordinary, one-shot Hikvision opening. No arbitrary command or target API. */
export class DoorError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const unknown = () => ({ status: "unknown", deviceStatusCode: null });
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const label = value => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f<>]/.test(value);
const door = value => Number.isSafeInteger(value) && value >= 1 && value <= 65535;
// JSON and XML syntax whitespace is only SP, HTAB, CR and LF. Generic trim/\s
// would erase unsupported response bytes before the grammar can reject them.
const syntaxTrim = value => value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");

// Small bounded XML reader: no DTD, entity expansion, comments, CDATA or mixed
// content. It consumes the entire document and checks every closing tag. Device
// responses use ordinary element/text nodes; unsupported XML fails closed.
function xmlDocument(text) {
  if (typeof text !== "string" || text.length > 65536 || /<!|&|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new DoorError("DEVICE_XML_INVALID");
  const source = syntaxTrim(text).replace(/^<\?xml[ \t\r\n]+version=["']1\.0["'](?:[ \t\r\n]+encoding=["']UTF-8["'])?[ \t\r\n]*\?>[ \t\r\n]*/i, "");
  const stack = []; let root = null, index = 0, nodes = 0;
  const name = "[A-Za-z_][A-Za-z0-9_.:-]*";
  const opening = new RegExp(`^<(${name})((?:[ \\t\\r\\n]+${name}[ \\t\\r\\n]*=[ \\t\\r\\n]*(?:\"[^\"<>]*\"|'[^'<>]*'))*)[ \\t\\r\\n]*(/?)>`);
  while (index < source.length) {
    if (source[index] !== "<") {
      const next = source.indexOf("<", index), end = next < 0 ? source.length : next;
      const value = source.slice(index, end);
      if (!stack.length) { if (syntaxTrim(value)) throw new DoorError("DEVICE_XML_INVALID"); }
      else stack.at(-1).text += value;
      index = end; continue;
    }
    const close = new RegExp(`^</(${name})[ \\t\\r\\n]*>`).exec(source.slice(index));
    if (close) {
      const node = stack.pop();
      if (!node || node.qualifiedName !== close[1] || (node.children.length && syntaxTrim(node.text))) throw new DoorError("DEVICE_XML_INVALID");
      index += close[0].length; continue;
    }
    const match = opening.exec(source.slice(index));
    if (!match || ++nodes > 256 || stack.length > 16) throw new DoorError("DEVICE_XML_INVALID");
    const attributes = [...match[2].matchAll(/[ \t\r\n]+([A-Za-z_][A-Za-z0-9_.:-]*)[ \t\r\n]*=/g)].map(value => value[1]);
    if (new Set(attributes).size !== attributes.length) throw new DoorError("DEVICE_XML_INVALID");
    const node = { qualifiedName: match[1], name: match[1].split(":").at(-1), text: "", children: [] };
    if (stack.length) stack.at(-1).children.push(node);
    else { if (root) throw new DoorError("DEVICE_XML_INVALID"); root = node; }
    if (!match[3]) stack.push(node);
    index += match[0].length;
  }
  if (!root || stack.length) throw new DoorError("DEVICE_XML_INVALID");
  return root;
}

function directText(root, key) {
  const nodes = root.children.filter(node => node.name === key);
  if (nodes.length !== 1 || nodes[0].children.length) throw new DoorError("DEVICE_RESPONSE_INVALID");
  return syntaxTrim(nodes[0].text);
}

// JSON.parse alone silently accepts duplicate keys. The response schema is
// small: reject duplicates in every object with a complete, bounded reader.
function strictJson(text) {
  let position = 0, count = 0;
  const whitespace = () => { while (position < text.length && /[ \t\r\n]/.test(text[position])) position++; };
  function string() {
    const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(text.slice(position));
    if (!match) throw new DoorError("DEVICE_JSON_INVALID");
    position += match[0].length; return JSON.parse(match[0]);
  }
  function value(depth = 0) {
    whitespace(); if (depth > 16 || ++count > 256) throw new DoorError("DEVICE_JSON_INVALID");
    if (text[position] === '"') return string();
    if (text[position] === "{") {
      position++; whitespace(); const result = Object.create(null), keys = new Set();
      if (text[position] === "}") { position++; return result; }
      while (true) {
        whitespace(); const key = string(); if (keys.has(key)) throw new DoorError("DEVICE_JSON_INVALID"); keys.add(key);
        whitespace(); if (text[position++] !== ":") throw new DoorError("DEVICE_JSON_INVALID");
        result[key] = value(depth + 1); whitespace(); const separator = text[position++];
        if (separator === "}") return result;
        if (separator !== ",") throw new DoorError("DEVICE_JSON_INVALID");
      }
    }
    if (text[position] === "[") {
      position++; whitespace(); const result = []; if (text[position] === "]") { position++; return result; }
      while (true) { result.push(value(depth + 1)); whitespace(); const separator = text[position++]; if (separator === "]") return result; if (separator !== ",") throw new DoorError("DEVICE_JSON_INVALID"); }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position));
    if (!match) throw new DoorError("DEVICE_JSON_INVALID"); position += match[0].length; return JSON.parse(match[0]);
  }
  const result = value(); whitespace(); if (position !== text.length) throw new DoorError("DEVICE_JSON_INVALID"); return result;
}

function responseText(response) {
  if (!response || !Number.isInteger(response.status) || !Buffer.isBuffer(response.body) || !response.body.length || response.body.length > 65536) throw new DoorError("DEVICE_RESPONSE_INVALID");
  // Round-trip rejects invalid UTF-8 instead of parsing replacement characters.
  const text = response.body.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(response.body)) throw new DoorError("DEVICE_RESPONSE_INVALID");
  return text;
}

export function parseDoorResponse(response) {
  try {
    if (response.status !== 200) return unknown();
    const text = responseText(response); let fields;
    if (syntaxTrim(text).startsWith("{")) {
      const value = strictJson(text);
      if (!object(value)) return unknown();
      if (Object.hasOwn(value, "ResponseStatus")) {
        if (Object.keys(value).length !== 1 || !object(value.ResponseStatus)) return unknown();
        fields = value.ResponseStatus;
      } else fields = value;
    } else {
      const root = xmlDocument(text); if (root.name !== "ResponseStatus") return unknown();
      fields = Object.create(null);
      for (const node of root.children) {
        if (Object.hasOwn(fields, node.name) || node.children.length) return unknown();
        fields[node.name] = syntaxTrim(node.text);
      }
    }
    if (Object.keys(fields).some(key => !["requestURL", "statusCode", "statusString", "subStatusCode", "errorCode", "errorMsg"].includes(key))) return unknown();
    if (typeof fields.statusCode !== "number" && typeof fields.statusCode !== "string") return unknown();
    const code = String(fields.statusCode);
    if (!/^[1-7]$/.test(code) || !label(fields.statusString) || !label(fields.subStatusCode)) return unknown();
    const successText = fields.statusString === "OK", successSub = fields.subStatusCode === "ok";
    if (code === "1") {
      if ((fields.errorCode !== undefined && fields.errorCode !== 0 && fields.errorCode !== "0") || (fields.errorMsg !== undefined && fields.errorMsg !== "")) return unknown();
      return successText && successSub ? { status: "device_confirmed", deviceStatusCode: "1" } : unknown();
    }
    if (successText || successSub) return unknown();
    return { status: "failed", deviceStatusCode: code };
  } catch { return unknown(); }
}

export class HikvisionDoorProvider {
  #client; #verifiedDoor = null; #attempted = false; #closed = false;
  constructor(client) {
    if (!client || typeof client.request !== "function" || typeof client.close !== "function") throw new DoorError("DEVICE_CLIENT_INVALID");
    this.#client = client;
  }
  async verifyTarget({ expectedModel, doorNo } = {}) {
    if (this.#closed || this.#attempted || !label(expectedModel) || !door(doorNo)) throw new DoorError("DEVICE_TARGET_INVALID");
    this.#verifiedDoor = null;
    const response = await this.#client.request({ method: "GET", path: "/ISAPI/System/deviceInfo" });
    if (response.status !== 200) throw new DoorError("DEVICE_MODEL_UNCONFIRMED");
    const text = responseText(response); let actualModel;
    if (syntaxTrim(text).startsWith("{")) {
      const body = strictJson(text);
      if (!object(body) || Object.keys(body).length !== 1 || !object(body.DeviceInfo)) throw new DoorError("DEVICE_MODEL_UNCONFIRMED");
      actualModel = body.DeviceInfo.model;
    } else {
      const root = xmlDocument(text); if (root.name !== "DeviceInfo") throw new DoorError("DEVICE_MODEL_UNCONFIRMED");
      actualModel = directText(root, "model");
    }
    if (!label(actualModel) || actualModel !== expectedModel) throw new DoorError("DEVICE_MODEL_MISMATCH");
    this.#verifiedDoor = doorNo;
  }
  async openOnce({ doorNo } = {}) {
    if (this.#closed || this.#attempted || !door(doorNo) || this.#verifiedDoor !== doorNo) throw new DoorError("DEVICE_EXECUTION_FORBIDDEN");
    // Consume before awaiting: exceptions/timeouts can never make this object
    // eligible to send another business command. Digest 401 is handled by the
    // secured client as authentication for this one logical request.
    this.#attempted = true;
    try {
      return parseDoorResponse(await this.#client.request({
        method: "PUT", path: `/ISAPI/AccessControl/RemoteControl/door/${doorNo}`,
        contentType: "application/xml", body: '<?xml version="1.0" encoding="UTF-8"?><RemoteControlDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><cmd>open</cmd></RemoteControlDoor>',
      }));
    } catch { return unknown(); }
  }
  close() { this.#closed = true; this.#verifiedDoor = null; this.#client.close(); }
}

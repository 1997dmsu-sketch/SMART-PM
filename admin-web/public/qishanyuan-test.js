/** Same-origin read-only admin preview. No import/booking/payment actions. */
export function roomPreview(row) {
  return {
    roomNo: String(row.roomNo || ""), floor: `${row.floorNumber} 层`,
    layout: row.layoutStatus === "configured" ? row.layoutName : "待配置",
    visibility: row.listingVisible === true && row.floorNumber >= 2 ? "公开测试展示" : "内部隐藏（不可对外查询）",
    price: row.price === null || row.price === undefined ? "待配置" : `${row.price} 元/月`,
    area: row.area === null || row.area === undefined ? "待配置" : `${row.area} ㎡`,
    address: row.address || "地址待配置",
  };
}
export function createQishanyuanPreview({ document: doc, fetch: fetcher }) {
  let rooms = [];
  const $ = (id) => doc.getElementById(id);
  function render() {
    const floor = $("preset-floor").value;
    const fragment = doc.createDocumentFragment();
    for (const room of rooms.filter((row) => !floor || String(row.floorNumber) === floor)) {
      const view = roomPreview(room), tr = doc.createElement("tr");
      for (const value of [view.roomNo, view.floor, view.layout, view.visibility, view.price, view.area, view.address]) {
        const cell = doc.createElement("td");
        cell.textContent = value;
        tr.append(cell);
      }
      fragment.append(tr);
    }
    $("preset-rows").replaceChildren(fragment);
  }
  async function load() {
    $("reload-preset").disabled = true;
    $("preset-message").hidden = true;
    try {
      const response = await fetcher("/api/test-property-preset", { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "请先以管理账号登录，再查看测试基准。" : "暂时无法读取测试基准。");
      const payload = await response.json(), preset = payload.preset;
      if (preset?.presetId !== "qishanyuan-test-v1" || !Array.isArray(preset.rooms) || preset.rooms.length !== 242) throw new Error("测试基准格式不匹配，请核对服务端版本。");
      rooms = preset.rooms;
      $("preset-summary").textContent = `${preset.project.name} · ${preset.building.name} · 9 层 / 242 间 · 232 间公开测试 / 10 间内部隐藏；金额、面积及地址待配置，不可预订。`;
      render();
    } catch (error) {
      rooms = [];
      render();
      $("preset-summary").textContent = "尚未取得测试基准。";
      $("preset-message").textContent = error.message || "读取失败，请刷新后重试。";
      $("preset-message").hidden = false;
    } finally { $("reload-preset").disabled = false; }
  }
  $("reload-preset").addEventListener("click", load);
  $("preset-floor").addEventListener("change", render);
  return { load };
}
if (typeof document !== "undefined" && typeof fetch === "function") {
  createQishanyuanPreview({ document, fetch }).load();
}

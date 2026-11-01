import { floorPlan, roomPlan } from "./auto-fill.js";
export function openAutoFill(
  kind,
  {
    catalog,
    rooms,
    buildingId,
    floorId,
    api,
    esc,
    field,
    openDialog,
    toast,
    refresh,
    manual,
  },
) {
  const $ = (s) => document.querySelector(s);
  const buildings = catalog.filter((c) => c.kind === "building");
  if (!buildings.length) {
    toast("请先添加小区和楼栋");
    return;
  }
  const selectedBuilding = buildingId || buildings[0]._id;
  const selectedFloor = catalog.find((c) => c._id === floorId);
  const start = kind === "floors" ? 1 : selectedFloor?.level || 1;
  const number = (name, label, value, min, max) =>
    `<label class="field">${label}<input name="${name}" type="number" min="${min}" max="${max}" step="1" required value="${value}"></label>`;
  let fields =
    field("buildingId", "所属楼栋", selectedBuilding, {
      full: true,
      required: true,
      choices: buildings.map((b) => [
        b._id,
        `${catalog.find((c) => c._id === b.parentId)?.name || ""} / ${b.name}`,
      ]),
    }) +
    number("start", "起始楼层", start, -10, 200) +
    number("end", "结束楼层", kind === "floors" ? 5 : start, -10, 200);
  if (kind === "floors")
    fields +=
      field("template", "楼层名称规则", "{n}层", {
        full: true,
        help: "{n} 自动替换为楼层序号，例如 {n}F 或 第{n}层。",
      }) +
      field("skip", "跳过楼层（可选）", "", {
        full: true,
        help: "例如 4,13；不会默认跳过任何楼层。",
      });
  else
    fields +=
      number("count", "每层生成数量", 8, 1, 50) +
      number("first", "房间起始序号", 1, 0, 999) +
      '<details class="auto-advanced"><summary>更多编号规则（前缀、位数、跳过房号）</summary><div class="form-grid">' +
      field("digits", "序号位数", 2, {
        choices: [
          [1, "1 位：11、12"],
          [2, "2 位：101、102"],
          [3, "3 位：1001、1002"],
        ],
      }) +
      field("prefix", "房号前缀（可选）", "", {
        help: "例如 A- → A-101、A-102",
      }) +
      field("skip", "跳过完整房号（可选）", "", {
        full: true,
        help: "例如 104,204。跳过后不补足数量，以预览为准。",
      }) +
      "</div></details>" +
      field("layoutId", "统一户型（可选）", "", {
        full: true,
        choices: [["", "暂不设置"]],
      });
  openDialog(
    kind === "floors" ? "自动添加楼层" : "自动添加房间",
    "① 设置规则　→　② 自动预览　→　③ 确认添加",
    `<form id="auto-form" class="editor-body"><div class="form-grid">${fields}</div><div class="notice autofill-note">${kind === "floors" ? "每次最多 50 层。已存在的楼层自动跳过，不更改名称。" : "房号 = 前缀 + 楼层号 + 房间序号。地下层使用 B1、B2。每次最多 50 间，需先建好对应楼层。"}<br>只新增，不覆盖已有房间或自动上架。</div><section class="auto-preview" aria-live="polite"><h3>自动填充预览</h3><div id="auto-summary"></div><div id="auto-list"></div></section><div class="form-error" role="alert"></div></form>`,
    `<button class="btn" id="manual-fill">${kind === "floors" ? "单层添加" : "手动输入房号"}</button><button class="btn" data-close>取消</button><button class="btn primary" form="auto-form" id="auto-save">确认添加</button>`,
  );
  let pending = false;
  const data = () => Object.fromEntries(new FormData($("#auto-form")));
  const fillLayouts = () => {
    const select = $('[name="layoutId"]');
    if (select)
      select.innerHTML =
        '<option value="">暂不设置</option>' +
        catalog
          .filter(
            (c) =>
              c.kind === "layout" &&
              c.parentId === $('[name="buildingId"]').value,
          )
          .map(
            (l) =>
              `<option value="${esc(l._id)}">${esc(l.code)} · ${esc(l.name)}</option>`,
          )
          .join("");
  };
  fillLayouts();
  const preview = () => {
    if (pending) return;
    try {
      const d = data();
      const plan = kind === "floors" ? floorPlan(d) : roomPlan(d, catalog);
      const rows = plan.map((p) => ({
        ...p,
        exists:
          kind === "floors"
            ? catalog.some(
                (c) =>
                  c.kind === "floor" &&
                  c.parentId === d.buildingId &&
                  c.level === p.level,
              )
            : rooms.some(
                (r) => r.floorId === p.floorId && r.roomNo === p.number,
              ),
      }));
      const added = rows.filter((r) => !r.exists).length;
      $("#auto-summary").textContent =
        `将新增 ${added} ${kind === "floors" ? "层" : "间"}，跳过已存在 ${rows.length - added} ${kind === "floors" ? "层" : "间"}`;
      $("#auto-list").innerHTML = rows
        .map(
          (r) =>
            `<span class="auto-chip ${r.exists ? "exists" : ""}">${esc(kind === "floors" ? r.name : r.floorName + " · " + r.number)}${r.exists ? " · 已有" : ""}</span>`,
        )
        .join("");
      $("#auto-form .form-error").textContent = "";
      $("#auto-save").disabled = added === 0;
      $("#auto-save").textContent =
        `确认添加 ${added} ${kind === "floors" ? "层" : "间"}`;
      return d;
    } catch (e) {
      $("#auto-summary").textContent = "请调整填写内容";
      $("#auto-list").replaceChildren();
      $("#auto-form .form-error").textContent = e.message;
      $("#auto-save").disabled = true;
      return null;
    }
  };
  $("#auto-form").addEventListener("input", preview);
  $("#auto-form").addEventListener("change", (e) => {
    if (e.target.name === "buildingId") fillLayouts();
    preview();
  });
  $("#manual-fill").onclick = manual;
  $("#auto-form").onsubmit = async (e) => {
    e.preventDefault();
    const d = preview();
    if (!d) return;
    pending = true;
    const buttons = [...$("#editor").querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const result = await api("property/auto-" + kind, {
        method: "POST",
        data: d,
      });
      $("#editor").close();
      toast(
        `新增 ${result.count} ${kind === "floors" ? "层" : "间"}，跳过已有 ${result.skipped}`,
      );
      await refresh();
    } catch (error) {
      if ($("#auto-form .form-error"))
        $("#auto-form .form-error").textContent = error.message;
      else toast(error.message);
    } finally {
      pending = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  };
  preview();
}

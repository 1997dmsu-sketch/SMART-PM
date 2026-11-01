// Property inventory is separate from rental marketing records.
export function mountProperties(snapshot, helpers) {
  const {
    api,
    esc,
    icon,
    head,
    footer,
    openDialog,
    field,
    toast,
    confirmAction,
    writable,
    isActive,
  } = helpers;
  const $ = (s) => document.querySelector(s);
  let catalog = snapshot.catalog,
    rooms = snapshot.rooms,
    communityId = "",
    buildingId = "",
    floorId = "",
    keyword = "",
    orphan = false,
    page = 1;
  const selected = new Set();
  const of = (kind) => catalog.filter((c) => c.kind === kind);
  const title = (id) => catalog.find((c) => c._id === id)?.name || "";
  const options = (items, value, empty) =>
    `<option value="">${empty}</option>` +
    items
      .map(
        (r) =>
          `<option value="${esc(r._id)}" ${r._id === value ? "selected" : ""}>${esc(r.name)}</option>`,
      )
      .join("");
  async function refresh() {
    const data = await api("property/snapshot");
    if (!isActive()) return;
    catalog = data.catalog;
    rooms = data.rooms;
    selected.clear();
    render();
  }
  function form(title, subtitle, fields, save) {
    openDialog(
      title,
      subtitle,
      `<form id="property-form" class="editor-body"><div class="form-grid">${fields}</div><div class="form-error" role="alert"></div></form>`,
      '<button class="btn" data-close>取消</button><button class="btn primary" form="property-form">保存</button>',
    );
    $("#property-form").onsubmit = async (e) => {
      e.preventDefault();
      const button = $('[form="property-form"]');
      button.disabled = true;
      try {
        await save(Object.fromEntries(new FormData(e.target)));
        $("#editor").close();
        toast("已保存");
        await refresh();
      } catch (error) {
        if ($("#property-form .form-error"))
          $("#property-form .form-error").textContent = error.message;
        else toast(error.message);
      } finally {
        button.disabled = false;
      }
    };
  }
  function createCatalog(kind) {
    const names = {
      community: "小区",
      building: "楼栋",
      floor: "楼层",
      layout: "户型",
    };
    let fields = "";
    if (kind !== "community") {
      const parents = of(kind === "building" ? "community" : "building");
      if (!parents.length) {
        toast(kind === "building" ? "请先创建小区" : "请先创建楼栋");
        return;
      }
      fields += field(
        "parentId",
        kind === "building" ? "所属小区 *" : "所属楼栋 *",
        kind === "building" ? communityId : buildingId,
        {
          full: true,
          required: true,
          choices: [
            ["", "请选择"],
            ...parents.map((c) => [
              c._id,
              kind === "building" ? c.name : `${title(c.parentId)} / ${c.name}`,
            ]),
          ],
        },
      );
    }
    fields += field(
      "name",
      kind === "layout"
        ? "户型名称 *（如一房一厅、单间）"
        : `${names[kind]}名称 *`,
      "",
      { full: true, required: true },
    );
    if (kind === "floor")
      fields += `<label class="field full">楼层序号 *<input name="level" type="number" min="-10" max="200" step="1" required placeholder="例如 1；地下层可填 -1"></label>`;
    if (kind === "layout")
      fields +=
        field("code", "户型编码 *（如 A1）", "", {
          full: true,
          required: true,
        }) +
        field("bedrooms", "房间数", 1, { type: "number", required: true }) +
        field("livingRooms", "客厅数", 1, { type: "number", required: true });
    form(
      `新增${names[kind]}`,
      kind === "layout"
        ? "编码在楼栋内唯一，不同楼栋可以使用相同编码。"
        : "建立物业层级，后续可按楼层批量管理房间。",
      fields,
      async (d) => {
        d.kind = kind;
        for (const k of ["level", "bedrooms", "livingRooms"])
          if (k in d) d[k] = Number(d[k]);
        await api("property/catalog", { method: "POST", data: d });
      },
    );
  }
  function addRooms() {
    const floors = of("floor").filter(
      (f) => !buildingId || f.parentId === buildingId,
    );
    if (!floors.length) {
      toast("请先创建楼层");
      return;
    }
    form(
      "批量新增房间",
      "每批最多 50 间；同一楼层房号不可重复。不会自动上架出租。",
      field("floorId", "所属楼层 *", floorId, {
        full: true,
        required: true,
        choices: [
          ["", "请选择"],
          ...floors.map((f) => [
            f._id,
            `${title(catalog.find((c) => c._id === f.parentId)?.parentId)} / ${title(f.parentId)} / ${f.name}`,
          ]),
        ],
      }) +
        field("numbers", "房号 *", "", {
          full: true,
          textarea: true,
          required: true,
          help: "用逗号或换行分隔，例如 101,102,103。也可填写连续编号 101-110（不跨楼层）。",
        }) +
        field("layoutId", "户型（可稍后批量设置）", "", {
          full: true,
          choices: [["", "暂不设置"]],
        }),
      async (d) => {
        let value = d.numbers.trim();
        const range = value.match(/^(\d+)-(\d+)$/);
        let numbers;
        if (range) {
          const start = Number(range[1]),
            end = Number(range[2]);
          if (end < start || end - start >= 50)
            throw Error("连续房号每批需为 1–50 间");
          numbers = Array.from({ length: end - start + 1 }, (_, i) =>
            String(start + i).padStart(range[1].length, "0"),
          );
        } else numbers = value.split(/[,，\s]+/).filter(Boolean);
        await api("property/rooms", {
          method: "POST",
          data: { floorId: d.floorId, layoutId: d.layoutId, numbers },
        });
      },
    );
    const floorSelect = $('[name="floorId"]'),
      layoutSelect = $('[name="layoutId"]');
    const update = () => {
      const parent = catalog.find((c) => c._id === floorSelect.value)?.parentId;
      layoutSelect.innerHTML = options(
        of("layout").filter((l) => l.parentId === parent),
        "",
        "暂不设置",
      );
    };
    floorSelect.onchange = update;
    update();
  }
  async function batch() {
    const ids = [...selected],
      selection = rooms.filter((r) => selected.has(r._id));
    if (!ids.length) {
      toast("请先勾选房间");
      return;
    }
    if (ids.length > 30) {
      toast("每批最多 30 间，请缩小选择范围");
      return;
    }
    const building = selection[0].buildingId;
    if (!building || selection.some((r) => r.buildingId !== building)) {
      toast("请先按同一楼栋筛选，不能跨楼栋设置户型");
      return;
    }
    const layouts = of("layout").filter((l) => l.parentId === building);
    if (!layouts.length) {
      toast("请先为该楼栋创建户型");
      return;
    }
    form(
      "批量设置户型",
      `已选 ${ids.length} 间 · ${title(building)}。只更改户型，不修改租金、面积和展示状态。`,
      field("layoutId", "选择户型 *", "", {
        full: true,
        required: true,
        choices: [
          ["", "请选择"],
          ...layouts.map((l) => [l._id, `${l.code} · ${l.name}（${l.rooms}）`]),
        ],
      }) +
        `<div class="field full"><div class="notice">所选房间：${selection.map((r) => esc(r.roomNo || r.name)).join("、")}<br>已经关联的出租房源将同步更新户型。</div></div>`,
      async (d) => {
        const layout = catalog.find((l) => l._id === d.layoutId);
        if (
          !(await confirmAction(
            "确认批量设置户型？",
            `将 ${ids.length} 间房设置为 ${layout.code} · ${layout.name}。租金、面积、住户绑定不会改变。`,
          ))
        )
          throw Error("已取消，尚未修改");
        await api("property/layout", {
          method: "POST",
          data: { ids, layoutId: d.layoutId },
        });
      },
    );
  }
  function assign(room) {
    if (room.listingId) {
      toast("此房间已关联出租房源，可通过“批量设置户型”修改户型");
      return;
    }
    const floors = of("floor");
    if (!floors.length) {
      toast("请先创建小区、楼栋和楼层");
      return;
    }
    form(
      "归档房间",
      `保留原房产编号 ${room.houseId} 及已有住户绑定。`,
      field("floorId", "归属楼层 *", room.floorId || floorId, {
        full: true,
        required: true,
        choices: [
          ["", "请选择"],
          ...floors.map((f) => [
            f._id,
            `${title(catalog.find((c) => c._id === f.parentId)?.parentId)} / ${title(f.parentId)} / ${f.name}`,
          ]),
        ],
      }) +
        field("roomNo", "房号 *", room.roomNo || "", {
          full: true,
          required: true,
        }) +
        field("layoutId", "户型", "", {
          full: true,
          choices: [["", "暂不设置"]],
        }),
      async (d) =>
        api("property/assign", {
          method: "POST",
          data: { ...d, id: room._id },
        }),
    );
    const update = () => {
      const parent = catalog.find(
        (c) => c._id === $('[name="floorId"]').value,
      )?.parentId;
      $('[name="layoutId"]').innerHTML = options(
        of("layout").filter((l) => l.parentId === parent),
        room.layoutId,
        "暂不设置",
      );
    };
    $('[name="floorId"]').onchange = update;
    update();
  }
  function layouts() {
    const list = of("layout").filter(
      (l) => !buildingId || l.parentId === buildingId,
    );
    openDialog(
      "楼栋户型目录",
      "户型名称与户型编码分别保存；编码只在所属楼栋内唯一。",
      `<div class="editor-body">${list.length ? `<table><thead><tr><th>楼栋</th><th>编码</th><th>户型名称</th><th>房间 / 客厅</th></tr></thead><tbody>${list.map((l) => `<tr><td>${esc(title(l.parentId))}</td><td><b>${esc(l.code)}</b></td><td>${esc(l.name)}</td><td>${esc(l.rooms)}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">还没有户型，请先新增。</div>'}</div>`,
      `${writable ? '<button class="btn primary" id="add-layout">新增户型</button>' : ""}<button class="btn" data-close>关闭</button>`,
    );
    $("#add-layout")?.addEventListener("click", () => createCatalog("layout"));
  }
  function render() {
    if (!isActive()) return;
    const all = rooms.filter(
      (r) =>
        (!communityId || r.communityId === communityId) &&
        (!buildingId || r.buildingId === buildingId) &&
        (!floorId || r.floorId === floorId) &&
        (!orphan || !r.floorId) &&
        (!keyword ||
          [r.name, r.roomNo, r.houseId, r.layoutName, r.layoutCode].some((v) =>
            String(v || "")
              .toLowerCase()
              .includes(keyword.toLowerCase()),
          )),
    );
    all.sort(
      (a, b) =>
        String(a.community || "").localeCompare(
          String(b.community || ""),
          "zh-CN",
        ) ||
        String(a.buildingName || "").localeCompare(
          String(b.buildingName || ""),
          "zh-CN",
          { numeric: true },
        ) ||
        (catalog.find((c) => c._id === a.floorId)?.level || 0) -
          (catalog.find((c) => c._id === b.floorId)?.level || 0) ||
        String(a.roomNo || a.name).localeCompare(
          String(b.roomNo || b.name),
          "zh-CN",
          { numeric: true },
        ),
    );
    const visible = all.slice((page - 1) * 20, page * 20);
    const buildings = of("building").filter(
        (b) => !communityId || b.parentId === communityId,
      ),
      floors = of("floor")
        .filter((f) => !buildingId || f.parentId === buildingId)
        .sort((a, b) => a.level - b.level);
    $("#workspace").innerHTML =
      head(
        "整栋物业 · 房源管理",
        "按小区、楼栋、楼层维护房间；户型名称和编码分别管理。",
        writable
          ? '<button class="btn primary" id="new-rooms">批量新增房间</button>'
          : "",
      ) +
      `<div class="property-summary"><span><b>${of("community").length}</b> 个小区</span><span><b>${of("building").length}</b> 栋物业</span><span><b>${of("floor").length}</b> 个楼层</span><span><b>${rooms.length}</b> 间房</span><span class="muted">${rooms.filter((r) => !r.floorId).length} 间待归档</span></div><section class="panel"><div class="filters"><div class="property-tools">${writable ? '<button class="btn" id="new-community">＋ 小区</button><button class="btn" id="new-building">＋ 楼栋</button><button class="btn" id="new-floor">＋ 楼层</button>' : ""}<button class="btn" id="layouts">户型目录</button><button class="btn" id="property-refresh">刷新</button></div><a class="link" href="#houses">出租展示管理 →</a></div><div class="property-filter"><label>小区<select id="property-community">${options(of("community"), communityId, "全部小区")}</select></label><label>楼栋<select id="property-building">${options(
        buildings.map((b) => ({
          ...b,
          name: communityId ? b.name : title(b.parentId) + " / " + b.name,
        })),
        buildingId,
        "全部楼栋",
      )}</select></label><label>楼层<select id="property-floor">${options(
        floors.map((f) => ({
          ...f,
          name: buildingId ? f.name : title(f.parentId) + " / " + f.name,
        })),
        floorId,
        "全部楼层",
      )}</select></label><form id="property-search"><label>房号 / 户型<input name="keyword" value="${esc(keyword)}" placeholder="如 101、A1、一房一厅"></label><button class="btn">搜索</button></form></div><div class="property-batch"><label><input type="checkbox" id="orphans" ${orphan ? "checked" : ""}> 仅看待归档房间</label><span id="selection-count">已选择 ${selected.size} 间（当前筛选内）</span>${writable ? '<button class="btn primary" id="batch-layout">批量设置户型</button>' : ""}</div><div class="table-wrap"><table><thead><tr>${writable ? '<th><input type="checkbox" id="select-page" aria-label="全选本页"></th>' : ""}<th>房间</th><th>小区 / 楼栋 / 楼层</th><th>户型名称</th><th>户型编码</th><th>出租展示</th>${writable ? "<th>操作</th>" : ""}</tr></thead><tbody>${visible.map((r) => `<tr>${writable ? `<td><input type="checkbox" data-room-select="${esc(r._id)}" aria-label="选择房间 ${esc(r.roomNo || r.name)}" ${selected.has(r._id) ? "checked" : ""}></td>` : ""}<td><b>${esc(r.roomNo || r.name)}</b><br><small>${esc(r.houseId)}</small></td><td>${r.floorId ? `${esc(r.community)} / ${esc(r.buildingName)} / ${esc(r.floorName)}` : '<span class="badge amber">待归档</span>'}</td><td>${esc(r.layoutName || "未设置")}</td><td><span class="badge blue">${esc(r.layoutCode || "—")}</span></td><td>${r.listingId ? "已关联" : "未关联"}</td>${writable ? `<td><button class="link" data-assign-room="${esc(r._id)}">${r.floorId ? "修改归档" : "归档房间"}</button></td>` : ""}</tr>`).join("")}</tbody></table>${visible.length ? "" : '<div class="empty">没有符合条件的房间。可先新增小区、楼栋、楼层，再批量创建房间。</div>'}</div><div class="pagination"><span>共 ${all.length} 间 · 每页 20 间</span><div class="pages"><button id="property-prev" ${page <= 1 ? "disabled" : ""}>‹</button><span>${page}</span><small>/ ${Math.max(1, Math.ceil(all.length / 20))}</small><button id="property-next" ${page * 20 >= all.length ? "disabled" : ""}>›</button></div></div></section>` +
      footer();
    const reset = () => {
      selected.clear();
      page = 1;
      render();
    };
    $("#property-community").onchange = (e) => {
      communityId = e.target.value;
      buildingId = "";
      floorId = "";
      reset();
    };
    $("#property-building").onchange = (e) => {
      buildingId = e.target.value;
      floorId = "";
      if (buildingId)
        communityId = catalog.find((c) => c._id === buildingId).parentId;
      reset();
    };
    $("#property-floor").onchange = (e) => {
      floorId = e.target.value;
      if (floorId) {
        buildingId = catalog.find((c) => c._id === floorId).parentId;
        communityId = catalog.find((c) => c._id === buildingId).parentId;
      }
      reset();
    };
    $("#orphans").onchange = (e) => {
      orphan = e.target.checked;
      reset();
    };
    $("#property-search").onsubmit = (e) => {
      e.preventDefault();
      keyword = new FormData(e.target).get("keyword");
      reset();
    };
    $("#property-prev").onclick = () => {
      page--;
      render();
    };
    $("#property-next").onclick = () => {
      page++;
      render();
    };
    $("#layouts").onclick = layouts;
    $("#property-refresh").onclick = () =>
      refresh().catch((e) => toast(e.message));
    for (const kind of ["community", "building", "floor"])
      $("#new-" + kind)?.addEventListener("click", () => createCatalog(kind));
    $("#new-rooms")?.addEventListener("click", addRooms);
    $("#batch-layout")?.addEventListener("click", batch);
    const update = () => {
      $("#selection-count").textContent =
        `已选择 ${selected.size} 间（当前筛选内）`;
      const select = $("#select-page");
      if (select) {
        select.checked =
          visible.length > 0 && visible.every((r) => selected.has(r._id));
        select.indeterminate =
          visible.some((r) => selected.has(r._id)) && !select.checked;
      }
    };
    document.querySelectorAll("[data-room-select]").forEach(
      (b) =>
        (b.onchange = () => {
          if (b.checked) selected.add(b.dataset.roomSelect);
          else selected.delete(b.dataset.roomSelect);
          update();
        }),
    );
    $("#select-page")?.addEventListener("change", (e) => {
      for (const r of visible) {
        if (e.target.checked) selected.add(r._id);
        else selected.delete(r._id);
      }
      render();
    });
    document
      .querySelectorAll("[data-assign-room]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            assign(rooms.find((r) => r._id === b.dataset.assignRoom))),
      );
    update();
  }
  render();
}

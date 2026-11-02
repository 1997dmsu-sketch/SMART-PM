// Each request remains within the transactional limit; successful batches persist.
export async function applyLayoutBatches(
  api,
  ids,
  layoutId,
  progress = () => {},
) {
  if (!ids.length || new Set(ids).size !== ids.length)
    throw Error("请选择不同的房间");
  let completed = 0;
  try {
    for (let offset = 0; offset < ids.length; offset += 30) {
      const batch = ids.slice(offset, offset + 30);
      const result = await api("property/layout", {
        method: "POST",
        data: { ids: batch, layoutId },
      });
      if (result.count !== batch.length) throw Error("批次返回异常");
      completed += batch.length;
      progress(completed, ids.length);
    }
  } catch (error) {
    throw Error(
      `已确认设置 ${completed} / ${ids.length} 间。${error.message}。已完成部分保留；未收到响应的批次也可能已保存，可保持相同选择和户型重试。`,
    );
  }
}

export function mountLayoutRooms(
  root,
  { catalog, rooms, initialBuilding, initialIds, esc, onBuilding },
) {
  const chosen = new Set(initialIds);
  const buildings = catalog.filter((c) => c.kind === "building");
  let building = initialBuilding || buildings[0]?._id || "";
  const name = (id) => catalog.find((c) => c._id === id)?.name || "";
  const current = () =>
    rooms.filter((r) => r.buildingId === building && r.floorId);
  function trim() {
    const valid = new Set(current().map((r) => r._id));
    for (const id of chosen) if (!valid.has(id)) chosen.delete(id);
  }
  function render() {
    trim();
    const rows = current();
    const floors = catalog
      .filter((c) => c.kind === "floor" && c.parentId === building)
      .sort((a, b) => a.level - b.level);
    root.innerHTML = `<label class="field">选择小区 / 楼栋<select id="layout-building">${buildings.map((b) => `<option value="${esc(b._id)}" ${b._id === building ? "selected" : ""}>${esc(name(b.parentId))} / ${esc(b.name)}</option>`).join("")}</select></label>
      <div class="layout-room-tools"><button type="button" class="btn" id="layout-select-all">全选整栋（${rows.length} 间）</button><button type="button" class="btn" id="layout-clear">清空选择</button><strong id="layout-count" aria-live="polite"></strong></div>
      <div class="layout-floor-list">${
        floors
          .map((f) => {
            const floorRooms = rows
              .filter((r) => r.floorId === f._id)
              .sort((a, b) =>
                String(a.roomNo).localeCompare(String(b.roomNo), "zh-CN", {
                  numeric: true,
                }),
              );
            return `<section class="layout-floor"><label class="layout-floor-title"><input type="checkbox" data-layout-floor="${esc(f._id)}" ${floorRooms.length ? "" : "disabled"}>${esc(f.name)} · ${floorRooms.length} 间</label><div class="layout-room-grid">${floorRooms.map((r) => `<label class="layout-room"><input type="checkbox" data-layout-room="${esc(r._id)}"><span><b>${esc(r.roomNo || r.name)}</b><small>${esc(r.layoutCode || "未设置")} · ${esc(r.layoutName || "无户型")}${r.isPublic ? " · 公共用房" : ""}</small></span></label>`).join("") || '<span class="muted">该层暂无房间</span>'}</div></section>`;
          })
          .join("") ||
        '<div class="empty">该楼栋暂无楼层，请先添加楼层和房间。</div>'
      }</div>`;
    root.querySelector("#layout-building").onchange = (e) => {
      building = e.target.value;
      chosen.clear();
      render();
      onBuilding(building);
    };
    root.querySelector("#layout-select-all").onclick = () => {
      rows.forEach((r) => chosen.add(r._id));
      sync();
    };
    root.querySelector("#layout-clear").onclick = () => {
      chosen.clear();
      sync();
    };
    root.querySelectorAll("[data-layout-room]").forEach(
      (el) =>
        (el.onchange = () => {
          el.checked
            ? chosen.add(el.dataset.layoutRoom)
            : chosen.delete(el.dataset.layoutRoom);
          sync();
        }),
    );
    root.querySelectorAll("[data-layout-floor]").forEach(
      (el) =>
        (el.onchange = () => {
          rows
            .filter((r) => r.floorId === el.dataset.layoutFloor)
            .forEach((r) =>
              el.checked ? chosen.add(r._id) : chosen.delete(r._id),
            );
          sync();
        }),
    );
    sync();
  }
  function sync() {
    root.querySelector("#layout-count").textContent =
      `已选 ${chosen.size} / ${current().length} 间`;
    root.querySelectorAll("[data-layout-room]").forEach((el) => {
      el.checked = chosen.has(el.dataset.layoutRoom);
    });
    root.querySelectorAll("[data-layout-floor]").forEach((el) => {
      const rows = current().filter(
          (r) => r.floorId === el.dataset.layoutFloor,
        ),
        count = rows.filter((r) => chosen.has(r._id)).length;
      el.checked = rows.length > 0 && count === rows.length;
      el.indeterminate = count > 0 && count < rows.length;
    });
  }
  render();
  onBuilding(building);
  return { ids: () => [...chosen], building: () => building };
}

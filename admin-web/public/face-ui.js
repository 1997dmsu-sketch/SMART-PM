const FACE_STEPS = [
  ["person", "建人"],
  ["face", "上传人脸"],
  ["access", "授权门"],
  ["verify", "查询确认"],
];

export function faceStatus(enrollment, mode) {
  if (["ready", "pending-site"].includes(enrollment.status))
    return mode === "device"
      ? "已下发，待现场刷脸"
      : "模拟同步完成 · 未下发现场设备";
  if (enrollment.status === "failed") return "同步失败";
  if (enrollment.status === "running") return "正在同步";
  return "待查询确认";
}

export function faceSiteNote(enrollment) {
  if (enrollment.status !== "pending-site") return "";
  return enrollment.faceAssociationConfirmed
    ? "人员与照片关联已确认；人脸建模结果尚未验证，请到现场设备刷脸确认。"
    : "人脸建模结果尚未验证，请到现场设备刷脸确认。";
}

export function validateFacePhoto(file, maxPhotoBytes, bytes, { allowOversize = false } = {}) {
  if (!file) throw Error("请选择该测试人员的 JPEG 照片");
  if (!Number.isFinite(maxPhotoBytes) || maxPhotoBytes <= 0)
    throw Error("本次联调照片上限尚未提供，请重新连接后再试");
  if (!file.size || (!allowOversize && file.size > maxPhotoBytes))
    throw Error(`照片不能为空；本次联调照片上限为 ${Math.floor(maxPhotoBytes / 1024)} KB`);
  if (
    (file.type && file.type !== "image/jpeg") ||
    (!file.type && !/\.jpe?g$/i.test(file.name || "")) ||
    !bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
  )
    throw Error("仅支持有效的 JPEG 照片（.jpg / .jpeg）");
}

export function buildFaceEnrollment(values, capabilities, photo) {
  const employeeNo = String(values.employeeNo || "").trim();
  const name = String(values.name || "").trim();
  if (!employeeNo || !name) throw Error("请填写测试人员编号和显示名");
  if (capabilities.employeeNoPattern &&
      !new RegExp(`^(?:${capabilities.employeeNoPattern})$`).test(employeeNo))
    throw Error("测试人员编号不符合当前设备要求");
  const begin = new Date(values.validFrom).getTime();
  const end = new Date(values.validTo).getTime();
  if (!Number.isFinite(begin) || !Number.isFinite(end) || begin >= end)
    throw Error("有效期开始时间必须早于结束时间");
  const doorNo = Number(values.doorNo);
  if (!capabilities.doorNumbers?.some((door) => Number(door) === doorNo))
    throw Error("请选择设备提供的门号");
  const library = capabilities.libraries?.[Number(values.library)];
  if (values.library === "" || !library) throw Error("请选择设备提供的人脸库");
  if (values.consent !== true) throw Error("请确认此人员照片用于本次测试");
  if (!photo?.base64) throw Error("请选择该测试人员的 JPEG 照片");
  if (!Number.isFinite(capabilities.maxPhotoBytes) || capabilities.maxPhotoBytes <= 0)
    throw Error("本次联调照片上限尚未提供，请重新连接后再试");
  if (!photo.size || photo.size > capabilities.maxPhotoBytes)
    throw Error("处理后照片超过本次联调照片上限，请重新选择");
  return {
    employeeNo, name, doorNo,
    validFrom: values.validFrom,
    validTo: values.validTo,
    FDID: library.FDID,
    faceLibType: library.faceLibType,
    photoBase64: photo.base64,
    photoName: photo.name,
    consent: true,
  };
}

export function renderFaceSteps(enrollment, esc) {
  const steps = Array.isArray(enrollment.steps) ? enrollment.steps : [];
  const labels = { pending: "待执行", running: "处理中", success: "完成", failed: "失败", site: "待现场刷脸" };
  return `<ol class="face-steps">${FACE_STEPS.map(([key, label], index) => {
    const step = steps.find((item) => item.key === key) || {};
    const state = key === "verify" && enrollment.status === "pending-site"
      ? "site"
      : Object.hasOwn(labels, step.state) ? step.state : "pending";
    return `<li class="face-step ${state}"><span class="face-step-number">${state === "success" ? "✓" : index + 1}</span><div><strong>${label}</strong><span>${labels[state]}</span>${step.message ? `<p>${esc(step.message)}</p>` : ""}</div></li>`;
  }).join("")}</ol>`;
}

function localDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("无法读取所选文件，请重新选择"));
    reader.readAsDataURL(file);
  });
}

export function facePhotoDimensions(width, height, maxEdge = 960) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw Error("无法读取照片尺寸，请重新选择有效的 JPEG 照片");
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

// The encoder draws the entire image at each size, so this never crops a face.
export async function fitFacePhoto({ width, height, maxPhotoBytes, encode }) {
  if (!Number.isFinite(maxPhotoBytes) || maxPhotoBytes <= 0)
    throw Error("本次联调照片上限尚未提供，请重新连接后再试");
  let dimensions = facePhotoDimensions(width, height);
  for (let pass = 0; pass < 10; pass++) {
    for (const quality of [0.9, 0.82, 0.72, 0.62, 0.52, 0.42]) {
      const blob = await encode({ ...dimensions, quality });
      if (!blob || !Number.isFinite(blob.size) || blob.size <= 0)
        throw Error("本机 JPEG 处理失败，请重新选择照片");
      if (blob.size <= maxPhotoBytes) return { blob, ...dimensions, quality };
    }
    if (Math.max(dimensions.width, dimensions.height) <= 240) break;
    dimensions = facePhotoDimensions(dimensions.width, dimensions.height,
      Math.max(240, Math.floor(Math.max(dimensions.width, dimensions.height) * 0.8)));
  }
  throw Error("本机压缩后仍超过本次联调照片上限，请选择背景更简洁的正面照片");
}

async function decodePhoto(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error("无法解码该 JPEG 照片，请重新选择"));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readPhoto(file, capabilities) {
  if (!file) throw Error("请选择该测试人员的 JPEG 照片");
  const bytes = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  validateFacePhoto(file, capabilities.maxPhotoBytes, bytes, { allowOversize: true });
  const image = await decodePhoto(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  try {
    if (!context) throw Error("浏览器无法在本机处理照片，请使用支持 Canvas 的浏览器");
    const result = await fitFacePhoto({
      width: image.naturalWidth,
      height: image.naturalHeight,
      maxPhotoBytes: capabilities.maxPhotoBytes,
      encode: ({ width, height, quality }) => {
        canvas.width = width;
        canvas.height = height;
        context.drawImage(image, 0, 0, width, height);
        return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      },
    });
    if (result.blob.type !== "image/jpeg")
      throw Error("浏览器未能生成 JPEG 照片，请更换浏览器后重试");
    return {
      name: /\.jpe?g$/i.test(file.name) ? file.name : `${file.name || "face"}.jpg`,
      originalSize: file.size,
      size: result.blob.size,
      width: result.width,
      height: result.height,
      base64: await readBase64(result.blob),
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    image.src = "";
  }
}

export function mountFaceEnrollment(initialState, helpers) {
  const { api, esc, icon, head, footer, toast, confirmAction, isActive } = helpers;
  const root = document.querySelector("#workspace");
  let state = initialState;
  let busy = "";
  let error = "";
  let photo = null;
  let photoVersion = 0;
  let photoLoading = false;
  const retryPhotos = new Map();
  const connection = {
    mode: state.mode === "device" ? "device" : "simulation",
    origin: state.device?.origin || "https://192.168.1.227:443",
    username: "",
    developmentTls: false,
  };
  const now = new Date();
  const draft = {
    employeeNo: "", name: "", doorNo: "", library: "",
    validFrom: localDate(now),
    validTo: localDate(new Date(now.getTime() + 86400000)),
    consent: false,
  };
  const capabilities = () => state.capabilities || {};
  const alive = () => isActive() && root.isConnected;
  const disabled = () => busy ? "disabled" : "";

  function capture() {
    const connectForm = root.querySelector("#face-connect-form");
    if (connectForm) {
      connection.mode = connectForm.elements.mode.value;
      connection.origin = connectForm.elements.origin.value;
      connection.username = connectForm.elements.username.value;
      connection.developmentTls = connectForm.elements.developmentTls.checked;
    }
    const form = root.querySelector("#face-enroll-form");
    if (form) {
      for (const key of ["employeeNo", "name", "doorNo", "library", "validFrom", "validTo"])
        draft[key] = form.elements[key].value;
      draft.consent = form.elements.consent.checked;
    }
  }

  function previewMarkup(selected) {
    return selected
      ? `<img src="data:image/jpeg;base64,${selected.base64}" alt="所选测试人员照片的本机预览"><span>${esc(selected.name)}<br>原图 ${Math.ceil((selected.originalSize || selected.size) / 1024)} KB → 处理后 ${Math.ceil(selected.size / 1024)} KB${selected.width ? `<br>${selected.width} × ${selected.height} 像素 · 保留完整照片比例` : ""}</span>`
      : `<span>选择 JPEG 照片后在本机预览</span>`;
  }

  function updateEnrollment(enrollment) {
    if (!enrollment) throw Error("服务未返回同步结果，请查询状态");
    const records = state.enrollments || [];
    state = { ...state, enrollments: [enrollment, ...records.filter((row) => row.id !== enrollment.id)] };
    if (enrollment.status === "failed") {
      const failed = enrollment.steps?.find((step) => step.state === "failed");
      error = `${failed?.label || FACE_STEPS.find(([key]) => key === failed?.key)?.[1] || "同步"}失败：${enrollment.error || failed?.message || "请查看阶段详情后继续同步或查询状态"}`;
    } else if (["ready", "pending-site"].includes(enrollment.status)) {
      retryPhotos.delete(enrollment.id);
      toast(faceStatus(enrollment, state.mode));
    }
  }

  async function run(label, action) {
    if (busy) return;
    capture();
    busy = label;
    error = "";
    render();
    try {
      await action();
    } catch (failure) {
      if (alive()) error = failure.message || "请求失败，请重试";
    } finally {
      busy = "";
      if (alive()) render();
    }
  }

  async function refresh() {
    const next = await api("face/state");
    if (alive()) state = next;
  }

  function enrollmentMarkup(enrollment) {
    const selected = retryPhotos.get(enrollment.id);
    const failed = enrollment.status === "failed";
    const mode = enrollment.mode || state.mode;
    return `<article class="face-record" data-face-record="${esc(enrollment.id)}"><div class="face-record-head"><div><h3>${esc(enrollment.name)} <small>${esc(enrollment.employeeNo)}</small></h3><p>门号 ${esc(enrollment.doorNo)} · 人脸库 ${esc(enrollment.FDID)} / ${esc(enrollment.faceLibType)}</p></div><span class="face-result ${failed ? "failed" : enrollment.status === "pending-site" ? "pending-site" : enrollment.status === "ready" ? "ready" : ""}">${esc(faceStatus(enrollment, mode))}</span></div>${renderFaceSteps(enrollment, esc)}${faceSiteNote(enrollment) ? `<p class="face-site-note">${esc(faceSiteNote(enrollment))}</p>` : ""}${enrollment.error ? `<p class="face-record-error" role="alert">${esc(enrollment.error)}</p>` : ""}<p class="face-validity">有效期：${esc(enrollment.validFrom || "—")} 至 ${esc(enrollment.validTo || "—")}</p>${failed ? `<div class="face-retry-photo"><label class="field">补充该人员的 JPEG 照片（可选）<input type="file" accept="image/jpeg,.jpg,.jpeg" data-retry-photo ${disabled()}><small>可直接继续；需要补充照片时，请核对人员编号 ${esc(enrollment.employeeNo)}。</small></label><div class="face-photo-preview compact" data-retry-preview>${previewMarkup(selected?.photo)}</div><label class="face-check" ${selected?.photo ? "" : "hidden"}><input type="checkbox" data-retry-consent ${selected?.consent ? "checked" : ""} ${disabled()}>确认此照片属于该人员，并已同意用于本次测试</label><p class="form-error" data-retry-error role="alert">${esc(selected?.error || "")}</p></div>` : ""}<div class="face-record-actions">${failed ? `<button type="button" class="btn primary" data-face-retry ${!state.connected || connection.mode !== state.mode || busy || selected?.loading ? "disabled" : ""}>继续同步</button>` : ""}<button type="button" class="btn" data-face-verify ${!state.connected || connection.mode !== state.mode || busy ? "disabled" : ""}>查询状态</button></div></article>`;
  }

  function render() {
    if (!alive()) return;
    const cap = capabilities();
    const libraries = cap.libraries || [];
    const doors = cap.doorNumbers || [];
    if (!doors.some((door) => String(door) === String(draft.doorNo)))
      draft.doorNo = doors.length ? String(doors[0]) : "";
    if (draft.library === "" || !libraries[Number(draft.library)])
      draft.library = libraries.length ? "0" : "";
    const deviceMode = state.mode === "device";
    const canEnroll = state.connected && state.mode === connection.mode && libraries.length && doors.length && !busy && !photoLoading;
    root.innerHTML = `<div class="face-page">${head("人脸门禁", "连接设备，同步测试人员、人脸照片与门禁权限。", `<button type="button" class="btn" id="face-refresh" ${disabled()}>${icon("refresh")} 刷新状态</button>`)}<div class="face-mode-banner ${deviceMode ? "device" : "simulation"}" role="status"><strong>${deviceMode ? "现场设备模式" : "模拟模式 · 不会下发现场设备"}</strong><span>${deviceMode ? `${esc(state.device?.origin || connection.origin)} · ${state.connected ? "已连接" : "未连接"}` : "仅验证联调流程，所有结果均为模拟。"}</span>${deviceMode && (state.device?.model || state.device?.firmware) ? `<small>型号 ${esc(state.device.model || "—")} · 固件 ${esc(state.device.firmware || "—")}</small>` : ""}</div><div class="face-page-error form-error" role="alert">${esc(error)}</div>${busy ? `<div class="face-busy" role="status">${esc(busy)}。阶段：建人 → 上传人脸 → 授权门 → 查询确认；完成后显示设备返回结果。</div>` : ""}<div class="face-columns"><section class="panel"><div class="panel-head"><h2>1. 连接设备</h2><span class="face-connection ${state.connected ? "connected" : ""}">${state.connected ? "已连接" : "未连接"}</span></div><form id="face-connect-form" class="face-form" autocomplete="off"><fieldset ${disabled()}><legend class="face-sr-only">连接方式</legend><div class="face-mode-choice"><label><input type="radio" name="mode" value="simulation" ${connection.mode === "simulation" ? "checked" : ""}>模拟模式</label><label><input type="radio" name="mode" value="device" ${connection.mode === "device" ? "checked" : ""}>现场设备</label></div><div class="face-device-fields form-grid" ${connection.mode === "device" ? "" : "hidden"}><label class="field full">设备地址<input name="origin" type="url" value="${esc(connection.origin)}" placeholder="https://192.168.1.227:443" ${connection.mode === "device" ? "required" : ""}></label><label class="field">设备账号<input name="username" autocomplete="off" value="${esc(connection.username)}" ${connection.mode === "device" ? "required" : ""}></label><label class="field">设备密码<input name="password" type="password" autocomplete="new-password" ${connection.mode === "device" ? "required" : ""}></label><label class="field full">设备证书（.cer / .pem）<input name="certificate" type="file" accept=".cer,.pem"><small>证书与账号密码仅用于当前服务内存中的设备连接。</small></label><label class="face-check full"><input type="checkbox" name="developmentTls" ${connection.developmentTls ? "checked" : ""}>开发联调证书例外</label><p class="face-help full">仅在开发联调设备证书时使用此例外。连接成功后密码会清空。</p></div><p class="face-help">${connection.mode === "simulation" ? "默认使用模拟设备，可先验证人员同步、失败重试和查询流程。" : "连接后将显示现场设备地址与设备返回的人脸库、门号。"}</p><div class="face-form-actions"><button class="btn primary" type="submit">${connection.mode === "device" ? "连接现场设备" : "连接模拟设备"}</button>${state.connected ? '<button class="btn" type="button" id="face-disconnect">断开连接</button>' : ""}</div></fieldset></form></section><section class="panel"><div class="panel-head"><h2>2. 人员与人脸</h2></div><form id="face-enroll-form" class="face-form"><fieldset ${busy || !state.connected || connection.mode !== state.mode ? "disabled" : ""}><legend class="face-sr-only">测试人员信息</legend><div class="form-grid"><label class="field">测试人员编号 *<input name="employeeNo" value="${esc(draft.employeeNo)}" required autocomplete="off">${deviceMode ? "<small>现场设备人员编号使用字母和数字。</small>" : ""}</label><label class="field">显示名 *<input name="name" value="${esc(draft.name)}" required autocomplete="off"></label><label class="field">人脸库 *<select name="library" required>${libraries.length ? libraries.map((library, index) => `<option value="${index}" ${String(index) === draft.library ? "selected" : ""}>${esc(library.FDID)} · ${esc(library.faceLibType)}</option>`).join("") : '<option value="">连接后读取设备能力</option>'}</select></label><label class="field">门号 *<select name="doorNo" required>${doors.length ? doors.map((door) => `<option value="${esc(door)}" ${String(door) === draft.doorNo ? "selected" : ""}>门 ${esc(door)}</option>`).join("") : '<option value="">连接后读取设备能力</option>'}</select></label><label class="field">有效期开始 *<input name="validFrom" type="datetime-local" value="${esc(draft.validFrom)}" required></label><label class="field">有效期结束 *<input name="validTo" type="datetime-local" value="${esc(draft.validTo)}" required></label><label class="field full">JPEG 人脸照片 *<input id="face-photo" type="file" accept="image/jpeg,.jpg,.jpeg"><small>${cap.maxPhotoBytes ? `本次联调照片上限：${Math.floor(cap.maxPhotoBytes / 1024)} KB${cap.photoLimitSource === "guide-default" ? "（按接入指南设置）" : ""}。` : "连接后读取本次联调照片上限。"}在本机按比例处理为最长边不超过 960 像素的 JPEG，不裁剪照片；只随同步请求提交，不进入公共图片库。</small></label><div class="face-photo-preview full" id="face-photo-preview">${previewMarkup(photo)}</div><p class="form-error full" id="face-photo-error" role="alert"></p><label class="face-check full"><input type="checkbox" name="consent" ${draft.consent ? "checked" : ""} required>我确认此人员已同意将其照片用于本次人脸门禁测试</label></div></fieldset><div class="face-form-actions"><button type="submit" class="btn primary" id="face-enroll-submit" ${canEnroll ? "" : "disabled"}>同步人员和人脸</button></div><p class="face-help">${!state.connected ? "请先连接模拟设备或现场设备。" : connection.mode !== state.mode ? "所选模式尚未连接，请先连接该模式的设备。" : deviceMode ? "同步及查询通过后，还需在现场设备刷脸验证。" : "当前为模拟模式，同步完成不会向现场设备下发人员或照片。"}</p></form></section></div><section class="panel face-records"><div class="panel-head"><h2>3. 同步记录与阶段</h2><span class="muted">${(state.enrollments || []).length} 条</span></div>${state.enrollments?.length ? state.enrollments.map(enrollmentMarkup).join("") : '<div class="face-empty">暂无同步记录。连接后，选择一名测试人员开始联调。</div>'}</section>${footer()}</div>`;
    bind();
  }

  function bind() {
    root.querySelector("#face-refresh").onclick = () => run("正在查询最新状态", refresh);
    const connectForm = root.querySelector("#face-connect-form");
    connectForm.querySelectorAll('[name="mode"]').forEach((input) => {
      input.onchange = () => { capture(); render(); };
    });
    connectForm.onsubmit = (event) => {
      event.preventDefault();
      capture();
      const password = connectForm.elements.password.value;
      const certificate = connectForm.elements.certificate.files[0];
      const input = { ...connection };
      run("正在连接设备并读取能力", async () => {
        let data = { mode: "simulation" };
        if (input.mode === "device") {
          if (certificate && !/\.(cer|pem)$/i.test(certificate.name))
            throw Error("设备证书仅支持 .cer 或 .pem 文件");
          data = { ...input, password, certificateBase64: certificate ? await readBase64(certificate) : "" };
        }
        const next = await api("face/connect", { method: "POST", data });
        if (!alive()) return;
        state = next;
        connection.mode = next.mode;
        photo = null;
        photoVersion++;
        photoLoading = false;
        retryPhotos.clear();
        draft.consent = false;
        toast(next.mode === "device" ? `已连接现场设备 ${next.device?.origin || input.origin}` : "已连接模拟设备 · 不会下发现场设备");
      });
    };
    root.querySelector("#face-disconnect")?.addEventListener("click", async () => {
      if (!(await confirmAction("断开当前设备连接？", "断开后需要重新连接，才能继续同步人员和人脸。")) || !alive()) return;
      run("正在断开设备连接", async () => {
        const next = await api("face/disconnect", { method: "POST", data: {} });
        if (!alive()) return;
        state = next;
        photo = null;
        photoVersion++;
        photoLoading = false;
        retryPhotos.clear();
        draft.consent = false;
        toast("已断开设备连接");
      });
    });
    root.querySelector("#face-photo").onchange = async (event) => {
      const file = event.target.files[0];
      const version = ++photoVersion;
      const preview = root.querySelector("#face-photo-preview");
      const photoError = root.querySelector("#face-photo-error");
      const button = root.querySelector("#face-enroll-submit");
      photo = null;
      photoLoading = true;
      draft.consent = false;
      root.querySelector("#face-enroll-form").elements.consent.checked = false;
      preview.innerHTML = "<span>正在本机按比例处理照片…</span>";
      photoError.textContent = "";
      button.disabled = true;
      try {
        const selected = await readPhoto(file, capabilities());
        if (!alive() || version !== photoVersion) return;
        photo = selected;
        root.querySelector("#face-photo-preview").innerHTML = previewMarkup(photo);
      } catch (failure) {
        if (!alive() || version !== photoVersion) return;
        event.target.value = "";
        root.querySelector("#face-photo-preview").innerHTML = previewMarkup(null);
        root.querySelector("#face-photo-error").textContent = failure.message;
      } finally {
        if (alive() && version === photoVersion) {
          photoLoading = false;
          root.querySelector("#face-enroll-submit").disabled = Boolean(busy || !state.connected || state.mode !== connection.mode || !capabilities().libraries?.length || !capabilities().doorNumbers?.length);
        }
      }
    };
    root.querySelector("#face-enroll-form").onsubmit = (event) => {
      event.preventDefault();
      if (photoLoading) return;
      capture();
      if (!state.connected || connection.mode !== state.mode) {
        error = "请先连接所选模式的设备";
        render();
        return;
      }
      let data;
      try { data = buildFaceEnrollment(draft, capabilities(), photo); }
      catch (failure) { error = failure.message; render(); return; }
      const submittedPhoto = photo;
      run("正在同步人员和人脸", async () => {
        const result = await api("face/enroll", { method: "POST", data });
        if (!alive()) return;
        if (result.enrollment?.status === "failed")
          retryPhotos.set(result.enrollment.id, { photo: submittedPhoto, consent: true });
        updateEnrollment(result.enrollment);
        photo = null;
        photoVersion++;
        draft.consent = false;
      });
    };
    for (const card of root.querySelectorAll("[data-face-record]")) {
      const id = card.dataset.faceRecord;
      const consent = card.querySelector("[data-retry-consent]");
      if (consent) consent.onchange = () => {
        const selected = retryPhotos.get(id);
        if (selected) selected.consent = consent.checked;
      };
      const retryFile = card.querySelector("[data-retry-photo]");
      if (retryFile) retryFile.onchange = async (event) => {
        const retryError = card.querySelector("[data-retry-error]");
        const preview = card.querySelector("[data-retry-preview]");
        const version = Symbol();
        retryPhotos.set(id, { loading: true, version });
        retryError.textContent = "";
        consent.checked = false;
        consent.closest("label").hidden = true;
        preview.innerHTML = "<span>正在本机按比例处理照片…</span>";
        try {
          const selected = await readPhoto(event.target.files[0], capabilities());
          if (!alive() || retryPhotos.get(id)?.version !== version) return;
          retryPhotos.set(id, { photo: selected, consent: false });
          capture();
          render();
        } catch (failure) {
          if (!alive() || retryPhotos.get(id)?.version !== version) return;
          retryPhotos.set(id, { error: failure.message });
          capture();
          render();
        }
      };
      card.querySelector("[data-face-retry]")?.addEventListener("click", () => {
        const selected = retryPhotos.get(id);
        if (selected?.loading || (selected?.photo && !selected.consent)) {
          card.querySelector("[data-retry-error]").textContent = selected.loading ? "请等待照片读取完成" : "请确认此照片属于该人员，并已同意用于本次测试";
          return;
        }
        run("正在继续同步", async () => {
          const result = await api("face/retry", { method: "POST", data: {
            id,
            ...(selected?.photo ? { photoBase64: selected.photo.base64, photoName: selected.photo.name } : {}),
          } });
          if (alive()) updateEnrollment(result.enrollment);
        });
      });
      card.querySelector("[data-face-verify]").onclick = () => run("正在查询人员、人脸与门权限", async () => {
        const result = await api("face/verify", { method: "POST", data: { id } });
        if (alive()) updateEnrollment(result.enrollment);
      });
    }
  }

  render();
}

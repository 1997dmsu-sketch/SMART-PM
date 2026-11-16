export async function mountLeasing({ container, api, esc, toast }) {
  let records, settings;
  const money = (v) => (Number(v || 0) / 100).toFixed(2);
  const states = {
    submitted: "待确认",
    confirmed: "已确认",
    rejected: "已拒绝",
    awaiting_payment: "待支付",
    payment_expired: "支付超时",
    payment_closed: "支付已关闭",
    paid_held: "已交押金留房",
    expired_forfeited: "留房到期·押金不退",
    expired_review: "留房到期·待处理",
    refund_required: "异常到账·需退款",
    signed: "已正式签约",
  };
  const identity = {
    missing: "未提交",
    pending: "待审核",
    approved: "已通过",
    rejected: "未通过",
  };
  const load = async () => {
    [records, settings] = await Promise.all([
      api("leasing"),
      api("leasing/settings"),
    ]);
    container.innerHTML = `<div class="leasing-page"><div class="page-head"><div><h1>预约与预签约</h1><p>看房预约、证件审核、合同模板与押金留房</p></div><button id="lease-refresh" class="btn">刷新</button></div>
   <div class="notice">微信支付：${settings.paymentReady ? "已配置（仍需商户联调）" : "未配置，用户不能交押金"} · 证件加密：${settings.identityReady ? "已配置" : "未配置，用户不能提交证件"}。证件仅供审核，默认 30 天后不可查阅，请定期清理到期材料。</div>
   <section class="panel"><h2>看房预约</h2><div class="table-wrap"><table><thead><tr><th>联系人 / 电话</th><th>房号</th><th>时间</th><th>状态</th><th>身份证</th><th>操作</th></tr></thead><tbody>${records.appointments.map((a) => `<tr><td>${esc(a.name)}<br>${esc(a.phone)}</td><td>${esc(a.roomLabel)}</td><td>${esc(new Date(a.visitAt).toLocaleString())}</td><td>${esc(states[a.status] || a.status)}</td><td>${esc(identity[a.identityStatus] || a.identityStatus)} ${["Front", "Back"].map((side) => (a["identity" + side + "Id"] ? `<button class="btn" data-image="${esc(a["identity" + side + "Id"])}">${side === "Front" ? "人像面" : "国徽面"}</button>` : "")).join("")}</td><td>${["submitted", "confirmed"].includes(a.status) ? `<button class="btn" data-decision="confirmed" data-id="${esc(a.id)}">确认看房</button> <button class="btn" data-decision="rejected" data-id="${esc(a.id)}">拒绝</button>${a.identityFrontId && a.identityBackId ? `<button class="btn" data-decision="identity_approved" data-id="${esc(a.id)}">证件通过</button> <button class="btn" data-decision="identity_rejected" data-id="${esc(a.id)}">证件重传</button>` : ""}` : ""}</td></tr>`).join("") || '<tr><td colspan="6">暂无预约</td></tr>'}</tbody></table></div></section>
   <section class="panel"><h2>预签约订单</h2><div class="table-wrap"><table><thead><tr><th>房号</th><th>押金</th><th>状态</th><th>留房至</th><th>操作</th></tr></thead><tbody>${records.orders.map((o) => `<tr><td>${esc(o.roomLabel)}</td><td>¥${money(o.depositCents)}</td><td>${esc(states[o.status] || o.status)}</td><td>${o.holdUntil ? esc(new Date(o.holdUntil).toLocaleString()) : "—"}</td><td><button class="btn" data-contract="${esc(o.id)}">查看合同</button>${o.status === "paid_held" ? ` <button class="btn" data-sign="${esc(o.id)}">确认正式签约</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="5">暂无订单</td></tr>'}</tbody></table></div><p>异常到账订单请在微信商户平台核验并退款，退款进度以商户平台记录为准。</p></section>
   <section class="panel"><h2>押金规则与自有合同模板</h2><form id="lease-settings"><div class="form-grid"><label class="field">押金月数<input name="depositMonths" type="number" min="0" max="12" step="0.1" value="${esc(settings.depositMonths)}" required></label><label class="field">固定附加金额（元）<input name="fixedDeposit" type="number" min="0" step="0.01" value="${money(settings.fixedDepositCents)}" required></label><label class="field">留房小时数<input name="holdHours" type="number" min="1" max="720" value="${esc(settings.holdHours)}" required></label><label class="field">留房到期处理<select name="expiryPolicy"><option value="non_refundable" ${settings.expiryPolicy === "non_refundable" ? "selected" : ""}>期限届满未签约，押金不退</option><option value="manual_review" ${settings.expiryPolicy === "manual_review" ? "selected" : ""}>由物业审核处理</option></select></label></div>
   <p>押金 = 月租 × 押金月数 + 固定附加金额；默认两押、留房 72 小时。修改只影响新订单，已有合同和金额不变。</p>
   <label class="field">证件收集说明<textarea name="privacyText" rows="4" required>${esc(settings.privacyText || "")}</textarea></label><p>填写实际收集主体、用途、查阅人员、保存 30 天、删除与联系渠道。仅在用户同意后收集。</p>
   <label class="field">导入 UTF-8 合同模板（.txt）<input id="lease-template-file" type="file" accept=".txt,text/plain"></label>
   <label class="field">自有模板正文<textarea name="templateText" rows="14">${esc(settings.templateText || "")}</textarea></label><p>必需变量：{{tenantName}}、{{roomLabel}}、{{deposit}}、{{holdHours}}、{{expiryPolicy}}；可选：{{monthlyRent}}、{{appointmentId}}。仅保存纯文本，DOCX/PDF 请先转换文本并核对。此流程记录预签约确认，不提供 CA 电子签章。</p>
   <label><input name="enabled" type="checkbox" ${settings.enabled ? "checked" : ""}>启用预签约及证件收集</label><p><button class="btn primary">保存配置与新模板版本</button> <button id="lease-purge" type="button" class="btn">清理到期证件</button></p><div class="form-error" role="alert"></div></form></section></div>`;
    container.querySelector("#lease-refresh").onclick = () =>
      load().catch((e) => toast(e.message));
    container.querySelectorAll("[data-decision]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (
            !confirm("确认执行此处理？证件通过前应逐一核对正反面与预约联系人。")
          )
            return;
          button.disabled = true;
          try {
            const a = records.appointments.find(
              (a) => a.id === button.dataset.id,
            );
            await api("leasing", {
              method: "POST",
              data: {
                action: "reviewAppointment",
                input: {
                  id: a.id,
                  revision: a.revision,
                  decision: button.dataset.decision,
                },
              },
            });
            await load();
          } catch (e) {
            toast(e.message);
          } finally {
            button.disabled = false;
          }
        }),
    );
    container.querySelectorAll("[data-image]").forEach(
      (button) =>
        (button.onclick = () => {
          const dialog = document.querySelector("#editor");
          dialog.replaceChildren();
          const image = document.createElement("img");
          image.src =
            "/api/leasing/identity?id=" +
            encodeURIComponent(button.dataset.image);
          image.alt = "身份证材料";
          image.style.maxWidth = "100%";
          const close = document.createElement("button");
          close.className = "btn";
          close.textContent = "关闭";
          close.onclick = () => dialog.close();
          dialog.append(image, close);
          dialog.showModal();
          dialog.addEventListener(
            "close",
            () => {
              image.removeAttribute("src");
              dialog.replaceChildren();
            },
            { once: true },
          );
        }),
    );
    container.querySelectorAll("[data-contract]").forEach(
      (button) =>
        (button.onclick = () => {
          const dialog = document.querySelector("#editor");
          dialog.replaceChildren();
          const pre = document.createElement("pre");
          pre.textContent = records.orders.find(
            (o) => o.id === button.dataset.contract,
          ).contractText;
          pre.style.whiteSpace = "pre-wrap";
          const close = document.createElement("button");
          close.textContent = "关闭";
          close.onclick = () => dialog.close();
          dialog.append(pre, close);
          dialog.showModal();
        }),
    );
    container.querySelectorAll("[data-sign]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (!confirm("确认已经完成正式合同签署？确认后房源将标记已租。"))
            return;
          try {
            await api("leasing", {
              method: "POST",
              data: {
                action: "finishOrder",
                input: { id: button.dataset.sign },
              },
            });
            await load();
          } catch (e) {
            toast(e.message);
          }
        }),
    );
    container.querySelector("#lease-template-file").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 160000) {
        toast("模板文件过大");
        return;
      }
      container.querySelector("[name=templateText]").value = await f.text();
    };
    container.querySelector("#lease-purge").onclick = async () => {
      try {
        const r = await api("leasing", {
          method: "POST",
          data: { action: "purgeIdentity" },
        });
        toast(`已清理 ${r.purged} 份到期材料`);
      } catch (e) {
        toast(e.message);
      }
    };
    container.querySelector("#lease-settings").onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const button = e.target.querySelector(
        "button[type=submit],button.primary",
      );
      button.disabled = true;
      try {
        await api("leasing", {
          method: "POST",
          data: {
            action: "saveSettings",
            input: {
              revision: settings.revision || 0,
              depositMonths: Number(data.depositMonths),
              fixedDepositCents: Math.round(Number(data.fixedDeposit) * 100),
              holdHours: Number(data.holdHours),
              expiryPolicy: data.expiryPolicy,
              templateText: data.templateText,
              privacyText: data.privacyText,
              enabled: data.enabled === "on",
            },
          },
        });
        toast("规则与合同模板已保存");
        await load();
      } catch (error) {
        container.querySelector(".form-error").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  };
  await load();
}

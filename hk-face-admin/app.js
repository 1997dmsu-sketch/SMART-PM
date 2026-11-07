/*
 * HK 人脸门禁管理后台 · 页面壳共享交互
 * 零依赖、零网络请求，file:// 直接打开即可运行。
 * 仅负责：导航高亮、按钮占位提示、筛选条件重置。
 * 不读取、不写入、不请求任何真实业务数据。
 */
(function () {
  "use strict";

  // 1) 根据 body[data-page] 高亮当前侧边栏入口
  var page = document.body.getAttribute("data-page") || "index";
  var links = document.querySelectorAll(".nav-link[data-nav]");
  for (var i = 0; i < links.length; i++) {
    if (links[i].getAttribute("data-nav") === page) {
      links[i].classList.add("is-active");
      links[i].setAttribute("aria-current", "page");
    }
  }

  // 2) 占位提示：所有 [data-toast] 元素只弹提示，不执行业务动作
  var toast = document.getElementById("toast");
  var timer = null;
  function showToast(text) {
    if (!toast) return;
    toast.textContent = "页面壳：「" + text + "」功能待接入";
    toast.classList.add("is-visible");
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2200);
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    var el = target.closest("[data-toast]");
    if (!el) return;
    event.preventDefault();
    showToast(el.getAttribute("data-toast") || "该操作");
  });

  // 3) 重置当前面板内的筛选条件（纯前端，不发请求）
  var resetButtons = document.querySelectorAll("[data-reset]");
  for (var j = 0; j < resetButtons.length; j++) {
    (function (button) {
      button.addEventListener("click", function () {
        var scope = button.closest(".panel") || document;
        var fields = scope.querySelectorAll("input, select");
        for (var k = 0; k < fields.length; k++) {
          var f = fields[k];
          if (f.tagName === "SELECT") f.selectedIndex = 0;
          else f.value = "";
        }
        showToast("筛选条件已重置");
      });
    })(resetButtons[j]);
  }
})();

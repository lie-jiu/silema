// <dialog> 开合、确认后 POST、复制、密码显示切换。
// 全部走 data-* 属性 + 事件委托，不用内联 onclick，为了守住 CSP script-src 'self'。
function closestEl(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}

document.addEventListener("click", (e) => {
  const open = closestEl(e.target, "[data-open-dialog]");
  if (open) {
    const dlg = document.getElementById(open.getAttribute("data-open-dialog") ?? "");
    if (dlg instanceof HTMLDialogElement) dlg.showModal();
    return;
  }

  const closer = closestEl(e.target, "[data-close-dialog]");
  if (closer) {
    const dlg = closer.closest("dialog");
    if (dlg instanceof HTMLDialogElement) dlg.close();
    return;
  }

  const reveal = closestEl(e.target, "[data-reveal]");
  if (reveal) {
    const input = document.getElementById(reveal.getAttribute("data-reveal") ?? "");
    if (input instanceof HTMLInputElement) {
      input.type = input.type === "password" ? "text" : "password";
      reveal.textContent = input.type === "password" ? "显示" : "隐藏";
    }
    return;
  }

  const copy = closestEl(e.target, "[data-copy-into]");
  if (copy) {
    const src = document.querySelector(copy.getAttribute("data-copy-into") ?? "");
    if (src) {
      const text = [...src.querySelectorAll("li")].map((li) => li.textContent?.trim()).join("\n") || src.textContent;
      navigator.clipboard.writeText((text ?? "").trim()).then(() => {
        copy.textContent = "已复制";
      });
    }
    return;
  }
});

// 确认后直接 POST 并跳转（重发链接 / 删除接收人 / 注销所有设备）
document.addEventListener("click", async (e) => {
  const btn = closestEl(e.target, "[data-post-confirm]");
  if (!btn || btn.dataset.busy) return;
  btn.dataset.busy = "1";
  btn.disabled = true;
  const dlg = btn.closest("dialog");
  try {
    const res = await fetch(btn.getAttribute("data-post-confirm") ?? "", {
      method: "POST",
      headers: { "HX-Request": "true", "Content-Type": "application/x-www-form-urlencoded" },
      body: btn.getAttribute("data-post-body") ?? "",
    });
    if (dlg instanceof HTMLDialogElement) dlg.close();
    if (!res.ok) {
      delete btn.dataset.busy;
      btn.disabled = false;
      const slot = document.querySelector(`[data-error-for="${btn.id}"]`);
      if (slot) slot.textContent = (await res.text()).slice(0, 200);
      return;
    }
    location.assign(btn.getAttribute("data-post-go") || location.pathname);
  } catch {
    delete btn.dataset.busy;
    btn.disabled = false;
  }
});

// htmx 请求结束后收起当前对话框（恢复码就地渲染那种）
document.body.addEventListener("htmx:afterRequest", (e) => {
  const btn = closestEl(e.target, "[data-close-after]");
  if (!btn) return;
  const dlg = btn.closest("dialog");
  if (dlg instanceof HTMLDialogElement) dlg.close();
});

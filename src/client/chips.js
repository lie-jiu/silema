// 占位符 chip → 插入到当前聚焦 / 最后一个 textarea 的光标处。
document.addEventListener("click", (e) => {
  const chip = e.target instanceof Element ? e.target.closest("[data-chip]") : null;
  if (!chip) return;
  const targetId = chip.getAttribute("data-chip-into");
  const box =
    (targetId && document.getElementById(targetId)) ||
    (document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null) ||
    document.querySelector("textarea");
  if (!(box instanceof HTMLTextAreaElement)) return;
  box.focus();
  const token = chip.getAttribute("data-chip");
  const start = box.selectionStart ?? box.value.length;
  const end = box.selectionEnd ?? start;
  box.setRangeText(token, start, end, "end");
  // 触发 input 以便浏览器记住这是用户编辑（离开确认「放弃编辑？」需要 dirty 判定）
  box.dispatchEvent(new Event("input", { bubbles: true }));
});

// 有改动时离开页面先问一句——文案可能写很久（§4 Screen 2「操作」行）
let dirty = false;
document.addEventListener("input", (e) => {
  if (e.target instanceof HTMLFormElement || e.target.closest?.("form")) dirty = true;
});
document.addEventListener("submit", () => {
  dirty = false;
});
window.addEventListener("beforeunload", (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

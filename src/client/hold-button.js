// 长按签到大圆：全站唯一签到入口的防误触 + 进度反馈（docs/mobile-ui.md §2 Screen 1）。
// 满 0.6s 才派发 "hold" 事件，由 htmx 的 hx-trigger="hold" 发 POST；未满松手回弹且不发请求。
const HOLD_MS = 600;
const ROLLBACK_MS = 200;

function progress(el, value) {
  el.style.setProperty("--p", String(value));
}

function install(el) {
  if (el.dataset.holdBound) return;
  el.dataset.holdBound = "1";
  let startTime = 0;
  let raf = 0;
  let done = false;

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const tick = () => {
    const ratio = Math.min(1, (performance.now() - startTime) / HOLD_MS);
    progress(el, ratio * 100);
    if (ratio >= 1) {
      done = true;
      stop();
      el.dispatchEvent(new CustomEvent("hold"));
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const rollback = () => {
    stop();
    const start = Number(el.style.getPropertyValue("--p") || 0);
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ROLLBACK_MS);
      progress(el, start * (1 - k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    if (start > 0) raf = requestAnimationFrame(step);
  };

  const down = (e) => {
    if (el.disabled || el.classList.contains("htmx-request") || done) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    stop();
    startTime = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const up = () => {
    if (!done) rollback();
  };

  const reset = () => {
    done = false;
    progress(el, 0);
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("lostpointercapture", up);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("htmx:afterSwap", reset);
  el.addEventListener("htmx:responseError", reset);
  el.addEventListener("htmx:sendError", reset);
}

for (const el of document.querySelectorAll("[data-hold-post]")) install(el);

// htmx swap 进来的新确认按钮（错误后重试重渲染）同样要装监听
document.body.addEventListener("htmx:load", (e) => {
  const el = e.target;
  if (el instanceof HTMLElement && el.matches("[data-hold-post]")) install(el);
});

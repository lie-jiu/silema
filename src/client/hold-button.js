// 长按签到大圆：全站唯一签到入口的防误触 + 进度反馈。
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
  let active = false;

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

  // 释放监听一律挂 document：指针/按键在按钮之外松开时元素收不到事件，只绑元素会让
  // 「按下 → 拖出 → 松手」在 0.6s 到点时照样完成签到（误续命方向，比签不上更危险），
  // 而键盘长按期间焦点被 htmx 换掉就永远等不到 keyup，active 卡在 true 上再也按不动。
  const detach = () => {
    document.removeEventListener("pointerup", release);
    document.removeEventListener("pointercancel", release);
    document.removeEventListener("keyup", releaseKey);
  };

  const release = () => {
    if (!active) return;
    active = false;
    detach();
    if (!done) rollback();
  };

  const start = () => {
    if (el.disabled || el.classList.contains("htmx-request") || done) return;
    stop();
    active = true;
    startTime = performance.now();
    raf = requestAnimationFrame(tick);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    document.addEventListener("keyup", releaseKey);
  };

  const down = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    start();
  };

  // JS 开启时 <noscript> 表单不生效，键盘用户必须有等价的长按路径
  const isHoldKey = (e) => e.key === " " || e.key === "Spacebar" || e.key === "Enter";
  const keyDown = (e) => {
    if (!isHoldKey(e) || e.repeat || active) return;
    e.preventDefault();
    start();
  };
  function releaseKey(e) {
    if (isHoldKey(e)) release();
  }

  const reset = () => {
    detach();
    done = false;
    active = false;
    progress(el, 0);
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("keydown", keyDown);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("htmx:afterSwap", reset);
  el.addEventListener("htmx:responseError", reset);
  el.addEventListener("htmx:sendError", reset);
}

for (const el of document.querySelectorAll("[data-hold-post]")) install(el);

// htmx swap 进来的新确认按钮（错误后重试重渲染）同样要装监听。
// htmx:load 的 target 是 swap 进去的**顶层节点**（这里是 #checkin-stage 包装层），按钮是它的
// 后代，所以必须连子树一起扫——只判断 target 自身会让换入的重试按钮永远绑不上。
document.body.addEventListener("htmx:load", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.matches("[data-hold-post]")) install(el);
  for (const host of el.querySelectorAll("[data-hold-post]")) install(host);
});

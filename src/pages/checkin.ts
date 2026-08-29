/* 快速签到页。
 *
 * 这里刻意做成「打开页面 → 页面自动完成签到」，而不是让 GET /c/<token>
 * 直接改状态。原因是邮件里的链接会被机器抓：企业邮件网关的链接扫描、
 * IMAP 客户端预取、微信/Slack 的链接预览，全都会自动 GET 一遍。若 GET 本身
 * 就算签到，机器人会替所有者续命，死人开关直接失去意义。
 *
 * 真正的状态变更放在 /c/<token>/do，只有页面里的脚本或用户点击兜底按钮
 * 才会发起 —— 不执行脚本的扫描器抓到页面也不会签到。对真人而言仍然是
 * 点开链接即完成，一步不多。
 */

// 令牌只允许 base64url 字符。既是输入校验，也让下面的 HTML 拼接没有
// 注入面（放进 <script> 字符串字面量时不可能逃逸出引号）。
export function isSafeToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(t);
}

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f7fb">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%235b5bd6'/%3E%3Ctext x='16' y='22.5' font-family='sans-serif' font-size='15' font-weight='700' fill='%23fff' text-anchor='middle'%3E%E6%AD%BB%3C/text%3E%3C/svg%3E">
<style>
  :root{
    --bg:#f6f7fb; --surface:#ffffff; --surface-2:#f1f3f9;
    --border:#e4e8f1; --text:#101828; --text-2:#475467; --muted:#98a2b3;
    --primary:#5b5bd6;
    --green:#12a150; --green-soft:rgba(18,161,80,.12);
    --yellow:#d97706; --yellow-soft:rgba(217,119,6,.14);
    --red:#e5484d;   --red-soft:rgba(229,72,77,.13);
    --shadow:0 1px 2px rgba(16,24,40,.05),0 8px 32px rgba(16,24,40,.08);
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#0b0e14; --surface:#12161f; --surface-2:#181d29;
      --border:#232a38; --text:#f0f2f7; --text-2:#aab2c2; --muted:#69738a;
      --primary:#7b7bf0;
      --green:#34c98a; --green-soft:rgba(52,201,138,.15);
      --yellow:#f5a623; --yellow-soft:rgba(245,166,35,.16);
      --red:#f2666b;   --red-soft:rgba(242,102,107,.16);
      --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 40px rgba(0,0,0,.45);
    }
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif;
    background:var(--bg);color:var(--text);min-height:100vh;
    display:flex;align-items:center;justify-content:center;padding:24px;
  }
  .wrap{width:100%;max-width:420px;text-align:center}
  .brand{display:flex;align-items:center;justify-content:center;gap:9px;margin-bottom:22px;
    font-size:15px;font-weight:650;color:var(--text-2);letter-spacing:.2px}
  .brand .dot{width:26px;height:26px;border-radius:8px;background:var(--primary);color:#fff;
    display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:18px;
    padding:34px 26px 28px;box-shadow:var(--shadow)}
  .icon{width:60px;height:60px;border-radius:50%;margin:0 auto 18px;display:flex;
    align-items:center;justify-content:center}
  .icon svg{width:30px;height:30px}
  .icon.ok{background:var(--green-soft);color:var(--green)}
  .icon.wait{background:var(--yellow-soft);color:var(--yellow)}
  .icon.bad{background:var(--red-soft);color:var(--red)}
  .icon.idle{background:var(--surface-2);color:var(--muted)}
  h1{font-size:19px;font-weight:650;letter-spacing:-.2px;margin-bottom:9px}
  p{font-size:14px;line-height:1.65;color:var(--text-2)}
  .meta{margin-top:14px;font-size:12.5px;color:var(--muted)}
  .spinner{width:28px;height:28px;border-radius:50%;border:2.5px solid var(--surface-2);
    border-top-color:var(--primary);animation:spin .7s linear infinite;margin:0 auto}
  @keyframes spin{to{transform:rotate(360deg)}}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;
    margin-top:20px;padding:11px 22px;border-radius:11px;font-size:14px;font-weight:550;
    text-decoration:none;border:1px solid transparent;cursor:pointer;
    background:var(--primary);color:#fff;transition:filter .15s,transform .1s}
  .btn:hover{filter:brightness(1.07)}
  .btn:active{transform:translateY(1px)}
  .btn.ghost{background:transparent;border-color:var(--border);color:var(--text-2)}
  .hidden{display:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><span class="dot">死</span>死了吗</div>
  <div class="card" id="card">${body}</div>
</div>
</body>
</html>`;
}

const ICON_OK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const ICON_BAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>`;
const ICON_WAIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 首次打开：显示「正在签到」，脚本随即完成签到；无脚本时给一个兜底链接。 */
export function checkinPendingPage(token: string): string {
  const t = esc(token);
  return shell(
    "签到中 · 死了吗",
    `<div class="icon idle"><div class="spinner"></div></div>
     <h1>正在签到…</h1>
     <p>请稍候，正在为你确认平安。</p>
     <noscript>
       <a class="btn" href="/c/${t}/do">点此完成签到</a>
       <p class="meta">当前浏览器未启用脚本，需要手动点击一次。</p>
     </noscript>
     <script>
     (function(){
       var card=document.getElementById('card');
       function paint(cls,icon,title,msg,meta){
         var h='<div class="icon '+cls+'">'+icon+'</div><h1>'+title+'</h1><p>'+msg+'</p>';
         if(meta)h+='<p class="meta">'+meta+'</p>';
         card.innerHTML=h;
       }
       function fail(m){paint('bad','${ICON_BAD}','签到未完成',m,'')}
       function go(){
         fetch('/c/${t}/do?format=json',{method:'POST',headers:{'Accept':'application/json'}})
           .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
           .then(function(res){
             var d=res.d||{};
             if(res.ok&&d.ok){
               paint('ok','${ICON_OK}','已确认平安','签到成功，警报已解除。',
                 '本次签到时间：'+new Date(d.checkedAt*1000).toLocaleString());
             }else if(!res.ok&&d.retryAfterSec){
               paint('wait','${ICON_WAIT}','刚刚已签到过','当前处于签到冷却中，无需重复确认。',
                 '可在 '+Math.ceil(d.retryAfterSec/3600)+' 小时后再次签到');
             }else{
               fail(d.error||'签到失败，请登录后台手动签到。');
             }
           })
           .catch(function(){fail('网络异常，请登录后台手动签到。')});
       }
       go();
     })();
     </script>`
  );
}

/** 结果页。供 /do 的非脚本访问（兜底链接）使用。 */
export function checkinResultPage(opts: {
  ok: boolean;
  title: string;
  message: string;
  meta?: string;
  cooldown?: boolean;
}): string {
  const icon = opts.cooldown ? ICON_WAIT : opts.ok ? ICON_OK : ICON_BAD;
  const cls = opts.cooldown ? "wait" : opts.ok ? "ok" : "bad";
  const meta = opts.meta ? `<p class="meta">${esc(opts.meta)}</p>` : "";
  return shell(
    (opts.ok ? "已签到" : "签到未完成") + " · 死了吗",
    `<div class="icon ${cls}">${icon}</div>
     <h1>${esc(opts.title)}</h1>
     <p>${esc(opts.message)}</p>
     ${meta}`
  );
}

export function checkinInvalidPage(): string {
  return checkinResultPage({
    ok: false,
    title: "链接无效或已过期",
    message: "这条签到链接不可用。它可能已经被使用过太久，或系统的站点地址配置发生了变化。",
    meta: "请直接登录后台完成签到。",
  });
}

/** 一次性链接已用过后再次打开：明确告知已签到，避免「我到底签上没有」的恐慌。 */
export function checkinUsedPage(): string {
  return checkinResultPage({
    ok: true,
    title: "此链接已使用",
    message: "这条一键签到链接已经完成过签到，不可重复使用。若你尚未在后台确认状态，请登录查看。",
    meta: "签到成功，无需重复操作。",
  });
}

export function publicPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f7fb">
<title>死了吗</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%235b5bd6'/%3E%3Ctext x='16' y='22.5' font-family='sans-serif' font-size='15' font-weight='700' fill='%23fff' text-anchor='middle'%3E%E6%AD%BB%3C/text%3E%3C/svg%3E">
<script>
(function(){
  try{
    var t=localStorage.getItem('slm_theme');
    if(t!=='dark'&&t!=='light'){t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
    document.documentElement.setAttribute('data-theme',t);
  }catch(e){document.documentElement.setAttribute('data-theme','light')}
})();
</script>
<style>
  :root{
    --bg:#f6f7fb; --surface:#ffffff; --surface-2:#f1f3f9;
    --border:#e4e8f1; --text:#101828; --text-2:#475467; --muted:#98a2b3;
    --primary:#5b5bd6;
    --green:#12a150; --green-soft:rgba(18,161,80,.12);
    --yellow:#d97706; --yellow-soft:rgba(217,119,6,.14);
    --red:#e5484d;   --red-soft:rgba(229,72,77,.13);
    --track:#eceff5;
    --shadow:0 1px 2px rgba(16,24,40,.05),0 8px 32px rgba(16,24,40,.08);
  }
  [data-theme="dark"]{
    --bg:#0b0e14; --surface:#12161f; --surface-2:#181d29;
    --border:#232a38; --text:#f0f2f7; --text-2:#aab2c2; --muted:#69738a;
    --primary:#7b7bf0;
    --green:#34c98a; --green-soft:rgba(52,201,138,.15);
    --yellow:#f5a623; --yellow-soft:rgba(245,166,35,.16);
    --red:#f2666b;   --red-soft:rgba(242,102,107,.16);
    --track:#202636;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 40px rgba(0,0,0,.45);
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif;
    background:var(--bg);color:var(--text);min-height:100vh;
    display:flex;flex-direction:column;align-items:center;
    transition:background .3s ease,color .3s ease;
  }
  body::before{
    content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background:
      radial-gradient(520px 340px at 18% -6%, rgba(91,91,214,.09), transparent 62%),
      radial-gradient(600px 380px at 86% 108%, rgba(18,161,80,.07), transparent 60%);
  }
  [data-theme="dark"] body::before{
    background:
      radial-gradient(520px 340px at 18% -6%, rgba(123,123,240,.10), transparent 62%),
      radial-gradient(600px 380px at 86% 108%, rgba(52,201,138,.06), transparent 60%);
  }
  .theme-btn{
    position:fixed;top:18px;right:18px;z-index:20;width:40px;height:40px;border-radius:12px;
    display:flex;align-items:center;justify-content:center;cursor:pointer;
    background:var(--surface);border:1px solid var(--border);color:var(--text-2);
    box-shadow:var(--shadow);transition:transform .15s,color .2s,border-color .2s;
  }
  .theme-btn:hover{color:var(--primary);transform:translateY(-1px)}
  .theme-btn svg{width:19px;height:19px}
  [data-theme="dark"] .icon-sun{display:block}[data-theme="dark"] .icon-moon{display:none}
  :root:not([data-theme="dark"]) .icon-sun{display:none}:root:not([data-theme="dark"]) .icon-moon{display:block}

  .wrap{position:relative;z-index:1;max-width:480px;width:100%;padding:48px 20px 28px;margin:auto}
  .card{
    background:var(--surface);border-radius:24px;padding:44px 36px 36px;text-align:center;
    border:1px solid var(--border);box-shadow:var(--shadow);
    transition:background .4s,border-color .4s,color .4s;
  }
  /* ---- triggered：整卡强制暗色（保持原设计语义） ---- */
  .level-dark{background:#10141c;border-color:#232b3b;color:#f0f2f7}

  .dot{width:11px;height:11px;border-radius:50%;display:inline-block;margin-bottom:20px;animation:pulse 2.2s ease-in-out infinite}
  @keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.35);opacity:.75}}
  h1{font-size:14px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-bottom:26px}
  .level-dark h1{color:#8a93a8}

  .gauge-wrap{position:relative;width:216px;height:216px;margin:0 auto 8px}
  .gauge{width:100%;height:100%;transform:rotate(-90deg)}
  .gauge circle{fill:none;stroke-width:13;stroke-linecap:round}
  .gauge-bg{stroke:var(--track)}
  .gauge-fg{transition:stroke-dashoffset 1s cubic-bezier(.33,1,.68,1),stroke .4s}
  .gauge-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
  .hours{font-size:64px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.04em}
  .unit{font-size:13px;font-weight:500;color:var(--muted);letter-spacing:.02em}
  .level-dark .unit{color:#8a93a8}

  .desc{color:var(--text-2);font-size:14px;margin-top:18px;min-height:20px;font-weight:500}
  .chip{
    display:inline-flex;align-items:center;gap:7px;margin-top:18px;padding:7px 18px;
    border-radius:99px;font-size:13px;font-weight:600;color:#fff;letter-spacing:.02em;
  }
  .updated{margin-top:26px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}

  .level-green .dot{background:var(--green);box-shadow:0 0 0 6px var(--green-soft)}
  .level-yellow .dot{background:var(--yellow);box-shadow:0 0 0 6px var(--yellow-soft)}
  .level-red .dot{background:var(--red);box-shadow:0 0 0 6px var(--red-soft)}
  .level-dark .dot{background:#566078;box-shadow:0 0 0 6px rgba(86,96,120,.25)}
  .level-green .gauge-fg{stroke:var(--green)}
  .level-yellow .gauge-fg{stroke:var(--yellow)}
  .level-red .gauge-fg{stroke:var(--red)}
  .level-dark .gauge-fg{stroke:#566078}
  .level-dark .gauge-bg{stroke:#1d2433}
  .level-green .chip{background:var(--green)}
  .level-yellow .chip{background:var(--yellow)}
  .level-red .chip{background:var(--red)}
  .level-dark .chip{background:#39445c}

  footer{position:relative;z-index:1;padding:22px;text-align:center;font-size:12px;color:var(--muted);line-height:1.8}
  footer a{color:var(--muted);text-decoration:none;border-bottom:1px dashed var(--border)}
  footer a:hover{color:var(--primary);border-color:var(--primary)}

  @media (max-width:420px){
    .card{padding:36px 22px 30px}
    .gauge-wrap{width:184px;height:184px}
    .hours{font-size:54px}
  }
  @media (prefers-reduced-motion:reduce){
    *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}
  }
</style>
</head>
<body>
<button class="theme-btn js-theme" type="button" aria-label="切换深浅色模式">
  <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
  <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
</button>

<main class="wrap">
  <div class="card level-green" id="card">
    <span class="dot"></span>
    <h1>死了吗</h1>
    <div class="gauge-wrap">
      <svg class="gauge" viewBox="0 0 220 220" aria-hidden="true">
        <circle class="gauge-bg" cx="110" cy="110" r="92"/>
        <circle class="gauge-fg" id="gaugeFg" cx="110" cy="110" r="92"/>
      </svg>
      <div class="gauge-center">
        <div class="hours"><span id="hours">--</span></div>
        <div class="unit">小时未签到</div>
      </div>
    </div>
    <p class="desc" id="stateDesc">正在获取状态…</p>
    <span class="chip" id="chip">--</span>
    <div class="updated" id="updated"></div>
  </div>
</main>
<footer>所有者每日签到 · 超时未签到将自动通知已配置的联系人<br><a href="/admin">管理后台 →</a></footer>

<script>
(function(){
'use strict';
var CIRC=578.05;
var LEVEL_TEXT={green:'一切正常 · 请继续保持签到',yellow:'注意 · 已超过一半时限',red:'警告 · 即将触发群发',dark:'已触发 · 预设消息已发出'};
var STATE_TEXT={normal:'运行正常',warning:'警告期',triggered:'已触发'};
/* 时间按所有者的时区显示，而非访问者本地时区 —— 否则跨境查看会误读 */
var TZ='UTC';
function clock(){
  try{
    return new Intl.DateTimeFormat('zh-CN',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  }catch(e){return new Date().toLocaleTimeString()}
}
function $(id){return document.getElementById(id)}

document.querySelectorAll('.js-theme').forEach(function(b){
  b.addEventListener('click',function(){
    var cur=document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';
    var next=cur==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',next);
    try{localStorage.setItem('slm_theme',next)}catch(e){}
  });
});

$('gaugeFg').style.strokeDasharray=CIRC;

function render(){
  fetch('/api/status').then(function(r){return r.json()}).then(function(d){
    var level=d.level||'green';
    if(d.timezone)TZ=d.timezone;
    $('card').className='card level-'+level;
    document.title=level==='green'?'死了吗 · 平安':'死了吗 · '+(STATE_TEXT[d.state]||level);
    $('hours').textContent=(d.hoursSinceCheckin!=null?d.hoursSinceCheckin:'--');
    var pct=Math.max(0,Math.min(1,d.ratio||0));
    $('gaugeFg').style.strokeDashoffset=(CIRC*(1-pct)).toFixed(2);
    $('chip').textContent=STATE_TEXT[d.state]||d.state||'--';
    $('stateDesc').textContent=LEVEL_TEXT[level]||'';
    $('updated').textContent='更新于 '+clock();
  }).catch(function(){
    $('stateDesc').textContent='状态获取失败，60 秒后自动重试';
  });
}
render();
setInterval(render,60000);
})();
</script>
</body>
</html>`;
}

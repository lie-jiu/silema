export function adminPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>死了吗 · 管理后台</title>
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
    --bg:#f6f7fb; --surface:#ffffff; --surface-2:#f1f3f9; --surface-3:#e9edf5;
    --border:#e4e8f1; --border-strong:#d3dae6;
    --text:#101828; --text-2:#475467; --muted:#98a2b3;
    --primary:#5b5bd6; --primary-hover:#4c4cc4; --primary-soft:#eef0ff;
    --green:#12a150; --green-hover:#0e8a44; --green-soft:rgba(18,161,80,.12);
    --yellow:#d97706; --yellow-soft:rgba(217,119,6,.13);
    --red:#e5484d;   --red-soft:rgba(229,72,77,.11);
    --track:#eceff5;
    --ring:rgba(91,91,214,.20);
    --shadow-sm:0 1px 2px rgba(16,24,40,.05);
    --shadow-md:0 1px 2px rgba(16,24,40,.04),0 6px 24px rgba(16,24,40,.07);
    --shadow-lg:0 12px 48px rgba(16,24,40,.18);
  }
  [data-theme="dark"]{
    --bg:#0b0e14; --surface:#12161f; --surface-2:#181d29; --surface-3:#1f2532;
    --border:#232a38; --border-strong:#303949;
    --text:#f0f2f7; --text-2:#aab2c2; --muted:#69738a;
    --primary:#7b7bf0; --primary-hover:#9090f4; --primary-soft:rgba(123,123,240,.14);
    --green:#34c98a; --green-hover:#4bd69c; --green-soft:rgba(52,201,138,.15);
    --yellow:#f5a623; --yellow-soft:rgba(245,166,35,.16);
    --red:#f2666b;   --red-soft:rgba(242,102,107,.15);
    --track:#202636;
    --ring:rgba(123,123,240,.28);
    --shadow-sm:0 1px 2px rgba(0,0,0,.35);
    --shadow-md:0 1px 2px rgba(0,0,0,.3),0 8px 28px rgba(0,0,0,.35);
    --shadow-lg:0 16px 56px rgba(0,0,0,.55);
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif;
    background:var(--bg);color:var(--text);font-size:14px;line-height:1.55;
    transition:background .3s,color .3s;
  }
  button{font-family:inherit}
  ::selection{background:var(--primary);color:#fff}
  :focus-visible{outline:none;box-shadow:0 0 0 3px var(--ring)}
  ::-webkit-scrollbar{width:10px;height:10px}
  ::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:99px;border:2px solid var(--bg)}
  ::-webkit-scrollbar-track{background:transparent}

  svg.i{width:18px;height:18px;flex:none}

  /* ============ buttons ============ */
  .btn{
    padding:9px 16px;border:1px solid transparent;border-radius:10px;font-size:13px;font-weight:600;
    cursor:pointer;transition:all .16s;display:inline-flex;align-items:center;justify-content:center;gap:7px;
    user-select:none;white-space:nowrap;
  }
  .btn:disabled{opacity:.55;cursor:not-allowed}
  .btn svg.i{width:15px;height:15px}
  .btn-primary{background:var(--primary);color:#fff;box-shadow:var(--shadow-sm)}
  .btn-primary:hover:not(:disabled){background:var(--primary-hover);transform:translateY(-1px)}
  .btn-success{background:var(--green);color:#fff;box-shadow:var(--shadow-sm)}
  .btn-success:hover:not(:disabled){background:var(--green-hover);transform:translateY(-1px)}
  .btn-outline{background:var(--surface);border-color:var(--border-strong);color:var(--text-2)}
  .btn-outline:hover:not(:disabled){background:var(--surface-2);color:var(--text)}
  .btn-danger{background:var(--red-soft);color:var(--red)}
  .btn-danger:hover:not(:disabled){filter:brightness(.96)}
  .btn-sm{padding:6px 11px;font-size:12px;border-radius:8px}
  .btn-sm svg.i{width:13.5px;height:13.5px}
  .btn-ico{
    width:32px;height:32px;padding:0;border-radius:8px;background:transparent;color:var(--muted);
    border:1px solid transparent;
  }
  .btn-ico:hover{background:var(--surface-2);color:var(--text)}

  /* ============ forms ============ */
  .form-group{margin-bottom:14px}
  label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-2)}
  input[type=text],input[type=password],input[type=number],select,textarea{
    width:100%;padding:9px 12px;border:1px solid var(--border-strong);border-radius:10px;
    font-size:14px;outline:none;background:var(--surface);color:var(--text);
    font-family:inherit;transition:border-color .15s,box-shadow .15s;
  }
  input:focus,select:focus,textarea:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--ring)}
  input::placeholder,textarea::placeholder{color:var(--muted)}
  textarea{resize:vertical;min-height:110px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.6}
  select{cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2398a2b3' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:36px}
  input[type=file]{display:none}
  .req{color:var(--red)}

  /* switch */
  .switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
  .switch input{position:absolute;opacity:0;width:0;height:0}
  .switch .trk{
    width:34px;height:20px;border-radius:99px;background:var(--surface-3);position:relative;flex:none;
    border:1px solid var(--border-strong);transition:all .2s;
  }
  .switch .trk::after{
    content:"";position:absolute;top:50%;left:2px;transform:translateY(-50%);
    width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.3);
    transition:left .2s cubic-bezier(.33,1,.68,1);
  }
  .switch input:checked+.trk{background:var(--green);border-color:var(--green)}
  .switch input:checked+.trk::after{left:16px}
  .switch input:focus-visible+.trk{box-shadow:0 0 0 3px var(--ring)}
  .switch em{font-style:normal;font-size:12px;font-weight:600;color:var(--muted)}
  .switch input:checked~em{color:var(--green)}

  /* checkbox inline */
  .ckb{display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;font-weight:500;color:var(--text-2)}
  .ckb input{width:15px;height:15px;accent-color:var(--primary);cursor:pointer}

  /* ============ login ============ */
  .login-page{
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;overflow:hidden;
    background:
      radial-gradient(560px 360px at 14% -4%, rgba(91,91,214,.10), transparent 60%),
      radial-gradient(520px 380px at 88% 106%, rgba(18,161,80,.07), transparent 60%);
  }
  [data-theme="dark"] .login-page{
    background:
      radial-gradient(560px 360px at 14% -4%, rgba(123,123,240,.12), transparent 60%),
      radial-gradient(520px 380px at 88% 106%, rgba(52,201,138,.06), transparent 60%);
  }
  .login-card{
    background:var(--surface);border-radius:20px;padding:40px 36px;width:100%;max-width:408px;
    box-shadow:var(--shadow-md);border:1px solid var(--border);animation:pop .35s cubic-bezier(.33,1,.68,1);
  }
  @keyframes pop{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
  .logo{
    width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;margin-bottom:18px;
    background:linear-gradient(135deg,var(--primary),#8b5cf6);color:#fff;box-shadow:0 6px 16px rgba(91,91,214,.35);
  }
  .logo svg{width:24px;height:24px}
  .login-card h1{font-size:21px;font-weight:800;letter-spacing:-.01em}
  .login-card>p{color:var(--muted);margin:4px 0 24px;font-size:13px}
  .error{color:var(--red);font-size:13px;margin-top:2px;min-height:18px;font-weight:500}
  .hint{font-size:12px;color:var(--muted);line-height:1.7;margin-top:14px}

  /* ============ shell ============ */
  .shell{display:none;min-height:100vh}
  .shell.on{display:flex}
  .sidebar{
    width:236px;flex:none;background:var(--surface);border-right:1px solid var(--border);
    display:flex;flex-direction:column;position:fixed;top:0;bottom:0;left:0;z-index:60;
    transition:transform .25s cubic-bezier(.33,1,.68,1);
  }
  .brand{padding:20px 18px 16px;display:flex;align-items:center;gap:11px;border-bottom:1px solid var(--border)}
  .brand .mark{
    width:38px;height:38px;border-radius:11px;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;
    background:linear-gradient(135deg,var(--primary),#8b5cf6);box-shadow:0 4px 12px rgba(91,91,214,.3);
  }
  .brand .mark svg{width:19px;height:19px}
  .brand b{display:block;font-size:15px;font-weight:800;letter-spacing:.01em}
  .brand span{display:block;font-size:11px;color:var(--muted);margin-top:1px}
  nav{flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:3px;overflow-y:auto}
  .nav-item{
    display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;color:var(--text-2);
    text-decoration:none;cursor:pointer;border:none;background:none;font-family:inherit;font-size:13.5px;
    font-weight:600;text-align:left;transition:all .15s;position:relative;
  }
  .nav-item:hover{background:var(--surface-2);color:var(--text)}
  .nav-item.active{background:var(--primary-soft);color:var(--primary)}
  .nav-item.active::before{
    content:"";position:absolute;left:-10px;top:50%;transform:translateY(-50%);
    width:3px;height:18px;border-radius:99px;background:var(--primary);
  }
  .side-foot{padding:12px 14px;border-top:1px solid var(--border)}
  .scrim{position:fixed;inset:0;background:rgba(8,11,18,.5);backdrop-filter:blur(2px);z-index:55;opacity:0;pointer-events:none;transition:opacity .25s}
  .scrim.on{opacity:1;pointer-events:auto}

  .main{flex:1;margin-left:236px;min-width:0;display:flex;flex-direction:column}
  .topbar{
    position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:12px;
    padding:0 28px;height:60px;background:color-mix(in srgb,var(--bg) 82%,transparent);
    backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);
  }
  @supports not (background:color-mix(in srgb,red 50%,blue)){.topbar{background:var(--bg)}}
  .burger{display:none;width:38px;height:38px;border:none;border-radius:10px;background:none;color:var(--text-2);cursor:pointer;align-items:center;justify-content:center}
  .burger:hover{background:var(--surface-2)}
  .crumb{font-size:15px;font-weight:700;flex:1;letter-spacing:-.01em}
  .top-state{
    font-size:12px;font-weight:700;padding:4px 12px;border-radius:99px;display:inline-flex;align-items:center;gap:6px;
  }
  .top-state i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
  .top-state.green{background:var(--green-soft);color:var(--green)}
  .top-state.yellow{background:var(--yellow-soft);color:var(--yellow)}
  .top-state.red{background:var(--red-soft);color:var(--red)}
  .top-state.dark{background:var(--surface-3);color:var(--text-2)}
  .theme-btn{
    width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;
    background:none;border:1px solid transparent;color:var(--muted);transition:all .15s;
  }
  .theme-btn:hover{background:var(--surface-2);color:var(--text)}
  .theme-btn svg{width:18px;height:18px}
  [data-theme="dark"] .icon-sun{display:block}[data-theme="dark"] .icon-moon{display:none}
  :root:not([data-theme="dark"]) .icon-sun{display:none}:root:not([data-theme="dark"]) .icon-moon{display:block}

  .content{padding:26px 28px 48px;max-width:1080px;width:100%;margin:0 auto}
  .page{display:none}
  .page.on{display:block;animation:fadein .22s ease}
  @keyframes fadein{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
  .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;gap:12px;flex-wrap:wrap}
  .header h2{font-size:20px;font-weight:800;letter-spacing:-.02em}
  .actions{display:flex;gap:8px;flex-wrap:wrap}

  /* ============ cards & stats ============ */
  .card{
    background:var(--surface);border-radius:16px;padding:22px;border:1px solid var(--border);
    margin-bottom:16px;box-shadow:var(--shadow-sm);
  }
  .card h3{font-size:14.5px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;letter-spacing:-.01em}
  .card h3 svg.i{width:16px;height:16px;color:var(--primary)}
  .hint{font-size:12px;color:var(--muted);line-height:1.7;margin-top:10px}
  .hint code{
    font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;background:var(--surface-2);
    border:1px solid var(--border);border-radius:6px;padding:2px 7px;color:var(--text-2);white-space:nowrap;
  }
  hr.sep{border:none;border-top:1px solid var(--border);margin:16px 0}

  .banner{
    display:none;align-items:center;gap:12px;padding:13px 16px;border-radius:14px;margin-bottom:16px;
    font-size:13px;font-weight:600;line-height:1.6;
  }
  .banner.on{display:flex;animation:fadein .25s ease}
  .banner svg.i{width:19px;height:19px;flex:none}
  .banner.warn{background:var(--yellow-soft);color:var(--yellow)}
  .banner.trig{background:var(--red-soft);color:var(--red)}
  .banner .btn{margin-left:auto}
  .banner.trig .btn{background:var(--red);color:#fff}

  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:16px}
  .stat{
    background:var(--surface);border-radius:16px;padding:18px 20px;border:1px solid var(--border);
    box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:10px;
  }
  .stat .row{display:flex;align-items:center;gap:8px}
  .stat .ico{
    width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none;
    background:var(--primary-soft);color:var(--primary);
  }
  .stat .ico svg.i{width:15px;height:15px}
  .stat .label{font-size:12px;color:var(--muted);font-weight:600}
  .stat .value{font-size:27px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.03em;line-height:1.1}
  .stat .value small{font-size:13px;font-weight:600;color:var(--muted);letter-spacing:0;margin-left:3px}
  .stat.green .value{color:var(--green)}.stat.yellow .value{color:var(--yellow)}
  .stat.red .value{color:var(--red)}.stat.dark .value{color:var(--text-2)}
  .stat.green .ico{background:var(--green-soft);color:var(--green)}
  .stat.yellow .ico{background:var(--yellow-soft);color:var(--yellow)}
  .stat.red .ico{background:var(--red-soft);color:var(--red)}
  .stat.dark .ico{background:var(--surface-3);color:var(--text-2)}

  .progress{height:9px;background:var(--track);border-radius:99px;overflow:hidden}
  .progress i{display:block;height:100%;background:var(--green);border-radius:99px;width:0%;transition:width .7s cubic-bezier(.33,1,.68,1),background .3s}

  /* skeleton */
  .skel{position:relative;overflow:hidden;background:var(--surface-2);border-radius:10px}
  .skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);animation:shimmer 1.4s infinite}
  [data-theme="dark"] .skel::after{background:linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent)}
  @keyframes shimmer{to{transform:translateX(100%)}}

  /* ============ calendar ============ */
  .cal-head{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:18px;font-weight:700;font-size:15px}
  .cal-head span{min-width:118px;text-align:center;font-variant-numeric:tabular-nums}
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
  .cal-dow{font-size:11px;font-weight:700;color:var(--muted);text-align:center;padding:6px 0;text-transform:uppercase;letter-spacing:.05em}
  .cal-day{
    aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
    border-radius:11px;background:var(--surface-2);font-weight:600;font-variant-numeric:tabular-nums;
    transition:transform .15s;
  }
  .cal-day.checked{background:var(--green-soft);color:var(--green);font-weight:700}
  .cal-day.checked .t{color:var(--green);opacity:.75}
  .cal-day.today{outline:2px solid var(--primary);outline-offset:-2px}
  .cal-day .t{font-size:10px;color:var(--muted);font-weight:500;font-variant-numeric:tabular-nums}
  .legend{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:16px;font-size:12px;color:var(--muted)}
  .legend i{width:10px;height:10px;border-radius:4px;display:inline-block;margin-right:6px;vertical-align:-1px}
  .legend .l-ok{background:var(--green-soft);outline:1px solid var(--green)}
  .legend .l-today{background:var(--surface-2);outline:2px solid var(--primary);outline-offset:-2px}

  /* ============ templates ============ */
  .tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
  .tpl{
    background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px;
    box-shadow:var(--shadow-sm);transition:box-shadow .2s,transform .2s,border-color .2s;
    display:flex;flex-direction:column;gap:12px;
  }
  .tpl:hover{box-shadow:var(--shadow-md);transform:translateY(-2px)}
  .tpl-head{display:flex;align-items:center;gap:10px}
  .tpl-ico{
    width:34px;height:34px;border-radius:10px;flex:none;display:flex;align-items:center;justify-content:center;
    background:var(--primary-soft);color:var(--primary);
  }
  .tpl-ico svg.i{width:16px;height:16px}
  .tpl h4{font-size:14px;font-weight:700;letter-spacing:-.01em}
  .tpl p{
    font-size:12px;color:var(--muted);min-height:48px;max-height:48px;overflow:hidden;line-height:1.55;
    word-break:break-all;flex:1;white-space:pre-line;
  }
  .tpl p.unset{display:flex;align-items:center;font-style:normal;opacity:.7}
  .tpl .row{display:flex;gap:7px}
  .empty{
    text-align:center;color:var(--muted);padding:44px 16px;border:1.5px dashed var(--border-strong);
    border-radius:16px;font-size:13px;line-height:2;
  }
  .empty svg.i{width:26px;height:26px;color:var(--muted);margin-bottom:6px}

  /* ============ recipients ============ */
  .rcpt{
    display:flex;align-items:center;gap:14px;padding:13px 4px;border-bottom:1px solid var(--border);flex-wrap:wrap;
  }
  .rcpt:last-child{border-bottom:none}
  .rcpt-ico{
    width:36px;height:36px;border-radius:11px;flex:none;display:flex;align-items:center;justify-content:center;
    background:var(--surface-2);color:var(--text-2);
  }
  .rcpt-ico svg.i{width:17px;height:17px}
  .rcpt-info{flex:1;min-width:180px}
  .rcpt-name{font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .badge{
    display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;
    background:var(--surface-2);color:var(--text-2);letter-spacing:.01em;
  }
  .rcpt-cfg{
    display:block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:var(--muted);
    word-break:break-all;margin-top:3px;
  }
  .rcpt-sw{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
  .rcpt-act{display:flex;gap:5px}

  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}

  /* ============ modal ============ */
  .overlay{
    position:fixed;inset:0;background:rgba(8,11,18,.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
    z-index:100;display:none;align-items:center;justify-content:center;padding:16px;
  }
  .overlay.on{display:flex;animation:fadein .18s ease}
  .modal{
    background:var(--surface);border-radius:18px;padding:26px;width:100%;max-width:500px;max-height:88vh;overflow-y:auto;
    box-shadow:var(--shadow-lg);border:1px solid var(--border);animation:pop .28s cubic-bezier(.33,1,.68,1);
  }
  .modal h3{margin-bottom:18px;font-size:16.5px;font-weight:800;letter-spacing:-.01em}
  .modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
  .file-label{
    display:flex;align-items:center;justify-content:center;gap:8px;padding:13px;border:1.5px dashed var(--border-strong);
    border-radius:10px;cursor:pointer;color:var(--muted);font-size:13px;font-weight:600;transition:all .15s;
  }
  .file-label:hover{border-color:var(--primary);color:var(--primary);background:var(--primary-soft)}

  /* confirm modal */
  #confirmModal .modal{max-width:400px;text-align:left}
  #confirmMsg{color:var(--text-2);font-size:13.5px;line-height:1.7;margin-top:-8px;margin-bottom:4px}

  /* ============ toasts ============ */
  .toast-box{position:fixed;bottom:22px;right:22px;z-index:300;display:flex;flex-direction:column;gap:9px}
  .toast{
    display:flex;align-items:center;gap:9px;padding:12px 16px;border-radius:12px;color:#fff;font-size:13px;font-weight:600;
    animation:slidein .28s cubic-bezier(.33,1,.68,1);box-shadow:var(--shadow-lg);max-width:340px;
  }
  .toast svg.i{width:16px;height:16px;flex:none}
  .toast.success{background:#15803d}
  .toast.error{background:#dc2626}
  .toast.out{opacity:0;transform:translateY(8px);transition:all .3s}
  @keyframes slidein{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}

  /* ============ responsive ============ */
  @media (max-width:900px){
    .sidebar{transform:translateX(-105%);box-shadow:none}
    .sidebar.open{transform:translateX(0);box-shadow:var(--shadow-lg)}
    .main{margin-left:0}
    .burger{display:flex}
    .topbar{padding:0 16px}
    .content{padding:20px 16px 42px}
    .grid2{grid-template-columns:1fr}
    .rcpt-sw{width:100%;padding-left:50px}
  }
  @media (prefers-reduced-motion:reduce){
    *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}
  }
</style>
</head>
<body>

<!-- ================= 登录 ================= -->
<div id="loginView" class="login-page">
  <div class="login-card">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="m12.5 17-.5-1-.5 1h1z"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/></svg>
    </div>
    <h1>死了吗</h1>
    <p>管理后台登录 · 会话有效期 12 小时</p>
    <div class="form-group"><label for="liUser">用户名</label><input type="text" id="liUser" autocomplete="username"></div>
    <div class="form-group"><label for="liPass">密码</label><input type="password" id="liPass" autocomplete="current-password"></div>
    <div class="form-group"><label for="liTotp">TOTP 验证码</label><input type="text" id="liTotp" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="6 位验证码"></div>
    <div class="error" id="liErr"></div>
    <button class="btn btn-primary" id="btnLogin" style="width:100%">
      <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      登 录
    </button>
    <p class="hint">忘记 TOTP？通过 wrangler 更新 owner 表的 totp_secret 字段即可重置（见 README）。</p>
  </div>
</div>

<!-- ================= 应用 ================= -->
<div id="appView" class="shell">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <div class="mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="m12.5 17-.5-1-.5 1h1z"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/></svg>
      </div>
      <div><b>死了吗</b><span>每日签到开关</span></div>
    </div>
    <nav aria-label="主导航">
      <button class="nav-item active" data-nav="dash" type="button">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
        仪表盘
      </button>
      <button class="nav-item" data-nav="cal" type="button">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        签到日历
      </button>
      <button class="nav-item" data-nav="rcpt" type="button">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        通知接收人
      </button>
      <button class="nav-item" data-nav="set" type="button">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        设置
      </button>
    </nav>
    <div class="side-foot">
      <button class="btn btn-danger btn-sm" id="btnLogout" style="width:100%" type="button">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        退出登录
      </button>
    </div>
  </aside>
  <div class="scrim" id="scrim"></div>

  <div class="main">
    <header class="topbar">
      <button class="burger" id="btnBurger" type="button" aria-label="打开菜单">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
      </button>
      <div class="crumb" id="pageTitle">仪表盘</div>
      <span class="top-state green" id="topState" style="display:none"><i></i><b id="topStateTxt"></b></span>
      <button class="theme-btn js-theme" type="button" aria-label="切换深浅色模式">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      </button>
    </header>

    <div class="content">

      <!-- ======== 仪表盘 ======== -->
      <section id="page-dash" class="page on">
        <div class="header">
          <h2>仪表盘</h2>
          <div class="actions">
            <button class="btn btn-outline" id="resetBtn" style="display:none" type="button">
              <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              复位状态机
            </button>
            <button class="btn btn-success js-checkin" type="button">
              <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              <span class="js-label">立即签到</span>
            </button>
          </div>
        </div>

        <div class="banner warn" id="bannerWarn">
          <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z"/><line x1="12" y1="9" x2="12" y2="13"/><path d="M12 17h.01"/></svg>
          <span>已进入<b>警告期</b>：最后警告已发出。请在警告期内登录确认平安，否则将触发群发。</span>
        </div>
        <div class="banner trig" id="bannerTrig">
          <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span><b>已触发</b>：预设消息已发送给所有订阅接收人。处理完毕后请复位状态机。</span>
          <button class="btn btn-sm" id="resetBtn2" type="button">立即复位</button>
        </div>

        <div class="stats" id="dashStats"></div>
        <div class="card">
          <h3>
            <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            签到周期进度
          </h3>
          <div class="progress"><i id="dashBar"></i></div>
          <p class="hint" id="dashHint"></p>
        </div>
      </section>

      <!-- ======== 日历 ======== -->
      <section id="page-cal" class="page">
        <div class="header">
          <h2>签到日历</h2>
          <button class="btn btn-success js-checkin" type="button">
            <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            <span class="js-label">立即签到</span>
          </button>
        </div>
        <div class="card">
          <div class="cal-head">
            <button class="btn btn-outline btn-sm" id="calPrev" type="button" aria-label="上一月">
              <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <span id="calTitle"></span>
            <button class="btn btn-outline btn-sm" id="calNext" type="button" aria-label="下一月">
              <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          </div>
          <div class="cal-grid" id="calGrid"></div>
          <div class="legend">
            <span><i class="l-ok"></i>当日已签到（标注首次签到时间）</span>
            <span><i class="l-today"></i>今天</span>
            <span id="calTz"></span>
          </div>
        </div>
      </section>

      <!-- ======== 通知接收人 ======== -->
      <section id="page-rcpt" class="page">
        <div class="header"><h2>通知接收人</h2></div>
        <div class="card">
          <h3>
            <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            接收人列表与新增
          </h3>
          <p class="hint" style="margin:-6px 0 14px">每个接收人各自携带要发送的内容：勾选哪个事件，就必须填写对应内容；首行自动作为标题。</p>
          <div id="rcptList"></div>
          <hr class="sep">
          <div class="grid2">
            <div class="form-group"><label for="rcptLabel">备注名称</label><input type="text" id="rcptLabel" placeholder="如：我自己 / 家人 / 运维群"></div>
            <div class="form-group"><label for="rcptType">通道类型</label>
              <select id="rcptType">
                <option value="email">邮件</option><option value="telegram">Telegram</option><option value="bark">Bark</option>
                <option value="ntfy">ntfy</option><option value="serverchan">Server酱(Turbo微信)</option>
                <option value="serverchan3">Server酱³(APP)</option><option value="webhook">Webhook</option>
              </select>
            </div>
          </div>
          <div class="form-group"><label>通道配置</label><div id="rcptFields"></div></div>
          <div style="display:flex;gap:20px;flex-wrap:wrap;margin:4px 0 8px">
            <label class="ckb"><input type="checkbox" id="rcptWarn"> 警告开始时通知</label>
            <label class="ckb"><input type="checkbox" id="rcptTrig" checked> 警告结束时通知（群发）</label>
          </div>
          <div class="form-group" id="warnContentGroup" style="display:none">
            <label for="rcptWarnContent">「警告开始」内容 <span class="req">*</span> <span style="font-weight:400;color:var(--muted)">首行=标题，<code>{deadline}</code>=确认截止时间</span></label>
            <textarea id="rcptWarnContent" rows="3" placeholder="⚠️ 你还好吗&#10;你已超过签到时限，请在 {deadline} 前登录确认平安"></textarea>
          </div>
          <div class="form-group" id="trigContentGroup" style="display:none">
            <label for="rcptTrigContent">「警告结束」内容 <span class="req">*</span> <span style="font-weight:400;color:var(--muted)">首行=标题，<code>{time}</code>=触发时刻</span></label>
            <textarea id="rcptTrigContent" rows="3" placeholder="死了吗：主人失联了&#10;所有者超过时限未签到，于 {time} 触发本条预设消息"></textarea>
          </div>
          <button class="btn btn-primary btn-sm" id="btnAddRcpt" type="button" style="margin-top:10px">
            <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            添加接收人
          </button>
          <p class="hint">带 <span class="req">*</span> 为必填。行内开关可随时调整订阅事件；铅笔按钮编辑该接收人的通知内容。</p>
        </div>
      </section>

      <!-- ======== 设置 ======== -->
      <section id="page-set" class="page">
        <div class="header"><h2>设置</h2></div>

        <div class="card">
          <h3>
            <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            签到周期
          </h3>
          <div class="form-group">
            <label for="setTz">时区（IANA 名称）</label>
            <input type="text" id="setTz" list="tzList" placeholder="Asia/Shanghai">
            <datalist id="tzList"><option>Asia/Shanghai</option><option>Asia/Hong_Kong</option><option>Asia/Taipei</option><option>Singapore</option><option>Asia/Tokyo</option><option>Europe/London</option><option>America/New_York</option><option>America/Los_Angeles</option><option>UTC</option></datalist>
          </div>
          <div class="grid2">
            <div class="form-group"><label for="setExpiry">签到时限（小时）</label><input type="number" id="setExpiry" min="1" max="8760"></div>
            <div class="form-group"><label for="setWarn">警告期时长（小时）</label><input type="number" id="setWarn" min="1" max="8760"></div>
          </div>
          <button class="btn btn-primary" id="btnSaveSettings" type="button">保存设置</button>
        </div>

        <div class="card">
          <h3>
            <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            管理员凭据
          </h3>
          <p class="hint">
            用户名与密码由 Cloudflare 机密变量管理（<code>ADMIN_USERNAME</code> / <code>ADMIN_PASSWORD</code>），不在数据库中存储。
            如需修改，请在项目目录运行：<br><br>
            <code>npx wrangler secret put ADMIN_USERNAME</code><br>
            <code>npx wrangler secret put ADMIN_PASSWORD</code>
          </p>
        </div>
      </section>

    </div>
  </div>
</div>

<!-- ================= 接收人内容编辑弹窗 ================= -->
<div class="overlay" id="contentModal" role="dialog" aria-modal="true">
  <div class="modal">
    <h3 id="cmTitle">编辑通知内容</h3>
    <p class="hint" style="margin:-8px 0 14px">首行自动作为标题。仅勾选中的事件会被要求填写。</p>
    <div class="form-group">
      <label for="cmWarn">「警告开始」内容 <span style="font-weight:400;color:var(--muted)">（<code>{deadline}</code>=确认截止时间）</span></label>
      <textarea id="cmWarn" rows="4"></textarea>
    </div>
    <div class="form-group">
      <label for="cmTrig">「警告结束」内容 <span style="font-weight:400;color:var(--muted)">（<code>{time}</code>=触发时刻）</span></label>
      <textarea id="cmTrig" rows="4"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="cmCancel" type="button">取消</button>
      <button class="btn btn-primary" id="cmSave" type="button">保存</button>
    </div>
  </div>
</div>

<!-- ================= 通用确认弹窗 ================= -->
<div class="overlay" id="confirmModal" role="dialog" aria-modal="true">
  <div class="modal">
    <h3 id="confirmTitle">确认操作</h3>
    <p id="confirmMsg"></p>
    <div class="modal-actions">
      <button class="btn btn-outline" id="confirmCancel" type="button">取消</button>
      <button class="btn btn-danger" id="confirmOk" type="button">确认</button>
    </div>
  </div>
</div>

<div class="toast-box" id="toasts" aria-live="polite"></div>

<script>
(function(){
'use strict';

/* ---------- utilities ---------- */
function $(id){return document.getElementById(id)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
var TOAST_ICONS={
  success:'<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error:'<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
};
function toast(msg,type){
  var el=document.createElement('div');
  el.className='toast '+(type||'success');
  el.innerHTML=(TOAST_ICONS[type||'success']||'')+'<span>'+esc(msg)+'</span>';
  $('toasts').appendChild(el);
  setTimeout(function(){el.classList.add('out');setTimeout(function(){el.remove()},320)},3400);
}

/* ---------- theme ---------- */
document.querySelectorAll('.js-theme').forEach(function(b){
  b.addEventListener('click',function(){
    var cur=document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';
    var next=cur==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',next);
    try{localStorage.setItem('slm_theme',next)}catch(e){}
  });
});

/* ---------- icons ---------- */
var ICONS={
  email:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  telegram:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  bark:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  ntfy:'<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  serverchan:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  serverchan3:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  webhook:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'
};
function ic(name,size){
  return '<svg class="i" style="width:'+(size||17)+'px;height:'+(size||17)+'px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[name]||ICONS.webhook)+'</svg>';
}

/* ---------- api ---------- */
var token=localStorage.getItem('dms_token')||'';
var calYear,calMonth;
var lastCheckinAt=null;
var curState='normal';
var COOLDOWN=12*3600; /* fallback; real value arrives via /api/status cooldownSec */

function api(path,opts){
  opts=opts||{};
  var headers={'Content-Type':'application/json'};
  if(token)headers['Authorization']='Bearer '+token;
  return fetch(path,{method:opts.method||'GET',headers:headers,body:opts.body?JSON.stringify(opts.body):undefined})
    .then(function(resp){
      if(resp.status===401&&path!=='/api/auth/login'){forceLogout();throw{status:401,message:'会话已过期，请重新登录'}}
      return resp.text().then(function(t){
        var data=null;try{data=t?JSON.parse(t):null}catch(e){}
        if(!resp.ok)throw{status:resp.status,message:(data&&data.error)||('HTTP '+resp.status)};
        return data;
      });
    });
}

/* ---------- checkin buttons ---------- */
function fmtRemain(sec){
  var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);
  if(h>0)return h+' 小时 '+m+' 分';
  if(m>0)return m+' 分钟';
  return '不足 1 分钟';
}
function updateCheckinButtons(){
  var remain=(curState==='normal'&&lastCheckinAt)?(COOLDOWN-(Math.floor(Date.now()/1000)-lastCheckinAt)):0;
  var ready=remain<=0;
  document.querySelectorAll('.js-checkin').forEach(function(b){
    b.disabled=!ready;
    b.querySelector('.js-label').textContent=ready?'立即签到':'冷却中 · '+fmtRemain(remain);
  });
}
setInterval(updateCheckinButtons,30000);

/* ---------- auth ---------- */
window.doLogin=function(){
  var u=$('liUser').value.trim(),p=$('liPass').value,t=$('liTotp').value.trim();
  if(!u||!p||!t){$('liErr').textContent='请填写所有字段';return}
  var btn=$('btnLogin');btn.disabled=true;
  api('/api/auth/login',{method:'POST',body:{username:u,password:p,totpCode:t}})
    .then(function(d){
      token=d.token;try{localStorage.setItem('dms_token',token)}catch(e){}
      enterApp();
    })
    .catch(function(e){$('liErr').textContent=e.message||'登录失败'})
    .finally(function(){btn.disabled=false});
};
function forceLogout(){
  token='';try{localStorage.removeItem('dms_token')}catch(e){}
  $('appView').classList.remove('on');
  $('loginView').style.display='flex';
}
$('btnLogout').addEventListener('click',function(){token='';localStorage.removeItem('dms_token');location.reload()});

function enterApp(){
  $('loginView').style.display='none';
  $('appView').classList.add('on');
  showPage('dash');
}

/* ---------- navigation ---------- */
var PAGE_TITLES={dash:'仪表盘',cal:'签到日历',rcpt:'通知接收人',set:'设置'};
function closeSidebar(){$('sidebar').classList.remove('open');$('scrim').classList.remove('on')}
function showPage(name){
  document.querySelectorAll('.page').forEach(function(p){p.classList.toggle('on',p.id==='page-'+name)});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.nav===name)});
  $('pageTitle').textContent=PAGE_TITLES[name]||'';
  closeSidebar();
  if(name==='dash')loadDashboard();
  if(name==='cal')loadCalendar();
  if(name==='rcpt')loadRecipients();
  if(name==='set')loadSettings();
}
document.querySelectorAll('[data-nav]').forEach(function(n){
  n.addEventListener('click',function(){showPage(n.dataset.nav)});
});
$('btnBurger').addEventListener('click',function(){
  $('sidebar').classList.toggle('open');$('scrim').classList.toggle('on');
});
$('scrim').addEventListener('click',closeSidebar);

/* ---------- dashboard ---------- */
var STATE_CN={normal:'正常',warning:'警告期',triggered:'已触发'};
var LEVEL_COLOR={green:'#12a150',yellow:'#d97706',red:'#e5484d',dark:'#64748b'};
function topStateBadge(level,state){
  var el=$('topState');
  if(level==='green'&&state==='normal'){el.style.display='none';return}
  el.className='top-state '+(level||'green');
  el.style.display='inline-flex';
  $('topStateTxt').textContent=STATE_CN[state]||state||'';
}
function loadDashboard(){
  $('dashStats').innerHTML=
    '<div class="stat"><div class="skel" style="height:14px;width:80px"></div><div class="skel" style="height:30px;width:120px"></div></div>'+
    '<div class="stat"><div class="skel" style="height:14px;width:80px"></div><div class="skel" style="height:30px;width:90px"></div></div>'+
    '<div class="stat"><div class="skel" style="height:14px;width:80px"></div><div class="skel" style="height:30px;width:130px"></div></div>'+
    '<div class="stat"><div class="skel" style="height:14px;width:80px"></div><div class="skel" style="height:30px;width:70px"></div></div>';
  Promise.all([api('/api/status'),api('/api/settings')]).then(function(rs){
    var st=rs[0],cfg=rs[1]||{};
    if(st.cooldownSec>0)COOLDOWN=st.cooldownSec;
    lastCheckinAt=cfg.last_checkin_at||null;
    curState=st.state||'normal';
    updateCheckinButtons();
    topStateBadge(st.level,st.state);

    var levelClass={green:'green',yellow:'yellow',red:'red',dark:'dark'}[st.level]||'green';
    var remain=Math.max(0,(cfg.expiry_hours||24)-st.hoursSinceCheckin);
    $('dashStats').innerHTML=
      '<div class="stat '+levelClass+'">'+
        '<div class="row"><span class="ico"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span><span class="label">上次签到距今</span></div>'+
        '<div class="value">'+st.hoursSinceCheckin+'<small>小时</small></div>'+
      '</div>'+
      '<div class="stat">'+
        '<div class="row"><span class="ico"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span><span class="label">当前状态</span></div>'+
        '<div class="value">'+esc(STATE_CN[st.state]||st.state)+'</div>'+
      '</div>'+
      '<div class="stat '+levelClass+'">'+
        '<div class="row"><span class="ico"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414-4.414A2 2 0 0 1 7 6.172V2"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414 4.414a2 2 0 0 1 .586 1.414V22"/></svg></span><span class="label">预计剩余</span></div>'+
        '<div class="value">'+remain.toFixed(1)+'<small>小时</small></div>'+
      '</div>'+
      '<div class="stat">'+
        '<div class="row"><span class="ico"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span><span class="label">签到时限</span></div>'+
        '<div class="value">'+(cfg.expiry_hours||'?')+'<small>小时</small></div>'+
      '</div>';

    var pct=Math.max(0,Math.min(1,st.ratio||0))*100;
    var bar=$('dashBar');
    bar.style.width=pct.toFixed(1)+'%';
    bar.style.background=LEVEL_COLOR[st.level]||'#12a150';
    $('dashHint').textContent='时限 '+(cfg.expiry_hours||'?')+' 小时 · 警告期 '+(cfg.warning_hours||'?')+' 小时 · 时区 '+(cfg.timezone||'-');

    var abnormal=(st.state==='warning'||st.state==='triggered');
    $('resetBtn').style.display=abnormal?'inline-flex':'none';
    $('bannerWarn').classList.toggle('on',st.state==='warning');
    $('bannerTrig').classList.toggle('on',st.state==='triggered');
  }).catch(function(e){if(e.status!==401){toast('加载失败：'+e.message,'error');$('dashStats').innerHTML='<div class="empty" style="flex:1">数据加载失败</div>'}});
}
function doReset(){
  api('/api/reset',{method:'POST'}).then(function(){
    toast('状态机已复位，未投递的排队消息已取消');loadDashboard();
  }).catch(function(e){if(e.status!==401)toast(e.message,'error')});
}
$('resetBtn').addEventListener('click',function(){
  confirmBox('复位状态机','将状态恢复为「正常」，并取消该轮尚未投递的消息。确定继续？','复位',doReset);
});
$('resetBtn2').addEventListener('click',function(){
  confirmBox('复位状态机','将状态恢复为「正常」，并取消该轮尚未投递的消息。确定继续？','复位',doReset);
});

function doCheckin(){
  api('/api/checkin',{method:'POST'}).then(function(d){
    lastCheckinAt=Math.floor(d.checkedAt||Date.now()/1000);
    curState='normal';
    updateCheckinButtons();
    toast('签到成功，已恢复平安');loadDashboard();
  }).catch(function(e){if(e.status!==401)toast(e.message,'error')});
}
document.querySelectorAll('.js-checkin').forEach(function(b){b.addEventListener('click',doCheckin)});

/* ---------- calendar ---------- */
function loadCalendar(){
  var now=new Date();
  if(!calYear){calYear=now.getFullYear();calMonth=now.getMonth()+1}
  $('calTitle').textContent=calYear+' 年 '+calMonth+' 月';
  $('calGrid').innerHTML='';
  api('/api/checkin/list?y='+calYear+'&m='+calMonth).then(function(data){
    var dows=['日','一','二','三','四','五','六'];
    var html=dows.map(function(d){return '<div class="cal-dow">'+d+'</div>'}).join('');
    var first=new Date(calYear,calMonth-1,1).getDay();
    for(var i=0;i<first;i++)html+='<div></div>';
    var today=new Date();
    data.days.forEach(function(day){
      var isToday=calYear===today.getFullYear()&&calMonth===today.getMonth()+1&&day.d===today.getDate();
      html+='<div class="cal-day'+(day.t?' checked':'')+(isToday?' today':'')+'"'+(day.t?' title="'+esc(day.t)+' 已签到"':'')+'>'+day.d+(day.t?'<span class="t">'+esc(day.t)+'</span>':'')+'</div>';
    });
    $('calGrid').innerHTML=html;
    if(data.timezone)$('calTz').textContent='时区：'+data.timezone;
  }).catch(function(e){if(e.status!==401)toast('日历加载失败：'+e.message,'error')});
}
$('calPrev').addEventListener('click',function(){
  calMonth--;if(calMonth<1){calMonth=12;calYear--}loadCalendar();
});
$('calNext').addEventListener('click',function(){
  calMonth++;if(calMonth>12){calMonth=1;calYear++}loadCalendar();
});

/* ---------- notification recipients ---------- */
var CH_CN={email:'邮件',telegram:'Telegram',bark:'Bark',ntfy:'ntfy',serverchan:'Server酱·Turbo',serverchan3:'Server酱³',webhook:'Webhook'};
var rcptCache=[];
function getRcpt(id){
  for(var i=0;i<rcptCache.length;i++){if(String(rcptCache[i].id)===String(id))return rcptCache[i]}
  return null;
}
function hasText(s){return !!(s&&String(s).trim())}
function maskCfg(json){
  try{
    var o=JSON.parse(json);
    Object.keys(o).forEach(function(k){
      var v=String(o[k]);
      var keep=/url|server|email|topic|chat|method|label/i.test(k);
      if(v.length>10&&!keep)o[k]=v.slice(0,4)+'••••••'+v.slice(-4);
    });
    return JSON.stringify(o);
  }catch(e){return json}
}
function loadRecipients(){
  api('/api/recipients').then(function(data){
    rcptCache=data.recipients||[];
    var rows=rcptCache;
    if(!rows.length){
      $('rcptList').innerHTML=
        '<div class="empty">'+
        '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><br>'+
        '尚未配置任何接收人<br>在下方添加第一个联系人，让超时通知有人接收</div>';
      return;
    }
    var PENCIL='<svg class="i" style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    $('rcptList').innerHTML=rows.map(function(rc){
      var w=rc.on_warning?' checked':'',t=rc.on_trigger?' checked':'';
      return '<div class="rcpt">'+
        '<div class="rcpt-ico">'+ic(rc.channel_type)+'</div>'+
        '<div class="rcpt-info">'+
          '<div class="rcpt-name">'+esc(rc.label||CH_CN[rc.channel_type])+'<span class="badge">'+CH_CN[rc.channel_type]+'</span></div>'+
          '<code class="rcpt-cfg">'+esc(maskCfg(rc.config_json))+'</code>'+
        '</div>'+
        '<div class="rcpt-sw">'+
          '<label class="switch"><input type="checkbox" data-role="w" data-id="'+rc.id+'"'+w+'><span class="trk"></span><em>警告开始</em></label>'+
          '<label class="switch"><input type="checkbox" data-role="t" data-id="'+rc.id+'"'+t+'><span class="trk"></span><em>警告结束</em></label>'+
        '</div>'+
        '<div class="rcpt-act">'+
          '<button class="btn btn-ico btn-sm" data-act="rcpt-edit" data-id="'+rc.id+'" title="编辑通知内容" type="button">'+PENCIL+'</button>'+
          '<button class="btn btn-ico btn-sm" data-act="rcpt-test" data-id="'+rc.id+'" title="按已配置的内容发送测试" type="button">'+ic('telegram',14)+'</button>'+
          '<button class="btn btn-ico btn-sm" data-act="rcpt-del" data-id="'+rc.id+'" title="删除接收人" type="button">'+
            '<svg class="i" style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'+
          '</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }).catch(function(e){if(e.status!==401)toast('加载失败：'+e.message,'error')});
}
$('rcptList').addEventListener('change',function(e){
  var inp=e.target.closest('input[data-role]');
  if(!inp)return;
  var id=inp.dataset.id,role=inp.dataset.role;
  var row=getRcpt(id);
  /* Enabling an event that has no content yet → open editor instead of PUT */
  if(inp.checked){
    var ok = role==='w' ? hasText(row&&row.warning_content) : hasText(row&&row.trigger_content);
    if(!ok){inp.checked=false;openContentModal(row,role);return}
  }
  var pair=this.querySelector('input[data-role="'+(role==='w'?'t':'w')+'"][data-id="'+id+'"]');
  applyToggles(id,
    role==='w'?inp.checked:(pair?pair.checked:false),
    role==='t'?inp.checked:(pair?pair.checked:false));
});
function applyToggles(id,onW,onT){
  if(!onW&&!onT){toast('至少保留一种通知类型','error');loadRecipients();return}
  api('/api/recipients/'+id,{method:'PUT',body:{onWarning:onW,onTrigger:onT}})
    .then(function(){toast('已更新');loadRecipients()})
    .catch(function(err){if(err.status!==401)toast(err.message,'error');loadRecipients()});
}

/* per-channel config fields: [key, label, required, placeholder] */
var RCPT_FIELDS={
  email:[["email","邮箱地址",1,"name@example.com"]],
  telegram:[["chatId","Chat ID",1,"123456789"],["botToken","Bot Token",1,"110201543:AAHdqTcv..."]],
  bark:[["key","Bark Key",1,""],["server","服务器（可选）",0,"https://api.day.app"]],
  ntfy:[["server","服务器（可选）",0,"https://ntfy.sh"],["topic","Topic",1,"dms-alert-x7k2p9"]],
  serverchan:[["sendKey","SendKey（Turbo，微信）",1,"SCT..."]],
  serverchan3:[["sendKey","SendKey（³ APP）",1,"sctp..."],["uid","UID（Key 非 sctp 开头时填）",0,""]],
  webhook:[["url","Webhook URL（HTTPS）",1,"https://hooks.example.com/dms"],["method","HTTP 方法（POST/PUT，可空）",0,"POST"],["headers","额外 Headers JSON（可空）",0,'{"Authorization":"Bearer x"}']]
};
function renderRcptFields(){
  var ch=$('rcptType').value;
  var fields=RCPT_FIELDS[ch]||[];
  $('rcptFields').innerHTML=fields.map(function(f){
    return '<div style="margin-bottom:10px"><label>'+esc(f[1])+(f[2]?' <span class="req">*</span>':'')+'</label>'+
      '<input type="text" data-k="'+esc(f[0])+'" placeholder="'+esc(f[3]||'')+'" autocomplete="off"></div>';
  }).join('');
}
$('rcptType').addEventListener('change',renderRcptFields);
/* content fields appear only for the checked events */
function syncRcptContentUI(){
  $('warnContentGroup').style.display=$('rcptWarn').checked?'block':'none';
  $('trigContentGroup').style.display=$('rcptTrig').checked?'block':'none';
}
$('rcptWarn').addEventListener('change',syncRcptContentUI);
$('rcptTrig').addEventListener('change',syncRcptContentUI);
$('btnAddRcpt').addEventListener('click',function(){
  var type=$('rcptType').value;
  var cfg={};var missing=null;
  document.querySelectorAll('#rcptFields input').forEach(function(inp){
    var v=inp.value.trim();
    if(v)cfg[inp.dataset.k]=v;
  });
  (RCPT_FIELDS[type]||[]).forEach(function(f){
    if(f[2]&&!cfg[f[0]])missing=f[1];
  });
  if(missing){toast('请填写：'+missing,'error');return}
  var onW=$('rcptWarn').checked,onT=$('rcptTrig').checked;
  if(!onW&&!onT){toast('请至少勾选一种通知','error');return}
  var wc=$('rcptWarnContent').value,tc=$('rcptTrigContent').value;
  if(onW&&!hasText(wc)){toast('请填写「警告开始」内容','error');return}
  if(onT&&!hasText(tc)){toast('请填写「警告结束」内容','error');return}
  api('/api/recipients',{method:'POST',body:{
    label:$('rcptLabel').value.trim(),channelType:type,config:cfg,
    onWarning:onW,onTrigger:onT,warningContent:wc,triggerContent:tc
  }}).then(function(){
    toast('接收人已添加，建议先点击行内测试按钮验证链路');
    $('rcptLabel').value='';$('rcptWarnContent').value='';$('rcptTrigContent').value='';
    renderRcptFields();loadRecipients();
  }).catch(function(e){if(e.status!==401)toast(e.message,'error')});
});
function testRcpt(id){
  api('/api/recipients/'+id+'/test',{method:'POST'}).then(function(d){toast(d.message||'测试已发送')}).catch(function(e){if(e.status!==401)toast(e.message,'error')});
}
function delRcpt(id){
  confirmBox('删除接收人','该接收人的未发送排队消息也会一并取消，且无法恢复。确定删除？','删除',function(){
    api('/api/recipients/'+id,{method:'DELETE'}).then(function(){toast('已删除');loadRecipients()}).catch(function(e){if(e.status!==401)toast(e.message,'error')});
  });
}

/* ---------- recipient content editor ---------- */
var cmId=null,cmPending=null;
function openContentModal(row,focusRole){
  cmId=row?row.id:null;
  cmPending=(row&&focusRole)?{id:row.id,role:focusRole}:null;
  $('cmTitle').textContent='编辑通知内容 — '+((row&&(row.label||CH_CN[row.channel_type]))||'新订阅');
  $('cmWarn').value=row?(row.warning_content||''):'';
  $('cmTrig').value=row?(row.trigger_content||''):'';
  $('contentModal').classList.add('on');
  (focusRole==='w'?$('cmWarn'):focusRole==='t'?$('cmTrig'):$('cmWarn')).focus();
}
$('cmSave').addEventListener('click',function(){
  var body={warningContent:$('cmWarn').value,triggerContent:$('cmTrig').value};
  if(cmPending){
    var r=getRcpt(cmPending.id)||{};
    body.onWarning=cmPending.role==='w'?true:!!r.on_warning;
    body.onTrigger=cmPending.role==='t'?true:!!r.on_trigger;
  }
  api('/api/recipients/'+cmId,{method:'PUT',body:body}).then(function(){
    toast('内容已保存');
    $('contentModal').classList.remove('on');
    loadRecipients();
  }).catch(function(e){if(e.status!==401)toast(e.message,'error')});
});
$('cmCancel').addEventListener('click',function(){$('contentModal').classList.remove('on')});
$('contentModal').addEventListener('click',function(e){if(e.target===this)$('contentModal').classList.remove('on')});

/* ---------- templates ---------- */
/* ---------- settings ---------- */
function loadSettings(){
  api('/api/settings').then(function(o){
    o=o||{};
    lastCheckinAt=o.last_checkin_at||null;
    updateCheckinButtons();
    $('setTz').value=o.timezone||'UTC';
    $('setExpiry').value=o.expiry_hours!=null?o.expiry_hours:24;
    $('setWarn').value=o.warning_hours!=null?o.warning_hours:12;
  }).catch(function(e){if(e.status!==401)toast('加载失败：'+e.message,'error')});
}
$('btnSaveSettings').addEventListener('click',function(){
  api('/api/settings',{method:'PUT',body:{
    timezone:$('setTz').value.trim(),
    expiry_hours:parseInt($('setExpiry').value,10),
    warning_hours:parseInt($('setWarn').value,10)
  }}).then(function(){toast('设置已保存');loadDashboard()}).catch(function(e){if(e.status!==401)toast(e.message,'error')});
});

/* ---------- modals ---------- */
function hideModal(id){$(id).classList.remove('on')}

var confirmCb=null;
function confirmBox(title,msg,okText,cb){
  $('confirmTitle').textContent=title;
  $('confirmMsg').textContent=msg;
  $('confirmOk').textContent=okText||'确认';
  confirmCb=cb;
  $('confirmModal').classList.add('on');
}
$('confirmOk').addEventListener('click',function(){
  hideModal('confirmModal');
  if(confirmCb)confirmCb();confirmCb=null;
});
$('confirmCancel').addEventListener('click',function(){hideModal('confirmModal');confirmCb=null});
$('confirmModal').addEventListener('click',function(e){if(e.target===this){hideModal('confirmModal');confirmCb=null}});

document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    hideModal('contentModal');hideModal('confirmModal');confirmCb=null;cmPending=null;closeSidebar();
  }
});

/* ---------- delegated actions ---------- */
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-act]');
  if(!t)return;
  var act=t.dataset.act;
  if(act==='rcpt-edit')openContentModal(getRcpt(t.dataset.id),null);
  else if(act==='rcpt-test')testRcpt(t.dataset.id);
  else if(act==='rcpt-del')delRcpt(t.dataset.id);
});

/* ---------- boot ---------- */
$('btnLogin').addEventListener('click',doLogin);
['liPass','liTotp'].forEach(function(id){
  $(id).addEventListener('keydown',function(e){if(e.key==='Enter')doLogin()});
});
$('liUser').focus();
renderRcptFields();
syncRcptContentUI();
if(token){
  api('/api/settings').then(showPage.bind(null,'dash')).catch(function(e){if(e.status!==401)showPage('dash')});
}
})();
</script>
</body>
</html>`;
}

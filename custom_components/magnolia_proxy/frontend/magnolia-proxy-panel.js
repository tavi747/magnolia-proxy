// Magnolia Proxy sidebar panel: master/detail inspector.
// Design source: dev/redesign/b-master-detail (standalone simulator sharing this logic).

// Model label given to every device created from the panel.
const DEVICE_MODEL = "Magnolia Virtual Device";

const PANEL_CSS = `
:host{
  display:block; height:100vh; height:100dvh;
  --bg:var(--primary-background-color,#fafafa); --surface:var(--card-background-color,#fff);
  --text:var(--primary-text-color,#212121); --text2:var(--secondary-text-color,#727272);
  --line:var(--divider-color,#e0e0e0); --accent:var(--primary-color,#03a9f4);
  --mp-on-accent:var(--text-primary-color,#fff);
  --mp-danger:var(--error-color,#db4437); --mp-ok:var(--success-color,#43a047); --mp-warn:var(--warning-color,#ffa726);
  --mp-ok-text:color-mix(in srgb,var(--mp-ok) 65%,var(--text));
  --mp-warn-text:color-mix(in srgb,var(--mp-warn) 55%,var(--text));
  --mp-soft:color-mix(in srgb,var(--accent) 10%,transparent);
  --mp-soft2:color-mix(in srgb,var(--accent) 18%,transparent);
  --mp-field:color-mix(in srgb,var(--text) 5%,var(--surface));
  --mp-shadow:0 10px 40px rgba(0,0,0,.35);
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --sans:var(--paper-font-body1_-_font-family,Roboto),system-ui,-apple-system,"Segoe UI",Arial,sans-serif;
  --ease:cubic-bezier(.2,.8,.2,1);
  --sl:env(safe-area-inset-left,0px); --sr:env(safe-area-inset-right,0px); --sb:env(safe-area-inset-bottom,0px);
}
[hidden]{display:none!important}
#wrap{position:relative;height:100%;background:var(--bg);color:var(--text);font:16px/1.45 var(--sans);-webkit-font-smoothing:antialiased;overflow:hidden;-webkit-text-size-adjust:100%}
.app{display:grid;grid-template-rows:minmax(0,1fr);height:100%}
*{box-sizing:border-box}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent}
:focus{outline:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mono{font-family:var(--mono)}
.i{width:20px;height:20px;flex:none}
/* ---------- Buttons / fields ---------- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--text);font-weight:600;font-size:15px;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--mp-soft)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--mp-on-accent)}
.btn.primary:hover{filter:brightness(1.08)}
.btn.tonal{background:var(--mp-soft2);border-color:transparent;color:var(--accent)}
.btn.danger{color:var(--mp-danger);border-color:transparent;background:transparent}
.btn.danger.solid{background:var(--mp-danger);color:var(--surface);border-color:var(--mp-danger)}
.btn.ghost{border-color:transparent;background:transparent}
.btn[disabled],.btn[aria-disabled="true"]{opacity:.5;cursor:not-allowed;filter:none}
.btn[aria-pressed="true"]{background:var(--mp-warn);border-color:var(--mp-warn);color:#1a1200}
.iconbtn{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;border:0;background:transparent;color:var(--text)}
.iconbtn:hover{background:var(--mp-soft)}
label.l,.fl{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);margin:0 0 6px}
.field{margin:0 0 16px}
.in{width:100%;min-height:48px;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--mp-field);color:var(--text);font-size:16px}
.in:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
select.in{appearance:none;-webkit-appearance:none;padding-right:40px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a97a6' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:20px}
.hint{font-size:13px;color:var(--text2);margin:6px 0 0}
.rc .rd.sq{border-radius:6px}
.rc .rd.sq::after{border-radius:3px}
.hint .bad{color:var(--mp-danger);font-weight:600}
.in.mono{font-family:var(--mono);font-size:15px}
fieldset{border:0;margin:0 0 16px;padding:0;min-width:0}
legend{padding:0}

/* radio cards */
.rc{position:relative;display:flex;gap:12px;align-items:flex-start;padding:12px 14px;margin:0 0 8px;border:1px solid var(--line);border-radius:12px;background:var(--mp-field);min-height:48px;cursor:pointer}
.rc input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.rc .rd{flex:none;width:20px;height:20px;border-radius:50%;border:2px solid var(--text2);margin-top:2px;display:grid;place-items:center}
.rc .rd::after{content:"";width:10px;height:10px;border-radius:50%;background:var(--accent);transform:scale(0);transition:transform .15s var(--ease)}
.rc:has(input:checked){border-color:var(--accent);background:var(--mp-soft)}
.rc:has(input:checked) .rd{border-color:var(--accent)}
.rc:has(input:checked) .rd::after{transform:scale(1)}
.rc:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.rc:has(input:disabled){opacity:.55;cursor:not-allowed}
.rc .rt{display:block;font-weight:600;font-size:15px}
.rc .rs{display:block;font-size:13px;color:var(--text2);margin-top:2px;overflow-wrap:anywhere}
.rc.sub{margin-left:0}
.nest{margin:4px 0 10px 12px;padding-left:12px;border-left:2px solid var(--line)}

/* ---------- Stage / screens ---------- */
.stage{position:relative;overflow:hidden;min-height:0}
.screen{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg);transition:transform .34s var(--ease),visibility 0s linear 0s}
.scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
#railScreen{transform:none}
#detailScreen{transform:translateX(100%);visibility:hidden;transition:transform .34s var(--ease),visibility 0s linear .34s;box-shadow:-12px 0 30px rgba(0,0,0,.12)}
.stage[data-screen="detail"] #railScreen{transform:translateX(-22%)}
.stage[data-screen="detail"] #detailScreen{transform:none;visibility:visible;transition:transform .34s var(--ease),visibility 0s}

/* ---------- Rail ---------- */
.rhead{padding:14px calc(16px + var(--sr)) 8px calc(16px + var(--sl))}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 12px}
.mark{width:32px;height:32px;border-radius:10px;background:var(--accent);color:var(--mp-on-accent);display:grid;place-items:center}
.mark .i{width:18px;height:18px}
.brand h1{margin:0;font-size:20px;line-height:1.2;letter-spacing:-.02em;font-weight:700}
.brand small{display:block;margin-top:2px;color:var(--text2);font-size:12.5px;font-weight:500;letter-spacing:0}
.search{position:relative}
.search .i{position:absolute;left:13px;top:15px;width:18px;height:18px;color:var(--text2);pointer-events:none}
.search input{padding-left:42px;padding-right:44px}
.search kbd{position:absolute;right:12px;top:13px;font:12px/1 var(--mono);color:var(--text2);border:1px solid var(--line);border-radius:6px;padding:4px 7px;background:var(--surface);pointer-events:none;display:none}
@media (hover:hover) and (pointer:fine){.search kbd{display:block}}
.sect{margin:14px calc(16px + var(--sr)) 6px calc(16px + var(--sl));font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text2)}
.devlist{list-style:none;margin:0 calc(10px + var(--sr)) 0 calc(10px + var(--sl));padding:0}
.dev{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:60px;padding:8px 12px 8px 14px;border:0;border-radius:14px;background:transparent;text-align:left;margin-bottom:2px}
.dev:hover{background:var(--mp-soft)}
.dev[aria-current="true"]{background:var(--mp-soft2)}
.dev[aria-current="true"]::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:var(--accent)}
.dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--text2);box-shadow:0 0 0 3px var(--mp-soft)}
.dot.st-ok{background:var(--mp-ok)} .dot.st-warn{background:var(--mp-warn)} .dot.st-empty{background:transparent;border:2px solid var(--text2);box-shadow:none}
.dtxt{flex:1;min-width:0;display:flex;flex-direction:column}
.dname{font-weight:600;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsub{font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.count{flex:none;min-width:26px;text-align:center;padding:2px 8px;border-radius:99px;background:var(--mp-soft);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--text2)}
.dev .chev{color:var(--text2);width:18px;height:18px}
.dev mark,.rname mark{background:var(--mp-soft2);color:inherit;border-radius:3px}
.rfoot{padding:10px calc(16px + var(--sr)) calc(12px + var(--sb)) calc(16px + var(--sl));border-top:1px solid var(--line);background:var(--bg)}
.rfoot .btn{width:100%;min-height:48px}
.none{margin:24px 20px;text-align:center;color:var(--text2);font-size:14px}

/* ---------- Detail ---------- */
.dhead{padding:8px calc(12px + var(--sr)) 10px calc(8px + var(--sl));border-bottom:1px solid var(--line);background:var(--surface)}
.dtop{display:flex;align-items:center;gap:4px;min-height:44px}
.dtop .back{margin-right:2px}
.dtitle{flex:1;min-width:0;padding-left:4px}
.dtitle h2{margin:0;font-size:22px;line-height:1.15;font-weight:700;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtitle h2:focus{outline:none}
.dtitle p{margin:2px 0 0;font-size:13.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dact{display:flex;gap:8px;padding:8px 0 0 8px;flex-wrap:wrap}
.dact .btn{min-height:44px;padding:0 14px;font-size:14.5px}
.dwrap{max-width:760px;margin:0 auto;padding:16px calc(14px + var(--sr)) 24px calc(14px + var(--sl))}
.banner{position:sticky;top:8px;z-index:5;display:flex;gap:10px;align-items:flex-start;margin:0 0 14px;padding:12px 8px 12px 14px;border-radius:14px;background:var(--surface);border:1px solid var(--mp-danger);border-left-width:5px;box-shadow:0 6px 20px rgba(0,0,0,.12);color:var(--text)}
.banner .i{color:var(--mp-danger);margin-top:2px}
.banner div{flex:1;min-width:0;font-size:14.5px;overflow-wrap:anywhere}
.banner strong{display:block}
.sechead{display:flex;align-items:center;gap:10px;margin:4px 2px 8px;min-height:32px}
.sechead h3{margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text2)}
.sechead .count{background:var(--mp-soft2);color:var(--accent)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;font-size:13px;font-weight:600;background:var(--mp-soft);color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap;max-width:46vw;overflow:hidden;text-overflow:ellipsis}
.chip[data-st="on"]{background:rgba(46,139,87,.16);color:var(--mp-ok-text)}
.chip[data-st="unavailable"],.chip[data-st="unknown"]{background:rgba(201,138,11,.18);color:var(--mp-warn-text)}
button.chip{border:0;min-height:36px}
.rows{list-style:none;margin:0 0 14px;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.row+.row{border-top:1px solid var(--line)}
.rmain{display:flex;align-items:center;gap:12px;width:100%;min-height:68px;padding:10px 14px;background:transparent;border:0;text-align:left}
.rmain:hover{background:var(--mp-soft)}
.rmain:focus-visible{outline-offset:-3px;border-radius:0}
.ico{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--mp-soft2);color:var(--accent)}
.ico.energy{background:rgba(201,138,11,.18);color:var(--mp-warn-text)}
.rtxt{flex:1;min-width:0;display:flex;flex-direction:column}
.rname{font-weight:600;font-size:16.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rsub{font:12.5px/1.35 var(--mono);color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rmain .chev{width:18px;height:18px;color:var(--text2);transition:transform .2s var(--ease)}
.row[data-open="true"] .rmain .chev{transform:rotate(90deg)}
.row[data-open="true"]{background:var(--mp-soft)}
.panel{padding:4px 16px 18px}
.panel.fresh{animation:drop .26s var(--ease)}
@keyframes drop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.eid{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:8px 12px;margin:0 0 14px;border-radius:12px;border:1px dashed var(--line);background:var(--surface);font:13.5px/1.35 var(--mono);text-align:left;overflow-wrap:anywhere}
.eid span{flex:1;min-width:0}
.eid .i{color:var(--accent);width:18px;height:18px}
.eid:hover{border-color:var(--accent)}
.eid.copied{border-style:solid;border-color:var(--mp-ok)}
.acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.acts .grow{flex:1}
.acts .btn{min-height:48px}
.addrow{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:56px;border-radius:16px;border:2px dashed var(--line);background:transparent;color:var(--accent);font-weight:600;font-size:15.5px}
.addrow:hover{border-color:var(--accent);background:var(--mp-soft)}
.composer{background:var(--surface);border:1px solid var(--accent);border-radius:18px;padding:16px;animation:drop .26s var(--ease);box-shadow:0 0 0 4px var(--mp-soft)}
.composer h3{margin:0 0 14px;font-size:17px;letter-spacing:-.01em}
.composer h3 small{display:block;font-size:13px;font-weight:500;color:var(--text2);letter-spacing:0;margin-top:2px}
.preview{margin:0 0 16px;padding:12px 14px;border-radius:12px;background:var(--mp-soft);border-left:4px solid var(--accent)}
.preview .fl{margin-bottom:4px}
.preview .pe{font:14px/1.4 var(--mono);overflow-wrap:anywhere;font-weight:600}
.preview .pe.ph{color:var(--text2);font-weight:400}
.preview p{margin:6px 0 0;font-size:14px;overflow-wrap:anywhere}
.preview p.warn{color:var(--mp-warn-text)}
.empty{text-align:center;padding:28px 18px;color:var(--text2)}
.empty .ill{width:64px;height:64px;margin:0 auto 12px;border-radius:20px;background:var(--mp-soft2);color:var(--accent);display:grid;place-items:center}
.empty .ill .i{width:30px;height:30px}
.empty h3{margin:0 0 4px;color:var(--text);font-size:18px}
.empty p{margin:0 0 14px;font-size:14.5px}
.filterchip .i{width:14px;height:14px}
.filterchip{margin-left:auto;display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:99px;border:1px solid var(--line);background:var(--surface);font-size:13px}
.bottombar{display:none}
.skel{height:68px;margin:0 0 1px;background:linear-gradient(90deg,var(--mp-soft) 25%,var(--mp-soft2) 50%,var(--mp-soft) 75%);background-size:200% 100%;animation:shim 1.3s linear infinite;border-radius:14px;margin-bottom:8px}
@keyframes shim{to{background-position:-200% 0}}
.empty-detail{display:none}

/* ---------- Sheet ---------- */
.scrim{position:fixed;inset:0;z-index:100;background:rgba(10,16,24,.5);animation:fade .2s}
.sheet{position:fixed;z-index:101;left:0;right:0;bottom:0;max-height:92vh;max-height:92dvh;display:flex;flex-direction:column;background:var(--surface);color:var(--text);border-radius:24px 24px 0 0;box-shadow:var(--mp-shadow);animation:up .32s var(--ease)}
.sheet:focus{outline:none}
.grab{width:40px;height:5px;border-radius:3px;background:var(--line);margin:8px auto 0;flex:none}
.sheet h2{margin:0;padding:12px calc(20px + var(--sr)) 6px calc(20px + var(--sl));font-size:20px;letter-spacing:-.02em}
.sbody{flex:1;min-height:0;overflow-y:auto;padding:8px calc(20px + var(--sr)) 12px calc(20px + var(--sl));overscroll-behavior:contain}
.sbody p{margin:0 0 14px}
.sfoot{display:flex;gap:10px;padding:12px calc(20px + var(--sr)) calc(14px + var(--sb)) calc(20px + var(--sl));border-top:1px solid var(--line);flex:none}
.sfoot .btn{flex:1;min-height:50px}
.serr{margin:0 0 14px;padding:10px 12px;border-radius:12px;border:1px solid var(--mp-danger);font-size:14px}
@keyframes up{from{transform:translateY(100%)}to{transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
.rp{list-style:none;margin:0;padding:0}
.rp>li{padding:12px 0;border-top:1px solid var(--line)}
.rp>li:first-child{border-top:0;padding-top:0}
.rp .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px}
.rp .top strong{font-size:16px}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--mp-soft2);color:var(--accent)}
.tag.warn{background:rgba(201,138,11,.2);color:var(--mp-warn-text)}
.tag.ok{background:rgba(46,139,87,.16);color:var(--mp-ok-text)}
.rp .cur{font:12.5px var(--mono);color:var(--text2);margin:0 0 8px;overflow-wrap:anywhere}

/* ---------- Toast ---------- */
.toast{position:fixed;z-index:200;left:50%;transform:translateX(-50%);bottom:calc(84px + var(--sb));max-width:calc(100vw - 32px);padding:11px 18px;border-radius:99px;background:var(--text);color:var(--bg);font-size:14.5px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.3);animation:fade .2s;pointer-events:none}
.busybar{position:absolute;left:0;right:0;top:0;height:3px;z-index:70;background:var(--accent);transform-origin:left;animation:busy 1s ease-in-out infinite;display:none}
.app[data-busy="1"] .busybar{display:block}
@keyframes busy{0%{transform:scaleX(0)}60%{transform:scaleX(.8)}100%{transform:scaleX(1);opacity:.2}}
.app[data-busy="1"] .dwrap{opacity:.75;pointer-events:none}
.brand .iconbtn{margin-left:-8px}
/* Phone / narrow panel */
#wrap[data-wide="0"] .bottombar{display:block;padding:10px calc(14px + var(--sr)) calc(12px + var(--sb)) calc(14px + var(--sl));border-top:1px solid var(--line);background:var(--surface)}
#wrap[data-wide="0"] .bottombar .btn{width:100%;min-height:52px;font-size:16px}
#wrap[data-wide="0"] .toast{bottom:calc(88px + var(--sb))}
@media (max-width:420px){
  .dwrap{padding-left:calc(10px + var(--sl));padding-right:calc(10px + var(--sr))}
  .dtitle h2{font-size:20px}
}
/* Wide panel: split view */
#wrap[data-wide="1"] .stage{display:grid;grid-template-columns:minmax(290px,340px) minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
#wrap[data-wide="1"] .screen{min-height:0;position:relative;inset:auto;transform:none!important;visibility:visible!important;box-shadow:none!important}
#wrap[data-wide="1"] #railScreen{border-right:1px solid var(--line);background:var(--bg)}
#wrap[data-wide="1"] #detailScreen{background:var(--bg)}
#wrap[data-wide="1"] .back{display:none}
#wrap[data-wide="1"] .dtop{padding-left:12px}
#wrap[data-wide="1"] .dhead{padding:18px 28px 16px;display:flex;align-items:flex-start;gap:16px;justify-content:space-between;background:transparent;border-bottom:1px solid var(--line)}
#wrap[data-wide="1"] .dtop{flex:1;min-width:0;padding-left:0}
#wrap[data-wide="1"] .dact{padding:0;flex:none}
#wrap[data-wide="1"] .dtitle h2{font-size:28px}
#wrap[data-wide="1"] .dwrap{padding:22px 28px 40px;margin:0}
#wrap[data-wide="1"] .sheet{left:50%;right:auto;top:50%;bottom:auto;width:min(560px,calc(100vw - 48px));max-height:86vh;border-radius:22px;transform:translate(-50%,-50%);animation:pop .22s var(--ease)}
#wrap[data-wide="1"] .grab{display:none}
#wrap[data-wide="1"] .sheet h2{padding-top:22px}
#wrap[data-wide="1"] .toast{bottom:28px}
#wrap[data-wide="1"] .rmain{min-height:64px}
@keyframes pop{from{opacity:0;transform:translate(-50%,-48%) scale(.97)}to{opacity:1;transform:translate(-50%,-50%)}}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;transition-delay:0s!important}
}`;

const PANEL_HTML = `
<div id="wrap" data-wide="0">
<div class="app" id="app" data-busy="0">
  <div class="busybar" aria-hidden="true"></div>
  <main class="stage" id="stage" data-screen="list">
    <section class="screen" id="railScreen" aria-label="Virtual devices">
      <div class="rhead">
        <div class="brand">
          <button class="iconbtn" id="menuBtn" data-act="menu" aria-label="Open sidebar" hidden><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
          <div class="mark"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10M7 12h10M7 17h6"/><circle cx="18" cy="17" r="1.6"/></svg></div>
          <h1>Magnolia Proxy<small>Virtual devices &amp; proxies</small></h1>
        </div>
        <div class="search">
          <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>
          <label class="sr" for="q">Search devices and proxies</label>
          <input class="in" id="q" type="search" data-bind="q" placeholder="Search devices &amp; proxies" autocomplete="off" enterkeyhint="search">
          <kbd aria-hidden="true">/</kbd>
        </div>
      </div>
      <div class="scroll" id="rscroll"><div id="railList"></div></div>
      <div class="rfoot"><button class="btn tonal" data-act="new-device">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New device</button></div>
    </section>
    <section class="screen" id="detailScreen" aria-label="Device detail">
      <header class="dhead" id="dhead"></header>
      <div class="scroll" id="dscroll"><div class="dwrap" id="dbody"></div></div>
      <div class="bottombar" id="dbar"></div>
    </section>
  </main>
</div>
<div id="sheetRoot"></div>
<div id="toastRoot" role="status" aria-live="polite"></div>
</div>
`;

function mount(host, root) {
"use strict";
/* ---------- helpers ---------- */
const $ = (s, r=root) => r.querySelector(s);
const wrap = $("#wrap");
const isWide = () => wrap.dataset.wide === "1";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
const api = (m,p,b) => host._hass.callApi(m,p,b);
const plural = (n,w) => `${n} ${w}${n===1?"":"s"}`;
const fmtNum = n => { const x = Number(n); return Number.isFinite(x) ? String(+x.toFixed(3)) : String(n); };
const ago = t => { const s = Math.max(0, Date.now()/1000 - t); if (s < 90) return "just now"; if (s < 5400) return Math.round(s/60)+" min ago"; if (s < 129600) return Math.round(s/3600)+" h ago"; return Math.round(s/86400)+" days ago"; };
const errMsg = e => (e && e.body && e.body.message) || (e && e.message) || "Something went wrong";
const svg = (p, c="") => `<svg class="i ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const P = {
  light:'<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  switch:'<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="16" cy="12" r="2"/>',
  fan:'<circle cx="12" cy="12" r="1.5"/><path d="M12 10.5C12 6 14 3 17 4c2 .8 1 4-5 6.5zM13.5 12c4.5 0 7.5 2 6.5 5-.8 2-4 1-6.5-5zM12 13.5c0 4.5-2 7.5-5 6.5-2-.8-1-4 5-6.5zM10.5 12C6 12 3 10 4 7c.8-2 4-1 6.5 5z"/>',
  sensor:'<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  energy:'<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  chev:'<path d="M9 6l6 6-6 6"/>', back:'<path d="M15 6l-6 6 6 6"/>', plus:'<path d="M12 5v14M5 12h14"/>',
  copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  swap:'<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>', alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
  inbox:'<path d="M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5"/>', check:'<path d="M5 12l5 5 9-10"/>',
};
const domIcon = p => p.is_energy ? "energy" : p.domain;

/* ---------- state ---------- */
const S = {
  data:null, loading:true, loadErr:null, sel:null, screen:"list", expanded:null, q:"", error:null, busy:false,
  edit:{}, fresh:null,
  comp:{open:false,name:"",nameTouched:false,source:"",srcText:"",takeover:false,eid:"",eidTouched:false,ren:"",renTouched:false,mode:"zero",hist:"",histItems:null,histUnit:null,histLoading:false,histErr:null},
  sheet:null, fail:false, sig:"", simOpen:false,
};
const srcMap = () => { const m = {}; (S.data?.source_entities||[]).forEach(s => m[s.entity_id]=s); return m; };
function group(){
  if (!S.data || !S.sel) return null;
  if (S.sel === "unassigned") return { id:"unassigned", name:"Unassigned", model:"Proxies without a device", proxies:S.data.unassigned_proxies, un:true };
  return S.data.devices.find(d => d.id === S.sel) || null;
}
function allProxies(){ return S.data ? [...S.data.devices.flatMap(d=>d.proxies), ...S.data.unassigned_proxies] : []; }
function findProxy(id){ return allProxies().find(p => p.id === id); }
function status(proxies){
  if (!proxies.length) return "empty";
  return proxies.some(p => ["unavailable","unknown"].includes(p.live_state)) ? "warn" : "ok";
}
const statusLabel = s => ({ok:"All sources available",warn:"A source is unavailable",empty:"No proxies"}[s]);
function liveText(p){
  const st = p.live_state;
  if (p.domain === "sensor") return p.is_energy ? `${fmtNum(st)}${p.unit_of_measurement?" "+p.unit_of_measurement:""}` : `${st}${p.unit_of_measurement?" "+p.unit_of_measurement:""}`;
  return st;
}
const liveSt = p => p.domain==="sensor" ? (["unavailable","unknown"].includes(p.live_state)?p.live_state:"num") : p.live_state;
function matches(p, q){ q=q.toLowerCase(); return p.name.toLowerCase().includes(q) || p.entity_id.toLowerCase().includes(q) || p.source_entity.toLowerCase().includes(q); }
function hl(text, q){
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0,i)) + "<mark>" + esc(text.slice(i,i+q.length)) + "</mark>" + esc(text.slice(i+q.length));
}

/* ---------- focus preservation across renders ---------- */
function fidOf(el){
  if (!el || !el.dataset) return null; const d = el.dataset;
  if (d.bind) return "b:"+d.bind+"|"+(d.id||"")+(el.type==="radio"?"|"+el.value:"");
  if (d.act) return "a:"+d.act+"|"+(d.id||"")+"|"+(d.copy||"");
  return el.id ? "i:"+el.id : null;
}
function focusByFid(fid, sel){
  if (!fid) return false;
  for (const el of root.querySelectorAll("[data-bind],[data-act],[id]")) {
    if (fidOf(el) === fid && !el.disabled && !el.closest("[inert]")) {
      el.focus({preventScroll:true});
      if (sel && el.setSelectionRange && /^(text|search)$/.test(el.type||"")) { try { el.setSelectionRange(sel[0], sel[1]); } catch(_){} }
      return true;
    }
  }
  return false;
}
function keepFocus(fn){
  const a = root.activeElement; const fid = fidOf(a);
  const sel = a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (fid && root.activeElement !== a) focusByFid(fid, sel);
}

/* ---------- rendering ---------- */
function render(){
  keepFocus(() => { renderRail(); renderDetail(); renderSheet(); applyScreen(); });
  $("#app").dataset.busy = S.busy ? "1" : "0";
}

function renderRail(){
  const el = $("#railList");
  if (S.loading) { el.innerHTML = `<div style="padding:16px 14px">${'<div class="skel"></div>'.repeat(3)}</div>`; return; }
  if (S.loadErr) { el.innerHTML = `<div class="none">Could not load devices.<br>${esc(S.loadErr)}<br><br><button class="btn" data-act="retry">Retry</button></div>`; return; }
  const q = S.q.trim();
  const devs = S.data.devices.filter(d => !q || d.name.toLowerCase().includes(q.toLowerCase()) || (d.model||"").toLowerCase().includes(q.toLowerCase()) || d.proxies.some(p => matches(p,q)));
  const un = S.data.unassigned_proxies;
  const showUn = !q || un.some(p => matches(p,q)) || "unassigned".includes(q.toLowerCase());
  const item = (id, name, sub, n, st, extra="") => `<li><button class="dev" data-act="select" data-id="${esc(id)}" ${S.sel===id?'aria-current="true"':""}>
      <span class="dot st-${st}" role="img" aria-label="${esc(statusLabel(st))}"></span>
      <span class="dtxt"><span class="dname">${hl(name,q)}</span><span class="dsub">${esc(sub)}${extra}</span></span>
      <span class="count" aria-label="${plural(n,"proxy").replace("proxys","proxies")}">${n}</span>${svg(P.chev,"chev")}</button></li>`;
  let h = `<h2 class="sect">Virtual devices</h2>`;
  if (!devs.length) h += `<div class="none">${q ? "No devices match &ldquo;"+esc(q)+"&rdquo;" : "No virtual devices yet."}</div>`;
  else h += `<ul class="devlist" role="list" aria-label="Virtual devices">` + devs.map(d => {
      const m = q ? d.proxies.filter(p => matches(p,q)).length : 0;
      return item(d.id, d.name, d.model || "Virtual Device", d.proxies.length, status(d.proxies), m ? " · "+m+" match"+(m>1?"es":"") : "");
    }).join("") + `</ul>`;
  if (showUn) h += `<h2 class="sect">Unassigned</h2><ul class="devlist" role="list" aria-label="Unassigned proxies">` +
      item("unassigned","Unassigned proxies","Not part of any device",un.length,status(un)) + `</ul>`;
  h += `<div style="height:12px"></div>`;
  el.innerHTML = h;
}

function renderDetail(){
  const head = $("#dhead"), body = $("#dbody"), bar = $("#dbar");
  const backBtn = `<button class="iconbtn back" data-act="back" aria-label="Back to devices">${svg(P.back)}</button>`;
  if (S.loading) { head.innerHTML = `<div class="dtop">${backBtn}<div class="dtitle"><h2>Loading…</h2></div></div>`; body.innerHTML = '<div class="skel"></div>'.repeat(4); bar.innerHTML=""; return; }
  if (S.loadErr) { head.innerHTML = `<div class="dtop">${backBtn}<div class="dtitle"><h2>Unavailable</h2></div></div>`; body.innerHTML = `<div class="empty"><div class="ill">${svg(P.alert)}</div><h3>Can&rsquo;t reach Magnolia Proxy</h3><p>${esc(S.loadErr)}</p><button class="btn primary" data-act="retry">Try again</button></div>`; bar.innerHTML=""; return; }
  const g = group();
  if (!g) {
    head.innerHTML = `<div class="dtop">${backBtn}<div class="dtitle"><h2>Magnolia Proxy</h2></div></div>`;
    body.innerHTML = `<div class="empty"><div class="ill">${svg(P.inbox)}</div><h3>No virtual devices yet</h3><p>A virtual device groups proxy entities, so you can swap the real hardware behind them later.</p><button class="btn primary" data-act="new-device">Create your first device</button></div>`;
    bar.innerHTML = ""; return;
  }
  const n = g.proxies.length;
  head.innerHTML = `<div class="dtop">${backBtn}<div class="dtitle"><h2 id="dtitle" tabindex="-1">${esc(g.name)}</h2>
      <p>${esc(g.model || "Virtual Device")} · ${n===1?"1 proxy":n+" proxies"}${g.un ? "" : ` · <span class="tag ${g.added_to_ha ? "ok" : "warn"}">${g.added_to_ha ? "Added to HA" : "Discovered / pending"}</span>`}</p></div></div>
    ${g.un ? "" : `<div class="dact">
      ${g.added_to_ha ? "" : `<button class="btn" data-act="discover" title="Re-send Home Assistant discovery">Notify discovery</button>`}
      <button class="btn tonal" data-act="replace" ${n?"":"disabled"}>${svg(P.swap)}Replace device</button>
      <button class="btn danger" data-act="del-device">${svg(P.trash)}Delete</button></div>`}`;

  const q = S.q.trim();
  const devMatch = q && g.name.toLowerCase().includes(q.toLowerCase());
  const list = (q && !devMatch) ? g.proxies.filter(p => matches(p,q)) : g.proxies;
  let h = "";
  if (S.error) h += `<div class="banner" role="alert">${svg(P.alert)}<div><strong>That didn&rsquo;t work</strong>${esc(S.error)}</div><button class="iconbtn" data-act="dismiss" aria-label="Dismiss error">${svg(P.x)}</button></div>`;
  h += `<div class="sechead"><h3>Proxies</h3><span class="count">${n}</span>${list.length!==n?`<button class="filterchip" data-act="clear-q">Showing ${list.length} of ${n} ${svg(P.x)}</button>`:""}</div>`;
  if (!n) h += `<div class="empty"><div class="ill">${svg(P.inbox)}</div><h3>${g.un?"No unassigned proxies":"No proxies yet"}</h3><p>${g.un?"Proxies created without a device appear here.":"Add a proxy to mirror a light, switch, fan or sensor."}</p></div>`;
  else if (!list.length) h += `<div class="empty"><p>No proxy here matches &ldquo;${esc(q)}&rdquo;.</p></div>`;
  else h += `<ul class="rows" role="list">${list.map(rowHtml).join("")}</ul>`;
  h += S.comp.open ? composerHtml(g) : `<button class="addrow" data-act="comp-open">${svg(P.plus)}Add proxy</button>`;
  body.innerHTML = h;
  S.fresh = null;
  bar.innerHTML = S.comp.open ? "" : `<button class="btn primary" data-act="comp-open">${svg(P.plus)}Add proxy</button>`;
}

function radio(name, value, checked, title, desc, bind, id, extra=""){
  return `<label class="rc"><input type="radio" name="${esc(name)}" value="${esc(value)}" ${checked?"checked":""} data-bind="${bind}" ${id?`data-id="${esc(id)}"`:""} ${extra}>
    <span class="rd"></span><span><span class="rt">${title}</span>${desc?`<span class="rs">${desc}</span>`:""}</span></label>`;
}

// Text input with autocomplete for an entity ID. `options` are source entities;
// typing an ID (or choosing a suggestion) is validated by the caller.
function entityInput({ id, bind, bindId, value, options, placeholder, disabled }){
  return `<input class="in mono" type="text" id="${esc(id)}" list="dl-${esc(id)}" data-bind="${bind}" ${bindId?`data-id="${esc(bindId)}"`:""} value="${esc(value)}" placeholder="${esc(placeholder||"domain.entity_id")}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done" ${disabled?"disabled":""}>
    <datalist id="dl-${esc(id)}">${options.map(s => `<option value="${esc(s.entity_id)}"></option>`).join("")}</datalist>`;
}
// Entities a proxy may point at: same domain, unit and (for energy) energy sensors, plus its current source.
function compatOpts(p){
  return S.data.source_entities.filter(s => s.entity_id===p.source_entity || (s.domain===p.domain && (!p.unit || s.unit_of_measurement===p.unit) && (!p.is_energy || s.is_energy)));
}
function editHint(p, d, opts){
  if (d.invalid) return `<span class="bad">No compatible ${esc(p.domain)} entity with this ID.</span>`;
  const cur = srcMap()[d.source];
  return `${cur ? `<b>${esc(cur.name)}</b> · ` : ""}Locked to <b>${esc(p.domain)}</b>${p.unit?` · unit <b>${esc(p.unit)}</b>`:""}${p.is_energy?" · energy sensors only":""}.${opts.length<2?" No other compatible entity exists.":""}`;
}
function compHint(){
  const c = S.comp, src = srcMap()[c.source];
  if (src) return `<b>${esc(src.name)}</b> · the proxy&rsquo;s type is locked to the source&rsquo;s type.`;
  if (c.srcText.trim()) return `<span class="bad">No entity with this ID.</span>`;
  return "Type an entity ID, or pick a suggestion. The proxy&rsquo;s type is locked to the source&rsquo;s type.";
}

function rowHtml(p){
  const open = S.expanded === p.id;
  const q = S.q.trim();
  let h = `<li class="row" data-open="${open}"><button class="rmain" data-act="toggle" data-id="${esc(p.id)}" aria-expanded="${open}" aria-controls="pn-${esc(p.id)}">
    <span class="ico ${p.is_energy?"energy":""}">${svg(P[domIcon(p)]||P.sensor)}</span>
    <span class="rtxt"><span class="rname">${hl(p.name,q)}</span><span class="rsub">${esc(p.entity_id)}</span></span>
    <span class="chip" data-live="${esc(p.id)}" data-st="${esc(liveSt(p))}">${esc(liveText(p))}</span>${svg(P.chev,"chev")}</button>`;
  if (open) {
    const d = S.edit[p.id] || (S.edit[p.id] = { name:p.name, source:p.source_entity, srcText:p.source_entity, invalid:false, mode:"continue" });
    const sm = srcMap();
    const opts = compatOpts(p);
    const changed = d.source !== p.source_entity;
    const newSrc = sm[d.source];
    h += `<div class="panel ${S.fresh===p.id?"fresh":""}" id="pn-${esc(p.id)}">
      <button class="eid" data-act="copy" data-copy="${esc(p.entity_id)}" aria-label="Copy entity ID ${esc(p.entity_id)}"><span>${esc(p.entity_id)}</span>${svg(P.copy)}</button>
      <div class="field"><label class="l" for="nm-${esc(p.id)}">Name</label><input class="in" id="nm-${esc(p.id)}" data-bind="edit.name" data-id="${esc(p.id)}" value="${esc(d.name)}" autocomplete="off" enterkeyhint="done"></div>
      <div class="field"><label class="l" for="sc-${esc(p.id)}">Source entity</label>
        ${entityInput({ id:"sc-"+p.id, bind:"edit.source", bindId:p.id, value:d.srcText ?? d.source, options:opts })}
        <p class="hint" id="sh-${esc(p.id)}">${editHint(p, d, opts)}</p></div>`;
    if (p.is_energy && changed) {
      const reading = newSrc ? fmtNum(newSrc.state) : "?"; const u = p.unit||"";
      h += `<fieldset><legend class="fl">What happens to the total?</legend>
        ${radio("em-"+p.id,"continue",d.mode==="continue","Continue the running total",`Keeps ${esc(fmtNum(p.live_state))} ${esc(u)} and adds the new source&rsquo;s increase from now.`,"edit.mode",p.id)}
        ${radio("em-"+p.id,"zero",d.mode==="zero","Restart at 0",`Total resets; counts from the swap onward.`,"edit.mode",p.id)}
        ${radio("em-"+p.id,"source",d.mode==="source","Start at the new source&rsquo;s reading",`Total becomes ${esc(reading)} ${esc(u)}.`,"edit.mode",p.id)}</fieldset>`;
    }
    h += `<div class="acts"><button class="btn primary grow" data-act="save" data-id="${esc(p.id)}" ${S.busy||d.invalid?"disabled":""}>${S.busy?"Saving…":"Save changes"}</button>
      <button class="btn ghost" data-act="collapse">Cancel</button>
      <button class="btn danger" data-act="del-proxy" data-id="${esc(p.id)}">${svg(P.trash)}Delete</button></div></div>`;
  }
  return h + "</li>";
}

/* ---------- composer ---------- */
const VALID_EID = /^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$/;
const usedIds = () => new Set([...S.data.source_entities.map(s => s.entity_id), ...allProxies().map(p => p.entity_id)]);
// Taking over the source's ID is moot when a seamless history entity already supplies the ID.
function seamlessHist(){
  const c = S.comp; return c.mode === "history" ? (c.histItems||[]).find(h => h.entity_id === c.hist && h.seamless) : null;
}
function takeoverOn(){ return S.comp.takeover && !!srcMap()[S.comp.source] && !seamlessHist(); }
// Fill name / IDs from the source until the user edits them.
function syncTakeover(){
  const c = S.comp, src = srcMap()[c.source]; if (!c.takeover) return;
  if (!src) { if (!c.nameTouched) c.name = ""; if (!c.eidTouched) c.eid = ""; if (!c.renTouched) c.ren = ""; return; }
  if (!c.nameTouched) c.name = src.name;
  if (!c.eidTouched) c.eid = src.entity_id;
  if (!c.renTouched) c.ren = src.entity_id + "_source";
}
function idChecks(src){
  const c = S.comp, used = usedIds(), out = { eid:"", ren:"" };
  const eid = c.eid.trim().toLowerCase(), ren = c.ren.trim().toLowerCase();
  const fmt = v => VALID_EID.test(v) && v.split(".")[0] === src.domain;
  if (ren) {
    if (!fmt(ren)) out.ren = `Use a valid ${src.domain}.object_id.`;
    else if (ren === src.entity_id) out.ren = "Must differ from the source's current ID.";
    else if (used.has(ren)) out.ren = "Already in use.";
  }
  if (!fmt(eid)) out.eid = `Use a valid ${src.domain}.object_id.`;
  else if (used.has(eid) && !(ren && !out.ren && eid === src.entity_id))
    out.eid = eid === src.entity_id ? "That is the source's ID. Give the source a new ID below to free it." : "Already in use.";
  return out;
}
function idHints(src){
  const k = idChecks(src), bad = t => `<span class="bad">${esc(t)}</span>`;
  return {
    eid: k.eid ? bad(k.eid) : "The proxy takes this entity ID.",
    ren: k.ren ? bad(k.ren) : (S.comp.ren.trim() ? "The source is renamed to this ID, so the proxy can take its place." : "Empty keeps the source's ID unchanged."),
  };
}
function compInfo(g){
  const c = S.comp, sm = srcMap(), src = sm[c.source];
  const devName = g.un ? null : g.name;
  const info = { src, ready:false, eid:null, text:"", warn:false, hist:null };
  if (!src) { info.text = "Pick a source entity to see what will be created."; return info; }
  const u = src.unit_of_measurement || "";
  let hist = null;
  if (src.is_energy && c.mode === "history") hist = (c.histItems||[]).find(h => h.entity_id === c.hist) || null;
  info.hist = hist;
  info.takeover = takeoverOn();
  info.eid = (hist && hist.seamless) ? hist.entity_id : info.takeover ? (c.eid.trim().toLowerCase() || `${src.domain}.…`) : `${src.domain}.${slug(c.name) || "name"}${devName ? "_" + slug(devName) : ""}`;
  const name = !!c.name.trim();
  if (!src.is_energy) info.text = `Mirrors ${src.entity_id} (${src.state}${u?" "+u:""}). Changes follow the source.`;
  else if (c.mode === "zero") info.text = `Counter starts at 0 ${u} and counts the increase of ${src.entity_id} from now.`;
  else if (c.mode === "source") info.text = `Counter starts at ${fmtNum(src.state)} ${u}, the current reading of ${src.entity_id}.`;
  else if (!hist) { info.text = c.histLoading ? "Loading recorded history…" : "Choose a recorded entity to continue."; info.warn = true; }
  else info.text = `Counter starts at ${fmtNum(hist.last_value)} ${u}` + (hist.seamless ? ` and takes over ${hist.entity_id}, keeping its history unbroken.` : ` — copied from ${hist.entity_id}'s last total. The new entity gets its own ID.`);
  if (info.takeover) {
    const k = idChecks(src), ren = c.ren.trim().toLowerCase();
    if (ren && !k.ren) info.text += ` The source is renamed to ${ren}.`;
    info.idErr = !!(k.eid || k.ren);
  }
  info.ready = name && !info.idErr && (!src.is_energy || c.mode !== "history" || !!hist);
  return info;
}
function previewHtml(info){
  return `<div class="fl">Preview</div>` +
    (info.eid ? `<div class="pe">${esc(info.eid)}</div>` : `<div class="pe ph">domain.name_device</div>`) +
    `<p class="${info.warn?"warn":""}">${esc(info.text)}</p>`;
}
function composerHtml(g){
  const c = S.comp, info = compInfo(g), src = info.src, u = src?.unit_of_measurement || "";
  const sel = entityInput({ id:"cp-src", bind:"comp.source", value:c.srcText, options:S.data.source_entities });
  let h = `<section class="composer" aria-labelledby="cp-t"><h3 id="cp-t">New proxy<small>in ${esc(g.name)}</small></h3>
    <div class="field"><label class="l" for="cp-name">Name</label><input class="in" id="cp-name" data-bind="comp.name" value="${esc(c.name)}" autocomplete="off" placeholder="e.g. Desk Lamp" enterkeyhint="next"></div>
    <div class="field"><label class="l" for="cp-src">Mirror this entity</label>${sel}<p class="hint" id="cp-src-hint">${compHint()}</p></div>`;
  if (src) {
    if (seamlessHist()) h += `<p class="hint" style="margin:0 0 16px">This proxy takes over the recorded entity&rsquo;s ID, so the source keeps its own.</p>`;
    else {
      h += `<label class="rc"><input type="checkbox" data-bind="comp.takeover" ${c.takeover?"checked":""}><span class="rd sq"></span><span><span class="rt">Take over the source&rsquo;s name and ID</span><span class="rs">The proxy gets the source&rsquo;s name and entity ID, so dashboards and automations that use it keep working. The source is renamed with a suffix.</span></span></label>`;
      if (c.takeover) {
        const ih = idHints(src);
        h += `<div class="nest"><div class="field"><label class="l" for="cp-eid">Proxy entity ID</label><input class="in mono" id="cp-eid" data-bind="comp.eid" value="${esc(c.eid)}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${esc(src.entity_id)}"><p class="hint" id="cp-eid-hint">${ih.eid}</p></div>
          <div class="field"><label class="l" for="cp-ren">Source entity ID after rename</label><input class="in mono" id="cp-ren" data-bind="comp.ren" value="${esc(c.ren)}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${esc(src.entity_id)}_source"><p class="hint" id="cp-ren-hint">${ih.ren}</p></div></div>`;
      }
    }
  }
  if (src && src.is_energy) {
    h += `<fieldset><legend class="fl">Where does the counter start?</legend>
      ${radio("cp-mode","zero",c.mode==="zero","From zero","Count only what the source consumes from now on.","comp.mode")}
      ${radio("cp-mode","source",c.mode==="source","At the source&rsquo;s current reading",`${esc(fmtNum(src.state))} ${esc(u)} right now.`,"comp.mode")}
      ${radio("cp-mode","history",c.mode==="history","Continue a recorded history",c.histLoading?"Looking through the recorder…":(c.histItems&&!c.histItems.length?`No recorded ${esc(u)} entities found.`:"Pick an old meter and carry its total over."),"comp.mode","", (c.histItems&&!c.histItems.length)?"disabled":"")}`;
    if (c.mode === "history" && c.histItems && c.histItems.length) {
      h += `<div class="nest" role="group" aria-label="Recorded entities">` + c.histItems.map(x =>
        radio("cp-hist", x.entity_id, c.hist===x.entity_id, `<span class="mono" style="font-size:14px;overflow-wrap:anywhere">${esc(x.entity_id)}</span>`,
          `${esc(x.name)} · last ${esc(fmtNum(x.last_value))} ${esc(x.unit)} · ${esc(ago(x.last_time))}<br>${x.seamless?'<span class="tag ok">Takes over entity ID</span>':'<span class="tag">'+(x.exists?"Entity still exists":"No longer recorded")+' · copies total</span>'}`, "comp.hist")).join("") + `</div>`;
    }
    if (c.histErr) h += `<p class="hint" style="color:var(--mp-danger)">${esc(c.histErr)}</p>`;
    h += `</fieldset>`;
  }
  h += `<div class="preview" id="cp-prev" aria-live="polite">${previewHtml(info)}</div>
    <div class="acts"><button class="btn primary grow" id="cp-go" data-act="comp-create" ${info.ready&&!S.busy?"":"disabled"}>${S.busy?"Creating…":"Create proxy"}</button><button class="btn ghost" data-act="comp-close">Cancel</button></div></section>`;
  return h;
}
function updateComp(){
  const g = group(); if (!g || !S.comp.open) return;
  const info = compInfo(g);
  const pv = $("#cp-prev"); if (pv) pv.innerHTML = previewHtml(info);
  const go = $("#cp-go"); if (go) go.disabled = !(info.ready && !S.busy);
  if (info.takeover && info.src) { const ih = idHints(info.src), a = $("#cp-eid-hint"), b = $("#cp-ren-hint"); if (a) a.innerHTML = ih.eid; if (b) b.innerHTML = ih.ren; }
}
async function loadHist(){
  const c = S.comp, src = srcMap()[c.source];
  if (!src || !src.is_energy) return;
  const unit = src.unit_of_measurement;
  if (c.histUnit === unit && c.histItems) return;
  c.histUnit = unit; c.histItems = null; c.histErr = null; c.histLoading = true;
  try {
    const r = await api("GET", "magnolia_proxy/energy_history?unit=" + encodeURIComponent(unit));
    if (c.histUnit !== unit) return;
    c.histItems = r.items || []; if (r.recorder === false) c.histErr = "The recorder is not available, so no history can be continued.";
  } catch (e) { if (c.histUnit === unit) { c.histItems = []; c.histErr = errMsg(e); } }
  c.histLoading = false;
  if (c.open) { keepFocus(renderDetail); }
}

/* ---------- sheets ---------- */
function openSheet(s){ S.sheet = Object.assign({fresh:true, opener:fidOf(root.activeElement), error:null}, s); render(); }
function closeSheet(){
  if (!S.sheet) return; const o = S.sheet.opener; S.sheet = null; render(); if (o) focusByFid(o);
}
function renderSheet(){
  const root = $("#sheetRoot"), s = S.sheet;
  if (!s) { root.innerHTML = ""; return; }
  const fresh = s.fresh; s.fresh = false;
  let title = "", body = "", foot = "";
  const busy = S.busy;
  if (s.type === "new-device") {
    title = "New virtual device";
    body = `<p style="color:var(--text2)">Create a device first, then add proxies to it.</p>
      <div class="field"><label class="l" for="nd-name">Name</label><input class="in" id="nd-name" data-bind="nd.name" value="${esc(s.name||"")}" placeholder="e.g. Garage Meter" autocomplete="off"></div>`;
    foot = `<button class="btn" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="do-new-device" ${(busy||!(s.name||"").trim())?"disabled":""}>${busy?"Creating…":"Create device"}</button>`;
  } else if (s.type === "del-device") {
    const g = S.data.devices.find(d => d.id === s.id); if (!g) { S.sheet = null; root.innerHTML = ""; return; }
    title = "Delete this device?";
    body = `<p><b>${esc(g.name)}</b> and ${g.proxies.length?`its ${plural(g.proxies.length,"proxy").replace("proxys","proxies")}`:"all its settings"} will be permanently removed. Entities that use them in dashboards or automations will stop working.</p>`;
    foot = `<button class="btn" data-act="sheet-close">Keep it</button><button class="btn danger solid" data-act="do-del-device" ${busy?"disabled":""}>${busy?"Deleting…":"Delete device"}</button>`;
  } else if (s.type === "del-proxy") {
    const p = findProxy(s.id); if (!p) { S.sheet = null; root.innerHTML = ""; return; }
    title = "Delete this proxy?";
    body = `<p><b>${esc(p.name)}</b><br><span class="mono" style="font-size:13.5px;overflow-wrap:anywhere">${esc(p.entity_id)}</span></p><p>The proxy entity is removed. The source <span class="mono" style="font-size:13px;overflow-wrap:anywhere">${esc(p.source_entity)}</span> is not touched.</p>`;
    foot = `<button class="btn" data-act="sheet-close">Keep it</button><button class="btn danger solid" data-act="do-del-proxy" ${busy?"disabled":""}>${busy?"Deleting…":"Delete proxy"}</button>`;
  } else if (s.type === "replace") {
    const g = group(); title = "Replace device";
    if (s.step === 1) {
      const rds = S.data.real_devices || [];
      body = `<p style="color:var(--text2)">Pick the new real device. Every proxy of <b style="color:var(--text)">${esc(s.name)}</b> is matched to an equivalent entity.</p>` +
        (rds.length ? `<fieldset><legend class="fl">Real devices</legend>${rds.map(r => radio("rp-target", r.id, s.target===r.id, esc(r.name), `${esc([r.manufacturer, r.model].filter(Boolean).join(" · "))} · ${plural((r.entities||[]).length,"entity").replace("entitys","entities")}`, "rp.target")).join("")}</fieldset>` : `<div class="none">No real devices found.</div>`);
      foot = `<button class="btn" data-act="sheet-close">Cancel</button><button class="btn primary" data-act="rp-plan" ${(!s.target||busy)?"disabled":""}>${busy?"Matching…":"Find matches"}</button>`;
    } else {
      const sm = srcMap(); let changes = 0, open = 0;
      const items = s.items.map(it => {
        const pick = s.picks[it.proxy_id] || ""; const p = findProxy(it.proxy_id);
        if (pick && pick !== it.current_source_entity) changes++;
        if (it.conflict_reason === "multiple_candidates" && !pick) open++;
        const tag = it.conflict_reason === "multiple_candidates" ? '<span class="tag warn">Pick one</span>' : it.conflict_reason === "no_matching_entity" ? '<span class="tag warn">No match</span>' : '<span class="tag ok">Auto-matched</span>';
        const none = it.conflict_reason === "no_matching_entity";
        const bad = !!s.badPick[it.proxy_id];
        const sel = entityInput({ id:"rp-"+it.proxy_id, bind:"rp.pick", bindId:it.proxy_id, value:s.pickText[it.proxy_id] ?? pick, disabled:none,
            placeholder: it.conflict_reason==="multiple_candidates" ? "Type or choose a match…" : none ? "No match — keeps current source" : "Empty keeps current source",
            options: it.candidates.map(c => sm[c] || { entity_id:c, name:c }) })
          + `<p class="hint" id="rph-${esc(it.proxy_id)}">${bad ? `<span class="bad">Not one of the matching entities.</span>` : (pick && sm[pick] ? `<b>${esc(sm[pick].name)}</b>` : "")}</p>`;
        let modes = "";
        if (p && p.is_energy && pick && pick !== it.current_source_entity) {
          const m = s.modes[it.proxy_id] || "continue";
          modes = `<fieldset style="margin:10px 0 0"><legend class="fl">Total for ${esc(it.proxy_name)}</legend>
            ${radio("rpm-"+it.proxy_id,"continue",m==="continue","Continue running total","","rp.mode",it.proxy_id)}
            ${radio("rpm-"+it.proxy_id,"zero",m==="zero","Restart at 0","","rp.mode",it.proxy_id)}
            ${radio("rpm-"+it.proxy_id,"source",m==="source","Start at new reading",`${esc(fmtNum(sm[pick]?.state))} ${esc(p.unit||"")}`,"rp.mode",it.proxy_id)}</fieldset>`;
        }
        return `<li><div class="top"><strong>${esc(it.proxy_name)}</strong><span class="tag">${esc(it.locked_domain)}</span>${tag}</div>
          <div class="cur">now: ${esc(it.current_source_entity)}</div><label class="l" for="rp-${esc(it.proxy_id)}">New source</label>${sel}${modes}</li>`;
      }).join("");
      body = `<p style="color:var(--text2)">Matched against <b style="color:var(--text)">${esc(s.targetName)}</b>.${open?` <span style="color:var(--mp-warn-text)">${plural(open,"proxy").replace("proxys","proxies")} need${open===1?"s":""} a choice.</span>`:""}</p><ul class="rp">${items}</ul>`;
      foot = `<button class="btn" data-act="rp-back">Back</button><button class="btn primary" data-act="rp-apply" ${(!changes||busy||Object.values(s.badPick).some(Boolean))?"disabled":""}>${busy?"Applying…":changes?`Apply ${plural(changes,"change")}`:"Nothing to apply"}</button>`;
    }
  }
  const err = s.error ? `<div class="serr" role="alert">${esc(s.error)}</div>` : "";
  root.innerHTML = `<div class="scrim" data-act="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" tabindex="-1" ${fresh?"":'style="animation:none"'}>
      <div class="grab"></div><h2 id="sheetTitle">${esc(title)}</h2><div class="sbody">${err}${body}</div><div class="sfoot">${foot}</div></div>`;
  if (!fresh) { const sc = $(".scrim"); if (sc) sc.style.animation = "none"; }
  if (fresh) { const f = root.querySelector("input.in,select.in,input[type=radio]:checked") || root.querySelector(".sheet"); setTimeout(() => f && f.focus({preventScroll:true}), 30); }
  if (s.scrollKeep != null) { const sb = $(".sbody"); if (sb) sb.scrollTop = s.scrollKeep; }
}

/* ---------- screens ---------- */
function applyScreen(){
  $("#stage").dataset.screen = S.screen;
  const desk = isWide();
  const r = $("#railScreen"), d = $("#detailScreen");
  r.inert = !desk && S.screen === "detail" || !!S.sheet; d.inert = !desk && S.screen === "list" || !!S.sheet;
}

/* ---------- data ---------- */
function structSig(d){
  return JSON.stringify([d.devices.map(x => [x.id,x.name,x.model,x.proxies.map(p => [p.id,p.name,p.entity_id,p.source_entity,p.domain])]),
    d.unassigned_proxies.map(p => [p.id,p.name,p.entity_id,p.source_entity]), d.source_entities.map(s => s.entity_id), d.real_devices.map(r => r.id)]);
}
function normalizeSel(){
  const ids = S.data.devices.map(d => d.id);
  if (S.sel !== "unassigned" && !ids.includes(S.sel)) S.sel = ids[0] || "unassigned";
  if (S.expanded && !findProxy(S.expanded)) S.expanded = null;
  Object.keys(S.edit).forEach(k => { if (!findProxy(k)) delete S.edit[k]; });
}
async function load(){
  const d = await api("GET", "magnolia_proxy/state");
  S.data = d; S.sig = structSig(d); S.loading = false; S.loadErr = null; normalizeSel();
}
async function initialLoad(){
  S.loading = true; S.loadErr = null; render();
  try { await load(); } catch (e) { S.loading = false; S.loadErr = errMsg(e); }
  render();
}
function updateLive(){
  for (const p of allProxies()) {
    const el = root.querySelector(`[data-live="${CSS.escape(p.id)}"]`);
    if (el) { const t = liveText(p); if (el.textContent !== t) el.textContent = t; el.dataset.st = liveSt(p); }
  }
  updateComp();
}
async function refresh(){
  if (S.busy || S.loading) return;
  try {
    const d = await api("GET", "magnolia_proxy/state");
    if (S.busy) return;
    const sig = structSig(d); const changed = sig !== S.sig;
    S.data = d; S.sig = sig;
    if (changed) { normalizeSel(); render(); } else updateLive();
  } catch (_) { /* keep quiet: next tick retries */ }
}
async function act(fn, ok, inSheet){
  if (S.busy) return false;
  S.busy = true; S.error = null; if (S.sheet) S.sheet.error = null;
  if (S.sheet) S.sheet.scrollKeep = $(".sbody")?.scrollTop ?? null;
  render();
  let success = false;
  try { await fn(); success = true; } catch (e) { const m = errMsg(e); if (inSheet && S.sheet) S.sheet.error = m; else { S.error = m; } }
  try { await load(); } catch (e) { S.error = S.error || errMsg(e); }
  S.busy = false;
  render();
  if (success && ok) toast(ok);
  if (!success && !inSheet) { const sc = $("#dscroll"); if (sc) sc.scrollTop = 0; }
  return success;
}
let toastT;
function toast(msg){
  const r = $("#toastRoot"); r.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  clearTimeout(toastT); toastT = setTimeout(() => { r.innerHTML = ""; }, 2600);
}
function copy(text, btn){
  const done = () => { toast("Copied " + text); if (btn) { btn.classList.add("copied"); setTimeout(() => btn.classList.remove("copied"), 900); } };
  const fallback = () => { const t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0"; root.appendChild(t); t.select(); try { document.execCommand("copy"); } catch(_){} t.remove(); done(); };
  try { if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback(); } catch (_) { fallback(); }
}

/* ---------- actions ---------- */
function selectDev(id){
  S.sel = id; S.expanded = null; S.comp.open = false; S.error = null;
  if (!isWide()) S.screen = "detail";
  render(); $("#dscroll").scrollTop = 0;
  if (!isWide()) setTimeout(() => $("#dtitle")?.focus({preventScroll:true}), 360);
}
function goBack(){
  if (S.screen !== "detail") return;
  S.screen = "list"; render();
  setTimeout(() => { const b = root.querySelector('.dev[aria-current="true"]'); b && b.focus({preventScroll:true}); }, 340);
}
function openComp(){
  S.comp = { open:true, name:"", nameTouched:false, source:"", srcText:"", takeover:false, eid:"", eidTouched:false, ren:"", renTouched:false, mode:"zero", hist:"", histItems:null, histUnit:null, histLoading:false, histErr:null };
  S.expanded = null; render();
  setTimeout(() => { const n = $("#cp-name"); if (n) { n.focus({preventScroll:true}); n.scrollIntoView({block:"center", behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto":"smooth"}); } }, 40);
}
const ACT = {
  "select": el => selectDev(el.dataset.id),
  "back": goBack,
  "retry": initialLoad,
  "dismiss": () => { S.error = null; render(); },
  "clear-q": () => { S.q = ""; $("#q").value = ""; render(); },
  "toggle": el => { const id = el.dataset.id; S.expanded = S.expanded === id ? null : id; if (S.expanded) { const p = findProxy(id); S.edit[id] = { name:p.name, source:p.source_entity, srcText:p.source_entity, invalid:false, mode:"continue" }; S.fresh = id; } else delete S.edit[id]; render(); },
  "collapse": () => { const id = S.expanded; S.expanded = null; delete S.edit[id]; render(); setTimeout(() => focusByFid("a:toggle|"+id+"|"), 0); },
  "copy": el => copy(el.dataset.copy, el),
  "save": async el => {
    const id = el.dataset.id, p = findProxy(id), d = S.edit[id]; if (!p || !d) return;
    const body = {};
    if (d.name.trim() !== p.name) body.name = d.name;
    if (d.source !== p.source_entity) { body.source_entity = d.source; if (p.is_energy) body.energy_mode = d.mode; }
    if (!Object.keys(body).length) { toast("No changes to save"); return; }
    if ("name" in body && !d.name.trim()) { S.error = "Proxy name is required"; render(); return; }
    const ok = await act(() => api("PATCH", "magnolia_proxy/proxies/" + id, body), "Saved " + (d.name.trim() || p.name));
    if (ok) { S.expanded = null; delete S.edit[id]; render(); }
  },
  "del-proxy": el => openSheet({ type:"del-proxy", id:el.dataset.id }),
  "do-del-proxy": async () => { const id = S.sheet.id; const ok = await act(() => api("DELETE", "magnolia_proxy/proxies/" + id), "Proxy deleted", true); if (ok) { S.expanded = null; S.sheet = null; render(); } },
  "del-device": () => openSheet({ type:"del-device", id:S.sel }),
  "do-del-device": async () => { const id = S.sheet.id; const ok = await act(() => api("DELETE", "magnolia_proxy/devices/" + id), "Device deleted", true); if (ok) { S.sheet = null; S.screen = "list"; S.expanded = null; render(); } },
  "new-device": () => openSheet({ type:"new-device", name:"" }),
  "do-new-device": async () => {
    const s = S.sheet; let newId = null;
    const ok = await act(async () => { const r = await api("POST", "magnolia_proxy/devices", { name:(s.name || "").trim(), model:DEVICE_MODEL }); newId = r.device.id; }, "Device created", true);
    if (ok) { S.sheet = null; S.sel = newId; S.expanded = null; S.comp.open = false; if (!isWide()) S.screen = "detail"; render(); }
  },
  "sheet-close": closeSheet,
  "comp-open": openComp,
  "comp-close": () => { S.comp.open = false; render(); },
  "comp-create": async () => {
    const g = group(), info = compInfo(g), c = S.comp, src = info.src; if (!info.ready) return;
    const body = { name:c.name.trim(), source_entity:c.source, virtual_device_id: g.un ? null : g.id };
    if (src.is_energy) body.energy_start = c.mode === "history" ? { mode:"history", entity_id:c.hist } : { mode:c.mode };
    if (info.takeover) { body.entity_id = c.eid.trim().toLowerCase(); if (c.ren.trim()) body.rename_source = c.ren.trim().toLowerCase(); }
    const ok = await act(() => api("POST", "magnolia_proxy/proxies", body), "Proxy created");
    if (ok) { S.comp.open = false; render(); }
  },
  "replace": () => { const g = group(); openSheet({ type:"replace", step:1, name:g.name, target:(S.data.real_devices[0]||{}).id || "", items:[], picks:{}, pickText:{}, badPick:{}, modes:{} }); },
  "rp-plan": async () => {
    const s = S.sheet; let r;
    const rd = S.data.real_devices.find(x => x.id === s.target);
    const ok = await act(async () => { r = await api("POST", "magnolia_proxy/replace_plan", { virtual_device_id:S.sel, target_device_id:s.target }); }, null, true);
    if (ok && S.sheet) { s.items = r.items; s.targetName = rd?.name || s.target; s.picks = {}; s.pickText = {}; s.badPick = {}; r.items.forEach(it => { s.picks[it.proxy_id] = it.selected_source_entity || ""; s.pickText[it.proxy_id] = s.picks[it.proxy_id]; }); s.step = 2; render(); $(".sheet")?.focus({preventScroll:true}); }
  },
  "rp-back": () => { S.sheet.step = 1; S.sheet.error = null; render(); },
  "rp-apply": async () => {
    const s = S.sheet, mappings = {}, energy_modes = {}; let res;
    s.items.forEach(it => { const pick = s.picks[it.proxy_id]; if (pick && pick !== it.current_source_entity) { mappings[it.proxy_id] = pick; const p = findProxy(it.proxy_id); if (p && p.is_energy) energy_modes[it.proxy_id] = s.modes[it.proxy_id] || "continue"; } });
    const names = Object.fromEntries(s.items.map(it => [it.proxy_id, it.proxy_name]));
    const ok = await act(async () => { res = await api("POST", "magnolia_proxy/replace_apply", { mappings, energy_modes }); }, null, true);
    if (ok) {
      S.sheet = null; S.expanded = null;
      const rej = (res.rejected || []);
      if (rej.length) S.error = `${rej.length} of ${Object.keys(mappings).length} could not be applied: ${rej.map(i => names[i] || i).join(", ")}. Their sources did not pass validation.`;
      render(); if (!rej.length) toast("Replaced " + plural(Object.keys(mappings).length, "source"));
    }
  },
  "menu": () => host.dispatchEvent(new Event("hass-toggle-menu", { bubbles:true, composed:true })),
  "discover": async () => { const id = S.sel; await act(() => api("POST", "magnolia_proxy/devices/" + id), "Discovery re-sent"); },
};
root.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
  if (el.tagName === "A") return;
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
function bind(path, el, type){
  const v = el.value, id = el.dataset.id;
  switch (path) {
    case "q": S.q = v; renderRail(); keepFocus(renderDetail); break;
    case "edit.name": if (S.edit[id]) S.edit[id].name = v; break;
    case "edit.source": {
      const d = S.edit[id], p = findProxy(id); if (!d || !p) break;
      const t = v.trim().toLowerCase(), ok = compatOpts(p).some(s => s.entity_id === t);
      const prevSource = d.source, prevInvalid = d.invalid;
      d.srcText = v; d.invalid = !ok; d.source = ok ? t : p.source_entity;
      if (d.source !== prevSource || d.invalid !== prevInvalid) {
        if (d.source !== prevSource) d.mode = "continue";
        render();
      }
      break;
    }
    case "edit.mode": if (S.edit[id]) S.edit[id].mode = v; break;
    case "comp.name": S.comp.name = v; S.comp.nameTouched = v.trim() !== ""; updateComp(); break;
    case "comp.takeover": {
      const c = S.comp; c.takeover = el.checked;
      if (c.takeover) syncTakeover(); else if (!c.nameTouched) c.name = "";
      render(); break;
    }
    case "comp.eid": S.comp.eid = v; S.comp.eidTouched = true; updateComp(); break;
    case "comp.ren": S.comp.ren = v; S.comp.renTouched = true; updateComp(); break;
    case "comp.source": {
      const c = S.comp, t = v.trim().toLowerCase(), valid = srcMap()[t] ? t : "";
      c.srcText = v;
      if (valid !== c.source) { c.source = valid; c.mode = "zero"; c.hist = ""; c.eidTouched = false; c.renTouched = false; syncTakeover(); loadHist(); render(); }
      else { const h = $("#cp-src-hint"); if (h) h.innerHTML = compHint(); }
      break;
    }
    case "comp.mode": S.comp.mode = v; render(); break;
    case "comp.hist": { const was = !!seamlessHist(); S.comp.hist = v; if (S.comp.takeover && was !== !!seamlessHist()) render(); else updateComp(); break; }
    case "nd.name": { S.sheet.name = v; const b = $('[data-act="do-new-device"]'); if (b) b.disabled = !v.trim() || S.busy; break; }
    case "rp.target": S.sheet.target = v; render(); break;
    case "rp.pick": {
      const s = S.sheet, it = s.items.find(i => i.proxy_id === id); if (!it) break;
      const t = v.trim().toLowerCase(), isBad = t !== "" && !it.candidates.includes(t);
      const pick = isBad ? "" : t, wasBad = !!s.badPick[id], prev = s.picks[id] || "";
      s.pickText[id] = v; s.badPick[id] = isBad; s.picks[id] = pick;
      if (pick !== prev || isBad !== wasBad) { s.scrollKeep = $(".sbody")?.scrollTop ?? null; render(); }
      break;
    }
    case "rp.mode": S.sheet.modes[id] = v; break;
  }
}
const TEXTUAL = new Set(["q","edit.name","edit.source","comp.name","comp.source","comp.eid","comp.ren","rp.pick","nd.name"]);
root.addEventListener("input", e => { const b = e.target.dataset && e.target.dataset.bind; if (b && TEXTUAL.has(b)) bind(b, e.target, "input"); });
root.addEventListener("change", e => { const b = e.target.dataset && e.target.dataset.bind; if (b && !TEXTUAL.has(b)) bind(b, e.target, "change"); });
root.addEventListener("submit", e => e.preventDefault());

/* ---------- keyboard ---------- */
root.addEventListener("keydown", e => {
  const t = e.target, typing = t.matches && t.matches("input:not([type=radio]),select,textarea");
  if (e.key === "Escape") {
    if (S.sheet) { closeSheet(); e.preventDefault(); }
    else if (t.id === "q" && S.q) { S.q = ""; t.value = ""; render(); }
    else if (S.comp.open) { S.comp.open = false; render(); }
    else if (S.expanded) { ACT.collapse(); }
    else if (!isWide() && S.screen === "detail") goBack();
    return;
  }
  if (e.key === "Enter" && t.dataset && t.dataset.bind === "nd.name" && (S.sheet && (S.sheet.name || "").trim())) { e.preventDefault(); ACT["do-new-device"](); return; }
  if (S.sheet) { // focus trap
    if (e.key === "Tab") {
      const f = [...root.querySelectorAll(".sheet button:not([disabled]),.sheet input:not([disabled]),.sheet select:not([disabled])")].filter(x => x.offsetParent !== null || x.type === "radio");
      if (!f.length) return; const first = f[0], last = f[f.length-1];
      if (e.shiftKey && (root.activeElement === first || root.activeElement.classList.contains("sheet"))) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && root.activeElement === last) { first.focus(); e.preventDefault(); }
    }
    return;
  }
  if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $("#q").focus(); return; }
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && t.classList && t.classList.contains("dev")) {
    const all = [...root.querySelectorAll("#railList .dev")]; const i = all.indexOf(t); const n = all[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (n) { e.preventDefault(); n.focus(); if (isWide()) { S.sel = n.dataset.id; S.expanded = null; S.comp.open = false; render(); } }
  }
  if (e.key === "ArrowDown" && t.id === "q") { const f = root.querySelector("#railList .dev"); if (f) { e.preventDefault(); f.focus(); } }
  if (e.key === "Enter" && t.dataset && t.dataset.bind === "comp.name") { const b = $("#cp-go"); if (b && !b.disabled) b.click(); }
  if (e.key === "Enter" && t.dataset && t.dataset.bind === "edit.name") { const b = root.querySelector('[data-act="save"]'); if (b) b.click(); }
});

/* ---------- lifecycle ---------- */
let timer = null, ro = null, started = false;
function measure(){ wrap.dataset.wide = host.clientWidth >= 760 ? "1" : "0"; applyScreen(); }
return {
  onHass(){ if (!started) { started = true; initialLoad(); } },
  setNarrow(v){ $("#menuBtn").hidden = !v; },
  start(){
    if (!ro && typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(measure); ro.observe(host); }
    measure();
    if (!timer) timer = setInterval(refresh, 10000);
  },
  stop(){ if (timer) { clearInterval(timer); timer = null; } if (ro) { ro.disconnect(); ro = null; } },
};
}

class MagnoliaProxyPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this.shadowRoot.innerHTML = `<style>${PANEL_CSS}</style>${PANEL_HTML}`;
    this._m = mount(this, this.shadowRoot);
  }

  connectedCallback() {
    this._m.start();
  }

  disconnectedCallback() {
    this._m.stop();
  }

  set hass(hass) {
    this._hass = hass;
    this._m.onHass();
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    this._m.setNarrow(!!value);
  }

  // Set by Home Assistant on custom panels; unused here.
  set route(_value) {}
  set panel(_value) {}
}

customElements.define("magnolia-proxy-panel", MagnoliaProxyPanel);

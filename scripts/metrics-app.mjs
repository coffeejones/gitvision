#!/usr/bin/env node
// CodeTrawl founder dashboard — a real local app (npm run metrics).
//
// Spins up a tiny LOCAL server on your MacBook that:
//   - reads METRICS_TOKEN from .env.local,
//   - proxies the token-gated prod /api/metrics?detail=1 (the token stays in
//     THIS process — the browser never sees it),
//   - serves a CodeTrawl-themed dashboard (cards, charts, recent signups with
//     masked emails, repos with dates, a refresh button),
//   - opens your browser.
//
// No dependencies — Node 18+ (global fetch) + the http module.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (line.trimStart().startsWith("#")) continue;
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const val = m[2].replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch {
    // no env file — shell env may still have it
  }
}
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), ".env"));

const TOKEN = process.env.METRICS_TOKEN;
const BASE = (process.env.METRICS_URL ?? "https://codetrawl.com").replace(/\/+$/, "");
if (!TOKEN) {
  console.error(
    "No METRICS_TOKEN found. Put it in .env.local (METRICS_TOKEN=…) or pass it inline."
  );
  process.exit(1);
}

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CodeTrawl · metrics</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500&family=Fragment+Mono&display=swap');
:root{--bg:#0c0b0a;--surface:#141312;--s2:#1b1a18;--border:#262321;--text:#f2efea;--dim:#9a948c;--muted:#6b655e;--orange:#ff4f00;--sage:#9caf86}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Schibsted Grotesk',-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1000px;margin:0 auto;padding:32px 24px 64px}
.mono{font-family:'Fragment Mono',ui-monospace,monospace}
.row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.eyebrow{font-family:'Fragment Mono',monospace;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
h1{font-size:26px;font-weight:500;letter-spacing:-.02em;margin:6px 0 0}
button{font:inherit;cursor:pointer;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:8px 14px;transition:.15s}
button:hover{border-color:#3a3631;background:var(--s2)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:26px 0}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px}
.card .label{font-family:'Fragment Mono',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.card .num{font-size:30px;font-weight:500;line-height:1.1;margin-top:8px;letter-spacing:-.02em}
.card .sub{font-size:12.5px;color:var(--dim);margin-top:6px}
.up{color:var(--sage)}.down{color:var(--orange)}
.sec{margin-top:30px}
.sec h2{font-size:13px;font-weight:500;color:var(--dim);margin:0 0 12px;display:flex;align-items:center;justify-content:space-between}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.chart{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.chart .t{font-family:'Fragment Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-family:'Fragment Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:400;padding:0 0 9px}
td{padding:8px 0;border-top:1px solid var(--border);color:var(--dim)}
td.k{color:var(--text)}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px}
a{color:var(--text);text-decoration:none}a:hover{color:var(--orange)}
.tiny{font-size:11.5px;color:var(--muted)}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--sage);margin-right:7px;vertical-align:1px}
@media(max-width:680px){.charts{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<div class="row">
  <div><div class="eyebrow"><span class="dot"></span>CodeTrawl · metrics</div><h1 id="host">…</h1><div class="tiny" id="activity"></div></div>
  <div style="text-align:right"><button id="refresh">↻ Refresh</button><div class="tiny" id="updated" style="margin-top:6px"></div></div>
</div>
<div class="cards" id="cards"></div>
<div class="sec"><div class="charts">
  <div class="chart"><div class="t">signups / day · 30d</div><div id="ch-signups"></div></div>
  <div class="chart"><div class="t">analyses / day · 30d</div><div id="ch-analyses"></div></div>
</div></div>
<div class="sec" id="fl-sec" style="display:none"><h2><span>Faultline engine</span><span class="tiny" style="text-transform:none;letter-spacing:0;color:var(--muted)">the worker-offload decision</span></h2><div class="cards" id="fl-cards"></div></div>
<div class="sec"><h2><span>Recent signups</span><button id="reveal" style="padding:4px 10px;font-size:12px">Show emails</button></h2><div class="panel"><table><thead><tr><th>Account</th><th style="text-align:right">Signed up</th></tr></thead><tbody id="accounts"></tbody></table></div></div>
<div class="sec"><h2>Repos analyzed</h2><div class="panel"><table><thead><tr><th>Repo</th><th style="text-align:right">Runs</th><th style="text-align:right">Last analyzed</th></tr></thead><tbody id="repos"></tbody></table></div></div>
<div class="tiny" style="margin-top:24px">Read-only · computed from your own product's data · emails shown only on request</div>
</div>
<script>
let DATA=null, reveal=false;
const $=id=>document.getElementById(id);
function rel(iso){if(!iso)return"—";const s=(Date.now()-new Date(iso))/1000;if(s<90)return"just now";const m=s/60;if(m<90)return Math.round(m)+"m ago";const h=m/60;if(h<36)return Math.round(h)+"h ago";return Math.round(h/24)+"d ago"}
function mask(e){const[u,d]=String(e).split("@");if(!d)return e;return u[0]+"***@"+d}
function delta(n,p){if(p===0)return n>0?'<span class="up">new this week</span>':'';const d=n-p;const c=d>=0?'up':'down';return '<span class="'+c+'">'+(d>=0?'+':'')+d+' vs last wk</span>'}
function spark(values){const w=300,h=56,pad=4,max=Math.max(1,...values),n=values.length;const step=(w-pad*2)/(n-1);const pts=values.map((v,i)=>[pad+i*step,h-pad-(v/max)*(h-pad*2)]);const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');const area=line+' L'+(w-pad)+' '+(h-pad)+' L'+pad+' '+(h-pad)+' Z';return '<svg viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" preserveAspectRatio="none"><path d="'+area+'" fill="#ff4f0018"/><path d="'+line+'" fill="none" stroke="#ff4f00" stroke-width="1.5"/></svg>'}
function card(label,num,sub){return '<div class="card"><div class="label">'+label+'</div><div class="num mono">'+num+'</div><div class="sub">'+sub+'</div></div>'}
function render(){const m=DATA;if(!m)return;
 $('host').textContent=location.host.includes('localhost')?(new URL("`+BASE+`")).host:location.host;
 $('updated').textContent='updated '+rel(m.generatedAt);
 $('activity').textContent='last signup '+rel(m.lastSignupAt)+' · last analysis '+rel(m.lastAnalysisAt);
 const a=m.accounts,an=m.analyses;
 $('cards').innerHTML=[
   card('Accounts',a.total,a.thisWeek+' new this week '+delta(a.thisWeek,a.prevWeek)),
   card('Paid',a.paid,'Plus '+(a.byTier.Plus||0)+' · Pro '+(a.byTier.Pro||0)),
   card('Analyses',an.total,an.thisWeek+' this week '+delta(an.thisWeek,an.prevWeek)),
   card('Repos',an.uniqueRepos,an.refreshes+' re-runs')
 ].join('');
 $('ch-signups').innerHTML=spark(m.signupsByDay.map(d=>d.count));
 $('ch-analyses').innerHTML=spark(m.analysesByDay.map(d=>d.count));
 const f=m.faultline;
 if(f){$('fl-sec').style.display='';
   const verdict=f.count===0?'<span class="dim">no simulates yet — run the probe</span>'
     :(f.p95Ms>1000?'<span class="down">⚠ p95 &gt; 1s — worker offload warranted</span>':'<span class="up">within budget (p95 ≤ 1s)</span>');
   $('fl-cards').innerHTML=[
     card('Simulates',f.count,f.shed+' shed · '+f.inFlight+' in-flight now'),
     card('p95',f.p95Ms+'ms',verdict),
     card('window '+f.windowSize,'p50 '+f.p50Ms+' · max '+f.maxMs+'ms','engine up '+rel(f.startedAt))
   ].join('');
 }
 const accts=(m.detail&&m.detail.accounts)||[];
 $('accounts').innerHTML=accts.length?accts.map(x=>'<tr><td class="k mono">'+(reveal?x.email:mask(x.email))+'</td><td style="text-align:right" title="'+x.createdAt+'">'+rel(x.createdAt)+'</td></tr>').join(''):'<tr><td>No accounts yet</td><td></td></tr>';
 const repos=(m.detail&&m.detail.repos)||[];
 $('repos').innerHTML=repos.length?repos.map(r=>'<tr><td class="k"><a href="https://github.com/'+r.repo+'" target="_blank">'+r.repo+'</a></td><td style="text-align:right" class="mono">'+r.count+'</td><td style="text-align:right" title="'+r.lastAnalyzed+'">'+rel(r.lastAnalyzed)+'</td></tr>').join(''):'<tr><td>No analyses yet</td><td></td><td></td></tr>';
}
async function load(){$('refresh').textContent='…';try{const r=await fetch('/data',{cache:'no-store'});if(!r.ok){$('cards').innerHTML='<div class="card">Server returned '+r.status+' — check METRICS_TOKEN matches Railway.</div>';return}DATA=await r.json();render()}catch(e){$('cards').innerHTML='<div class="card">Could not load: '+e.message+'</div>'}finally{$('refresh').textContent='↻ Refresh'}}
$('refresh').onclick=load;
$('reveal').onclick=()=>{reveal=!reveal;$('reveal').textContent=reveal?'Hide emails':'Show emails';render()};
load();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.url === "/" || req.url.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(HTML);
  }
  if (req.url.startsWith("/data")) {
    try {
      const r = await fetch(`${BASE}/api/metrics?detail=1`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      const body = await r.text();
      res.writeHead(r.status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(body);
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
  }
  res.writeHead(404);
  res.end("not found");
});

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(cmd, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    }).unref();
  } catch {
    // couldn't auto-open — the URL is printed below
  }
}

function start(port) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && port !== 0) {
      start(0); // let the OS pick a free port
    } else {
      console.error(e.message);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    const url = `http://localhost:${server.address().port}`;
    console.log(`CodeTrawl metrics → ${url}  (reading ${BASE} · Ctrl+C to stop)`);
    if (!process.env.METRICS_NO_OPEN) openBrowser(url);
  });
}
start(Number(process.env.METRICS_PORT) || 4319);

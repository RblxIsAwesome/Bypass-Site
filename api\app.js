// ONE-FILE Vercel app: UI + proxy for permitted endpoints only.
// UI:      GET  /api/app
// Proxy:   POST /api/app/create-directory  -> https://dayonerblx.com/api/createDirectory.php
//          POST /api/app/verification      -> https://dayonerblx.com/api/verification.php
// DevTools deterrence:
//  - Detect DevTools via heuristics/key combos/resizes
//  - Black out the UI and disable all fetch/XHR calls from this page
// Note: Users can still open DevTools; this only stops your page from issuing more network requests.

const ALLOWED_ORIGIN = '*'; // set to your domain for tighter CORS

function send(res, status, body, headers = {}) {
  const isString = typeof body === 'string';
  res.statusCode = status;
  res.setHeader('Content-Type', isString ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  for (const [k,v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(isString ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return raw; }
}

async function proxyJson(res, upstreamUrl, payload) {
  try {
    const r = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})
    });
    const text = await r.text();
    const isJson = (r.headers.get('content-type') || '').includes('application/json');
    res.statusCode = r.status;
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Content-Type', isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
    res.end(text);
  } catch (e) {
    send(res, 502, { error: 'Upstream request failed', details: String(e?.message || e) });
  }
}

function pageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mystic Tools — Single File</title>
<style>
:root{--bg:#0f1223;--panel:#141739;--border:#2a2e4a;--text:#fff;--muted:#b9bed6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:24px}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:18px;margin-bottom:16px}
h1,h2{margin:0 0 12px}label{display:block;margin:10px 0 6px;color:var(--muted)}
input,textarea{width:100%;padding:12px;border:1px solid var(--border);border-radius:10px;background:#0c0f26;color:var(--text)}
button{padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:#1b1f3a;color:#fff;cursor:pointer}
button:hover{background:#283056}
pre{background:#0c0f26;border:1px solid var(--border);border-radius:12px;padding:12px;overflow:auto}
.note{color:var(--muted)}.success{border-color:#3aa76d}.error{border-color:#a33;color:#f88}
.tabs{display:flex;gap:8px;margin-bottom:12px}
.hidden{display:none}
#blackout{position:fixed;inset:0;background:#000;z-index:999999;display:none}
body.blocked *{display:none !important}
body.blocked #blackout{display:block !important}
</style>
</head>
<body>
<div id="blackout"></div>
<div class="wrap">
  <h1>Mystic Tools (Single File)</h1>
  <p class="note">This page forwards permitted requests to upstream APIs. DevTools detection will black out the page and stop all network requests from this app.</p>

  <div class="tabs">
    <button data-tab="create" id="tab-create">Create Directory</button>
    <button data-tab="verify" id="tab-verify">Verification</button>
  </div>

  <section id="view-create" class="panel">
    <h2>Create Directory</h2>
    <p class="note">POST → https://dayonerblx.com/api/createDirectory.php</p>
    <form id="form-create">
      <label>Directory Name</label>
      <input id="dir" placeholder="letters, numbers, underscore, hyphen" required>
      <label>Directory Webhook (Discord)</label>
      <input id="wh" placeholder="https://discord.com/api/webhooks/..." required>
      <label>Custom Discord Link (Optional)</label>
      <input id="link" placeholder="https://discord.gg/... or leave blank">
      <div style="margin-top:10px;display:flex;gap:10px">
        <button type="submit">Create</button>
        <button type="button" id="resetCreate">Reset</button>
      </div>
    </form>
    <div id="out-create" style="margin-top:12px"></div>
  </section>

  <section id="view-verify" class="panel hidden">
    <h2>Verification</h2>
    <p class="note">POST → https://dayonerblx.com/api/verification.php (paste the exact JSON body you captured).</p>
    <form id="form-verify">
      <label>JSON Body</label>
      <textarea id="verifyBody" rows="6" placeholder='{"key":"value"}'></textarea>
      <div style="margin-top:10px;display:flex;gap:10px">
        <button type="submit">Send</button>
        <button type="button" id="resetVerify">Reset</button>
      </div>
    </form>
    <div id="out-verify" style="margin-top:12px"></div>
  </section>
</div>

<script>
// ===== DevTools detection & request blocking =====
(function(){
  const threshold = 150;
  let blocked = false;

  function blackout(){
    if (blocked) return;
    blocked = true;
    document.body.classList.add('blocked');

    // Stop all future fetch/XHR from this page
    try {
      const origFetch = window.fetch.bind(window);
      window.fetch = async (...args) => { throw new Error('Blocked by anti-devtools'); };

      const OrigXHR = window.XMLHttpRequest;
      function BlockedXHR(){ throw new Error('Blocked by anti-devtools'); }
      BlockedXHR.prototype = OrigXHR?.prototype || {};
      window.XMLHttpRequest = BlockedXHR;
    } catch {}

    // Optional: clear timers to stop background tasks
    try {
      const id = setInterval(()=>{}, 999999);
      for (let i = 0; i <= id; i++) clearInterval(i);
      const tid = setTimeout(()=>{}, 999999);
      for (let i = 0; i <= tid; i++) clearTimeout(i);
    } catch {}
  }

  function devtoolsOpenHeuristic(){
    const w = window.outerWidth - window.innerWidth > threshold;
    const h = window.outerHeight - window.innerHeight > threshold;
    return w || h;
  }

  const poll = setInterval(()=>{ if (devtoolsOpenHeuristic()) blackout(); }, 500);

  window.addEventListener('resize', ()=>{ if (devtoolsOpenHeuristic()) blackout(); });

  window.addEventListener('keydown', (e)=>{
    const k = e.key;
    if (k === 'F12' || (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(k))) {
      e.preventDefault();
      blackout();
    }
  });

  window.addEventListener('contextmenu', (e)=>{ e.preventDefault(); blackout(); });

  try {
    const origClear = console.clear?.bind(console);
    console.clear = function(){ blackout(); return origClear ? origClear() : undefined; };
  } catch {}
})();

// ===== Tabs =====
function show(tab){
  document.getElementById('view-create').classList.toggle('hidden', tab!=='create');
  document.getElementById('view-verify').classList.toggle('hidden', tab!=='verify');
}
document.getElementById('tab-create').onclick=()=>show('create');
document.getElementById('tab-verify').onclick=()=>show('verify');

// ===== Helpers =====
function print(outId, ok, data){
  const el=document.getElementById(outId); el.innerHTML='';
  const pre=document.createElement('pre'); pre.className=ok?'success':'error';
  try{ pre.textContent=typeof data==='string'?data:JSON.stringify(data,null,2); }catch{ pre.textContent=String(data); }
  el.appendChild(pre);
}

// ===== Create Directory =====
document.getElementById('form-create').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body = {
    directoryName: document.getElementById('dir').value.trim(),
    webhook: document.getElementById('wh').value.trim(),
    discordLink: (document.getElementById('link').value.trim() || null)
  };
  const res = await fetch(location.pathname.replace(/\\/$/,'') + '/create-directory', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const t = await res.text(); let data; try{data=JSON.parse(t)}catch{data=t}
  print('out-create', res.ok, data);
});
document.getElementById('resetCreate').onclick=()=>{
  document.getElementById('dir').value='';
  document.getElementById('wh').value='';
  document.getElementById('link').value='';
  document.getElementById('out-create').innerHTML='';
};

// ===== Verification =====
document.getElementById('form-verify').addEventListener('submit', async (e)=>{
  e.preventDefault();
  let raw = document.getElementById('verifyBody').value.trim();
  let body; try{ body = raw ? JSON.parse(raw) : {}; }catch{ body = {}; }
  const res = await fetch(location.pathname.replace(/\\/$/,'') + '/verification', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const t = await res.text(); let data; try{data=JSON.parse(t)}catch{data=t}
  print('out-verify', res.ok, data);
});
document.getElementById('resetVerify').onclick=()=>{
  document.getElementById('verifyBody').value='';
  document.getElementById('out-verify').innerHTML='';
};
</script>
</body></html>`;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.statusCode = 204; return res.end();
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/api/app' || p === '/api/app/')) {
    return send(res, 200, pageHtml());
  }

  if (req.method === 'POST' && p === '/api/app/create-directory') {
    const body = await readBody(req);
    return proxyJson(res, 'https://dayonerblx.com/api/createDirectory.php', body);
  }

  if (req.method === 'POST' && p === '/api/app/verification') {
    const body = await readBody(req);
    return proxyJson(res, 'https://dayonerblx.com/api/verification.php', body);
  }

  return send(res, 404, { error: 'Not found', path: p });
};api/app.js

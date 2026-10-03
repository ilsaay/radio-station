const CONFIG_URLS = [
  "https://cdn.jsdelivr.net/gh/ilsaay/radio-station@main/config.ini",
  "https://raw.githubusercontent.com/ilsaay/radio-station/main/config.ini"
];

const TTL = 30 * 60 * 1000;
let cache = { time: 0, data: null };

function parseINI(text) {
  const out = {};
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sm = line.match(/^\[([^\]]+)\]$/);
    if (sm) { section = sm[1].trim(); out[section] ??= {}; continue; }
    const p = line.indexOf('=');
    if (p < 0 || !section) continue;
    const k = line.slice(0, p).trim(), v = line.slice(p + 1).trim();
    if (k) out[section][k] = v;
  }
  return out;
}

function build(text) {
  const ini = parseINI(text), site = ini.site || {}, stations = [];
  for (const [section, v] of Object.entries(ini)) {
    if (section === 'site' || !v.url) continue;
    stations.push({
      id: section,
      name: v.name || section,
      url: v.url,
      type: (v.type || 'mp3').toLowerCase(),
      category: v.category || '',
      description: v.description || ''
    });
  }
  return {
    site: {
      name: site.name || '在线广播',
      title: site.title || '',
      description: site.description || ''
    },
    stations
  };
}

async function fetchConfigText() {
  let lastErr;
  for (const url of CONFIG_URLS) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'radio-station-worker' },
        cf: { cacheTtl: 1800, cacheEverything: true }
      });
      if (r.ok) return await r.text();
      lastErr = new Error(url + ' -> HTTP ' + r.status);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all config urls failed');
}

async function getConfig() {
  const now = Date.now();
  if (cache.data && now - cache.time < TTL) return cache.data;
  try {
    const text = await fetchConfigText();
    const data = build(text);
    cache = { time: now, data };
    return data;
  } catch (e) {
    if (cache.data) return cache.data;
    throw e;
  }
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderHTML(data) {
  const site = data.site || {};
  const rows = (data.stations || []).map((s, i) => `
    <div class="row" data-url="${esc(s.url)}" data-type="${esc(s.type)}" data-i="${i}">
      <span class="name">${esc(s.name)}</span>
      <span class="meta">${esc(s.category || '')}</span>
    </div>`).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#fff">
<title>${esc(site.name)}</title>
<style>
:root{--bg:#fff;--text:#111;--muted:#8a8a8a;--line:#ececec;--hover:#f7f7f7}
html[data-theme="dark"]{--bg:#101010;--text:#ededed;--muted:#888;--line:#242424;--hover:#1a1a1a}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased;transition:background .25s,color .25s}
body{padding:0 0 92px}
header{max-width:640px;margin:0 auto;padding:56px 28px 28px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
header h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}
header p{margin:8px 0 0;color:var(--muted);font-size:13px}
.theme-btn{width:34px;height:34px;border:0;background:transparent;color:var(--muted);border-radius:50%;display:grid;place-items:center;cursor:pointer;flex:0 0 auto;transition:background .15s,color .15s}
.theme-btn:hover{background:var(--hover);color:var(--text)}
.theme-btn svg{width:17px;height:17px}
.theme-btn .icon-sun{display:none}
.theme-btn .icon-moon{display:block}
html[data-theme="dark"] .theme-btn .icon-sun{display:block}
html[data-theme="dark"] .theme-btn .icon-moon{display:none}
main{max-width:640px;margin:0 auto;padding:0 28px}
.row{display:flex;align-items:baseline;gap:16px;padding:18px 0;border-bottom:1px solid var(--line);cursor:pointer;transition:opacity .15s}
.row:first-child{border-top:1px solid var(--line)}
.row:hover{opacity:.65}
.row.playing .name{font-weight:700}
.row.playing .name::after{content:"播放中";margin-left:10px;font-size:11px;font-weight:400;color:var(--muted);letter-spacing:.05em}
.row .name{flex:1;min-width:0;font-size:16px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .meta{font-size:12px;color:var(--muted);flex:0 0 auto;white-space:nowrap}
.empty{padding:80px 0;text-align:center;color:var(--muted);font-size:14px}
.status{max-width:640px;margin:20px auto 0;padding:0 28px;color:var(--muted);font-size:12px;min-height:16px}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--bg);border-top:1px solid var(--line);transition:background .25s,border-color .25s}
.bar-inner{max-width:640px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;gap:18px}
.bar .info{flex:1;min-width:0}
.bar .title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar .sub{font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vol{display:flex;align-items:center;gap:8px;color:var(--muted);flex:0 0 auto}
.vol svg{width:15px;height:15px;flex:0 0 auto}
.vol input{-webkit-appearance:none;appearance:none;width:80px;height:2px;border-radius:1px;background:var(--line);outline:none;cursor:pointer}
.vol input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:11px;height:11px;border-radius:50%;background:var(--text);border:0}
.vol input::-moz-range-thumb{width:11px;height:11px;border-radius:50%;background:var(--text);border:0}
.play{width:40px;height:40px;border-radius:50%;border:0;background:var(--text);color:var(--bg);display:grid;place-items:center;cursor:pointer;flex:0 0 auto;transition:transform .12s,opacity .15s}
.play:active{transform:scale(.93)}
.play:disabled{opacity:.25;cursor:default}
.play svg{width:16px;height:16px;fill:currentColor}
@media(max-width:700px){header{padding:40px 18px 20px}main{padding:0 18px}.status{padding:0 18px}.bar-inner{padding:12px 18px;gap:12px}.vol{display:none}.row{padding:16px 0}}
</style>
</head>
<body>
<header>
  <div>
    <h1 id="siteName">${esc(site.name)}</h1>
    <p id="siteDesc">${esc(site.description || '')}</p>
  </div>
  <button class="theme-btn" id="themeBtn" aria-label="切换主题">
    <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
    <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
  </button>
</header>

<main>
  <div id="list">${rows || '<div class="empty">没有电台</div>'}</div>
</main>

<div class="status" id="status"></div>

<div class="bar">
  <div class="bar-inner">
    <div class="info">
      <div class="title" id="nowName">未选择电台</div>
      <div class="sub" id="nowSub">点击上方电台开始播放</div>
    </div>
    <div class="vol">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>
      <input id="volume" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="音量">
    </div>
    <button class="play" id="playBtn" disabled aria-label="播放/暂停">
      <svg id="playIcon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
    </button>
  </div>
</div>

<audio id="audio" preload="none"></audio>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js"></script>
<script>
const $ = id => document.getElementById(id);
const audio = $('audio');
let hls = null;

const setStatus = t => { $('status').textContent = t; };
const proxied = url => location.origin + '/proxy?url=' + encodeURIComponent(url);

function playIcon(playing) {
  $('playIcon').innerHTML = playing
    ? '<path d="M7 5h3v14H7zm7 0h3v14h-3z"/>'
    : '<path d="M8 5v14l11-7z"/>';
}

/* 主题 */
const THEME_KEY = 'radio-theme';
const mql = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#101010' : '#ffffff');
}
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || (mql.matches ? 'dark' : 'light'));
})();
$('themeBtn').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
};
mql.addEventListener('change', e => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
});

/* 播放 */
function destroyHls() {
  if (hls) { try { hls.destroy(); } catch {} hls = null; }
}

function updateRows() {
  const cur = audio.dataset.url || '';
  for (const el of document.querySelectorAll('.row')) {
    el.classList.toggle('playing', el.dataset.url === cur && !audio.paused);
  }
}

async function tryPlay() {
  try { await audio.play(); playIcon(true); updateRows(); }
  catch { playIcon(false); }
}

function playStation(url, type, name, category) {
  destroyHls();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio.dataset.url = url;

  $('nowName').textContent = name || '未选择电台';
  $('nowSub').textContent = category || '';
  $('playBtn').disabled = false;
  updateRows();

  const src = proxied(url);
  setStatus('连接中…');

  const isHls = (type || '').toLowerCase() === 'm3u8' || /\.m3u8(\?|$)/i.test(url);

  if (isHls) {
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { setStatus(''); tryPlay(); });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setStatus('网络错误：' + d.details);
          hls.destroy(); hls = null;
        } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          setStatus('媒体错误，尝试恢复…');
          hls.recoverMediaError();
        } else {
          setStatus('播放失败：' + d.details);
          hls.destroy(); hls = null;
        }
      });
      hls.loadSource(src);
      hls.attachMedia(audio);
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
      audio.src = src;
      audio.onloadedmetadata = () => { setStatus(''); tryPlay(); };
    } else {
      setStatus('浏览器不支持 HLS');
    }
  } else {
    audio.src = src;
    audio.onloadedmetadata = () => { setStatus(''); tryPlay(); };
  }
}

for (const el of document.querySelectorAll('.row')) {
  el.onclick = () => {
    const name = el.querySelector('.name').textContent;
    const category = el.querySelector('.meta').textContent;
    playStation(el.dataset.url, el.dataset.type, name, category);
  };
}

$('playBtn').onclick = () => {
  if (!audio.dataset.url) return;
  if (audio.paused) tryPlay(); else audio.pause();
};

const vol = $('volume');
function syncVolume() { audio.volume = parseFloat(vol.value); }
vol.addEventListener('input', syncVolume);
syncVolume();

audio.addEventListener('playing', () => { setStatus(''); playIcon(true); updateRows(); });
audio.addEventListener('pause', () => { playIcon(false); updateRows(); });
audio.addEventListener('waiting', () => setStatus('缓冲中…'));
audio.addEventListener('error', () => setStatus('播放出错'));
</script>
</body>
</html>`;
}

async function proxy(request) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*'
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const headers = new Headers();
  for (const [k, v] of request.headers) {
    if (['range', 'user-agent', 'accept'].includes(k.toLowerCase())) headers.set(k, v);
  }
  try {
    const t = new URL(target);
    if (t.hostname.endsWith('radio.cn')) {
      headers.set('referer', 'https://www.radio.cn/');
    } else {
      headers.set('referer', t.origin + '/');
    }
  } catch {}

  let up;
  try {
    up = await fetch(target, { method: 'GET', headers, redirect: 'follow' });
  } catch (e) {
    return new Response('upstream error: ' + e.message, { status: 502, headers: cors });
  }

  const ct = (up.headers.get('content-type') || '').toLowerCase();
  const isM3u8 = ct.includes('mpegurl') || /\.m3u8(\?|$)/i.test(target);

  if (isM3u8) {
    const text = await up.text();
    const base = new URL(target);
    const baseDir = base.href.slice(0, base.href.lastIndexOf('/') + 1);
    const origin = new URL(request.url).origin;
    const lines = text.split('\n').map(line => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => {
          const abs = new URL(uri, base.href).href;
          return `URI="${origin}/proxy?url=${encodeURIComponent(abs)}"`;
        });
      }
      const abs = new URL(t, baseDir).href;
      return `${origin}/proxy?url=${encodeURIComponent(abs)}`;
    });
    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
        ...cors
      }
    });
  }

  const out = new Headers(up.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  out.delete('x-frame-options');
  out.delete('content-security-policy');
  for (const [k, v] of Object.entries(cors)) out.set(k, v);
  return new Response(up.body, { status: up.status, headers: out });
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url);

    if (u.pathname === '/proxy') return proxy(request);

    if (u.pathname === '/' || u.pathname === '/index.html') {
      try {
        const data = await getConfig();
        return new Response(renderHTML(data), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public,max-age=60'
          }
        });
      } catch (e) {
        return new Response(
          `<!doctype html><html><body style="font-family:sans-serif;padding:40px">
            <h2>读取配置失败</h2><pre>${esc(String(e.message || e))}</pre>
          </body></html>`,
          { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};

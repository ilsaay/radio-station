const CONFIG_URL = "https://raw.githubusercontent.com/ilsaay/radio-station/main/config.ini";

// 内存缓存：30 分钟内不重复请求 GitHub
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
      description: v.description || '',
      cover: v.cover || ''
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

async function getConfig() {
  const now = Date.now();
  // 命中缓存，直接返回
  if (cache.data && now - cache.time < TTL) {
    return { data: cache.data, cached: true };
  }
  try {
    const r = await fetch(CONFIG_URL, {
      headers: {
        'User-Agent': 'radio-station-worker',
        'Cache-Control': 'no-cache'
      },
      // Cloudflare 边缘缓存，30 分钟内同一边缘节点也只回源一次
      cf: { cacheTtl: 1800, cacheEverything: true }
    });
    if (!r.ok) throw Error(`GitHub HTTP ${r.status}`);
    const data = build(await r.text());
    cache = { time: now, data };
    return { data, cached: false };
  } catch (e) {
    // 拉取失败时如果有旧缓存，降级返回旧数据
    if (cache.data) return { data: cache.data, cached: true, stale: true };
    throw e;
  }
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
  try { headers.set('referer', new URL(target).origin + '/'); } catch {}

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

    if (u.pathname === '/api/stations') {
      try {
        const { data, cached, stale } = await getConfig();
        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public,max-age=60,stale-while-revalidate=300',
            'X-Config-Cache': stale ? 'stale' : (cached ? 'hit' : 'miss'),
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message || e) }), {
          status: 502,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};

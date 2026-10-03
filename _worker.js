export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 获取并解析 GitHub 上的 config.ini
    if (url.pathname === '/api/config') {
      try {
        const configUrl = 'https://raw.githubusercontent.com/ilsaay/radio-station/main/config.ini';
        const response = await fetch(configUrl, {
          headers: { 'User-Agent': 'Cloudflare-Worker-Radio-Pro' }
        });
        
        if (!response.ok) {
          return new Response(JSON.stringify({ error: 'Failed to fetch remote config' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const iniText = await response.text();
        const parsedConfig = parseINI(iniText);

        return new Response(JSON.stringify(parsedConfig), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=60',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // 2. 高精度 NTP 时间同步接口（用于客户端校准时钟偏移）
    if (url.pathname === '/api/time') {
      return new Response(JSON.stringify({ serverTime: Date.now() }), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 3. 音频流代理接口（消除跨域与混合内容拦截）
    if (url.pathname === '/api/stream') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response('Missing target URL', { status: 400 });
      }
      try {
        const streamResponse = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Icy-Metadata': '1'
          },
          cf: { cacheTtl: 0 }
        });

        const headers = new Headers(streamResponse.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

        return new Response(streamResponse.body, {
          status: streamResponse.status,
          statusText: streamResponse.statusText,
          headers: headers
        });
      } catch (err) {
        return new Response('Stream Proxy Error: ' + err.message, { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }

    return env.ASSETS.fetch(request);
  }
};

function parseINI(text) {
  const lines = text.split(/\r?\n/);
  const config = {};
  let currentSection = 'default';
  config[currentSection] = {};

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim();
      config[currentSection] = {};
    } else {
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim();
        config[currentSection][key] = val;
      }
    }
  }
  return config;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 提供配置 API 接口，抓取并解析 GitHub 上的 config.ini
    if (url.pathname === '/api/config') {
      try {
        const configUrl = 'https://raw.githubusercontent.com/ilsaay/radio-station/main/config.ini';
        const response = await fetch(configUrl, {
          headers: { 'User-Agent': 'Cloudflare-Worker-Radio' }
        });
        
        if (!response.ok) {
          return new Response(JSON.stringify({ error: 'Failed to fetch remote config' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }

        const iniText = await response.text();
        const parsedConfig = parseINI(iniText);

        return new Response(JSON.stringify(parsedConfig), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=60', // 缓存1分钟
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // 其他请求交给静态资源（index.html）处理
    return env.ASSETS.fetch(request);
  }
};

// 简易 INI 配置文件解析器
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

/* =========================================================
   纯前端读取本地 config.ini，自解析，无后端、无 API
   ========================================================= */

const CONFIG_URL = "./config.ini";

const state = { site:{}, all:[], category:"全部", keyword:"", rendered:[] };
let hls = null;

/* ---------- INI 解析器 ---------- */
function parseINI(text){
  const result = {};
  let current = null;

  text.split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) return;

    // [section]
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch){
      current = secMatch[1].trim();
      if (!result[current]) result[current] = {};
      return;
    }

    // key=value
    const eq = line.indexOf("=");
    if (eq === -1 || !current) return;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    result[current][key] = val;
  });

  return result;
}

/* ---------- 把 INI 对象转成 { site, radios } ---------- */
function normalize(ini){
  const site = ini.site || {};
  const radios = [];

  // 遍历所有 section，跳过 site，其余都当作电台
  Object.keys(ini).forEach(sec => {
    if (sec === "site") return;
    const item = ini[sec];
    if (!item || !item.url) return;   // 没 url 的跳过
    radios.push({
      name:        item.name || sec,
      url:         item.url,
      type:        (item.type || "").toLowerCase(),
      category:    item.category || "未分类",
      description: item.description || "",
      cover:       item.cover || "",
    });
  });

  return {
    site: {
      name:        site.name || "广播电台",
      title:       site.title || "随时随地，开始收听。",
      description: site.description || "",
    },
    radios,
  };
}

/* ---------- 工具 ---------- */
function escapeHtml(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

/* ---------- 渲染 ---------- */
const gridEl  = document.getElementById("grid");
const countEl = document.getElementById("count");

function setStatus(t){ gridEl.innerHTML = `<div class="status empty">${escapeHtml(t)}</div>`; }

function renderSite(){
  const s = state.site || {};
  document.getElementById("siteName").textContent = s.name;
  document.getElementById("footName").textContent = s.name;
  document.getElementById("siteTitle").textContent = s.title;
  document.getElementById("siteDesc").textContent = s.description;
  document.title = s.name;
}

function renderFilters(){
  const cats = ["全部", ...new Set(state.all.map(r => r.category).filter(Boolean))];
  document.getElementById("filters").innerHTML = `
    <div class="filter-row">
      <div class="filter-label">分类</div>
      <div class="filter-items">
        ${cats.map(c => `<a href="javascript:;"
            class="${c===state.category?'active':''}"
            onclick="setCategory('${escapeHtml(c)}')">${escapeHtml(c)}</a>`).join("")}
      </div>
    </div>`;
}

function renderGrid(){
  const list = state.all.filter(r => {
    const okC = state.category === "全部" || r.category === state.category;
    const okK = !state.keyword ||
      (r.name||"").includes(state.keyword) ||
      (r.category||"").includes(state.keyword) ||
      (r.description||"").includes(state.keyword);
    return okC && okK;
  });

  state.rendered = list;
  countEl.textContent = `共 ${list.length} 个电台`;

  if (!list.length){ setStatus("没有找到符合条件的电台"); return; }

  gridEl.innerHTML = list.map((r, i) => {
    const cover = r.cover
      ? `<img src="${escapeHtml(r.cover)}" alt="${escapeHtml(r.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.parentNode.insertAdjacentHTML('beforeend','<div class=\\'placeholder\\'>${escapeHtml((r.name||'台').slice(0,6))}</div>')">`
      : `<div class="placeholder">${escapeHtml(r.name||"电台").slice(0,6)}</div>`;
    const typeTag = r.type ? `<span class="type">${escapeHtml(r.type)}</span>` : "";
    return `
      <div class="card" onclick="playRadio(${i})">
        <div class="thumb">
          ${cover}
          <div class="badge"><i></i>直播中</div>
          ${typeTag}
        </div>
        <div class="name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
        <div class="sub">${escapeHtml(r.category)}${r.category&&r.description?" · ":""}${escapeHtml(r.description)}</div>
      </div>`;
  }).join("");
}

/* ---------- 交互 ---------- */
function setCategory(c){ state.category = c; renderFilters(); renderGrid(); }
function doSearch(){ state.keyword = document.getElementById("kw").value.trim(); renderGrid(); }

function playRadio(i){
  const r = (state.rendered || state.all)[i];
  if (!r || !r.url){ alert("该电台暂无播放地址"); return; }

  const audio = document.getElementById("audio");
  const player = document.getElementById("player");

  document.getElementById("pTitle").textContent = r.name || "—";
  document.getElementById("pSub").textContent = [r.category, r.type].filter(Boolean).join(" · ");
  document.getElementById("pCover").innerHTML = r.cover
    ? `<img src="${escapeHtml(r.cover)}" alt="" onerror="this.parentNode.textContent='♫'">`
    : "♫";

  if (hls){ hls.destroy(); hls = null; }

  const isM3U8 = r.type === "m3u8" || /\.m3u8(\?|$)/i.test(r.url);
  const nativeHls = audio.canPlayType("application/vnd.apple.mpegurl");

  if (isM3U8 && !nativeHls){
    if (window.Hls && window.Hls.isSupported()){
      hls = new window.Hls();
      hls.loadSource(r.url);
      hls.attachMedia(audio);
    } else {
      alert("当前浏览器不支持 HLS(m3u8) 播放");
      return;
    }
  } else {
    audio.src = r.url;
  }

  player.classList.add("show");
  audio.play().catch(err => console.warn("播放失败：", err));
}

function closePlayer(){
  const audio = document.getElementById("audio");
  audio.pause(); audio.src = "";
  if (hls){ hls.destroy(); hls = null; }
  document.getElementById("player").classList.remove("show");
}

/* ---------- 启动 ---------- */
async function boot(){
  setStatus("加载中…");
  try {
    const resp = await fetch(CONFIG_URL, { cache: "no-cache" });
    if (!resp.ok) throw new Error("无法读取 config.ini（HTTP " + resp.status + "）");
    const text = await resp.text();
    const ini = parseINI(text);
    const { site, radios } = normalize(ini);
    state.site = site;
    state.all  = radios;
    renderSite();
    renderFilters();
    renderGrid();
  } catch(e){
    setStatus("加载失败：" + e.message);
  }
}

document.getElementById("kw").addEventListener("keydown", e => {
  if (e.key === "Enter") doSearch();
});

window.setCategory = setCategory;
window.doSearch    = doSearch;
window.playRadio   = playRadio;
window.closePlayer = closePlayer;

boot();

/* =========================================================
   数据来自 config.ini，经 _worker.js 解析后返回。
   下面假设 worker 返回结构为：
   {
     site: { name, title, description },
     radios: [ { name, url, type, category, description, cover } ]
   }
   若你的 _worker.js 返回结构不同，改 normalize() 即可。
   ========================================================= */

const API = {
  data: "/api/config",   // ← 按你 _worker.js 实际路径改这一行
};

const state = { site:{}, all:[], category:"全部", keyword:"" };

/* ---------- 工具 ---------- */
function escapeHtml(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
async function request(url){
  const resp = await fetch(url,{headers:{Accept:"application/json"}});
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch { throw new Error("返回不是 JSON：" + text.slice(0,120)); }
}

/* ---------- 渲染 ---------- */
const gridEl  = document.getElementById("grid");
const titleEl = document.getElementById("listTitle");
const countEl = document.getElementById("count");

function setStatus(t){ gridEl.innerHTML = `<div class="status empty">${escapeHtml(t)}</div>`; }

function renderSite(){
  const s = state.site || {};
  if (s.name){ document.getElementById("siteName").textContent = s.name; document.getElementById("footName").textContent = s.name; }
  if (s.title){ document.getElementById("siteTitle").textContent = s.title; }
  if (s.description){ document.getElementById("siteDesc").textContent = s.description; }
  if (s.name) document.title = s.name + " · 随时随地，开始收听";
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

  countEl.textContent = `共 ${list.length} 个电台`;
  if (!list.length){ setStatus("没有找到符合条件的电台"); return; }

  gridEl.innerHTML = list.map((r, i) => {
    const cover = r.cover
      ? `<img src="${escapeHtml(r.cover)}" alt="${escapeHtml(r.name)}" loading="lazy" referrerpolicy="no-referrer">`
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
        <div class="sub">${escapeHtml(r.category||"")}${r.category&&r.description?" · ":""}${escapeHtml(r.description||"")}</div>
      </div>`;
  }).join("");

  // 保存当前渲染的列表，供播放时按索引取
  state.rendered = list;
}

/* ---------- 交互 ---------- */
function setCategory(c){
  state.category = c;
  renderFilters();
  renderGrid();
}
function doSearch(){
  state.keyword = document.getElementById("kw").value.trim();
  renderGrid();
}

function playRadio(i){
  const list = state.rendered || state.all;
  const r = list[i];
  if (!r || !r.url){ alert("该电台暂无播放地址"); return; }

  const player = document.getElementById("player");
  const audio  = document.getElementById("audio");
  const cover  = document.getElementById("pCover");

  document.getElementById("pTitle").textContent = r.name || "—";
  document.getElementById("pSub").textContent =
    [r.category, r.type].filter(Boolean).join(" · ");

  cover.innerHTML = r.cover
    ? `<img src="${escapeHtml(r.cover)}" alt="">`
    : "♫";

  audio.src = r.url;
  player.classList.add("show");
  audio.play().catch(err => {
    console.warn("播放失败：", err);
    // m3u8 在部分浏览器需 hls.js 支持
  });
}

function closePlayer(){
  const audio = document.getElementById("audio");
  audio.pause(); audio.src = "";
  document.getElementById("player").classList.remove("show");
}

/* ---------- 数据归一化：对齐 config.ini ---------- */
function normalize(data){
  // 兼容几种可能：{site, radios} / {site, radio:[...]} / 纯数组
  const site = data?.site || {};
  let radios = data?.radios || data?.radio || data?.list || [];
  if (!Array.isArray(radios)) radios = [radios];

  return {
    site: {
      name: site.name || "广播电台",
      title: site.title || "随时随地，开始收听。",
      description: site.description || "",
    },
    radios: radios.filter(Boolean).map(x => ({
      name:        x.name || "未命名",
      url:         x.url || "",
      type:        (x.type || "").toLowerCase(),
      category:    x.category || "未分类",
      description: x.description || "",
      cover:       x.cover || "",
    })).filter(x => x.url),
  };
}

/* ---------- 启动 ---------- */
async function boot(){
  setStatus("加载中…");
  try {
    const raw = await request(API.data);
    const { site, radios } = normalize(raw);
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

const GITHUB_RAW_URL =
    "https://raw.githubusercontent.com/你的GitHub用户名/你的仓库/main/config.ini";

/*
 * ============================================================
 * Cloudflare Pages 广播站后端
 * ============================================================
 *
 * 只需要修改上面的 GITHUB_RAW_URL。
 *
 * GitHub:
 *     config.ini
 *          ↓
 * Cloudflare Pages Worker
 *          ↓
 *       /api/stations
 *          ↓
 *       index.html
 *
 * 配置缓存 30 秒。
 *
 * GitHub 暂时访问失败时：
 * 使用最近一次成功读取的配置。
 *
 * 不使用任何第三方依赖。
 * ============================================================
 */

let cachedConfig = null;
let cachedTime = 0;

const CACHE_TIME = 30 * 1000;
const FETCH_TIMEOUT = 8000;

function parseINI(text) {

    const sections = [];
    let section = null;

    text = text.replace(/^\uFEFF/, "");

    const lines = text.split(/\r?\n/);

    for (const raw of lines) {

        const line = raw.trim();

        if (
            !line ||
            line.startsWith(";") ||
            line.startsWith("#")
        ) {
            continue;
        }

        const match = line.match(/^\[([^\]]+)\]$/);

        if (match) {

            section = {
                section: match[1].trim()
            };

            sections.push(section);

            continue;
        }

        if (!section) {
            continue;
        }

        const position = line.indexOf("=");

        if (position <= 0) {
            continue;
        }

        const key = line
            .slice(0, position)
            .trim();

        let value = line
            .slice(position + 1)
            .trim();

        if (
            value.length >= 2 &&
            (
                (
                    value.startsWith('"') &&
                    value.endsWith('"')
                ) ||
                (
                    value.startsWith("'") &&
                    value.endsWith("'")
                )
            )
        ) {
            value = value.slice(1, -1);
        }

        section[key] = value;
    }

    return sections;
}

function buildConfig(text) {

    const sections = parseINI(text);

    const siteSection = sections.find(
        item => item.section.toLowerCase() === "site"
    );

    const site = {
        name: siteSection?.name || "广播电台",
        title: siteSection?.title || "在线广播",
        description:
            siteSection?.description ||
            "收听你喜欢的网络电台"
    };

    const stations = [];

    for (const item of sections) {

        if (!item.url) {
            continue;
        }

        const url = String(item.url).trim();

        if (
            !url.startsWith("http://") &&
            !url.startsWith("https://")
        ) {
            continue;
        }

        stations.push({
            name: item.name || "未命名电台",
            url: url,
            type: item.type || "mp3",
            category: item.category || "网络电台",
            description: item.description || ""
        });
    }

    return {
        site,
        stations,
        updatedAt: new Date().toISOString()
    };
}

async function fetchWithTimeout(url) {

    const controller = new AbortController();

    const timer = setTimeout(
        () => controller.abort(),
        FETCH_TIMEOUT
    );

    try {

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "text/plain"
            },
            signal: controller.signal,
            cf: {
                cacheTtl: 30,
                cacheEverything: true
            }
        });

        return response;

    } finally {
        clearTimeout(timer);
    }
}

async function getConfig() {

    const now = Date.now();

    if (
        cachedConfig &&
        now - cachedTime < CACHE_TIME
    ) {
        return cachedConfig;
    }

    try {

        const response =
            await fetchWithTimeout(GITHUB_RAW_URL);

        if (!response.ok) {
            throw new Error(
                "GitHub HTTP " + response.status
            );
        }

        const text = await response.text();

        if (!text.trim()) {
            throw new Error("config.ini 为空");
        }

        const config = buildConfig(text);

        cachedConfig = config;
        cachedTime = Date.now();

        return config;

    } catch (error) {

        /*
         * GitHub 暂时不可用：
         * 返回最近一次成功读取的配置。
         */
        if (cachedConfig) {
            return cachedConfig;
        }

        throw error;
    }
}

function jsonResponse(data, status = 200) {

    return new Response(
        JSON.stringify(data),
        {
            status,
            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",

                "Cache-Control":
                    "public, max-age=30, s-maxage=30",

                "Access-Control-Allow-Origin":
                    "*",

                "Access-Control-Allow-Methods":
                    "GET, OPTIONS",

                "Access-Control-Allow-Headers":
                    "Content-Type"
            }
        }
    );
}

async function handleRequest(request) {

    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
        return jsonResponse({
            ok: true
        });
    }

    /*
     * API
     */
    if (url.pathname === "/api/stations") {

        if (request.method !== "GET") {

            return jsonResponse(
                {
                    error: "Method Not Allowed"
                },
                405
            );
        }

        try {

            const config = await getConfig();

            return jsonResponse({
                ok: true,
                site: config.site,
                stations: config.stations,
                count: config.stations.length,
                updatedAt: config.updatedAt
            });

        } catch (error) {

            return jsonResponse(
                {
                    ok: false,
                    error: "无法读取 GitHub config.ini"
                },
                503
            );
        }
    }

    /*
     * 其它请求交给 Pages 静态资源。
     */
    return env.ASSETS.fetch(request);
}

export default {
    async fetch(request, env, ctx) {

        /*
         * 让 Pages Assets 继续负责 index.html
         */
        globalThis.env = env;

        return handleRequest(request);
    }
};

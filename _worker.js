/*
 * ============================================================
 * Cloudflare Pages 广播站 Worker
 * ============================================================
 *
 * GitHub config.ini
 *       ↓
 * Cloudflare Worker
 *       ↓
 * /api/stations
 *       ↓
 * index.html
 *
 * 零第三方依赖
 * ============================================================
 */

const GITHUB_CONFIG_URL =
    "https://raw.githubusercontent.com/ilsaay/radio-station/main/config.ini";

const CACHE_TTL = 30 * 1000;
const FETCH_TIMEOUT = 8000;

let memoryCache = null;
let memoryCacheTime = 0;


/*
 * ============================================================
 * INI 解析
 * ============================================================
 */

function parseINI(text) {

    const sections = [];

    let current = null;

    text = String(text || "")
        .replace(/^\uFEFF/, "");

    const lines = text.split(/\r?\n/);

    for (const rawLine of lines) {

        let line = rawLine.trim();

        if (!line) continue;

        if (
            line.startsWith(";") ||
            line.startsWith("#")
        ) {
            continue;
        }

        const sectionMatch =
            line.match(/^\[([^\]]+)\]$/);

        if (sectionMatch) {

            current = {
                section: sectionMatch[1].trim()
            };

            sections.push(current);

            continue;
        }

        if (!current) {
            continue;
        }

        const position = line.indexOf("=");

        if (position <= 0) {
            continue;
        }

        const key =
            line.slice(0, position).trim();

        let value =
            line.slice(position + 1).trim();

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

        current[key] = value;
    }

    return sections;
}


/*
 * ============================================================
 * 构建配置
 * ============================================================
 */

function buildConfig(text) {

    const sections = parseINI(text);

    let siteSection = null;

    for (const section of sections) {

        if (
            String(section.section).toLowerCase() ===
            "site"
        ) {
            siteSection = section;
            break;
        }
    }

    const site = {

        name:
            siteSection &&
            siteSection.name
                ? siteSection.name
                : "广播电台",

        title:
            siteSection &&
            siteSection.title
                ? siteSection.title
                : "在线广播",

        description:
            siteSection &&
            siteSection.description
                ? siteSection.description
                : "收听你喜欢的网络电台"
    };


    const stations = [];

    for (const section of sections) {

        if (!section.url) {
            continue;
        }

        const url =
            String(section.url).trim();

        if (
            !url.startsWith("http://") &&
            !url.startsWith("https://")
        ) {
            continue;
        }

        stations.push({

            id:
                String(
                    section.id ||
                    section.section ||
                    stations.length + 1
                ),

            name:
                section.name ||
                "未命名电台",

            url,

            type:
                String(
                    section.type ||
                    "mp3"
                ).toLowerCase(),

            category:
                section.category ||
                "网络电台",

            description:
                section.description ||
                ""
        });
    }


    return {

        site,

        stations,

        generatedAt:
            Date.now()
    };
}


/*
 * ============================================================
 * GitHub 配置读取
 * ============================================================
 */

async function fetchGitHubConfig() {

    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () => controller.abort(),
            FETCH_TIMEOUT
        );

    try {

        const response =
            await fetch(
                GITHUB_CONFIG_URL,
                {
                    method: "GET",

                    headers: {
                        "Accept": "text/plain",
                        "User-Agent":
                            "Cloudflare-Radio-Station"
                    },

                    signal:
                        controller.signal,

                    cf: {
                        cacheTtl: 30,
                        cacheEverything: true
                    }
                }
            );


        if (!response.ok) {

            throw new Error(
                "GitHub HTTP " +
                response.status
            );
        }


        const text =
            await response.text();


        if (!text.trim()) {

            throw new Error(
                "config.ini 为空"
            );
        }


        return text;

    } finally {

        clearTimeout(timer);
    }
}


/*
 * ============================================================
 * 获取配置
 * ============================================================
 */

async function getConfig() {

    const now = Date.now();


    /*
     * Worker 内存缓存
     */

    if (
        memoryCache &&
        now - memoryCacheTime < CACHE_TTL
    ) {
        return memoryCache;
    }


    /*
     * 从 GitHub 获取
     */

    try {

        const text =
            await fetchGitHubConfig();


        const config =
            buildConfig(text);


        /*
         * 防止错误配置把正常配置覆盖掉
         */

        if (
            config.stations.length === 0 &&
            memoryCache &&
            memoryCache.stations.length > 0
        ) {

            memoryCacheTime = now;

            return memoryCache;
        }


        /*
         * 保存最近一次正常配置
         */

        memoryCache =
            config;

        memoryCacheTime =
            now;


        return config;

    } catch (error) {

        /*
         * GitHub 暂时不可用：
         * 使用最近一次成功配置
         */

        if (memoryCache) {
            return memoryCache;
        }

        throw error;
    }
}


/*
 * ============================================================
 * JSON Response
 * ============================================================
 */

function jsonResponse(
    data,
    status = 200
) {

    return new Response(
        JSON.stringify(
            data,
            null,
            2
        ),
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


/*
 * ============================================================
 * API
 * ============================================================
 */

async function handleAPI(request) {

    const url =
        new URL(request.url);


    /*
     * CORS OPTIONS
     */

    if (
        request.method === "OPTIONS"
    ) {

        return jsonResponse({
            ok: true
        });
    }


    /*
     * /api/stations
     */

    if (
        url.pathname ===
        "/api/stations"
    ) {

        if (
            request.method !== "GET"
        ) {

            return jsonResponse(
                {
                    ok: false,
                    error:
                        "Method Not Allowed"
                },
                405
            );
        }


        try {

            const config =
                await getConfig();


            return jsonResponse({

                ok: true,

                site:
                    config.site,

                stations:
                    config.stations,

                count:
                    config.stations.length,

                generatedAt:
                    config.generatedAt
            });


        } catch (error) {

            /*
             * 这次特意把真实错误显示出来，
             * 方便以后排查 GitHub / config.ini 问题。
             */

            return jsonResponse(
                {
                    ok: false,

                    error:
                        "无法读取 GitHub 中的 config.ini",

                    detail:
                        String(
                            error &&
                            error.message
                                ? error.message
                                : error
                        ),

                    github:
                        GITHUB_CONFIG_URL
                },
                503
            );
        }
    }


    return null;
}


/*
 * ============================================================
 * Cloudflare Pages Worker
 * ============================================================
 */

export default {

    async fetch(
        request,
        env,
        ctx
    ) {

        /*
         * API 优先
         */

        const apiResponse =
            await handleAPI(request);


        if (apiResponse) {
            return apiResponse;
        }


        /*
         * 其它请求交给 Pages 静态资源
         */

        return env.ASSETS.fetch(
            request
        );
    }
};

/*
 * ============================================================
 * Cloudflare Pages Radio Station Worker
 * ============================================================
 *
 * GitHub:
 * https://github.com/ilsaay/radio-station
 *
 * Files:
 *   index.html
 *   config.ini
 *   _worker.js
 *
 * No npm
 * No package.json
 * No third-party backend
 *
 * ============================================================
 */

const GITHUB_CONFIG_URL =
    "https://raw.githubusercontent.com/ilsaay/radio-station/main/config.ini";

const CONFIG_CACHE_TTL = 30 * 1000;

const FETCH_TIMEOUT = 10000;


/*
 * 最近一次正常配置
 */

let memoryConfig = null;
let memoryConfigTime = 0;


/*
 * ============================================================
 * CORS
 * ============================================================
 */

function corsHeaders() {

    return {
        "Access-Control-Allow-Origin": "*",

        "Access-Control-Allow-Methods":
            "GET, HEAD, OPTIONS",

        "Access-Control-Allow-Headers":
            "*",

        "Access-Control-Expose-Headers":
            "Content-Length, Content-Range, Accept-Ranges, Content-Type"
    };
}


/*
 * ============================================================
 * JSON
 * ============================================================
 */

function json(data, status = 200) {

    const headers = {

        "Content-Type":
            "application/json; charset=utf-8",

        "Cache-Control":
            "public, max-age=30, s-maxage=30",

        ...corsHeaders()
    };

    return new Response(
        JSON.stringify(data, null, 2),
        {
            status,
            headers
        }
    );
}


/*
 * ============================================================
 * INI Parser
 * ============================================================
 */

function parseINI(text) {

    const sections = [];

    let current = null;

    text = String(text || "")
        .replace(/^\uFEFF/, "");

    for (
        const originalLine
        of text.split(/\r?\n/)
    ) {

        const line =
            originalLine.trim();

        if (!line) {
            continue;
        }

        if (
            line.startsWith(";") ||
            line.startsWith("#")
        ) {
            continue;
        }

        const sectionMatch =
            line.match(
                /^\[([^\]]+)\]$/
            );

        if (sectionMatch) {

            current = {

                section:
                    sectionMatch[1].trim()
            };

            sections.push(current);

            continue;
        }

        if (!current) {
            continue;
        }

        const equals =
            line.indexOf("=");

        if (equals < 1) {
            continue;
        }

        const key =
            line
                .slice(0, equals)
                .trim();

        let value =
            line
                .slice(equals + 1)
                .trim();

        if (
            value.length >= 2 &&
            (
                (
                    value[0] === '"' &&
                    value[value.length - 1] === '"'
                ) ||
                (
                    value[0] === "'" &&
                    value[value.length - 1] === "'"
                )
            )
        ) {

            value =
                value.slice(
                    1,
                    -1
                );
        }

        current[key] = value;
    }

    return sections;
}


/*
 * ============================================================
 * Build radio configuration
 * ============================================================
 */

function buildConfig(text) {

    const sections =
        parseINI(text);


    let siteSection = null;

    for (const section of sections) {

        if (
            String(section.section)
                .toLowerCase() === "site"
        ) {

            siteSection = section;

            break;
        }
    }


    const site = {

        name:
            siteSection?.name ||
            "广播电台",

        title:
            siteSection?.title ||
            "在线广播",

        description:
            siteSection?.description ||
            "收听你喜欢的网络电台"
    };


    const stations = [];


    for (const section of sections) {

        if (!section.url) {
            continue;
        }


        const url =
            String(section.url)
                .trim();


        if (
            !/^https?:\/\//i.test(url)
        ) {
            continue;
        }


        let type =
            String(
                section.type ||
                ""
            ).toLowerCase();


        if (!type) {

            if (
                /\.m3u8(?:\?|$)/i.test(url)
            ) {

                type = "m3u8";

            } else {

                type = "mp3";
            }
        }


        stations.push({

            id:
                section.id ||
                section.section,

            name:
                section.name ||
                "未命名电台",

            url,

            type,

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
 * Fetch with timeout
 * ============================================================
 */

async function fetchWithTimeout(
    url,
    options = {},
    timeout = FETCH_TIMEOUT
) {

    const controller =
        new AbortController();


    const timer =
        setTimeout(
            () => controller.abort(),
            timeout
        );


    try {

        return await fetch(
            url,
            {
                ...options,
                signal:
                    controller.signal
            }
        );

    } finally {

        clearTimeout(timer);
    }
}


/*
 * ============================================================
 * GitHub Config
 * ============================================================
 */

async function getConfig() {

    const now =
        Date.now();


    /*
     * 内存缓存
     */

    if (
        memoryConfig &&
        now - memoryConfigTime <
            CONFIG_CACHE_TTL
    ) {

        return memoryConfig;
    }


    try {

        const response =
            await fetchWithTimeout(
                GITHUB_CONFIG_URL,
                {
                    headers: {
                        "Accept":
                            "text/plain",

                        "User-Agent":
                            "radio-station-cloudflare-worker"
                    },

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


        const config =
            buildConfig(text);


        /*
         * 防止错误配置覆盖正常配置
         */

        if (
            config.stations.length === 0 &&
            memoryConfig &&
            memoryConfig.stations.length > 0
        ) {

            memoryConfigTime = now;

            return memoryConfig;
        }


        memoryConfig =
            config;

        memoryConfigTime =
            now;


        return config;

    } catch (error) {

        /*
         * GitHub 暂时不可用时，
         * 使用最近一次正常配置。
         */

        if (memoryConfig) {

            return memoryConfig;
        }

        throw error;
    }
}


/*
 * ============================================================
 * API /api/stations
 * ============================================================
 */

async function stationsAPI() {

    try {

        const config =
            await getConfig();


        return json({

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

        return json(
            {
                ok: false,

                error:
                    "无法读取电台配置",

                detail:
                    error?.message ||
                    String(error)
            },

            503
        );
    }
}


/*
 * ============================================================
 * Allowed source URL
 *
 * 只允许来自 config.ini 的地址。
 * 防止 /api/hls 被当成开放代理滥用。
 * ============================================================
 */

async function isAllowedSource(
    source
) {

    try {

        const config =
            await getConfig();


        for (
            const station
            of config.stations
        ) {

            if (
                station.url === source
            ) {

                return true;
            }
        }


        return false;

    } catch {

        return false;
    }
}


/*
 * ============================================================
 * Resolve URL
 * ============================================================
 */

function resolveURL(
    base,
    target
) {

    try {

        return new URL(
            target,
            base
        ).toString();

    } catch {

        return null;
    }
}


/*
 * ============================================================
 * Rewrite M3U8
 *
 * 把：
 *
 *   segment.ts
 *
 * 变成：
 *
 *   /api/hls-segment?url=...
 *
 * ============================================================
 */

function rewriteM3U8(
    text,
    playlistURL
) {

    const lines =
        text.split(/\r?\n/);


    const output = [];


    for (let i = 0; i < lines.length; i++) {

        const line =
            lines[i];


        const trimmed =
            line.trim();


        /*
         * 空行
         */

        if (!trimmed) {

            output.push("");

            continue;
        }


        /*
         * M3U8 注释
         */

        if (
            trimmed.startsWith("#")
        ) {

            /*
             * EXT-X-KEY
             *
             * 如果 KEY 使用 URI，
             * 也需要代理。
             */

            if (
                /^#EXT-X-KEY:/i.test(trimmed)
            ) {

                const rewritten =
                    rewriteURIAttribute(
                        line,
                        playlistURL
                    );

                output.push(
                    rewritten
                );

            } else {

                output.push(line);
            }

            continue;
        }


        /*
         * 普通 URI
         *
         * 可能是：
         *
         * .ts
         * .aac
         * .m4s
         * 子 M3U8
         */

        const absolute =
            resolveURL(
                playlistURL,
                trimmed
            );


        if (!absolute) {

            output.push(line);

            continue;
        }


        const proxyURL =
            "/api/hls-segment?url=" +
            encodeURIComponent(
                absolute
            );


        output.push(
            proxyURL
        );
    }


    return output.join("\n");
}


/*
 * ============================================================
 * Rewrite URI="..."
 * ============================================================
 */

function rewriteURIAttribute(
    line,
    playlistURL
) {

    return line.replace(
        /URI="([^"]+)"/gi,
        (full, uri) => {

            const absolute =
                resolveURL(
                    playlistURL,
                    uri
                );


            if (!absolute) {
                return full;
            }


            return (
                'URI="/api/hls-segment?url=' +
                encodeURIComponent(
                    absolute
                ) +
                '"'
            );
        }
    );
}


/*
 * ============================================================
 * HLS playlist
 * ============================================================
 */

async function hlsPlaylist(
    request,
    source
) {

    const allowed =
        await isAllowedSource(
            source
        );


    if (!allowed) {

        return json(
            {
                ok: false,
                error:
                    "该电台地址没有在 config.ini 中登记"
            },
            403
        );
    }


    const response =
        await fetchWithTimeout(
            source,
            {
                headers: {

                    "User-Agent":
                        "Mozilla/5.0",

                    "Accept":
                        "*/*",

                    "Referer":
                        "https://www.ximalaya.com/"
                }
            }
        );


    if (!response.ok) {

        return new Response(
            "Upstream HTTP " +
            response.status,
            {
                status: 502,

                headers:
                    corsHeaders()
            }
        );
    }


    const text =
        await response.text();


    const rewritten =
        rewriteM3U8(
            text,
            source
        );


    return new Response(
        rewritten,
        {
            status: 200,

            headers: {

                ...corsHeaders(),

                "Content-Type":
                    "application/vnd.apple.mpegurl",

                "Cache-Control":
                    "no-cache, no-store, must-revalidate",

                "Access-Control-Allow-Headers":
                    "*"
            }
        }
    );
}


/*
 * ============================================================
 * HLS segment / nested resource
 * ============================================================
 */

async function hlsSegment(
    request,
    source
) {

    if (!source) {

        return json(
            {
                ok: false,
                error:
                    "缺少 url"
            },
            400
        );
    }


    /*
     * 只允许 config.ini 中登记的源站，
     * 或由已登记 M3U8 解析出来的同源资源。
     *
     * 这里先检查 hostname。
     */

    let target;

    try {

        target =
            new URL(source);

    } catch {

        return json(
            {
                ok: false,
                error:
                    "URL 无效"
            },
            400
        );
    }


    const config =
        await getConfig();


    let sourceAllowed = false;


    for (
        const station
        of config.stations
    ) {

        try {

            const stationURL =
                new URL(station.url);


            if (
                stationURL.hostname ===
                target.hostname
            ) {

                sourceAllowed = true;

                break;
            }

        } catch {}
    }


    if (!sourceAllowed) {

        return json(
            {
                ok: false,
                error:
                    "该媒体源不在允许范围内"
            },
            403
        );
    }


    const headers =
        new Headers();


    headers.set(
        "User-Agent",
        "Mozilla/5.0"
    );


    headers.set(
        "Accept",
        "*/*"
    );


    /*
     * 支持音频 Range
     */

    const range =
        request.headers.get(
            "Range"
        );


    if (range) {

        headers.set(
            "Range",
            range
        );
    }


    const referer =
        request.headers.get(
            "Referer"
        );


    if (referer) {

        headers.set(
            "Referer",
            referer
        );
    }


    const response =
        await fetchWithTimeout(
            target.toString(),
            {
                headers
            }
        );


    if (
        !response.ok &&
        response.status !== 206
    ) {

        return new Response(
            "Upstream HTTP " +
            response.status,
            {
                status: 502,

                headers:
                    corsHeaders()
            }
        );
    }


    const responseHeaders =
        new Headers(
            response.headers
        );


    /*
     * CORS
     */

    const cors =
        corsHeaders();


    for (
        const [key, value]
        of Object.entries(cors)
    ) {

        responseHeaders.set(
            key,
            value
        );
    }


    /*
     * 不让浏览器缓存直播分片太久
     */

    responseHeaders.set(
        "Cache-Control",
        "no-cache"
    );


    /*
     * 允许浏览器 Range
     */

    responseHeaders.set(
        "Accept-Ranges",
        "bytes"
    );


    return new Response(
        response.body,
        {
            status:
                response.status,

            statusText:
                response.statusText,

            headers:
                responseHeaders
        }
    );
}


/*
 * ============================================================
 * Main
 * ============================================================
 */

export default {

    async fetch(
        request,
        env,
        ctx
    ) {

        const url =
            new URL(
                request.url
            );


        /*
         * OPTIONS
         */

        if (
            request.method ===
            "OPTIONS"
        ) {

            return new Response(
                null,
                {
                    status: 204,

                    headers:
                        corsHeaders()
                }
            );
        }


        /*
         * API
         */

        if (
            url.pathname ===
            "/api/stations"
        ) {

            if (
                request.method !==
                "GET"
            ) {

                return json(
                    {
                        ok: false,
                        error:
                            "Method Not Allowed"
                    },
                    405
                );
            }


            return stationsAPI();
        }


        /*
         * M3U8
         */

        if (
            url.pathname ===
            "/api/hls"
        ) {

            if (
                request.method !==
                    "GET" &&
                request.method !==
                    "HEAD"
            ) {

                return json(
                    {
                        ok: false,
                        error:
                            "Method Not Allowed"
                    },
                    405
                );
            }


            const source =
                url.searchParams.get(
                    "url"
                );


            if (!source) {

                return json(
                    {
                        ok: false,
                        error:
                            "缺少 url"
                    },
                    400
                );
            }


            try {

                return await hlsPlaylist(
                    request,
                    source
                );

            } catch (error) {

                return json(
                    {
                        ok: false,

                        error:
                            "HLS 获取失败",

                        detail:
                            error?.message ||
                            String(error)
                    },
                    502
                );
            }
        }


        /*
         * HLS 分片
         */

        if (
            url.pathname ===
            "/api/hls-segment"
        ) {

            if (
                request.method !==
                    "GET" &&
                request.method !==
                    "HEAD"
            ) {

                return json(
                    {
                        ok: false,
                        error:
                            "Method Not Allowed"
                    },
                    405
                );
            }


            const source =
                url.searchParams.get(
                    "url"
                );


            if (!source) {

                return json(
                    {
                        ok: false,
                        error:
                            "缺少 url"
                    },
                    400
                );
            }


            try {

                return await hlsSegment(
                    request,
                    source
                );

            } catch (error) {

                return json(
                    {
                        ok: false,

                        error:
                            "媒体分片获取失败",

                        detail:
                            error?.message ||
                            String(error)
                    },
                    502
                );
            }
        }


        /*
         * Pages 静态文件
         */

        return env.ASSETS.fetch(
            request
        );
    }
};

/*
 * ============================================================
 * Cloudflare Pages 广播站后端
 * ============================================================
 *
 * 零第三方依赖。
 *
 * GitHub config.ini
 *       ↓
 * Cloudflare Worker
 *       ↓
 * /api/stations
 *       ↓
 * index.html
 *
 * ============================================================
 */


/*
 * ============================================================
 * ① 修改这里
 * ============================================================
 *
 * 例如：
 *
 * https://raw.githubusercontent.com/abc/radio-station/main/config.ini
 *
 */

const GITHUB_CONFIG_URL =
    "https://raw.githubusercontent.com/ilsaay/radio-station/blob/main/config.ini";


/*
 * 配置缓存时间。
 *
 * 30 秒：
 *
 * 修改 GitHub config.ini 后，
 * 最多约 30 秒读取到新配置。
 */

const CACHE_TTL =
    30 * 1000;


/*
 * GitHub 请求超时时间。
 */

const FETCH_TIMEOUT =
    8000;


/*
 * Worker 内存中的最近成功配置。
 *
 * GitHub 暂时失败时，
 * 继续使用最近一次成功配置。
 */

let memoryCache = null;

let memoryCacheTime = 0;


/*
 * ============================================================
 * INI 解析器
 * ============================================================
 */

function parseINI(text){

    const sections = [];

    let current = null;


    text =
        text.replace(
            /^\uFEFF/,
            ""
        );


    const lines =
        text.split(/\r?\n/);


    for(
        let i = 0;
        i < lines.length;
        i++
    ){

        let line =
            lines[i].trim();


        /*
         * 空行和注释。
         */

        if(
            !line ||
            line.startsWith(";") ||
            line.startsWith("#")
        ){

            continue;
        }


        /*
         * [radio]
         */

        const sectionMatch =
            line.match(
                /^\[([^\]]+)\]$/
            );


        if(sectionMatch){

            current = {
                section:
                    sectionMatch[1].trim()
            };


            sections.push(
                current
            );


            continue;
        }


        /*
         * 没有 section 时忽略。
         */

        if(!current){

            continue;
        }


        /*
         * key=value
         */

        const position =
            line.indexOf("=");


        if(position <= 0){

            continue;
        }


        const key =
            line
                .slice(
                    0,
                    position
                )
                .trim();


        let value =
            line
                .slice(
                    position + 1
                )
                .trim();


        /*
         * 删除首尾引号。
         */

        if(
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
        ){

            value =
                value.slice(
                    1,
                    -1
                );

        }


        current[key] =
            value;
    }


    return sections;
}


/*
 * ============================================================
 * 配置转换
 * ============================================================
 */

function buildConfig(text){

    const sections =
        parseINI(text);


    /*
     * 网站配置。
     */

    let siteSection = null;


    for(
        const item of sections
    ){

        if(
            String(item.section)
                .toLowerCase() ===
            "site"
        ){

            siteSection =
                item;

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


    /*
     * 电台列表。
     */

    const stations = [];


    for(
        const item of sections
    ){

        if(!item.url){

            continue;
        }


        const url =
            String(item.url)
                .trim();


        /*
         * 只接受 HTTP / HTTPS。
         */

        if(
            !url.startsWith(
                "http://"
            ) &&
            !url.startsWith(
                "https://"
            )
        ){

            continue;
        }


        stations.push({

            name:
                item.name ||
                "未命名电台",

            url:
                url,

            type:
                item.type ||
                "mp3",

            category:
                item.category ||
                "网络电台",

            description:
                item.description ||
                ""

        });

    }


    return {

        site:
            site,

        stations:
            stations,

        generatedAt:
            Date.now()

    };
}


/*
 * ============================================================
 * 带超时的 GitHub 请求
 * ============================================================
 */

async function fetchGitHubConfig(){

    const controller =
        new AbortController();


    const timeout =
        setTimeout(
            function(){

                controller.abort();

            },
            FETCH_TIMEOUT
        );


    try{

        const response =
            await fetch(
                GITHUB_CONFIG_URL,
                {
                    method:"GET",

                    headers:{
                        "Accept":
                            "text/plain",

                        "User-Agent":
                            "Cloudflare-Radio-Station"
                    },

                    signal:
                        controller.signal,

                    cf:{
                        cacheTtl:30,
                        cacheEverything:true
                    }
                }
            );


        if(!response.ok){

            throw new Error(
                "GitHub HTTP " +
                response.status
            );

        }


        const text =
            await response.text();


        if(
            !text ||
            !text.trim()
        ){

            throw new Error(
                "config.ini 为空"
            );

        }


        return text;

    }finally{

        clearTimeout(
            timeout
        );

    }

}


/*
 * ============================================================
 * 获取最新配置
 * ============================================================
 */

async function getConfig(){

    const now =
        Date.now();


    /*
     * Worker 内存缓存。
     */

    if(
        memoryCache &&
        (
            now -
            memoryCacheTime
        ) < CACHE_TTL
    ){

        return memoryCache;

    }


    /*
     * 尝试读取 GitHub。
     */

    try{

        const text =
            await fetchGitHubConfig();


        const config =
            buildConfig(text);


        /*
         * 配置为空时，
         * 如果以前有成功配置，
         * 不立即覆盖。
         */

        if(
            config.stations.length === 0 &&
            memoryCache &&
            memoryCache.stations.length > 0
        ){

            memoryCacheTime =
                now;

            return memoryCache;
        }


        /*
         * 保存最近一次成功配置。
         */

        memoryCache =
            config;

        memoryCacheTime =
            now;


        return config;

    }catch(error){

        /*
         * GitHub 暂时不可用：
         *
         * 返回最近成功配置。
         */

        if(memoryCache){

            return memoryCache;

        }


        /*
         * 第一次启动且 GitHub 无法访问。
         */

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
    status = 200,
    extraHeaders = {}
){

    const headers =
        new Headers();


    headers.set(
        "Content-Type",
        "application/json; charset=utf-8"
    );


    headers.set(
        "Cache-Control",
        "public, max-age=30, s-maxage=30"
    );


    headers.set(
        "Access-Control-Allow-Origin",
        "*"
    );


    headers.set(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS"
    );


    headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );


    for(
        const key in extraHeaders
    ){

        headers.set(
            key,
            extraHeaders[key]
        );

    }


    return new Response(
        JSON.stringify(data),
        {
            status:
                status,

            headers:
                headers
        }
    );

}


/*
 * ============================================================
 * API
 * ============================================================
 */

async function handleAPI(request){

    const url =
        new URL(
            request.url
        );


    /*
     * OPTIONS
     */

    if(
        request.method ===
        "OPTIONS"
    ){

        return jsonResponse({
            ok:true
        });

    }


    /*
     * /api/stations
     */

    if(
        url.pathname ===
        "/api/stations"
    ){

        if(
            request.method !==
            "GET"
        ){

            return jsonResponse(
                {
                    ok:false,
                    error:
                        "Method Not Allowed"
                },
                405
            );

        }


        try{

            const config =
                await getConfig();


            return jsonResponse({

                ok:true,

                site:
                    config.site,

                stations:
                    config.stations,

                count:
                    config.stations.length,

                generatedAt:
                    config.generatedAt

            });

        }catch(error){

            return jsonResponse(
                {
                    ok:false,

                    error:
                        "暂时无法读取 GitHub 中的 config.ini"
                },
                503
            );

        }

    }


    return null;
}


/*
 * ============================================================
 * Cloudflare Pages / Workers
 * ============================================================
 */

export default {

    async fetch(
        request,
        env,
        ctx
    ){

        /*
         * API 优先。
         */

        const apiResponse =
            await handleAPI(
                request
            );


        if(apiResponse){

            return apiResponse;

        }


        /*
         * 其它文件：
         *
         * 交给 Cloudflare Pages
         * 静态资源系统。
         */

        return env.ASSETS.fetch(
            request
        );

    }

};

const GITHUB_CONFIG_URL =
    "https://raw.githubusercontent.com/ilsaay/radio-station/main/config.ini";

const CACHE_TTL =
    30 * 1000;

let memoryCache = {
    time: 0,
    data: null
};


/* =========================================================
   INI PARSER
========================================================= */

function parseINI(text){

    const result = {};

    let section = null;


    for(
        const rawLine of text.split(/\r?\n/)
    ){

        const line =
            rawLine.trim();


        if(!line){

            continue;

        }


        if(
            line.startsWith("#") ||
            line.startsWith(";")
        ){

            continue;

        }


        const sectionMatch =
            line.match(
                /^\[([^\]]+)\]$/
            );


        if(sectionMatch){

            section =
                sectionMatch[1].trim();


            if(!result[section]){

                result[section] = {};

            }


            continue;

        }


        const equal =
            line.indexOf("=");


        if(
            equal === -1 ||
            !section
        ){

            continue;

        }


        const key =
            line
                .slice(0,equal)
                .trim();


        const value =
            line
                .slice(equal + 1)
                .trim();


        if(key){

            result[section][key] =
                value;

        }

    }


    return result;

}


/* =========================================================
   BUILD JSON
========================================================= */

function buildData(text){

    const ini =
        parseINI(text);


    const site =
        ini.site || {};


    const stations = [];


    /*
     * 不要求 radio1/radio2/radio3
     *
     * 任何 section 只要存在 url
     * 都自动成为一个电台。
     */

    for(
        const [section, values]
        of Object.entries(ini)
    ){

        if(
            section === "site" ||
            !values.url
        ){

            continue;

        }


        stations.push({

            id:
                section,

            name:
                values.name ||
                section,

            url:
                values.url,

            type:
                (
                    values.type ||
                    "mp3"
                ).toLowerCase(),

            category:
                values.category ||
                "网络广播",

            description:
                values.description ||
                "",

            cover:
                values.cover ||
                ""

        });

    }


    return {

        site: {

            name:
                site.name ||
                "在线广播",

            title:
                site.title ||
                "随时随地，开始收听。",

            description:
                site.description ||
                "从音乐、新闻到网络广播，把你喜欢的声音集中到一个简单的播放器里。"

        },

        stations

    };

}


/* =========================================================
   GET CONFIG
========================================================= */

async function getConfig(){

    const now =
        Date.now();


    /*
     * Worker 内存缓存
     */

    if(
        memoryCache.data &&
        now - memoryCache.time <
        CACHE_TTL
    ){

        return memoryCache.data;

    }


    try{

        const response =
            await fetch(
                GITHUB_CONFIG_URL,
                {
                    headers:{
                        "User-Agent":
                            "radio-station-worker",

                        "Cache-Control":
                            "no-cache"
                    },

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


        const data =
            buildData(text);


        memoryCache = {

            time:now,

            data

        };


        return data;

    }
    catch(error){

        /*
         * GitHub 临时不可用时，
         * 如果 Worker 已经有旧配置，
         * 继续使用旧配置。
         */

        if(memoryCache.data){

            return memoryCache.data;

        }


        throw error;

    }

}


/* =========================================================
   WORKER
========================================================= */

export default {

    async fetch(
        request,
        env
    ){

        const url =
            new URL(
                request.url
            );


        /*
         * 唯一 API：
         *
         * /api/stations
         */

        if(
            url.pathname ===
            "/api/stations"
        ){

            try{

                const data =
                    await getConfig();


                return new Response(

                    JSON.stringify(
                        data
                    ),

                    {
                        status:200,

                        headers:{

                            "Content-Type":
                                "application/json; charset=utf-8",

                            "Cache-Control":
                                "public, max-age=20, stale-while-revalidate=60",

                            "Access-Control-Allow-Origin":
                                "*"

                        }

                    }

                );

            }
            catch(error){

                return new Response(

                    JSON.stringify({

                        error:
                            "CONFIG_ERROR",

                        message:
                            String(
                                error.message ||
                                error
                            )

                    }),

                    {
                        status:502,

                        headers:{

                            "Content-Type":
                                "application/json; charset=utf-8",

                            "Access-Control-Allow-Origin":
                                "*"

                        }

                    }

                );

            }

        }


        /*
         * 其他所有请求：
         *
         * 交给 Cloudflare Pages 静态资源。
         */

        return env.ASSETS.fetch(
            request
        );

    }

};

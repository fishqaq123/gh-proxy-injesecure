'use strict'

/**
 * ============================================================
 *  InjeSecure — gh-proxy 增强分支 · 注入框架 + 统一鉴权
 *  基于 gh-proxy 原版，增加注入框架、统一鉴权、远程配置支持
 * ============================================================
 *
 *  使用前请先配置以下部分：
 *   1. KEY 相关：在下方「KEY 配置区域」设置你的密钥
 *   2. 注入仓库：在「注入配置」中设置你自己的 JSON 配置文件地址（可选）
 *   3. 回退注入：在「FALLBACK_INJECTIONS」中自定义默认注入内容
 *   4. 功能开关：在「功能开关」中启用/禁用 KEY 验证和注入功能
 *
 *  部署后访问 https://你的域名/ 即可看到效果
 * ============================================================
 */

// ==================== 功能开关 ====================
const ENABLE_KEY_AUTH = true   // 是否启用密钥验证（true/false）
const ENABLE_INJECTION = true  // 是否启用页面注入（true/false）
// ==================================================

// ==================== KEY 配置区域（请修改） ====================
const MY_KEY = 'set-your-own-key'                    // 主密钥，用于下载和 Git Clone
const TEMP_KEY_TIME_LIMITED = 'set-your-own-key' // 临时密钥（限时）
const START_TIME = '2000-01-01 00:00:00'             // 临时密钥生效开始时间（北京时间）
const END_TIME = '2000-01-02 00:00:00'               // 临时密钥失效结束时间（北京时间）
// ==================================================

// ==================== 注入配置 ====================
// 远程注入配置文件地址（留空则仅使用回退注入）
const REMOTE_INJECTION_URL = 'https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/injections.json'//默认为本仓库注入文件

// 回退注入（当远程拉取失败或未配置时使用）
const FALLBACK_INJECTIONS = [
    {
        position: 'afterBody',
        html: `
<!-- ====== 右上角提示：注入已生效 ====== -->
<style>
  .injection-badge {
    position: fixed !important;
    top: 12px !important;
    right: 12px !important;
    z-index: 99999 !important;
    background: rgba(0,0,0,0.7) !important;
    color: #fff !important;
    padding: 6px 14px !important;
    border-radius: 20px !important;
    font-size: 12px !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    backdrop-filter: blur(4px) !important;
    border: 1px solid rgba(255,255,255,0.15) !important;
    pointer-events: none !important;
  }
</style>
<div class="injection-badge">✨ 注入生效</div>
`
    }
]
// ==================================================

// ==================== 静态资源地址（原项目） ====================
const ASSET_URL = 'https://hunshcn.github.io/gh-proxy/'
const PREFIX = '/'
const Config = {
    jsdelivr: 0
}

const whiteList = []

/** @type {ResponseInit} */
const PREFLIGHT_INIT = {
    status: 204,
    headers: new Headers({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    }),
}

// ==================== 路由正则表达式 ====================
const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

// ==================================================

function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*'
    return new Response(body, { status, headers })
}

function newUrl(urlStr) {
    try {
        return new URL(urlStr)
    } catch (err) {
        return null
    }
}

addEventListener('fetch', e => {
    const ret = fetchHandler(e)
        .catch(err => makeRes('cfworker error:\n' + err.stack, 502))
    e.respondWith(ret)
})

function checkUrl(u) {
    for (let i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
        if (u.search(i) === 0) {
            return true
        }
    }
    return false
}

function beijingToUTC(beijingTimeStr) {
    const [datePart, timePart] = beijingTimeStr.split(' ')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute, second] = timePart.split(':').map(Number)
    return Date.UTC(year, month - 1, day, hour - 8, minute, second)
}

function checkTimeLimitedKey() {
    const now = Date.now()
    const start = beijingToUTC(START_TIME)
    const end = beijingToUTC(END_TIME)
    
    if (now < start) {
        return { valid: false, reason: 'not_started' }
    }
    if (now > end) {
        return { valid: false, reason: 'expired' }
    }
    
    const remainingMs = end - now
    const remainingDays = remainingMs / (1000 * 60 * 60 * 24)
    return { valid: true, remainingDays }
}

/**
 * 统一密钥校验函数
 */
function validateKey(key, isGit) {
    if (!ENABLE_KEY_AUTH) {
        return { valid: true }
    }

    if (key === MY_KEY) {
        return { valid: true }
    }
    
    if (key === TEMP_KEY_TIME_LIMITED) {
        const timeCheck = checkTimeLimitedKey()
        if (timeCheck.valid) {
            const result = { valid: true }
            if (timeCheck.remainingDays < 3) {
                result.warning = `Key expires in ${Math.ceil(timeCheck.remainingDays)} days`
            }
            return result
        }
        if (timeCheck.reason === 'expired') {
            return { valid: false, status: 403, error: 'Out Of Date' }
        }
        return { valid: false, status: 403, error: 'Forbidden' }
    }
    
    return {
        valid: false,
        status: isGit ? 401 : 403,
        error: isGit ? 'Invalid credentials' : 'Forbidden',
        headers: isGit ? { 'WWW-Authenticate': 'Basic realm="GitHub Proxy"' } : {}
    }
}

/**
 * 注入应用函数
 */
function applyInjections(html, injections) {
    if (!ENABLE_INJECTION || !injections || injections.length === 0) {
        return html
    }
    let result = html
    for (const inj of injections) {
        switch (inj.position) {
            case 'afterBody':
                result = result.replace(/<body[^>]*>/, match => match + inj.html)
                break
            case 'beforeHeadEnd':
                result = result.replace('</head>', `${inj.html}</head>`)
                break
            default:
                break
        }
    }
    return result
}

/**
 * 从远程拉取注入配置
 */
async function fetchRemoteInjections() {
    if (!REMOTE_INJECTION_URL) {
        return null
    }
    try {
        const response = await fetch(REMOTE_INJECTION_URL, {
            headers: { 'User-Agent': 'Cloudflare-Worker' }
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (data && Array.isArray(data.injections)) {
            return data.injections
        }
        throw new Error('Invalid JSON structure')
    } catch (error) {
        console.error('Failed to fetch remote injections:', error)
        return null
    }
}

// ==================== 主请求处理 ====================
async function fetchHandler(e) {
    const req = e.request
    const urlStr = req.url
    const urlObj = new URL(urlStr)
    let path = urlObj.searchParams.get('q')

    // 处理 q 参数重定向
    if (path) {
        return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
    }

    // ====== 首页处理（注入） ======
    if (urlObj.pathname === '/' || urlObj.pathname === PREFIX) {
        if (urlObj.searchParams.has('compat')) {
            return fetch(ASSET_URL)
        }

        let injections = null
        if (ENABLE_INJECTION) {
            if (REMOTE_INJECTION_URL) {
                injections = await fetchRemoteInjections()
            }
            if (!injections) {
                injections = FALLBACK_INJECTIONS
            }
        } else {
            injections = []
        }

        const resp = await fetch(ASSET_URL)
        const html = await resp.text()
        const injectedHtml = applyInjections(html, injections)
        return new Response(injectedHtml, {
            headers: {
                'Content-Type': 'text/html; charset=UTF-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'access-control-allow-origin': '*'
            }
        })
    }
    // ====== 结束首页处理 ======

    // ====== 非首页请求：统一进入 httpHandler（认证 + 路由） ======
    path = urlObj.href.slice(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')
    
    if (!path) {
        path = '/'
    }
    
    return httpHandler(req, path)
}
// ==================================================

// ==================== HTTP 处理器（认证 + 路由） ====================
function httpHandler(req, pathname) {
    const reqHdrRaw = req.headers

    // CORS preflight
    if (req.method === 'OPTIONS' && reqHdrRaw.has('access-control-request-headers')) {
        return new Response(null, PREFLIGHT_INIT)
    }

    const reqHdrNew = new Headers(reqHdrRaw)
    let urlStr = pathname

    // 白名单
    let flag = !Boolean(whiteList.length)
    for (let i of whiteList) {
        if (urlStr.includes(i)) {
            flag = true
            break
        }
    }
    if (!flag) {
        return new Response("blocked", { status: 403 })
    }

    // ====== 统一密钥提取（优先检查 URL 参数） ======
    let key = null
    let keySource = null
    let urlForKey = null

    // 1. 首先检查 URL 参数 ?key= (适用于 Git 和浏览器下载)
    const url = new URL(req.url);
    const urlKey = url.searchParams.get('key');
    if (urlKey) {
        key = urlKey;
        keySource = 'url';
        urlForKey = url;
        urlForKey.searchParams.delete('key');
    }

    // 2. 如果 URL 参数中没有 key，检查 Authorization 头
    if (!key) {
        const authHeader = reqHdrRaw.get('Authorization');
        if (authHeader) {
            if (authHeader.startsWith('Bearer ')) {
                key = authHeader.slice(7).trim();
                keySource = 'header';
            } else if (authHeader.startsWith('Basic ')) {
                try {
                    const base64 = authHeader.slice(6);
                    const credentials = atob(base64);
                    const splitIndex = credentials.indexOf(':');
                    if (splitIndex !== -1) {
                        const password = credentials.slice(splitIndex + 1);
                        if (password === MY_KEY) {
                            key = MY_KEY;
                            keySource = 'basic';
                        }
                    }
                } catch (e) {
                    // Base64 解码失败，忽略
                }
            }
        }
    }

    // 判断是否为 Git 请求
    const isGit =
        urlStr.includes('git-upload-pack') ||
        urlStr.includes('git-receive-pack') ||
        urlStr.endsWith('.git')

    // 3. 如果还没有 key，且是 Git 请求，返回 401 并提示 Basic
    if (!key && isGit) {
        return new Response('Unauthorized', {
            status: 401,
            headers: {
                'WWW-Authenticate': 'Basic realm="GitHub Proxy"',
                'Content-Type': 'text/plain;charset=UTF-8'
            }
        })
    }

    // 4. 如果还没有 key，且不是 Git 请求，返回 403
    if (!key) {
        return new Response('Forbidden: Missing key', {
            status: 403,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
        })
    }

    // 5. 验证 key
    const validationResult = validateKey(key, isGit)
    if (!validationResult.valid) {
        return new Response(validationResult.error, {
            status: validationResult.status,
            headers: validationResult.headers || {}
        })
    }

    if (validationResult.warning) {
        reqHdrNew.set('X-Warning', validationResult.warning)
    }

    // 6. 如果密钥来自 URL 参数，使用修改后的 URL
    if (keySource === 'url' && urlForKey) {
        const modifiedUrl = urlForKey.toString()
        const modifiedUrlObj = newUrl(modifiedUrl)
        if (modifiedUrlObj) {
            const reqInit = {
                method: req.method,
                headers: reqHdrNew,
                redirect: 'manual',
                body: req.body
            }
            return proxy(modifiedUrlObj, reqInit, req)
        }
    }

    // 7. 重建 URL（去除可能的前缀）
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }
    const urlObj = newUrl(urlStr)

    // 8. 路由：根据路径匹配选择处理方式
    if (urlObj) {
        const path = urlObj.pathname + urlObj.search
        if (path.search(exp1) === 0 || path.search(exp5) === 0 || path.search(exp6) === 0 || path.search(exp3) === 0) {
            return proxy(urlObj, { method: req.method, headers: reqHdrNew, redirect: 'manual', body: req.body }, req)
        } else if (path.search(exp2) === 0) {
            if (Config.jsdelivr) {
                const newUrlPath = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
                return Response.redirect(newUrlPath, 302)
            } else {
                const rawPath = path.replace('/blob/', '/raw/')
                const rawUrlObj = newUrl(rawPath)
                if (rawUrlObj) {
                    return proxy(rawUrlObj, { method: req.method, headers: reqHdrNew, redirect: 'manual', body: req.body }, req)
                }
            }
        } else if (path.search(exp4) === 0) {
            if (Config.jsdelivr) {
                const newUrlPath = path.replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1')
                    .replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
                return Response.redirect(newUrlPath, 302)
            } else {
                return proxy(urlObj, { method: req.method, headers: reqHdrNew, redirect: 'manual', body: req.body }, req)
            }
        }
    }

    // 默认：直接代理
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: req.body
    }
    return proxy(urlObj, reqInit, req)
}
// ==================================================

// ==================== 代理函数 ====================
async function proxy(urlObj, reqInit, originalReq) {
    const res = await fetch(urlObj.href, reqInit)
    const resHdrOld = res.headers
    const resHdrNew = new Headers(resHdrOld)

    const status = res.status

    if (resHdrNew.has('location')) {
        let _location = resHdrNew.get('location')
        if (checkUrl(_location))
            resHdrNew.set('location', PREFIX + _location)
        else {
            reqInit.redirect = 'follow'
            return proxy(newUrl(_location), reqInit, originalReq)
        }
    }
    resHdrNew.set('access-control-expose-headers', '*')
    resHdrNew.set('access-control-allow-origin', '*')

    resHdrNew.delete('content-security-policy')
    resHdrNew.delete('content-security-policy-report-only')
    resHdrNew.delete('clear-site-data')

    const contentLength = res.headers.get('content-length')
    const country = originalReq.headers.get('CF-IPCountry') || 'XX'

    if (contentLength && country !== 'CN') {
        const fileSizeMB = parseInt(contentLength, 10) / (1024 * 1024)
        let cacheMaxAge = null
        if (fileSizeMB > 95 && fileSizeMB <= 105) {
            cacheMaxAge = 172800
        } else if (fileSizeMB >= 60 && fileSizeMB <= 94) {
            cacheMaxAge = 345600
        } else if (fileSizeMB >= 30 && fileSizeMB <= 59) {
            cacheMaxAge = 604800
        } else if (fileSizeMB >= 10 && fileSizeMB <= 29) {
            cacheMaxAge = 1209600
        }
        if (cacheMaxAge !== null) {
            resHdrNew.set('Cache-Control', `public, max-age=${cacheMaxAge}`)
            resHdrNew.set('X-Cache-Policy', `country=${country}_size=${fileSizeMB.toFixed(2)}MB_age=${cacheMaxAge}`)
        }
    } else if (country === 'CN') {
        resHdrNew.set('X-Cache-Policy', 'direct-china')
    }

    const warningHeader = originalReq.headers.get('X-Warning')
    if (warningHeader) {
        resHdrNew.set('X-Warning', warningHeader)
    }

    return new Response(res.body, {
        status,
        headers: resHdrNew,
    })
}
// ==================================================

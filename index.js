'use strict'

/**
 * ============================================================
 *  GitHub Proxy Worker - 增强版 (可公开部署)
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
const MY_KEY = 'Set-your-own-key'                    // 主密钥，用于下载和 Git Clone
const TEMP_KEY_TIME_LIMITED = 'Set-your-own-temp-key' // 临时密钥（限时）
const START_TIME = '2000-01-01 00:00:00'             // 临时密钥生效开始时间（北京时间）
const END_TIME = '2000-01-02 00:00:00'               // 临时密钥失效结束时间（北京时间）
// ==================================================

// ==================== 注入配置 ====================
// 远程注入配置文件地址（留空则禁用远程拉取，仅使用回退注入）
const REMOTE_INJECTION_URL = ''  // 例如：'https://raw.githubusercontent.com/你的用户名/仓库名/main/injections.json'

// 回退注入（当远程拉取失败或未配置时使用）
// 注意：这里默认只显示一个简单的提示，你可以自行修改
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

const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

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
        // 如果密钥验证被禁用，直接通过
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
        error: isGit ? 'Invalid Bearer token' : 'Forbidden',
        headers: isGit ? { 'WWW-Authenticate': 'Bearer realm="GitHub Proxy"' } : {}
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

async function fetchHandler(e) {
    const req = e.request
    const urlStr = req.url
    const urlObj = new URL(urlStr)
    let path = urlObj.searchParams.get('q')

    if (path) {
        return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
    }

    path = urlObj.href.slice(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')

    // ====== 首页处理（注入） ======
    if (urlObj.pathname === '/' || urlObj.pathname === PREFIX) {
        if (urlObj.searchParams.has('compat')) {
            // 兼容模式：返回原始页面
            return fetch(ASSET_URL)
        }

        // 获取注入内容
        let injections = null
        if (ENABLE_INJECTION) {
            // 尝试远程拉取
            if (REMOTE_INJECTION_URL) {
                injections = await fetchRemoteInjections()
            }
            // 若远程失败或未配置，使用回退注入
            if (!injections) {
                injections = FALLBACK_INJECTIONS
            }
        } else {
            injections = [] // 注入功能关闭
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

    // 非首页请求走代理
    if (path.search(exp1) === 0 || path.search(exp5) === 0 || path.search(exp6) === 0 || path.search(exp3) === 0) {
        return httpHandler(req, path)
    } else if (path.search(exp2) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
            return Response.redirect(newUrl, 302)
        } else {
            path = path.replace('/blob/', '/raw/')
            return httpHandler(req, path)
        }
    } else if (path.search(exp4) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path.replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1')
                .replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
            return Response.redirect(newUrl, 302)
        } else {
            return httpHandler(req, path)
        }
    } else {
        return fetch(ASSET_URL + path)
    }
}

function httpHandler(req, pathname) {
    const reqHdrRaw = req.headers

    if (req.method === 'OPTIONS' && reqHdrRaw.has('access-control-request-headers')) {
        return new Response(null, PREFLIGHT_INIT)
    }

    const reqHdrNew = new Headers(reqHdrRaw)
    let urlStr = pathname

    // 白名单检查
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

    // ====== 统一密钥提取和验证 ======
    let key = null
    let keySource = null
    let urlForKey = null

    // 1. 从 Authorization: Bearer 提取
    const authHeader = reqHdrRaw.get('Authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
        key = authHeader.slice(7).trim()
        keySource = 'header'
    }

    // 2. 从 URL 参数 ?key= 提取
    if (!key) {
        const url = new URL(req.url)
        const urlKey = url.searchParams.get('key')
        if (urlKey) {
            key = urlKey
            keySource = 'url'
            urlForKey = url
            urlForKey.searchParams.delete('key')
        }
    }

    // 判断是否为 Git 请求
    const isGit =
        urlStr.includes('git-upload-pack') ||
        urlStr.includes('git-receive-pack') ||
        urlStr.endsWith('.git')

    // 密钥验证
    if (!key) {
        if (isGit) {
            return new Response('Unauthorized: Please provide key via "Authorization: Bearer <key>" header', {
                status: 401,
                headers: {
                    'WWW-Authenticate': 'Bearer realm="GitHub Proxy"',
                    'Content-Type': 'text/plain;charset=UTF-8'
                }
            })
        } else {
            return new Response('Forbidden: Missing key parameter', {
                status: 403,
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
            })
        }
    }

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

    // 如果密钥来自 URL 参数，使用修改后的 URL
    if (keySource === 'url' && urlForKey) {
        // 重新构建 URL（因为我们已经删除了 key 参数）
        // 但原始 urlStr 可能不包含查询参数，我们直接使用修改后的完整 URL
        const modifiedUrl = urlForKey.toString()
        const modifiedUrlObj = newUrl(modifiedUrl)
        if (modifiedUrlObj) {
            // 确保路径正确（可能包含查询参数）
            // 但我们仍需处理后续代理，这里直接调用 proxy
            // 注意：此时 req 的 URL 仍是原始的，我们需要传递修改后的 URL
            // 为了不破坏调用链，我们修改 urlStr 和重新构造 urlObj
            // 但更好的方式是直接构造新的请求参数
            const reqInit = {
                method: req.method,
                headers: reqHdrNew,
                redirect: 'manual',
                body: req.body
            }
            return proxy(modifiedUrlObj, reqInit, req)
        }
    }

    // 常规处理
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }
    const urlObj = newUrl(urlStr)
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: req.body
    }
    return proxy(urlObj, reqInit, req)
}

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

    // 缓存策略（可根据需要自定义）
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

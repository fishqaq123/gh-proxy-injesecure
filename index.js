'use strict'

/**
 * ============================================================
 *  InjeSecure — gh-proxy 增强分支 · 注入框架 + 统一鉴权
 *  基于 gh-proxy 原版，增加注入框架、统一鉴权、远程配置支持
 * ============================================================
 *
 *  static files (404.html, sw.js, conf.js)
 */

// ============================================================
// 静态资源地址（原项目）
// ============================================================
const ASSET_URL = 'https://hunshcn.github.io/gh-proxy/'
const PREFIX = '/'

// jsDelivr 开关
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

// ============================================================
// 功能开关
// ============================================================
// 是否启用 KEY 鉴权（true = 启用，false = 禁用）
const ENABLE_KEY_AUTH = true

// 是否启用远程注入功能（true = 启用，false = 禁用）
const ENABLE_INJECTION = true

// 远程注入配置文件地址（请替换为你的 GitHub 仓库地址）
// 如果 ENABLE_INJECTION = false，此配置无效  此链接为仓库默认注入地址
const INJECTION_CONFIG_URL = 'https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/injections.json'

// ============================================================
// KEY 配置区域（仅当 ENABLE_KEY_AUTH = true 时生效）
// ============================================================
// 主 KEY（请替换为你自己的密钥）
const MY_KEY = 'Set-your-own-key'

// 临时 KEY（请替换为你自己的密钥）
const TEMP_KEY_TIME_LIMITED = 'Set-your-own-key'

// 临时 KEY 的有效期（北京时间）
const START_TIME = '2000-01-01 00:00:00'
const END_TIME = '2000-01-01 00:00:00'

// ============================================================
// 最小回退注入配置（当远程注入拉取失败或 ENABLE_INJECTION = false 时使用）
// ============================================================
const FALLBACK_INJECTIONS = [
    {
        position: 'afterBody',
        html: `
<!-- ====== 注入生效提示 ====== -->
<style>
  #injection-badge {
    position: fixed !important;
    top: 12px !important;
    right: 12px !important;
    z-index: 99999 !important;
    background: #2ea043 !important;
    color: #ffffff !important;
    padding: 4px 14px !important;
    border-radius: 9999px !important;
    font-size: 12px !important;
    font-weight: 500 !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    box-shadow: 0 2px 8px rgba(46, 160, 67, 0.35) !important;
    border: none !important;
    pointer-events: none !important;
    user-select: none !important;
    letter-spacing: 0.3px !important;
  }
  @media (max-width: 480px) {
    #injection-badge {
      top: 8px !important;
      right: 8px !important;
      font-size: 10px !important;
      padding: 3px 10px !important;
    }
  }
</style>
<div id="injection-badge">✓ 注入生效</div>
<!-- InjeSecure 仓库链接 -->
<div style="text-align:center;padding:12px 0 6px 0;font-size:12px;color:#888;border-top:1px solid rgba(255,255,255,0.05);margin-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;opacity:0.6;">
    <span>Powered by</span>
    <a href="https://github.com/fishqaq123/gh-proxy-injesecure" target="_blank" rel="noopener" style="color:#888;text-decoration:none;font-weight:400;margin-left:4px;">
        InjeSecure
    </a>
    <span style="margin:0 4px;">·</span>
    <a href="https://github.com/fishqaq123/gh-proxy-injesecure" target="_blank" rel="noopener" style="color:#888;text-decoration:none;font-size:11px;">
        GitHub
    </a>
</div>
`
    }
]

// ============================================================
// 路由正则表达式
// ============================================================
const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

// ============================================================
// 工具函数
// ============================================================

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

/**
 * 将北京时间字符串转换为 UTC 时间戳 (毫秒)
 * @param {string} beijingTimeStr 格式: 'YYYY-MM-DD HH:MM:SS'
 */
function beijingToUTC(beijingTimeStr) {
    const [datePart, timePart] = beijingTimeStr.split(' ')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute, second] = timePart.split(':').map(Number)
    return Date.UTC(year, month - 1, day, hour - 8, minute, second)
}

/**
 * 检查临时 KEY 是否在有效期内
 */
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
 * 密钥校验函数（仅当 ENABLE_KEY_AUTH = true 时生效）
 * @param {string} key - 待验证的密钥
 * @returns {Object} { valid: boolean, error: string, status: number, headers: Object, warning?: string }
 */
function validateKey(key) {
    // 检查主 KEY
    if (key === MY_KEY) {
        return { valid: true }
    }

    // 检查临时 KEY
    if (key === TEMP_KEY_TIME_LIMITED) {
        const timeCheck = checkTimeLimitedKey()
        if (timeCheck.valid) {
            const result = { valid: true }
            if (timeCheck.remainingDays < 3) {
                result.warning = `密钥剩余 ${Math.ceil(timeCheck.remainingDays)} 天过期`
            }
            return result
        }
        if (timeCheck.reason === 'expired') {
            return { valid: false, status: 403, error: 'Out Of Date' }
        }
        return { valid: false, status: 403, error: 'Forbidden' }
    }

    // 密钥无效
    return {
        valid: false,
        status: 403,
        error: 'Forbidden'
    }
}

/**
 * 对 HTML 内容执行注入
 * @param {string} html - 原始 HTML 内容
 * @param {Array} injections - 注入配置数组
 * @returns {string} 注入后的 HTML
 */
function applyInjections(html, injections) {
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

    // ====== 在所有注入完成后，追加仓库链接 ======
    const footerLink = `
<!-- InjeSecure 仓库链接 -->
<div style="text-align:center;padding:12px 0 6px 0;font-size:12px;color:#888;border-top:1px solid rgba(255,255,255,0.05);margin-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;opacity:0.6;">
    <span>Powered by</span>
    <a href="https://github.com/fishqaq123/gh-proxy-injesecure" target="_blank" rel="noopener" style="color:#888;text-decoration:none;font-weight:400;margin-left:4px;">
        InjeSecure
    </a>
    <span style="margin:0 4px;">·</span>
    <a href="https://github.com/fishqaq123/gh-proxy-injesecure" target="_blank" rel="noopener" style="color:#888;text-decoration:none;font-size:11px;">
        GitHub
    </a>
</div>
`
    result = result.replace('</body>', `${footerLink}</body>`)

    return result
}

/**
 * 从远程拉取注入配置
 * @returns {Promise<Array>} 注入配置数组
 */
async function fetchRemoteInjections() {
    try {
        const response = await fetch(INJECTION_CONFIG_URL, {
            headers: {
                'User-Agent': 'Cloudflare-Worker'
            }
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()

        if (data && Array.isArray(data.injections)) {
            return data.injections
        } else {
            throw new Error('无效的 JSON 结构：缺少 "injections" 数组')
        }
    } catch (error) {
        console.error('拉取远程注入配置失败:', error)
        return null
    }
}

// ============================================================
// 主请求处理器
// ============================================================

async function fetchHandler(e) {
    const req = e.request
    const urlStr = req.url
    const urlObj = new URL(urlStr)
    let path = urlObj.searchParams.get('q')
    let remoteInjections = null

    if (path) {
        return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
    }

    path = urlObj.href.slice(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')

    // ========== 首页注入处理 ==========
    if (urlObj.pathname === '/' || urlObj.pathname === PREFIX) {
        // 检查是否为兼容模式（通过 ?compat=1 参数），绕过所有注入
        if (urlObj.searchParams.has('compat')) {
            return fetch(ASSET_URL)
        }

        // 如果注入功能已禁用，直接返回上游页面
        if (!ENABLE_INJECTION) {
            return fetch(ASSET_URL)
        }

        // 尝试拉取远程注入配置
        try {
            remoteInjections = await fetchRemoteInjections()
        } catch (e) {
            // 拉取失败，使用降级方案
        }

        const resp = await fetch(ASSET_URL)
        const html = await resp.text()
        const injections = (remoteInjections && Array.isArray(remoteInjections))
            ? remoteInjections
            : FALLBACK_INJECTIONS
        const injectedHtml = applyInjections(html, injections)
        return new Response(injectedHtml, {
            headers: {
                'Content-Type': 'text/html; charset=UTF-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'access-control-allow-origin': '*'
            }
        })
    }
    // ========== 注入结束 ==========

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

// ============================================================
// HTTP 处理器（鉴权 + 路由）
// ============================================================

function httpHandler(req, pathname) {
    const reqHdrRaw = req.headers

    // CORS preflight
    if (
        req.method === 'OPTIONS' &&
        reqHdrRaw.has('access-control-request-headers')
    ) {
        return new Response(null, PREFLIGHT_INIT)
    }

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
        return new Response('blocked', {
            status: 403
        })
    }

    // ============================================================
    // KEY 鉴权
    // ============================================================
    let authenticatedByBasic = false

    if (ENABLE_KEY_AUTH) {
        let key = null
        const authHeader = reqHdrRaw.get('Authorization')

        // ========================================================
        // 1. Bearer Auth
        // ========================================================
        if (authHeader && /^Bearer\s+/i.test(authHeader)) {
            key = authHeader.replace(/^Bearer\s+/i, '').trim()
        }

        // ========================================================
        // 2. Basic Auth
        // Git 兼容模式：
        //   username = 任意
        //   password = GHProxy KEY
        // ========================================================
        if (
            !key &&
            authHeader &&
            /^Basic\s+/i.test(authHeader)
        ) {
            try {
                const encoded = authHeader.replace(/^Basic\s+/i, '').trim()
                const decoded = atob(encoded)
                const separator = decoded.indexOf(':')

                if (separator !== -1) {
                    // 用户名忽略
                    // 密码作为 KEY
                    key = decoded.slice(separator + 1)
                    authenticatedByBasic = true
                }
            } catch (e) {
                console.error('Basic Auth parse failed:', e)
                key = null
            }
        }

        // ========================================================
        // 3. URL ?key=
        // ========================================================
        if (!key) {
            const url = new URL(req.url)
            const urlKey = url.searchParams.get('key')

            if (urlKey) {
                key = urlKey
            }
        }

        // ========================================================
        // Git 请求识别
        // ========================================================
        const isGit =
            urlStr.includes('.git') ||
            urlStr.includes('git-upload-pack') ||
            urlStr.includes('git-receive-pack') ||
            urlStr.includes('/info/refs')

        // ========================================================
        // 没有 KEY
        // ========================================================
        if (!key) {
            if (isGit) {
                return new Response(
                    'Unauthorized: Git authentication required',
                    {
                        status: 401,
                        headers: {
                            'WWW-Authenticate': 'Basic realm="GitHub Proxy"',
                            'Content-Type': 'text/plain;charset=UTF-8'
                        }
                    }
                )
            }

            return new Response(
                'Forbidden: 缺少 key 参数',
                {
                    status: 403,
                    headers: {
                        'Content-Type': 'text/plain;charset=UTF-8'
                    }
                }
            )
        }

        // ========================================================
        // KEY 验证
        // ========================================================
        const validationResult = validateKey(key)

        if (!validationResult.valid) {
            return new Response(
                validationResult.error,
                {
                    status: validationResult.status || 403,
                    headers: validationResult.headers || {}
                }
            )
        }

        // ========================================================
        // 临时 KEY 警告（仅记录，不向上游泄露）
        // ========================================================
        if (validationResult.warning) {
            // 这里暂时不放进 GitHub 请求头
            // 避免任何鉴权相关信息向上游泄露
        }
    }

    // ============================================================
    // 构造真正发往 GitHub 的请求头
    //
    // 注意：
    // 不再直接使用 req.headers
    // 明确禁止 Authorization / Proxy-Authorization
    // ============================================================
    const reqHdrNew = new Headers()

    for (const [name, value] of reqHdrRaw.entries()) {
        const lowerName = name.toLowerCase()

        if (
            lowerName === 'authorization' ||
            lowerName === 'proxy-authorization'
        ) {
            continue
        }

        reqHdrNew.set(name, value)
    }

    // ============================================================
    // URL 处理
    // ============================================================
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }

    const urlObj = newUrl(urlStr)

    if (!urlObj) {
        return new Response(
            'Invalid URL',
            {
                status: 400
            }
        )
    }

    // ============================================================
    // 发往 GitHub
    // ============================================================
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: req.body
    }

    return proxy(urlObj, reqInit, req)
}

// ============================================================
// 代理函数
// ============================================================

async function proxy(urlObj, reqInit, originalReq) {
    const res = await fetch(urlObj.href, reqInit)
    const resHdrOld = res.headers
    const resHdrNew = new Headers(resHdrOld)

    const status = res.status

    if (resHdrNew.has('location')) {
        let _location = resHdrNew.get('location')
        if (checkUrl(_location)) {
            resHdrNew.set('location', PREFIX + _location)
        } else {
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
}// ============================================================
// 是否启用 KEY 鉴权（true = 启用，false = 禁用）
const ENABLE_KEY_AUTH = true

// 是否启用远程注入功能（true = 启用，false = 禁用）
const ENABLE_INJECTION = true

// 远程注入配置文件地址（请替换为你的 GitHub 仓库地址）
// 如果 ENABLE_INJECTION = false，此配置无效  此链接为仓库默认注入地址
const INJECTION_CONFIG_URL = 'https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/injections.json'

// ============================================================
// KEY 配置区域（仅当 ENABLE_KEY_AUTH = true 时生效）
// ============================================================
// 主 KEY（请替换为你自己的密钥）
const MY_KEY = 'Set-your-own-key'

// 临时 KEY（请替换为你自己的密钥）
const TEMP_KEY_TIME_LIMITED = 'Set-your-own-key'

// 临时 KEY 的有效期（北京时间）
const START_TIME = '2000-01-01 00:00:00'
const END_TIME = '2000-01-01 00:00:00'

// ============================================================
// 最小回退注入配置（当远程注入拉取失败或 ENABLE_INJECTION = false 时使用）
// ============================================================
const FALLBACK_INJECTIONS = [
    {
        position: 'afterBody',
        html: `
<!-- ====== 注入生效提示 ====== -->
<style>
  #injection-badge {
    position: fixed !important;
    top: 12px !important;
    right: 12px !important;
    z-index: 99999 !important;
    background: #2ea043 !important;
    color: #ffffff !important;
    padding: 4px 14px !important;
    border-radius: 9999px !important;
    font-size: 12px !important;
    font-weight: 500 !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    box-shadow: 0 2px 8px rgba(46, 160, 67, 0.35) !important;
    border: none !important;
    pointer-events: none !important;
    user-select: none !important;
    letter-spacing: 0.3px !important;
  }
  @media (max-width: 480px) {
    #injection-badge {
      top: 8px !important;
      right: 8px !important;
      font-size: 10px !important;
      padding: 3px 10px !important;
    }
  }
</style>
<div id="injection-badge">✓ 注入生效</div>
`
    }
]

// ============================================================
// 路由正则表达式
// ============================================================
const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

// ============================================================
// 工具函数
// ============================================================

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

/**
 * 将北京时间字符串转换为 UTC 时间戳 (毫秒)
 * @param {string} beijingTimeStr 格式: 'YYYY-MM-DD HH:MM:SS'
 */
function beijingToUTC(beijingTimeStr) {
    const [datePart, timePart] = beijingTimeStr.split(' ')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute, second] = timePart.split(':').map(Number)
    return Date.UTC(year, month - 1, day, hour - 8, minute, second)
}

/**
 * 检查临时 KEY 是否在有效期内
 */
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
 * 密钥校验函数（仅当 ENABLE_KEY_AUTH = true 时生效）
 * @param {string} key - 待验证的密钥
 * @returns {Object} { valid: boolean, error: string, status: number, headers: Object, warning?: string }
 */
function validateKey(key) {
    // 检查主 KEY
    if (key === MY_KEY) {
        return { valid: true }
    }

    // 检查临时 KEY
    if (key === TEMP_KEY_TIME_LIMITED) {
        const timeCheck = checkTimeLimitedKey()
        if (timeCheck.valid) {
            const result = { valid: true }
            if (timeCheck.remainingDays < 3) {
                result.warning = `密钥剩余 ${Math.ceil(timeCheck.remainingDays)} 天过期`
            }
            return result
        }
        if (timeCheck.reason === 'expired') {
            return { valid: false, status: 403, error: 'Out Of Date' }
        }
        return { valid: false, status: 403, error: 'Forbidden' }
    }

    // 密钥无效
    return {
        valid: false,
        status: 403,
        error: 'Forbidden'
    }
}

/**
 * 对 HTML 内容执行注入
 * @param {string} html - 原始 HTML 内容
 * @param {Array} injections - 注入配置数组
 * @returns {string} 注入后的 HTML
 */
function applyInjections(html, injections) {
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
 * @returns {Promise<Array>} 注入配置数组
 */
async function fetchRemoteInjections() {
    try {
        const response = await fetch(INJECTION_CONFIG_URL, {
            headers: {
                'User-Agent': 'Cloudflare-Worker'
            }
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()

        if (data && Array.isArray(data.injections)) {
            return data.injections
        } else {
            throw new Error('无效的 JSON 结构：缺少 "injections" 数组')
        }
    } catch (error) {
        console.error('拉取远程注入配置失败:', error)
        return null
    }
}

// ============================================================
// 主请求处理器
// ============================================================

async function fetchHandler(e) {
    const req = e.request
    const urlStr = req.url
    const urlObj = new URL(urlStr)
    let path = urlObj.searchParams.get('q')
    let remoteInjections = null

    if (path) {
        return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
    }

    path = urlObj.href.slice(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')

    // ========== 首页注入处理 ==========
    if (urlObj.pathname === '/' || urlObj.pathname === PREFIX) {
        // 检查是否为兼容模式（通过 ?compat=1 参数），绕过所有注入
        if (urlObj.searchParams.has('compat')) {
            return fetch(ASSET_URL)
        }

        // 如果注入功能已禁用，直接返回上游页面
        if (!ENABLE_INJECTION) {
            return fetch(ASSET_URL)
        }

        // 尝试拉取远程注入配置
        try {
            remoteInjections = await fetchRemoteInjections()
        } catch (e) {
            // 拉取失败，使用降级方案
        }

        const resp = await fetch(ASSET_URL)
        const html = await resp.text()
        const injections = (remoteInjections && Array.isArray(remoteInjections))
            ? remoteInjections
            : FALLBACK_INJECTIONS
        const injectedHtml = applyInjections(html, injections)
        return new Response(injectedHtml, {
            headers: {
                'Content-Type': 'text/html; charset=UTF-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'access-control-allow-origin': '*'
            }
        })
    }
    // ========== 注入结束 ==========

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

// ============================================================
// HTTP 处理器（鉴权 + 路由）
// ============================================================

function httpHandler(req, pathname) {
    const reqHdrRaw = req.headers

    // CORS preflight
    if (
        req.method === 'OPTIONS' &&
        reqHdrRaw.has('access-control-request-headers')
    ) {
        return new Response(null, PREFLIGHT_INIT)
    }

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
        return new Response('blocked', {
            status: 403
        })
    }

    // ============================================================
    // KEY 鉴权
    // ============================================================
    let authenticatedByBasic = false

    if (ENABLE_KEY_AUTH) {
        let key = null
        const authHeader = reqHdrRaw.get('Authorization')

        // ========================================================
        // 1. Bearer Auth
        // ========================================================
        if (authHeader && /^Bearer\s+/i.test(authHeader)) {
            key = authHeader.replace(/^Bearer\s+/i, '').trim()
        }

        // ========================================================
        // 2. Basic Auth
        // Git 兼容模式：
        //   username = 任意
        //   password = GHProxy KEY
        // ========================================================
        if (
            !key &&
            authHeader &&
            /^Basic\s+/i.test(authHeader)
        ) {
            try {
                const encoded = authHeader.replace(/^Basic\s+/i, '').trim()
                const decoded = atob(encoded)
                const separator = decoded.indexOf(':')

                if (separator !== -1) {
                    // 用户名忽略
                    // 密码作为 KEY
                    key = decoded.slice(separator + 1)
                    authenticatedByBasic = true
                }
            } catch (e) {
                console.error('Basic Auth parse failed:', e)
                key = null
            }
        }

        // ========================================================
        // 3. URL ?key=
        // ========================================================
        if (!key) {
            const url = new URL(req.url)
            const urlKey = url.searchParams.get('key')

            if (urlKey) {
                key = urlKey
            }
        }

        // ========================================================
        // Git 请求识别
        // ========================================================
        const isGit =
            urlStr.includes('.git') ||
            urlStr.includes('git-upload-pack') ||
            urlStr.includes('git-receive-pack') ||
            urlStr.includes('/info/refs')

        // ========================================================
        // 没有 KEY
        // ========================================================
        if (!key) {
            if (isGit) {
                return new Response(
                    'Unauthorized: Git authentication required',
                    {
                        status: 401,
                        headers: {
                            'WWW-Authenticate': 'Basic realm="GitHub Proxy"',
                            'Content-Type': 'text/plain;charset=UTF-8'
                        }
                    }
                )
            }

            return new Response(
                'Forbidden: 缺少 key 参数',
                {
                    status: 403,
                    headers: {
                        'Content-Type': 'text/plain;charset=UTF-8'
                    }
                }
            )
        }

        // ========================================================
        // KEY 验证
        // ========================================================
        const validationResult = validateKey(key)

        if (!validationResult.valid) {
            return new Response(
                validationResult.error,
                {
                    status: validationResult.status || 403,
                    headers: validationResult.headers || {}
                }
            )
        }

        // ========================================================
        // 临时 KEY 警告（仅记录，不向上游泄露）
        // ========================================================
        if (validationResult.warning) {
            // 这里暂时不放进 GitHub 请求头
            // 避免任何鉴权相关信息向上游泄露
        }
    }

    // ============================================================
    // 构造真正发往 GitHub 的请求头
    //
    // 注意：
    // 不再直接使用 req.headers
    // 明确禁止 Authorization / Proxy-Authorization
    // ============================================================
    const reqHdrNew = new Headers()

    for (const [name, value] of reqHdrRaw.entries()) {
        const lowerName = name.toLowerCase()

        if (
            lowerName === 'authorization' ||
            lowerName === 'proxy-authorization'
        ) {
            continue
        }

        reqHdrNew.set(name, value)
    }

    // ============================================================
    // URL 处理
    // ============================================================
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }

    const urlObj = newUrl(urlStr)

    if (!urlObj) {
        return new Response(
            'Invalid URL',
            {
                status: 400
            }
        )
    }

    // ============================================================
    // 发往 GitHub
    // ============================================================
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: req.body
    }

    return proxy(urlObj, reqInit, req)
}

// ============================================================
// 代理函数
// ============================================================

async function proxy(urlObj, reqInit, originalReq) {
    const res = await fetch(urlObj.href, reqInit)
    const resHdrOld = res.headers
    const resHdrNew = new Headers(resHdrOld)

    const status = res.status

    if (resHdrNew.has('location')) {
        let _location = resHdrNew.get('location')
        if (checkUrl(_location)) {
            resHdrNew.set('location', PREFIX + _location)
        } else {
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

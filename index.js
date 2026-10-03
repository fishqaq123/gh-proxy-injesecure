
'use strict'

/**
 * ============================================================
 * InjeSecure — gh-proxy 增强分支
 * 注入框架 + 统一鉴权 + 大文件流式传输
 * ============================================================
 */

// ============================================================
// 静态资源地址
// ============================================================
const ASSET_URL = 'https://hunshcn.github.io/gh-proxy/'
const PREFIX = '/'

const Config = {
    jsdelivr: 0
}

const whiteList = []

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
const ENABLE_KEY_AUTH = true
const ENABLE_INJECTION = true
const ENABLE_KEY_DIALOG = true

const INJECTION_CONFIG_URL =
    'https://raw.githubusercontent.com/fishqaq123/Injections-For-My-GHproxy/master/injections.json'

// ============================================================
// KEY 配置
// ============================================================
const MY_KEY = 'Set-your-own-key'
const TEMP_KEY_TIME_LIMITED = 'Set-your-own-key'

const START_TIME = '2000-01-01 00:00:00'
const END_TIME = '2000-01-01 00:00:00'

// ============================================================
// 最小回退注入配置
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

/**
 * 计算 chunk 字节大小
 */
function streamByteSize(chunk) {
    if (chunk == null) return 0

    if (typeof chunk === 'string') {
        return new TextEncoder().encode(chunk).byteLength
    }

    if (ArrayBuffer.isView(chunk)) {
        return chunk.byteLength
    }

    if (chunk instanceof ArrayBuffer) {
        return chunk.byteLength
    }

    return 0
}

/**
 * 原生流直接传递，不增加额外转换队列
 */
function ensureStreamBody(body) {
    return body == null ? null : body
}

/**
 * 检查流是否提前结束
 *
 * expectedLength 为当前 HTTP 响应体的长度，
 * 对于 206 响应，通常是当前分块长度，而不是完整文件长度。
 *
 * 不会缓存整个文件。
 */
function createCheckedStream(body, expectedLength) {
    if (!body) return null

    const reader = body.getReader()
    let received = 0
    let finished = false

    return new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await reader.read()

                if (done) {
                    finished = true

                    if (
                        expectedLength !== null &&
                        received !== expectedLength
                    ) {
                        throw new Error(
                            `Incomplete stream: expected ${expectedLength} bytes, received ${received} bytes`
                        )
                    }

                    controller.close()
                    return
                }

                const size = streamByteSize(value)
                received += size

                controller.enqueue(value)
            } catch (error) {
                console.error('Stream transfer error:', error)

                try {
                    await reader.cancel(error)
                } catch (_) {}

                controller.error(error)
            }
        },

        async cancel(reason) {
            if (!finished) {
                try {
                    await reader.cancel(reason)
                } catch (error) {
                    console.error('Stream cancel error:', error)
                }
            }
        }
    })
}

/**
 * 判断请求是否为浏览器页面导航
 */
function isBrowserNavigation(req) {
    const accept = req.headers.get('Accept') || ''
    const secFetchMode = req.headers.get('Sec-Fetch-Mode') || ''
    const secFetchDest = req.headers.get('Sec-Fetch-Dest') || ''

    if (secFetchMode === 'navigate' && secFetchDest === 'document') {
        return true
    }

    if (req.method === 'GET' && accept.includes('text/html')) {
        return true
    }

    return false
}

// ============================================================
// KEY 对话框页面
// ============================================================
function buildKeyDialogPage(reqUrl, reason = 'missing') {
    const targetUrl = new URL(reqUrl)
    targetUrl.searchParams.delete('key')

    const targetHref = targetUrl.toString()

    const titleText = reason === 'invalid'
        ? '密钥无效，请重新输入'
        : '需要访问密钥'

    const msgText = reason === 'invalid'
        ? '提供的 key 无效，请重新输入。'
        : '此代理需要输入访问密钥 (key)。'

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titleText}</title>
<style>
* { box-sizing: border-box; }
body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d1117;
    color: #c9d1d9;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 24px;
}
.card {
    width: 100%;
    max-width: 420px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 28px 24px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
.card h1 {
    font-size: 18px;
    margin: 0 0 8px;
    color: #f0f6fc;
    font-weight: 600;
}
.card p {
    font-size: 13px;
    line-height: 1.6;
    color: #8b949e;
    margin: 0 0 20px;
}
label {
    display: block;
    font-size: 13px;
    margin-bottom: 6px;
    color: #c9d1d9;
}
input[type="password"], input[type="text"] {
    width: 100%;
    padding: 10px 12px;
    font-size: 14px;
    color: #f0f6fc;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 8px;
    outline: none;
    transition: border-color .15s, box-shadow .15s;
}
input:focus {
    border-color: #2ea043;
    box-shadow: 0 0 0 3px rgba(46,160,67,0.25);
}
.row {
    display: flex;
    gap: 10px;
    margin-top: 18px;
}
button {
    flex: 1;
    padding: 10px 14px;
    font-size: 14px;
    font-weight: 600;
    border-radius: 8px;
    border: 1px solid #30363d;
    background: #21262d;
    color: #c9d1d9;
    cursor: pointer;
    transition: background .15s, border-color .15s;
}
button:hover { background: #30363d; }
button.primary {
    background: #238636;
    border-color: #2ea043;
    color: #fff;
}
button.primary:hover { background: #2ea043; }
.error {
    color: #f85149;
    font-size: 12px;
    margin-top: 10px;
    display: none;
}
.hint {
    font-size: 11px;
    color: #6e7681;
    margin-top: 16px;
    line-height: 1.5;
}
.hint code {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 11px;
}
</style>
</head>
<body>
<div class="card">
    <h1>${titleText}</h1>
    <p>${msgText}</p>
    <form id="keyForm" autocomplete="off">
        <label for="keyInput">访问密钥</label>
        <input id="keyInput" type="password" placeholder="请输入 key" autofocus>
        <div class="error" id="errMsg">请输入有效的 key</div>
        <div class="row">
            <button type="button" id="cancelBtn">取消</button>
            <button type="submit" class="primary">确认</button>
        </div>
    </form>
    <div class="hint">
        也可直接在 URL 上附加 <code>?key=你的密钥</code>，
        便于脚本或书签使用。
    </div>
</div>
<script>
(function () {
    var target = ${JSON.stringify(targetHref)};
    var form = document.getElementById('keyForm');
    var input = document.getElementById('keyInput');
    var errMsg = document.getElementById('errMsg');

    setTimeout(function () {
        input.focus();
    }, 50);

    function go(k) {
        if (!k) {
            errMsg.style.display = 'block';
            input.focus();
            return;
        }

        var u = new URL(target);
        u.searchParams.set('key', k);
        window.location.replace(u.toString());
    }

    form.addEventListener('submit', function (ev) {
        ev.preventDefault();

        var v = input.value.trim();

        if (!v) {
            errMsg.style.display = 'block';
            input.focus();
            return;
        }

        go(v);
    });

    document.getElementById('cancelBtn').addEventListener('click', function () {
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = 'about:blank';
        }
    });

    input.addEventListener('input', function () {
        errMsg.style.display = 'none';
    });
})();
</script>
</body>
</html>`

    return new Response(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=UTF-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'access-control-allow-origin': '*'
        }
    })
}

// ============================================================
// Fetch 入口
// ============================================================
addEventListener('fetch', e => {
    const ret = fetchHandler(e)
        .catch(err => {
            console.error('Worker error:', err)

            return makeRes(
                'cfworker error:\n' + (err.stack || err.message || String(err)),
                502
            )
        })

    e.respondWith(ret)
})

// ============================================================
// URL 检查
// ============================================================
function checkUrl(u) {
    if (!u) return false

    for (const i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
        if (i.test(u)) {
            return true
        }
    }

    return false
}

// ============================================================
// 北京时间转 UTC
// ============================================================
function beijingToUTC(beijingTimeStr) {
    const [datePart, timePart] = beijingTimeStr.split(' ')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute, second = 0] = timePart.split(':').map(Number)

    return Date.UTC(year, month - 1, day, hour - 8, minute, second)
}

// ============================================================
// 临时 KEY 有效期检查
// ============================================================
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

// ============================================================
// KEY 校验
// ============================================================
function validateKey(key) {
    if (key === MY_KEY) {
        return { valid: true }
    }

    if (key === TEMP_KEY_TIME_LIMITED) {
        const timeCheck = checkTimeLimitedKey()

        if (timeCheck.valid) {
            const result = { valid: true }

            if (timeCheck.remainingDays < 3) {
                result.warning =
                    `密钥剩余 ${Math.ceil(timeCheck.remainingDays)} 天过期`
            }

            return result
        }

        if (timeCheck.reason === 'expired') {
            return {
                valid: false,
                status: 403,
                error: 'Out Of Date'
            }
        }

        return {
            valid: false,
            status: 403,
            error: 'Forbidden'
        }
    }

    return {
        valid: false,
        status: 403,
        error: 'Forbidden'
    }
}

// ============================================================
// 提取请求中的 KEY
// 支持：Authorization Bearer / Basic、URL ?key=
// ============================================================
function extractKey(req, reqHdrRaw) {
    let key = null

    const authHeader = reqHdrRaw.get('Authorization')

    // Bearer Auth
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
        key = authHeader.replace(/^Bearer\s+/i, '').trim()
    }

    // Basic Auth
    if (!key && authHeader && /^Basic\s+/i.test(authHeader)) {
        try {
            const encoded = authHeader
                .replace(/^Basic\s+/i, '')
                .trim()

            const decoded = atob(encoded)
            const separator = decoded.indexOf(':')

            if (separator !== -1) {
                key = decoded.slice(separator + 1)
            }
        } catch (e) {
            console.error('Basic Auth parse failed:', e)
            key = null
        }
    }

    // URL ?key=
    if (!key) {
        const url = new URL(req.url)
        const urlKey = url.searchParams.get('key')

        if (urlKey) {
            key = urlKey
        }
    }

    return key
}

// ============================================================
// HTML 注入
// ============================================================
function applyInjections(html, injections) {
    let result = html

    for (const inj of injections) {
        if (!inj || typeof inj.html !== 'string') {
            continue
        }

        switch (inj.position) {
            case 'afterBody':
                result = result.replace(
                    /<body[^>]*>/i,
                    match => match + inj.html
                )
                break

            case 'beforeHeadEnd':
                result = result.replace(
                    /<\/head>/i,
                    `${inj.html}</head>`
                )
                break

            default:
                break
        }
    }

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

    result = result.replace(
        /<\/body>/i,
        `${footerLink}</body>`
    )

    return result
}

// ============================================================
// 远程注入配置
// ============================================================
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
        }

        throw new Error('无效的 JSON 结构：缺少 "injections" 数组')
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

    // 兼容 ?q= 形式
    if (path) {
        const redirectUrl = new URL(
            'https://' + urlObj.host + PREFIX + path
        )

        const key = urlObj.searchParams.get('key')

        if (key) {
            redirectUrl.searchParams.set('key', key)
        }

        return Response.redirect(redirectUrl.toString(), 301)
    }

    path = urlObj.href
        .slice(urlObj.origin.length + PREFIX.length)
        .replace(/^https?:\/+/, 'https://')

    // ========================================================
    // 首页注入处理
    // ========================================================
    if (urlObj.pathname === '/' || urlObj.pathname === PREFIX) {
        if (urlObj.searchParams.has('compat')) {
            return fetch(ASSET_URL)
        }

        if (!ENABLE_INJECTION) {
            return fetch(ASSET_URL)
        }

        remoteInjections = await fetchRemoteInjections()

        const resp = await fetch(ASSET_URL)
        const html = await resp.text()

        const injections =
            remoteInjections && Array.isArray(remoteInjections)
                ? remoteInjections
                : FALLBACK_INJECTIONS

        const injectedHtml = applyInjections(html, injections)

        return new Response(injectedHtml, {
            status: resp.status,
            headers: {
                'Content-Type': 'text/html; charset=UTF-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'access-control-allow-origin': '*'
            }
        })
    }

    // ========================================================
    // 代理路由
    // ========================================================
    if (
        exp1.test(path) ||
        exp5.test(path) ||
        exp6.test(path) ||
        exp3.test(path)
    ) {
        return httpHandler(req, path)
    } else if (exp2.test(path)) {
        if (Config.jsdelivr) {
            const newUrl = path
                .replace('/blob/', '@')
                .replace(
                    /^(?:https?:\/\/)?github\.com/i,
                    'https://cdn.jsdelivr.net/gh'
                )

            return Response.redirect(newUrl, 302)
        } else {
            path = path.replace('/blob/', '/raw/')
            return httpHandler(req, path)
        }
    } else if (exp4.test(path)) {
        if (Config.jsdelivr) {
            const newUrl = path
                .replace(
                    /(?<=com\/.+?\/.+?)\/(.+?\/)/,
                    '@$1'
                )
                .replace(
                    /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/i,
                    'https://cdn.jsdelivr.net/gh'
                )

            return Response.redirect(newUrl, 302)
        } else {
            return httpHandler(req, path)
        }
    }

    return fetch(ASSET_URL + path)
}

// ============================================================
// HTTP 处理器：鉴权 + 路由
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

    // ========================================================
    // 白名单
    // ========================================================
    let flag = !Boolean(whiteList.length)

    for (const item of whiteList) {
        if (urlStr.includes(item)) {
            flag = true
            break
        }
    }

    if (!flag) {
        return new Response('blocked', {
            status: 403
        })
    }

    // ========================================================
    // KEY 鉴权
    // ========================================================
    if (ENABLE_KEY_AUTH) {
        const key = extractKey(req, reqHdrRaw)

        const isGit =
            urlStr.includes('.git') ||
            urlStr.includes('git-upload-pack') ||
            urlStr.includes('git-receive-pack') ||
            urlStr.includes('/info/refs')

        const isNav =
            ENABLE_KEY_DIALOG &&
            isBrowserNavigation(req)

        // 缺少 KEY
        if (!key) {
            if (isNav && !isGit) {
                return buildKeyDialogPage(req.url, 'missing')
            }

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

        // 验证 KEY
        const validationResult = validateKey(key)

        if (!validationResult.valid) {
            if (isNav && !isGit) {
                return buildKeyDialogPage(req.url, 'invalid')
            }

            return new Response(validationResult.error, {
                status: validationResult.status || 403,
                headers: validationResult.headers || {}
            })
        }
    }

    // ========================================================
    // 构造发往 GitHub 的请求头
    // ========================================================
    const reqHdrNew = new Headers()

    const excludedHeaders = new Set([
        'authorization',
        'proxy-authorization',
        'host',
        'connection',
        'keep-alive',
        'transfer-encoding',
        'te',
        'trailer',
        'upgrade',
        'accept-encoding',
        'content-length'
    ])

    for (const [name, value] of reqHdrRaw.entries()) {
        const lowerName = name.toLowerCase()

        if (excludedHeaders.has(lowerName)) {
            continue
        }

        reqHdrNew.set(name, value)
    }

    // 请求未压缩的响应，降低内容长度不一致风险
    reqHdrNew.set('Accept-Encoding', 'identity')

    // ========================================================
    // URL 处理
    // ========================================================
    if (!/^https?:\/\//i.test(urlStr)) {
        urlStr = 'https://' + urlStr
    }

    const urlObj = newUrl(urlStr)

    if (!urlObj) {
        return new Response('Invalid URL', {
            status: 400
        })
    }

    // ========================================================
    // 请求配置
    // ========================================================
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: ['GET', 'HEAD'].includes(req.method)
            ? undefined
            : req.body
    }

    return proxy(urlObj, reqInit, req)
}

// ============================================================
// 代理函数：流式转发 + 长度检查
// ============================================================
async function proxy(urlObj, reqInit, originalReq) {
    const res = await fetch(urlObj.href, reqInit)

    const resHdrNew = new Headers(res.headers)
    const status = res.status

    // ========================================================
    // 重定向处理
    // ========================================================
    if (resHdrNew.has('location')) {
        const location = resHdrNew.get('location')

        if (checkUrl(location)) {
            // 代理内部重定向，保留 KEY
            const key = extractKey(
                originalReq,
                originalReq.headers
            )

            let newLocation = PREFIX + location

            if (key) {
                const sep = newLocation.includes('?') ? '&' : '?'
                newLocation =
                    newLocation +
                    sep +
                    'key=' +
                    encodeURIComponent(key)
            }

            resHdrNew.set('location', newLocation)
        } else {
            // 外部重定向，跟随上游地址
            const redirectUrl = newUrl(
                new URL(location, urlObj).toString()
            )

            if (!redirectUrl) {
                return new Response('Invalid redirect URL', {
                    status: 502
                })
            }

            // 防止递归重定向无限循环
            if (reqInit.redirect === 'follow') {
                return new Response('Too many redirects', {
                    status: 502
                })
            }

            reqInit.redirect = 'follow'

            return proxy(
                redirectUrl,
                reqInit,
                originalReq
            )
        }
    }

    // ========================================================
    // CORS
    // ========================================================
    resHdrNew.set('access-control-expose-headers', '*')
    resHdrNew.set('access-control-allow-origin', '*')

    // 移除安全策略头
    resHdrNew.delete('content-security-policy')
    resHdrNew.delete('content-security-policy-report-only')
    resHdrNew.delete('clear-site-data')

    // ========================================================
    // 文件长度处理
    // ========================================================
    const contentLength = resHdrNew.get('content-length')
    const contentRange = resHdrNew.get('content-range')

    let expectedLength = null

    if (contentRange) {
        // 例如 bytes 0-999/5000
        const match = contentRange.match(
            /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i
        )

        if (match) {
            const start = Number(match[1])
            const end = Number(match[2])
            const total = match[3]

            // 当前分块实际长度
            expectedLength = end - start + 1

            if (total !== '*') {
                resHdrNew.set(
                    'X-File-Total-Length',
                    total
                )
            }
        }
    } else if (
        contentLength !== null &&
        /^\d+$/.test(contentLength)
    ) {
        expectedLength = Number(contentLength)

        resHdrNew.set(
            'X-File-Total-Length',
            contentLength
        )
    }

    // 如果 Content-Length 可用，则用于完整性检查
    if (
        expectedLength === null &&
        contentLength !== null &&
        /^\d+$/.test(contentLength)
    ) {
        expectedLength = Number(contentLength)
    }

    // ========================================================
    // 缓存策略
    // ========================================================
    const country =
        originalReq.headers.get('CF-IPCountry') || 'XX'

    if (contentLength && country !== 'CN') {
        const fileSizeMB =
            parseInt(contentLength, 10) / (1024 * 1024)

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
            resHdrNew.set(
                'Cache-Control',
                `public, max-age=${cacheMaxAge}`
            )

            resHdrNew.set(
                'X-Cache-Policy',
                `country=${country}_size=${fileSizeMB.toFixed(2)}MB_age=${cacheMaxAge}`
            )
        }
    } else if (country === 'CN') {
        resHdrNew.set(
            'X-Cache-Policy',
            'direct-china'
        )
    }

    // 警告头
    const warningHeader =
        originalReq.headers.get('X-Warning')

    if (warningHeader) {
        resHdrNew.set('X-Warning', warningHeader)
    }

    // ========================================================
    // 响应体处理
    // ========================================================
    const noBody =
        originalReq.method === 'HEAD' ||
        status === 204 ||
        status === 304

    // HEAD / 204 / 304 不应携带响应体
    const body = noBody ? null : res.body

    return new Response(body, {
        status,
        headers: resHdrNew,
    })
}

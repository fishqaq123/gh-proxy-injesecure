'use strict'

/**
 * ============================================================
 * InjeSecure — gh-proxy 增强分支
 * 注入框架 + 统一鉴权 + 大文件流式传输
 * ============================================================
 *
 * static files (404.html, sw.js, conf.js)
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
const ENABLE_KEY_AUTH = true
const ENABLE_INJECTION = true

/**
 * 浏览器界面默认使用对话框询问 key
 * key 参数保留，作为退回与自动脚本支持
 */
const ENABLE_KEY_DIALOG = true

const INJECTION_CONFIG_URL =
    'https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/injections.json'

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
 * 判断是否为原生 ReadableStream
 */
function isNativeStream(body) {
    return !!(
        body &&
        typeof body === 'object' &&
        typeof body.pipeTo === 'function' &&
        typeof body.getReader === 'function'
    )
}

/**
 * 转换响应体
 */
function toStreamBody(body) {
    return body == null ? null : body
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

    return chunk.length || 0
}

/**
 * 确保流式转发
 */
function ensureStreamBody(body) {
    if (!isNativeStream(body)) {
        return toStreamBody(body)
    }

    try {
        const transformer = new TransformStream(
            {
                transform(chunk, controller) {
                    controller.enqueue(chunk)
                },
            },
            {
                highWaterMark: 8,
                size: streamByteSize,
            },
            {
                highWaterMark: 8,
                size: streamByteSize,
            }
        )

        return body.pipeThrough(transformer)
    } catch (e) {
        console.error('ensureStreamBody fallback:', e)
        return body
    }
}

/**
 * 判断请求是否为浏览器页面导航
 * 用于决定是走对话框询问 key，还是走 401/403 回退
 */
function isBrowserNavigation(req) {
    const accept = req.headers.get('Accept') || ''
    const secFetchMode = req.headers.get('Sec-Fetch-Mode') || ''
    const secFetchDest = req.headers.get('Sec-Fetch-Dest') || ''

    // 明确是页面导航
    if (secFetchMode === 'navigate' && secFetchDest === 'document') {
        return true
    }

    // 浏览器地址栏直接打开时，Accept 里会包含 text/html
    if (req.method === 'GET' && accept.includes('text/html')) {
        return true
    }

    return false
}

/**
 * 构造“对话框询问 key”页面
 * 页面加载后自动弹出对话框，提交后带 key 重新跳转
 */
function buildKeyDialogPage(reqUrl, reason = 'missing') {
    const targetUrl = new URL(reqUrl)
    // 移除旧的 key，避免干扰
    targetUrl.searchParams.delete('key')
    const targetHref = targetUrl.toString()

    const titleText = reason === 'invalid'
        ? '密钥无效，请重新输入'
        : '需要访问密钥'

    const msgText = reason === 'invalid'
        ? '提供的 key 无效，请重新输入。'
        : '此代理需要输入访问密钥 (key)。'

    // 注意：脚本中的 `${}` 会与模板字符串冲突，
    // 这里使用字符串拼接，避免转义问题。
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
      <button type="submit" class="primary" id="submitBtn">确认</button>
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

  // 页面加载后自动聚焦输入框
  setTimeout(function () { input.focus(); }, 50);

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
        .catch(err => makeRes('cfworker error:\n' + err.stack, 502))

    e.respondWith(ret)
})

// ============================================================
// URL 检查
// ============================================================
function checkUrl(u) {
    for (let i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
        if (u.search(i) === 0) {
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
    const [hour, minute, second] = timePart.split(':').map(Number)

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
        switch (inj.position) {
            case 'afterBody':
                result = result.replace(
                    /<body[^>]*>/,
                    match => match + inj.html
                )
                break

            case 'beforeHeadEnd':
                result = result.replace(
                    '</head>',
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

    result = result.replace('</body>', `${footerLink}</body>`)

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

    if (path) {
        // 兼容 ?q= 形式时，一并透传 key
        const redirectUrl = new URL('https://' + urlObj.host + PREFIX + path)
        const key = urlObj.searchParams.get('key')
        if (key) {
            redirectUrl.searchParams.set('key', key)
        }
        return Response.redirect(redirectUrl.toString(), 301)
    }

    path = urlObj.href
        .slice(urlObj.origin.length + PREFIX.length)
        .replace(/^https?:\/+/, 'https://')

    // 首页注入处理
    if (urlObj.pathname === '/' || urlObj.pathname === PREFIX) {
        if (urlObj.searchParams.has('compat')) {
            return fetch(ASSET_URL)
        }

        if (!ENABLE_INJECTION) {
            return fetch(ASSET_URL)
        }

        try {
            remoteInjections = await fetchRemoteInjections()
        } catch (e) {
            // 使用回退注入配置
        }

        const resp = await fetch(ASSET_URL)
        const html = await resp.text()

        const injections =
            remoteInjections && Array.isArray(remoteInjections)
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

    // 代理路由
    if (
        path.search(exp1) === 0 ||
        path.search(exp5) === 0 ||
        path.search(exp6) === 0 ||
        path.search(exp3) === 0
    ) {
        return httpHandler(req, path)
    } else if (path.search(exp2) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path
                .replace('/blob/', '@')
                .replace(
                    /^(?:https?:\/\/)?github\.com/,
                    'https://cdn.jsdelivr.net/gh'
                )

            return Response.redirect(newUrl, 302)
        } else {
            path = path.replace('/blob/', '/raw/')
            return httpHandler(req, path)
        }
    } else if (path.search(exp4) === 0) {
        if (Config.jsdelivr) {
            const newUrl = path
                .replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1')
                .replace(
                    /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/,
                    'https://cdn.jsdelivr.net/gh'
                )

            return Response.redirect(newUrl, 302)
        } else {
            return httpHandler(req, path)
        }
    } else {
        return fetch(ASSET_URL + path)
    }
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

    // KEY 鉴权
    if (ENABLE_KEY_AUTH) {
        const key = extractKey(req, reqHdrRaw)

        // Git 请求识别
        const isGit =
            urlStr.includes('.git') ||
            urlStr.includes('git-upload-pack') ||
            urlStr.includes('git-receive-pack') ||
            urlStr.includes('/info/refs')

        // 是否为浏览器页面导航
        const isNav = ENABLE_KEY_DIALOG && isBrowserNavigation(req)

        // 缺少 KEY
        if (!key) {
            // 浏览器页面导航：走对话框询问
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
            // 浏览器页面导航且 key 无效：走对话框重新询问
            if (isNav && !isGit) {
                return buildKeyDialogPage(req.url, 'invalid')
            }

            return new Response(validationResult.error, {
                status: validationResult.status || 403,
                headers: validationResult.headers || {}
            })
        }
    }

    // 构造发往 GitHub 的请求头
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

    // URL 处理
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }

    const urlObj = newUrl(urlStr)

    if (!urlObj) {
        return new Response('Invalid URL', {
            status: 400
        })
    }

    // 请求配置
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
// 代理函数：大文件流式转发及长度处理
// ============================================================
async function proxy(urlObj, reqInit, originalReq) {
    const res = await fetch(urlObj.href, reqInit)

    const resHdrNew = new Headers(res.headers)
    const status = res.status

    // 重定向处理
    if (resHdrNew.has('location')) {
        const location = resHdrNew.get('location')

        if (checkUrl(location)) {
            // 重定向时保留 key，避免用户再次输入
            const key = extractKey(originalReq, originalReq.headers)
            let newLocation = PREFIX + location

            if (key) {
                const sep = newLocation.includes('?') ? '&' : '?'
                newLocation = newLocation + sep + 'key=' + encodeURIComponent(key)
            }

            resHdrNew.set('location', newLocation)
        } else {
            reqInit.redirect = 'follow'
            return proxy(newUrl(location), reqInit, originalReq)
        }
    }

    // CORS
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

    // Content-Range 示例：
    // bytes 0-999/5000
    // 其中 5000 是整个文件长度。
    if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/)

        if (match) {
            resHdrNew.set('X-File-Total-Length', match[1])
        }
    } else if (contentLength) {
        resHdrNew.set('X-File-Total-Length', contentLength)
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
        resHdrNew.set('X-Cache-Policy', 'direct-china')
    }

    // 警告头
    const warningHeader = originalReq.headers.get('X-Warning')

    if (warningHeader) {
        resHdrNew.set('X-Warning', warningHeader)
    }

    // ========================================================
    // 响应体处理
    // ========================================================

    // HEAD、204、304 响应不应携带响应体
    const noBody =
        originalReq.method === 'HEAD' ||
        status === 204 ||
        status === 304

    // 继续使用原生 ReadableStream，避免将大文件
    // 整体读取到内存中。
    const body = noBody
        ? null
        : ensureStreamBody(res.body)

    return new Response(body, {
        status,
        headers: resHdrNew,
    })
}
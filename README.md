# ✨ InjeSecure

**InjeSecure — gh-proxy 增强分支 · 注入框架 + 统一鉴权**

InjeSecure 是在 gh-proxy 原版基础上构建的增强版本，主要解决两个原版没有覆盖的需求：

1. 🎨 **页面自定义**：在不修改原页面核心代码的前提下，通过非侵入式的注入框架为页面叠加自定义内容（导航栏、样式、统计脚本等）。注入内容与核心逻辑完全解耦，可远程配置、可一键回滚，即使“玩坏”也能通过 `?compat=1` 瞬间恢复原貌。

2. 🔐 **访问鉴权**：原版 gh-proxy 完全开放，任何人知道你的域名就能使用。InjeSecure 新增了一套完整的密钥鉴权系统，统一覆盖 HTTP 下载（`?key=`）和Git Clone（`Basic Authorization`），并支持临时密钥和过期警告。


## ✨ 特性

- 🚀 完整的 GitHub 资源代理：支持 Release、Archive、Raw、Git Clone 等所有 GitHub 资源
- 🔑 统一密钥鉴权：HTTP 下载（`?key=`）和 Git Clone（`Basic Authorization`）使用同一套密钥体系，支持主密钥和临时密钥
- 🧩 非侵入式注入框架：支持在 `<body>` 后或 `</head>` 前注入自定义 HTML/CSS/JS，注入失败不影响原页面
- ☁️ 远程配置支持：注入内容通过 JSON 配置文件远程拉取，无需重新部署 Worker
- ↩️ 一键回滚兼容模式：访问 `?compat=1` 可瞬间切回原始页面，零风险调试
- 🇨🇳 中国直连优化：针对中国大陆访问自动禁用缓存，提升国内用户连接体验
- 🐍 实验性开放python版本支持


## 🚀 快速部署（Cloudflare Workers）

### 方式一：手动部署

1. 登录 Cloudflare Dashboard
2. 进入 Workers 和 Pages → 创建应用程序 → 创建 Worker
3. 将 worker.js 中的代码完整复制到编辑器中
4. 根据下方配置说明修改密钥和注入配置
5. 点击保存并部署

### 方式二：使用 Wrangler CLI

```bash
git clone https://github.com/你的用户名/injesecure.git
cd injesecure
npm install -g wrangler
wrangler login
wrangler deploy
```

⚙️ 配置说明

在 Worker 代码顶部，你可以修改以下配置：

功能开关

```javascript
const ENABLE_KEY_AUTH = true   // 是否启用密钥验证（true/false）
const ENABLE_INJECTION = true  // 是否启用页面注入（true/false）
```

密钥设置

```javascript
const MY_KEY = 'Set-your-own-key'                    // 主密钥
const TEMP_KEY_TIME_LIMITED = 'Set-your-own-temp-key' // 临时密钥
const START_TIME = '2000-01-01 00:00:00'             // 临时密钥生效时间（北京时间）
const END_TIME = '2000-01-02 00:00:00'               // 临时密钥失效时间（北京时间）
```

注入配置

```javascript
// 远程注入配置文件地址（留空则仅使用回退注入）
const REMOTE_INJECTION_URL = ''  // 例如：'https://raw.githubusercontent.com/你的用户名/仓库名/main/injections.json'
```

远程配置文件格式示例：

```json
{
    "version": "1.0",
    "injections": [
        {
            "position": "afterBody",
            "html": "<style>body { background: #f6f8fa; }</style>"
        }
    ]
}
```

注入位置说明：

· afterBody：在 <body> 标签之后插入
· beforeHeadEnd：在 </head> 标签之前插入

回退注入

当远程拉取失败或未配置时，使用 FALLBACK_INJECTIONS 中的内容。默认在右上角显示“注入生效”提示。

🔑 使用方式

普通下载

```bash
wget "https://your-worker-domain/github.com/用户名/仓库名/...?key=你的主密钥"
```

Git Clone

传递密钥：

```bash
git clone https://your-worker-domain/https://github.com/用户名/仓库名.git

//注意：之后会按流程请求用户名与密码，用户名随意，密码就是key，用户名不会进入鉴权逻辑
//当然，你也可以在前面加上username:your_key@（不推荐此方法，这样会在你的.bash_history留下key痕迹）
```
兼容模式

访问以下地址可查看未注入的原始页面：

```
https://your-worker-domain/?compat=1
```

临时密钥警告

当临时密钥剩余不足 3 天时，响应头中会包含 X-Warning: Key expires in X days，便于脚本自动监测。

📊 与原版 gh-proxy 的对比

· 🔓 原版不支持页面注入 → ✨ InjeSecure 支持非侵入式注入框架

· 🔓 原版完全开放 → 🔐 InjeSecure 新增统一密钥鉴权系统

· 🔓 原版 Git Clone 无鉴权 → 🔐 InjeSecure 支持 Git Clone 鉴权

· 🔓 原版不支持临时密钥 → ⏳ InjeSecure 支持临时密钥

· 🔓 原版无回滚机制 → ↩️ InjeSecure 支持 ?compat=1 一键回滚

📄 License

MIT License

🙏 致谢

· 原版 gh-proxy 项目：[hunshcn/gh-proxy](https://github.com/hunshcn/gh-proxy)

· [Cloudflare Workers](https://dash.cloudflare.com/login) 提供边缘计算基础设施

```
```

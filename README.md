# ✨ InjeSecure

**InjeSecure — gh-proxy 增强分支 · 注入框架 + 统一鉴权**

InjeSecure 是在 gh-proxy 原版基础上构建的增强版本，主要解决两个原版没有覆盖的需求：

1. 🎨 **页面自定义**：在不修改原页面核心代码的前提下，通过非侵入式的注入框架为页面叠加自定义内容（导航栏、样式、统计脚本等）。注入内容与核心逻辑完全解耦，可远程配置、可一键回滚，即使"玩坏"也能通过 `?compat=1` 瞬间恢复原貌。

2. 🔐 **访问鉴权**：原版 gh-proxy 完全开放，任何人知道你的域名就能使用。InjeSecure 新增了一套完整的密钥鉴权系统，统一覆盖 HTTP 下载（`?key=`）和 Git Clone（`Basic Authorization`），并支持临时密钥和过期警告。


## ✨ 特性

- 🚀 完整的 GitHub 资源代理：支持 Release、Archive、Raw、Git Clone 等所有 GitHub 资源
- 🔑 统一密钥鉴权：HTTP 下载（`?key=`）和 Git Clone（`Basic Authorization`）使用同一套密钥体系，支持主密钥和临时密钥
- 🧩 非侵入式注入框架：支持在 `<body>` 后或 `</head>` 前注入自定义 HTML/CSS/JS，注入失败不影响原页面
- ☁️ 远程配置支持：注入内容通过 JSON 配置文件远程拉取，无需重新部署 Worker
- ↩️ 一键回滚兼容模式：访问 `?compat=1` 可瞬间切回原始页面，零风险调试
- 🇨🇳 中国直连优化：针对中国大陆访问自动禁用缓存，提升国内用户连接体验
- 🐍 本地 Python 管理服务：提供配置热更新、进程管理与控制台交互能力


## 🚀 部署方式

### 方式一：Cloudflare Workers（原版 Worker 模式）

#### 1. 手动部署

1. 登录 Cloudflare Dashboard
2. 进入 Workers 和 Pages → 创建应用程序 → 创建 Worker
3. 将 `index.js` 中的代码完整复制到编辑器中
4. 根据下方配置说明修改密钥和注入配置
5. 点击保存并部署

#### 2. 使用 Wrangler CLI

```bash
git clone https://github.com/fishqaq123/gh-proxy-injesecure.git
cd gh-proxy-injesecure
npm install -g wrangler
wrangler login
wrangler deploy
```

#### 配置说明（Worker 模式）

在 Worker 代码顶部，你可以修改以下配置：

**功能开关**

```javascript
const ENABLE_KEY_AUTH = true   // 是否启用密钥验证（true/false）
const ENABLE_INJECTION = true  // 是否启用页面注入（true/false）
```

**密钥设置**

```javascript
const MY_KEY = 'Set-your-own-key'                    // 主密钥
const TEMP_KEY_TIME_LIMITED = 'Set-your-own-temp-key' // 临时密钥
const START_TIME = '2000-01-01 00:00:00'             // 临时密钥生效时间（北京时间）
const END_TIME = '2000-01-02 00:00:00'               // 临时密钥失效时间（北京时间）
```

**注入配置**

```javascript
// 远程注入配置文件地址
const INJECTION_CONFIG_URL = 'https://raw.githubusercontent.com/你的用户名/仓库名/main/injections.json'
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
- `afterBody`：在 `<body>` 标签之后插入
- `beforeHeadEnd`：在 `</head>` 标签之前插入

**回退注入**

当远程拉取失败或未配置时，使用 `FALLBACK_INJECTIONS` 中的内容。默认在右上角显示"注入生效"提示。

---

### 方式二：本地 Python 服务部署

本地 Python 服务模式适合需要完整配置管理能力（即需要本地部署的）的用户，提供配置动态更新、基础进程管理等功能。

#### 系统要求

| 组件 | 版本要求 |
|------|---------|
| Python | 3.8 及以上 |
| Node.js | 14.x 及以上 |
| 操作系统 | Windows / Linux / macOS |

#### 安装步骤

**1. 下载最新稳定版releases**

**2. 启动服务**

```bash
python server.py
```

首次启动时，服务会自动：
- 创建 `independences/`、`CP/`、`log/` 目录
- 从 GitHub 下载 `runtime.js` 和 `index.js` 到 `independences/`
- 从 GitHub 下载 `configprovider.py` 到 `CP/`
- 生成默认的 `config.ini` 和 `injections.json`

**3. 管理控制台**

服务启动后，控制台会进入交互模式，支持以下命令：

| 命令 | 说明 |
|------|------|
| `help` | 显示帮助信息 |
| `version` | 显示版本信息 |
| `restart` | 重启整个服务（所有子进程） |
| `restart cp` | 只重启 CP 服务 |
| `restart index` | 只重启 Node.js 进程 |
| `stop` | 停止整个服务 |
| `stop cp` | 只停止 CP 服务 |
| `get <key>` | 获取配置值 |
| `set <k1> <v1> [<k2> <v2> ...]` | 动态设置配置并重启 Node.js |

#### 配置文件（CP/config.ini）

```ini
[ConfigProvider]
enable_key_auth = true
enable_injection = true
my_key = your-secret-key
temp_key_time_limited = your-temp-key
start_time = 2026-01-01 00:00:00
end_time = 2026-12-31 23:59:59
injection_config_url = https://raw.githubusercontent.com/xxx/injections.json
whitelist = ["owner/repo1", "owner/repo2"]
main_working_port = 8080
cp_working_port = 8081
```

#### 关于 ConfigProvider（CP）

ConfigProvider 是本地 Python 服务中的配置提供组件，负责：

- 管理本地 `config.ini` 和 `injections.json`
- 向 Worker 主程序提供统一的配置访问接口
- 提供远程注入配置的使用方式

**禁用 CP（使用纯 Worker 模式）**

在 `server.py` 所在目录创建 `.nocp` 文件即可禁用 CP 相关功能：

```bash
touch .nocp   # Linux/macOS
# 或创建一个名为 .nocp 的空文件（Windows）
```

禁用后，服务以纯 Worker 模式运行，不启动 CP 进程，不生成配置文件。

#### 目录结构（本地模式）

```
.
├── server.py                 # Python 管理服务主程序
├── independences/            # Node.js 运行目录
│   ├── runtime.js            # Node.js 运行时
│   └── index.js              # Worker 主程序
├── CP/                       # ConfigProvider 目录
│   ├── config.ini            # 配置文件
│   ├── configprovider.py     # CP 服务程序
│   └── injections.json       # 本地注入配置
├── log/
│   └── server.log            # 运行日志
└── .nocp                     # 可选：禁用 CP 的标志文件
```


## 🔑 使用方式

### 普通下载

```bash
wget "https://your-worker-domain/github.com/用户名/仓库名/...?key=你的主密钥"
```

### Git Clone

传递密钥：

```bash
git clone https://your-worker-domain/https://github.com/用户名/仓库名.git
```

> 注意：之后会按流程请求用户名与密码，用户名随意，密码就是 KEY，用户名不会进入鉴权逻辑。当然，你也可以在前面加上 `username:your_key@`（不推荐此方法，这样会在你的 `.bash_history` 留下 KEY 痕迹）。

### 兼容模式

访问以下地址可查看未注入的原始页面：

```
https://your-worker-domain/?compat=1
```

### 临时密钥警告

当临时密钥剩余不足 3 天时，响应头中会包含 `X-Warning: Key expires in X days`，便于脚本自动监测。


## 📊 与原版 gh-proxy 的对比

| 功能 | 原版 gh-proxy | InjeSecure |
|------|:---:|:---:|
| GitHub 资源代理 | ✅ | ✅ |
| 页面注入框架 | ❌ | ✅ |
| 统一密钥鉴权 | ❌ | ✅ |
| Git Clone 鉴权 | ❌ | ✅ |
| 临时密钥支持 | ❌ | ✅ |
| 一键回滚（`?compat=1`） | ❌ | ✅ |
| 中国直连优化 | ❌ | ✅ |
| 本地管理服务 | ❌ | ✅ |
| 配置热更新 | ❌ | ✅ |


## 📄 License

MIT License


## 🙏 致谢

- 原版 gh-proxy 项目：[hunshcn/gh-proxy](https://github.com/hunshcn/gh-proxy)
- [Cloudflare Workers](https://dash.cloudflare.com/login) 提供边缘计算基础设施

import os
import json
import configparser
import urllib.request
import urllib.error
import http.server
import threading
import socket
import time
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config.ini")
INJECTION_FILE = os.path.join(BASE_DIR, "injections.json")
DEFAULT_URL = "https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/injections.json"

CP_VERSION = "v1.0stable.cp(2608221740)"

# 问题12：使用小写键名，与 server.py 保持一致
DEFAULT_CONFIG = {
    "enable_key_auth": "true",
    "enable_injection": "true",
    "my_key": "Set-your-own-key",
    "temp_key_time_limited": "Set-your-own-key",
    "start_time": "2000-01-01 00:00:00",
    "end_time": "2000-01-01 00:00:00",
    "injection_config_url": DEFAULT_URL,
    "cp_working_port": "8081",
    "main_working_port": "8080",
    "whitelist": "[]"
}

INJECTION_SOURCE_FILE = INJECTION_FILE

# 问题3：使用可控制的 Event 以支持优雅退出
shutdown_event = threading.Event()
server_instance = None


# =========================
# 日志（问题13已忽略，保持原有方式）
# =========================

def log(message):
    print(message, flush=True)


# =========================
# 确保目录存在（问题5）
# =========================

def ensure_dir_exists(filepath):
    """确保文件所在目录存在"""
    directory = os.path.dirname(filepath)
    if directory and not os.path.exists(directory):
        try:
            os.makedirs(directory, exist_ok=True)
            log(f"Created directory: {directory}")
        except Exception as e:
            log(f"[ERROR] Failed to create directory {directory}: {e}")
            return False
    return True


# =========================
# config.ini 初始化
# =========================

def init_config():
    if os.path.exists(CONFIG_FILE):
        log("config.ini already exists")
        return

    log("config.ini not found, creating...")

    config = configparser.ConfigParser()
    config["ConfigProvider"] = DEFAULT_CONFIG

    try:
        # 问题5：确保目录存在
        ensure_dir_exists(CONFIG_FILE)
        
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            config.write(f)

        log("config.ini created successfully")

    except Exception as e:
        log(f"[ERROR] Failed creating config.ini: {e}")


# =========================
# 读取配置（问题4修复）
# =========================

def load_config():
    """返回 ConfigParser 的 SectionProxy 或默认配置字典的兼容包装"""
    config = configparser.ConfigParser()

    try:
        config.read(CONFIG_FILE, encoding="utf-8")
    except Exception as e:
        log(f"[WARN] Failed reading config.ini: {e}")
        return _dict_to_section_proxy(DEFAULT_CONFIG)

    if "ConfigProvider" not in config:
        log("[WARN] ConfigProvider section not found in config.ini")
        return _dict_to_section_proxy(DEFAULT_CONFIG)

    return config["ConfigProvider"]


def _dict_to_section_proxy(data):
    """将字典转换为类似 SectionProxy 的对象"""
    class SectionProxyWrapper:
        def __init__(self, data):
            self._data = data
        
        def get(self, key, fallback=None):
            return self._data.get(key, fallback)
        
        def __getitem__(self, key):
            return self._data[key]
        
        def __contains__(self, key):
            return key in self._data
        
        def items(self):
            return self._data.items()
    
    return SectionProxyWrapper(data)


# =========================
# 创建默认 injections.json
# =========================

def create_default_injection():
    log("Creating default injections.json...")

    default_data = {
        "version": "1.0",
        "injections": [
            {
                "position": "afterBody",
                "html": """
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
"""
            }
        ]
    }

    try:
        # 问题5：确保目录存在
        ensure_dir_exists(INJECTION_FILE)
        
        with open(INJECTION_FILE, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=4, ensure_ascii=False)

        log("Default injections.json created")

    except Exception as e:
        log(f"[ERROR] Failed creating injections.json: {e}")


# =========================
# 验证 JSON 格式（问题6）
# =========================

def validate_json_file(filepath):
    """验证文件是否为有效的 JSON"""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        return True, data
    except json.JSONDecodeError as e:
        return False, str(e)
    except Exception as e:
        return False, str(e)


# =========================
# 下载文件（问题2：添加超时）
# =========================

def download_file_with_timeout(url, filepath, timeout=30):
    """带超时的文件下载"""
    try:
        log(f"Downloading from {url}")
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'Mozilla/5.0')
        
        with urllib.request.urlopen(req, timeout=timeout) as response:
            content = response.read()
            
            # 问题5：确保目录存在
            ensure_dir_exists(filepath)
            
            with open(filepath, "wb") as f:
                f.write(content)
            
            log(f"Downloaded successfully: {filepath}")
            return True
    except urllib.error.URLError as e:
        log(f"[WARN] Download failed (network): {e}")
        return False
    except socket.timeout as e:
        log(f"[WARN] Download failed (timeout): {e}")
        return False
    except Exception as e:
        log(f"[WARN] Download failed: {e}")
        return False


# =========================
# 判断是否为 HTTP / HTTPS
# =========================

def is_http_url(value):
    value = value.strip().lower()
    return value.startswith("http://") or value.startswith("https://")


# =========================
# 去除配置值首尾引号（问题7：处理嵌套引号）
# =========================

def clean_config_value(value):
    value = value.strip()
    
    # 循环去除成对引号，直到没有引号或只剩一个引号
    while len(value) >= 2:
        if (value.startswith("'") and value.endswith("'")) or \
           (value.startswith('"') and value.endswith('"')):
            value = value[1:-1].strip()
        else:
            break
    
    return value


# =========================
# 判断 Windows 驱动器路径
# =========================

def is_windows_drive_path(value):
    return (len(value) >= 3 and value[0].isalpha() and value[1] == ":" and value[2] in ("\\", "/"))


# =========================
# 判断 Windows UNC 路径（问题8：改进）
# =========================

def is_windows_unc_path(value):
    return value.startswith("\\\\") or value.startswith("//")


# =========================
# 判断是否为绝对本地路径
# =========================

def is_absolute_local_path(value):
    # 当前系统支持的绝对路径
    if os.path.isabs(value):
        return True
    
    # Windows C:\xxx / C:/xxx
    if is_windows_drive_path(value):
        return True
    
    # Windows \\server\share\xxx
    if is_windows_unc_path(value):
        return True
    
    return False


# =========================
# 初始化 injections.json
# =========================

def init_injection():
    global INJECTION_SOURCE_FILE

    config = load_config()

    url = config.get("injection_config_url", DEFAULT_URL)

    # 去除首尾空白以及成对引号（问题7修复）
    url = clean_config_value(url)

    # =========================
    # HTTP / HTTPS
    # =========================

    if is_http_url(url):
        INJECTION_SOURCE_FILE = INJECTION_FILE

        # 如果文件存在，验证其有效性（问题6）
        if os.path.exists(INJECTION_FILE):
            valid, _ = validate_json_file(INJECTION_FILE)
            if valid:
                log("injections.json already exists and is valid")
                return
            else:
                log("[WARN] injections.json exists but is invalid, re-downloading...")
                # 备份损坏的文件
                try:
                    backup = INJECTION_FILE + ".bak"
                    if os.path.exists(backup):
                        os.remove(backup)
                    os.rename(INJECTION_FILE, backup)
                    log(f"Backed up corrupted file to: {backup}")
                except Exception:
                    pass

        log("Downloading injections.json...")

        # 问题2：使用带超时的下载
        if download_file_with_timeout(url, INJECTION_FILE, timeout=30):
            # 问题6：验证下载的文件
            valid, error = validate_json_file(INJECTION_FILE)
            if valid:
                log("injections.json downloaded and validated successfully")
                return
            else:
                log(f"[WARN] Downloaded file is invalid JSON: {error}")
                # 删除无效文件，使用默认
                try:
                    os.remove(INJECTION_FILE)
                except Exception:
                    pass
        else:
            log("[WARN] Download failed, generating default injections.json")

        # 下载失败或无效，使用默认
        create_default_injection()
        return

    # =========================
    # 本地路径
    # =========================

    log("INJECTION_CONFIG_URL is not HTTP/HTTPS")
    log(f"Checking local injection path: {url}")

    # =========================
    # 禁止相对路径
    # =========================

    if not is_absolute_local_path(url):
        log(f"[WARN] Local injection path is not an absolute path: {url}")
        log("Relative paths are not supported")
        INJECTION_SOURCE_FILE = INJECTION_FILE
        log("Using CP directory injections.json as injection provider")

        if not os.path.exists(INJECTION_FILE):
            create_default_injection()
        else:
            # 问题6：验证现有文件
            valid, _ = validate_json_file(INJECTION_FILE)
            if not valid:
                log("[WARN] Existing injections.json is invalid, regenerating...")
                create_default_injection()

        return

    # =========================
    # 绝对路径
    # =========================

    local_path = os.path.abspath(url)
    log(f"Resolved local injection path: {local_path}")

    # =========================
    # 检查文件是否存在（问题9：放宽文件名限制）
    # =========================

    if os.path.isfile(local_path):
        # 问题6：验证文件是否为有效的 JSON
        valid, error = validate_json_file(local_path)
        if valid:
            # 问题9：允许任何 .json 文件，不强制要求 injections.json
            INJECTION_SOURCE_FILE = local_path
            log(f"Using local injections.json: {local_path}")
            return
        else:
            log(f"[WARN] Local injection file is not valid JSON: {error}")
    else:
        log(f"[WARN] Local injection path does not exist: {local_path}")

    # =========================
    # 回退到 CP/injections.json
    # =========================

    INJECTION_SOURCE_FILE = INJECTION_FILE
    log("Using CP directory injections.json as injection provider")

    if not os.path.exists(INJECTION_FILE):
        create_default_injection()
    else:
        # 问题6：验证现有文件
        valid, _ = validate_json_file(INJECTION_FILE)
        if not valid:
            log("[WARN] Existing injections.json is invalid, regenerating...")
            create_default_injection()


# =========================
# Provider HTTP 服务（问题1：添加超时）
# =========================

class ProviderHandler(http.server.BaseHTTPRequestHandler):
    # 问题1：设置超时
    timeout = 30

    def do_GET(self):
        # 问题10：file_path 初始化为 None
        file_path = None
        content_type = "text/plain"

        # =========================
        # /version
        # =========================

        if self.path == "/version":
            version_data = {"version": CP_VERSION}

            try:
                data = json.dumps(version_data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                log("Served /version")
            except Exception as e:
                log(f"[ERROR] Serve /version failed: {e}")
                self.send_error(500)

            return

        # =========================
        # /injections.json
        # =========================

        elif self.path == "/injections.json":
            file_path = INJECTION_SOURCE_FILE
            content_type = "application/json"

        # =========================
        # /config.ini
        # =========================

        elif self.path == "/config.ini":
            file_path = CONFIG_FILE
            content_type = "text/plain"

        # =========================
        # 404
        # =========================

        else:
            self.send_error(404)
            return

        # =========================
        # 问题10：检查 file_path 是否为 None
        # =========================

        if file_path is None:
            self.send_error(500, "Internal error: file_path is None")
            log("[ERROR] file_path is None for path: {self.path}")
            return

        # =========================
        # 文件不存在
        # =========================

        if not os.path.isfile(file_path):
            self.send_error(404, "File not found")
            log(f"[WARN] Requested file not found: {file_path}")
            return

        # =========================
        # 读取并返回
        # =========================

        try:
            with open(file_path, "rb") as f:
                data = f.read()

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(data)
            
            # 截断过长的路径用于日志
            display_path = file_path if len(file_path) < 80 else "..." + file_path[-77:]
            log(f"Served {self.path} from {display_path}")

        except Exception as e:
            log(f"[ERROR] Serve failed: {e}")
            self.send_error(500)

    # =========================
    # 问题11：明确处理非 GET 请求
    # =========================

    def do_POST(self):
        self.send_error(405, "Method Not Allowed")
        log(f"[WARN] 405 POST {self.path}")

    def do_PUT(self):
        self.send_error(405, "Method Not Allowed")
        log(f"[WARN] 405 PUT {self.path}")

    def do_DELETE(self):
        self.send_error(405, "Method Not Allowed")
        log(f"[WARN] 405 DELETE {self.path}")

    def do_HEAD(self):
        self.send_error(405, "Method Not Allowed")
        log(f"[WARN] 405 HEAD {self.path}")

    def log_message(self, format, *args):
        return


# =========================
# 启动 Provider（问题1：添加超时）
# =========================

def start_provider():
    global server_instance

    config = load_config()

    try:
        port = int(config.get("cp_working_port", "8081"))
    except ValueError:
        log("[WARN] Invalid cp_working_port, using 8081")
        port = 8081

    try:
        # 问题1：使用带超时的 Server
        server_instance = http.server.HTTPServer(("127.0.0.1", port), ProviderHandler)
        # 设置 socket 超时
        server_instance.socket.settimeout(30)
        
        # 问题3：支持 shutdown
        server_instance.timeout = 1

        log(f"Provider running on http://localhost:{port}")

        # 问题3：使用 server_instance 的 serve_forever 并支持 shutdown
        while not shutdown_event.is_set():
            server_instance.handle_request()

        log("Provider shutting down...")

    except KeyboardInterrupt:
        log("Provider interrupted by user")
    except Exception as e:
        log(f"[Provider ERROR] {e}")
    finally:
        if server_instance:
            server_instance.server_close()
            server_instance = None


# =========================
# 主入口（问题3：使用可控制的 Event）
# =========================

def main():
    log("================================================")
    log("ConfigProvider starting")
    log(f"Base directory: {BASE_DIR}")
    log(f"Config file: {CONFIG_FILE}")
    log(f"Injection file: {INJECTION_FILE}")
    log("================================================")

    init_config()
    init_injection()

    log(f"Injection provider source: {INJECTION_SOURCE_FILE}")

    # 启动 provider
    threading.Thread(target=start_provider, daemon=True).start()

    # 问题3：使用可控制的 Event 等待
    try:
        while not shutdown_event.is_set():
            time.sleep(1)
    except KeyboardInterrupt:
        log("Received interrupt, shutting down...")
        shutdown_event.set()


if __name__ == "__main__":
    main()

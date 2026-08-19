import os
import json
import configparser
import urllib.request
import http.server
import threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config.ini")
INJECTION_FILE = os.path.join(BASE_DIR, "injections.json")
DEFAULT_URL = "https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/injections.json"

CP_VERSION = "SnapShot2608191737"

DEFAULT_CONFIG = {
    "ENABLE_KEY_AUTH": "true",
    "MY_KEY": "Set-your-own-key",
    "TEMP_KEY_TIME_LIMITED": "Set-your-own-key",
    "START_TIME": "2000-01-01 00:00:00",
    "END_TIME": "2000-01-01 00:00:00",
    "INJECTION_CONFIG_URL": DEFAULT_URL,
    "CP_WORKING_PORT": "8081",
    "MAIN_WORKING_PORT": "8080",
    "WHITELIST": "[]"
}

INJECTION_SOURCE_FILE = INJECTION_FILE


# =========================
# 日志
# =========================

def log(message):
    print(message, flush=True)


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
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            config.write(f)

        log("config.ini created successfully")

    except Exception as e:
        log(f"[ERROR] Failed creating config.ini: {e}")


# =========================
# 读取配置
# =========================

def load_config():
    config = configparser.ConfigParser()

    try:
        config.read(
            CONFIG_FILE,
            encoding="utf-8"
        )
    except Exception as e:
        log(f"[WARN] Failed reading config.ini: {e}")
        return DEFAULT_CONFIG

    if "ConfigProvider" not in config:
        log("[WARN] ConfigProvider section not found in config.ini")
        return DEFAULT_CONFIG

    return config["ConfigProvider"]


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
                "html": "<style>body { background: #f6f8fa; }</style>"
            }
        ]
    }

    try:
        with open(
            INJECTION_FILE,
            "w",
            encoding="utf-8"
        ) as f:
            json.dump(
                default_data,
                f,
                indent=4,
                ensure_ascii=False
            )

        log("Default injections.json created")

    except Exception as e:
        log(
            f"[ERROR] Failed creating injections.json: {e}"
        )


# =========================
# 判断是否为 HTTP / HTTPS
# =========================

def is_http_url(value):
    value = value.strip().lower()

    return (
        value.startswith("http://")
        or value.startswith("https://")
    )


# =========================
# 去除配置值首尾引号
# =========================

def clean_config_value(value):
    value = value.strip()

    if len(value) >= 2:

        if (
            value.startswith("'")
            and value.endswith("'")
        ):
            value = value[1:-1].strip()

        elif (
            value.startswith('"')
            and value.endswith('"')
        ):
            value = value[1:-1].strip()

    return value


# =========================
# 判断 Windows 驱动器路径
# =========================

def is_windows_drive_path(value):
    return (
        len(value) >= 3
        and value[0].isalpha()
        and value[1] == ":"
        and value[2] in ("\\", "/")
    )


# =========================
# 判断 Windows UNC 路径
# =========================

def is_windows_unc_path(value):
    return value.startswith("\\\\")


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

    url = config.get(
        "INJECTION_CONFIG_URL",
        DEFAULT_URL
    )

    # 去除首尾空白以及成对引号
    url = clean_config_value(url)

    # =========================
    # HTTP / HTTPS
    # =========================

    if is_http_url(url):

        INJECTION_SOURCE_FILE = INJECTION_FILE

        if os.path.exists(INJECTION_FILE):
            log("injections.json already exists")
            return

        log("injections.json not found")
        log("Downloading default injections.json...")

        try:
            urllib.request.urlretrieve(
                url,
                INJECTION_FILE
            )

            log(
                "Default injections.json downloaded successfully"
            )

        except Exception as e:

            log(
                f"[WARN] Download failed: {e}"
            )

            log(
                "Generating local default injections.json"
            )

            create_default_injection()

        return

    # =========================
    # 本地路径
    # =========================

    log(
        "INJECTION_CONFIG_URL is not HTTP/HTTPS"
    )

    log(
        f"Checking local injection path: {url}"
    )

    # =========================
    # 禁止相对路径
    # =========================

    if not is_absolute_local_path(url):

        log(
            f"[WARN] Local injection path is not an absolute path: {url}"
        )

        log(
            "Relative paths are not supported"
        )

        INJECTION_SOURCE_FILE = INJECTION_FILE

        log(
            "Using CP directory injections.json as injection provider"
        )

        if not os.path.exists(INJECTION_FILE):

            log(
                "CP injections.json not found, generating default injections.json"
            )

            create_default_injection()

        return

    # =========================
    # 绝对路径
    # =========================

    local_path = os.path.abspath(url)

    log(
        f"Resolved local injection path: {local_path}"
    )

    # =========================
    # 检查文件
    # =========================

    if os.path.isfile(local_path):

        filename = os.path.basename(
            local_path
        )

        if filename == "injections.json":

            INJECTION_SOURCE_FILE = local_path

            log(
                f"Using local injections.json: {local_path}"
            )

            return

        log(
            f"[WARN] Local injection file is not injections.json: {filename}"
        )

    else:

        log(
            f"[WARN] Local injection path does not exist: {local_path}"
        )

    # =========================
    # 回退到 CP/injections.json
    # =========================

    INJECTION_SOURCE_FILE = INJECTION_FILE

    log(
        "Using CP directory injections.json as injection provider"
    )

    if not os.path.exists(INJECTION_FILE):

        log(
            "CP injections.json not found, generating default injections.json"
        )

        create_default_injection()


# =========================
# Provider HTTP 服务
# =========================

class ProviderHandler(
    http.server.BaseHTTPRequestHandler
):

    def do_GET(self):

        file_path = None
        content_type = "text/plain"

        # =========================
        # /version
        # =========================

        if self.path == "/version":

            version_data = {
                "version": CP_VERSION
            }

            try:

                data = json.dumps(
                    version_data
                ).encode("utf-8")

                self.send_response(200)

                self.send_header(
                    "Content-Type",
                    "application/json"
                )

                self.send_header(
                    "Content-Length",
                    str(len(data))
                )

                self.end_headers()

                self.wfile.write(data)

                log(
                    "Served /version"
                )

            except Exception as e:

                log(
                    f"[ERROR] Serve /version failed: {e}"
                )

                self.send_error(500)

            return

        # =========================
        # /injections.json
        # =========================

        elif self.path == "/injections.json":

            file_path = INJECTION_SOURCE_FILE

            content_type = (
                "application/json"
            )

        # =========================
        # /config.ini
        # =========================

        elif self.path == "/config.ini":

            file_path = CONFIG_FILE

            content_type = (
                "text/plain"
            )

        # =========================
        # 404
        # =========================

        else:

            self.send_error(404)

            return

        # =========================
        # 文件不存在
        # =========================

        if not os.path.isfile(file_path):

            self.send_error(
                404,
                "File not found"
            )

            log(
                f"[WARN] Requested file not found: {file_path}"
            )

            return

        # =========================
        # 读取并返回
        # =========================

        try:

            with open(
                file_path,
                "rb"
            ) as f:

                data = f.read()

            self.send_response(200)

            self.send_header(
                "Content-Type",
                content_type
            )

            self.send_header(
                "Content-Length",
                str(len(data))
            )

            self.end_headers()

            self.wfile.write(
                data
            )

            log(
                f"Served {self.path} from {file_path}"
            )

        except Exception as e:

            log(
                f"[ERROR] Serve failed: {e}"
            )

            self.send_error(500)

    def log_message(
        self,
        format,
        *args
    ):
        return


# =========================
# 启动 Provider
# =========================

def start_provider():

    config = load_config()

    try:

        port = int(
            config.get(
                "CP_WORKING_PORT",
                "8081"
            )
        )

    except ValueError:

        log(
            "[WARN] Invalid CP_WORKING_PORT, using 8081"
        )

        port = 8081

    try:

        server = http.server.HTTPServer(
            (
                "127.0.0.1",
                port
            ),
            ProviderHandler
        )

        log(
            f"Provider running on http://localhost:{port}"
        )

        server.serve_forever()

    except Exception as e:

        log(
            f"[Provider ERROR] {e}"
        )


# =========================
# 主入口
# =========================

def main():

    log(
        "================================================"
    )

    log(
        "ConfigProvider starting"
    )

    log(
        f"Base directory: {BASE_DIR}"
    )

    log(
        f"Config file: {CONFIG_FILE}"
    )

    log(
        f"Injection file: {INJECTION_FILE}"
    )

    log(
        "================================================"
    )

    init_config()

    init_injection()

    log(
        f"Injection provider source: {INJECTION_SOURCE_FILE}"
    )

    threading.Thread(
        target=start_provider,
        daemon=True
    ).start()

    threading.Event().wait()


if __name__ == "__main__":
    main()
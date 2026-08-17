import os
import json
import configparser
import urllib.request
import http.server
import threading

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

CONFIG_FILE = os.path.join(
    BASE_DIR,
    "config.ini"
)

INJECTION_FILE = os.path.join(
    BASE_DIR,
    "injections.json"
)

DEFAULT_URL = (
    "https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/injections.json"
)

# CP 版本信息
CP_VERSION = "SnapShot08171104"

DEFAULT_CONFIG = {
    "ENABLE_KEY_AUTH": "true",
    "MY_KEY": "Set-your-own-key",
    "TEMP_KEY_TIME_LIMITED": "Set-your-own-key",
    "START_TIME": "2000-01-01 00:00:00",
    "END_TIME": "2000-01-01 00:00:00",
    "INJECTION_CONFIG_URL": DEFAULT_URL,
    "CP_WORKING_PORT": "8081",
    "MAIN_WORKING_PORT": "8080"
}


def log(message):
    print(
        message,
        flush=True
    )


# =========================
# config.ini 初始化
# =========================

def init_config():

    if os.path.exists(CONFIG_FILE):

        log(
            "config.ini already exists"
        )

        return


    log(
        "config.ini not found, creating..."
    )


    config = configparser.ConfigParser()

    config["ConfigProvider"] = DEFAULT_CONFIG


    try:

        with open(
            CONFIG_FILE,
            "w",
            encoding="utf-8"
        ) as f:

            config.write(f)


        log(
            "config.ini created successfully"
        )


    except Exception as e:

        log(
            f"[ERROR] Failed creating config.ini: {e}"
        )


# =========================
# 读取配置
# =========================

def load_config():

    config = configparser.ConfigParser()

    config.read(
        CONFIG_FILE,
        encoding="utf-8"
    )


    if "ConfigProvider" not in config:

        return DEFAULT_CONFIG


    return config["ConfigProvider"]


# =========================
# 默认 injections.json
# =========================

def create_default_injection():

    log(
        "Creating default injections.json..."
    )


    default_data = {

        "version": "1.0",

        "injections": [

            {

                "position":
                "afterBody",

                "html":
                "<style>body { background: #f6f8fa; }</style>"

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


        log(
            "Default injections.json created"
        )


    except Exception as e:

        log(
            f"[ERROR] Failed creating injections.json: {e}"
        )


# =========================
# injections.json 初始化
# =========================

def init_injection():

    if os.path.exists(INJECTION_FILE):

        log(
            "injections.json already exists"
        )

        return


    config = load_config()


    url = config.get(
        "INJECTION_CONFIG_URL",
        DEFAULT_URL
    )


    log(
        "injections.json not found"
    )

    log(
        "Downloading default injections.json..."
    )


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


# =========================
# Provider HTTP服务
# =========================

class ProviderHandler(
    http.server.BaseHTTPRequestHandler
):

    def do_GET(self):

        file_path = None
        content_type = "text/plain"


        # 版本信息接口
        if self.path == "/version":

            version_data = {
                "version": CP_VERSION
            }

            try:

                data = json.dumps(
                    version_data
                ).encode('utf-8')


                self.send_response(
                    200
                )


                self.send_header(
                    "Content-Type",
                    "application/json"
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
                    "Served /version"
                )


            except Exception as e:

                log(
                    f"[ERROR] Serve /version failed: {e}"
                )

                self.send_error(
                    500
                )

            return


        elif self.path == "/injections.json":

            file_path = INJECTION_FILE

            content_type = (
                "application/json"
            )


        elif self.path == "/config.ini":

            file_path = CONFIG_FILE

            content_type = (
                "text/plain"
            )


        else:

            self.send_error(
                404
            )

            return


        if not os.path.exists(file_path):

            self.send_error(
                404,
                "File not found"
            )

            return


        try:

            with open(
                file_path,
                "rb"
            ) as f:

                data = f.read()


            self.send_response(
                200
            )


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
                f"Served {self.path}"
            )


        except Exception as e:

            log(
                f"[ERROR] Serve failed: {e}"
            )

            self.send_error(
                500
            )


    def log_message(
        self,
        format,
        *args
    ):

        return



def start_provider():

    config = load_config()


    port = int(
        config.get(
            "CP_WORKING_PORT",
            "8081"
        )
    )


    try:

        server = http.server.HTTPServer(
            (
                "127.0.0.1",
                port
            ),
            ProviderHandler
        )


        log(
            f"Provider running on http://127.0.0.1:{port}"
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


    threading.Thread(
        target=start_provider,
        daemon=True
    ).start()


    threading.Event().wait()



if __name__ == "__main__":

    main()

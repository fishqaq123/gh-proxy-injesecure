#!/usr/bin/env python3
# -*- coding:utf-8 -*-

import json
import subprocess
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import os
import sys
import time
import shutil
import configparser
import re
from urllib.parse import urlparse
import signal

node = None
config_provider = None
http_server = None
server_thread = None

request_id = 0
responses = {}
responses_lock = threading.Lock()  # 问题12：添加锁保护 responses

# Directory structure
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEPENDENCES_DIR = os.path.join(BASE_DIR, "independences")
CP_DIR = os.path.join(BASE_DIR, "CP")
LOG_DIR = os.path.join(BASE_DIR, "log")

# Log file
LOG_FILE = os.path.join(LOG_DIR, "server.log")

# Default ports
DEFAULT_MAIN_PORT = 8080
DEFAULT_CP_PORT = 8081

# Runtime ports
main_port = DEFAULT_MAIN_PORT
cp_port = DEFAULT_CP_PORT

# Configuration storage
config_data = {}

# Console control flags
console_running = True
server_ready = False

# Version info
CP_VERSION = "Unknown"

# CP disabled flag
CP_DISABLED = False

# 追踪通过 set 命令设置的键（问题8）
set_by_console = set()


class Tee:
    """Output to both console and file"""
    def __init__(self, filename, mode='a'):
        # Ensure log directory exists
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        self.file = open(filename, mode, encoding='utf-8')
        self.stdout = sys.stdout
        self.stderr = sys.stderr

    def write(self, message):
        self.stdout.write(message)
        self.stdout.flush()
        self.file.write(message)
        self.file.flush()

    def flush(self):
        self.stdout.flush()
        self.file.flush()

    def close(self):
        self.file.close()


def init_directories():
    """Create necessary directories"""
    directories = [INDEPENDENCES_DIR, CP_DIR, LOG_DIR]
    for directory in directories:
        try:
            os.makedirs(directory, exist_ok=True)
            log_message(f"Directory created/verified: {directory}")
        except Exception as e:
            log_message(f"Failed to create directory {directory}: {e}")
            return False
    return True


def log_message(msg):
    """Write log to file and console"""
    timestamp = time.strftime("%m-%d %H:%M:%S")
    log_entry = f"[{timestamp}][Worker-1-main] {msg}"
    # 直接使用 print 写入，Tee 会处理输出
    print(log_entry)


def download_file(url, filename):
    """Download file from URL"""
    try:
        log_message(f"Downloading {filename} from {url}")
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'Mozilla/5.0')
        with urllib.request.urlopen(req, timeout=30) as response:
            content = response.read().decode('utf-8', errors='ignore')
            with open(filename, "w", encoding="utf-8") as f:
                f.write(content)
            log_message(f"Successfully downloaded {filename}")
            return True
    except Exception as e:
        log_message(f"Failed to download {filename}: {e}")
        return False


def check_nocp_file():
    """Check if .nocp file exists in the base directory"""
    global CP_DISABLED
    
    nocp_path = os.path.join(BASE_DIR, ".nocp")
    if os.path.exists(nocp_path):
        CP_DISABLED = True
        log_message("[INFO] .nocp file detected, CP features disabled")
        return True
    return False


def download_configprovider():
    """Download configprovider.py from GitHub"""
    configprovider_url = "https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/additional/configprovider.py"
    configprovider_path = os.path.join(CP_DIR, "configprovider.py")
    
    # Check if .nocp exists
    if check_nocp_file():
        return False
    
    # Check if configprovider.py already exists
    if os.path.exists(configprovider_path) and os.path.getsize(configprovider_path) > 0:
        log_message(f"configprovider.py already exists in CP directory")
        return True
    
    log_message(f"configprovider.py not found, downloading from GitHub...")
    return download_file(configprovider_url, configprovider_path)


def check_and_download_files():
    """Check and download missing files to independences directory"""
    files_needed = [
        ("runtime.js", "https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/runtime/runtime.js"),
        ("index.js", "https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/index.js")
    ]
    
    all_ok = True
    for filename, url in files_needed:
        filepath = os.path.join(INDEPENDENCES_DIR, filename)
        if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
            log_message(f"File {filename} exists and is valid in independences directory")
        else:
            if os.path.exists(filepath):
                log_message(f"File {filename} exists but is empty or corrupted, re-downloading...")
            else:
                log_message(f"File {filename} does not exist, downloading to independences directory...")
            if not download_file(url, filepath):
                all_ok = False
            else:
                # Verify download
                if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
                    log_message(f"File {filename} downloaded successfully to independences directory")
                else:
                    log_message(f"File {filename} download appears to have failed")
                    all_ok = False
    return all_ok


def is_valid_url(url):
    """Check if a string is a valid URL"""
    try:
        result = urlparse(url)
        return all([result.scheme, result.netloc])
    except:
        return False


def fetch_cp_version():
    """Fetch CP version from configprovider"""
    global CP_VERSION, cp_port, CP_DISABLED
    
    # Skip if CP is disabled
    if CP_DISABLED:
        CP_VERSION = "Disabled"
        log_message("CP is disabled, version not available")
        return
    
    try:
        # Try to get version from CP service
        url = f"http://127.0.0.1:{cp_port}/version"
        log_message(f"Fetching CP version from {url}")
        
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'Mozilla/5.0')
        
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                CP_VERSION = data.get('version', 'Unknown')
                log_message(f"CP version fetched: {CP_VERSION}")
            else:
                log_message(f"CP version fetch failed with status: {response.status}")
                CP_VERSION = "Unknown"
    except Exception as e:
        log_message(f"Failed to fetch CP version: {e}")
        CP_VERSION = "Unknown"


def update_index_js_config():
    """Update index.js with configuration from config.ini"""
    global cp_port
    
    index_js_path = os.path.join(INDEPENDENCES_DIR, "index.js")
    
    if not os.path.exists(index_js_path):
        log_message("[ERROR] index.js not found, cannot update configuration")
        return False
    
    try:
        # Read current index.js
        with open(index_js_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Update ENABLE_KEY_AUTH
        if 'enable_key_auth' in config_data:
            key_auth_value = 'true' if config_data['enable_key_auth'].lower() == 'true' else 'false'
            content = re.sub(
                r'(const ENABLE_KEY_AUTH = )(true|false)',
                r'\1' + key_auth_value,
                content
            )
            log_message(f"Updated ENABLE_KEY_AUTH = {key_auth_value}")
        
        # Update ENABLE_INJECTION
        if 'enable_injection' in config_data:
            injection_value = 'true' if config_data['enable_injection'].lower() == 'true' else 'false'
            content = re.sub(
                r'(const ENABLE_INJECTION = )(true|false)',
                r'\1' + injection_value,
                content
            )
            log_message(f"Updated ENABLE_INJECTION = {injection_value}")
        
        # Update MY_KEY
        if 'my_key' in config_data and config_data['my_key'] and config_data['my_key'] != 'Set-your-own-key':
            content = re.sub(
                r"(const MY_KEY = ')[^']*(')",
                r"\1" + config_data['my_key'] + r"\2",
                content
            )
            log_message(f"Updated MY_KEY")
        
        # Update TEMP_KEY_TIME_LIMITED
        if 'temp_key_time_limited' in config_data and config_data['temp_key_time_limited'] and config_data['temp_key_time_limited'] != 'Set-your-own-key':
            content = re.sub(
                r"(const TEMP_KEY_TIME_LIMITED = ')[^']*(')",
                r"\1" + config_data['temp_key_time_limited'] + r"\2",
                content
            )
            log_message(f"Updated TEMP_KEY_TIME_LIMITED")
        
        # Update START_TIME - 使用更精确的匹配
        if 'start_time' in config_data and config_data['start_time']:
            start_time = config_data['start_time'].strip()
            # 如果配置中没有时间部分，默认添加 00:00:00
            if ' ' not in start_time:
                start_time = f"{start_time} 00:00:00"
            
            # 使用更精确的正则：匹配 const START_TIME = '...' 并替换
            pattern = r"const START_TIME = '([^']*)'"
            replacement = f"const START_TIME = '{start_time}'"
            content = re.sub(pattern, replacement, content)
            log_message(f"Updated START_TIME = {start_time}")
        
        # Update END_TIME - 使用更精确的匹配
        if 'end_time' in config_data and config_data['end_time']:
            end_time = config_data['end_time'].strip()
            # 如果配置中没有时间部分，默认添加 23:59:59
            if ' ' not in end_time:
                end_time = f"{end_time} 23:59:59"
            
            pattern = r"const END_TIME = '([^']*)'"
            replacement = f"const END_TIME = '{end_time}'"
            content = re.sub(pattern, replacement, content)
            log_message(f"Updated END_TIME = {end_time}")
        
        # Update INJECTION_CONFIG_URL
        if 'injection_config_url' in config_data and config_data['injection_config_url']:
            injection_url = config_data['injection_config_url'].strip()
            # 验证URL是否有效
            if is_valid_url(injection_url):
                log_message(f"Using remote injection URL: {injection_url}")
            else:
                # 如果URL无效，使用本地地址
                injection_url = f"http://127.0.0.1:{cp_port}/injections.json"
                log_message(f"[WARN] Invalid injection_config_url, using local: {injection_url}")
            
            content = re.sub(
                r"(const INJECTION_CONFIG_URL = ')[^']*(')",
                r"\1" + injection_url + r"\2",
                content
            )
            log_message(f"Updated INJECTION_CONFIG_URL = {injection_url}")
        
        # ====== 更新 whiteList ======
        if 'whitelist' in config_data:
            whitelist_raw = config_data['whitelist'].strip()
            
            # 如果 whitelist 为空或只有空白字符，设置为空数组
            if not whitelist_raw:
                content = re.sub(
                    r"(const whiteList = )\[[^\]]*\]",
                    r"\1[]",
                    content
                )
                log_message("Updated whiteList: [] (empty - allow all)")
            else:
                # 尝试解析为 JSON 数组
                if whitelist_raw.startswith('[') and whitelist_raw.endswith(']'):
                    try:
                        whitelist_items = json.loads(whitelist_raw)
                        if isinstance(whitelist_items, list):
                            # 过滤掉空字符串
                            whitelist_items = [item for item in whitelist_items if item and item.strip()]
                            if whitelist_items:
                                whitelist_str = ', '.join([f"'{item}'" for item in whitelist_items])
                                content = re.sub(
                                    r"(const whiteList = )\[[^\]]*\]",
                                    r"\1[" + whitelist_str + r"]",
                                    content
                                )
                                log_message(f"Updated whiteList (JSON array): {whitelist_items}")
                            else:
                                # 所有项都是空字符串，设置为空数组
                                content = re.sub(
                                    r"(const whiteList = )\[[^\]]*\]",
                                    r"\1[]",
                                    content
                                )
                                log_message("Updated whiteList: [] (empty after filtering)")
                        else:
                            log_message(f"[WARN] whitelist is not a list: {whitelist_items}")
                    except json.JSONDecodeError:
                        log_message(f"[WARN] Failed to parse whitelist as JSON: {whitelist_raw}")
                        # 尝试按逗号分割
                        whitelist_items = [item.strip() for item in whitelist_raw.split(',') if item.strip()]
                        if whitelist_items:
                            whitelist_str = ', '.join([f"'{item}'" for item in whitelist_items])
                            content = re.sub(
                                r"(const whiteList = )\[[^\]]*\]",
                                r"\1[" + whitelist_str + r"]",
                                content
                            )
                            log_message(f"Updated whiteList (comma-separated): {whitelist_items}")
                        else:
                            # 分割后为空，设置为空数组
                            content = re.sub(
                                r"(const whiteList = )\[[^\]]*\]",
                                r"\1[]",
                                content
                            )
                            log_message("Updated whiteList: [] (empty after parsing)")
                else:
                    # 逗号分隔格式: owner/repo1, owner/repo2
                    whitelist_items = [item.strip() for item in whitelist_raw.split(',') if item.strip()]
                    if whitelist_items:
                        whitelist_str = ', '.join([f"'{item}'" for item in whitelist_items])
                        content = re.sub(
                            r"(const whiteList = )\[[^\]]*\]",
                            r"\1[" + whitelist_str + r"]",
                            content
                        )
                        log_message(f"Updated whiteList (comma-separated): {whitelist_items}")
                    else:
                        # 分割后为空，设置为空数组
                        content = re.sub(
                            r"(const whiteList = )\[[^\]]*\]",
                            r"\1[]",
                            content
                        )
                        log_message("Updated whiteList: [] (empty after parsing)")
        else:
            # 如果配置中没有 whitelist，保持默认空数组
            log_message("No whitelist config found, keeping default (allow all)")
        
        # Write updated content back
        with open(index_js_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        log_message("index.js configuration updated successfully")
        return True
        
    except Exception as e:
        log_message(f"[ERROR] Failed to update index.js: {e}")
        return False


def read_config():
    """Read configuration from CP/config.ini"""
    global main_port, cp_port, config_data, CP_DISABLED
    
    # Skip if CP is disabled
    if CP_DISABLED:
        log_message("[INFO] CP is disabled, using default ports")
        log_message(f"  main_working_port = {DEFAULT_MAIN_PORT}")
        log_message(f"  cp_working_port = {DEFAULT_CP_PORT}")
        main_port = DEFAULT_MAIN_PORT
        cp_port = DEFAULT_CP_PORT
        return False
    
    config_path = os.path.join(CP_DIR, "config.ini")
    
    if not os.path.exists(config_path):
        log_message("[WARN] config.ini not found, using default ports")
        log_message(f"  main_working_port = {DEFAULT_MAIN_PORT}")
        log_message(f"  cp_working_port = {DEFAULT_CP_PORT}")
        return False
    
    try:
        config = configparser.ConfigParser()
        config.read(config_path, encoding='utf-8')
        
        # Read all configuration from ConfigProvider section
        if config.has_section('ConfigProvider'):
            for key, value in config.items('ConfigProvider'):
                # 如果 config_data 中已存在该键（通过 set 命令设置），不覆盖
                if key not in config_data:
                    config_data[key] = value
                    log_message(f"Read config: {key} = {value}")
                else:
                    log_message(f"Config {key} already set via console, keeping value: {config_data[key]}")
            
            # Read main_working_port - 优先使用 config_data 中的值
            if 'main_working_port' in config_data:
                try:
                    main_port = int(config_data['main_working_port'])
                    log_message(f"Using main_working_port from config_data: {main_port}")
                except ValueError:
                    log_message(f"[ERROR] Invalid main_working_port in config_data, using default {DEFAULT_MAIN_PORT}")
                    main_port = DEFAULT_MAIN_PORT
            else:
                log_message(f"[WARN] main_working_port not found in config.ini, using default {DEFAULT_MAIN_PORT}")
                main_port = DEFAULT_MAIN_PORT
            
            # Read cp_working_port - 优先使用 config_data 中的值
            if 'cp_working_port' in config_data:
                try:
                    cp_port = int(config_data['cp_working_port'])
                    log_message(f"Using cp_working_port from config_data: {cp_port}")
                except ValueError:
                    log_message(f"[ERROR] Invalid cp_working_port in config_data, using default {DEFAULT_CP_PORT}")
                    cp_port = DEFAULT_CP_PORT
            else:
                log_message(f"[WARN] cp_working_port not found in config.ini, using default {DEFAULT_CP_PORT}")
                cp_port = DEFAULT_CP_PORT
            
            # Update index.js with configuration
            update_index_js_config()
            
            # Fetch CP version
            fetch_cp_version()
            
        else:
            log_message("[WARN] [ConfigProvider] section not found in config.ini")
            log_message("  Using default ports")
            main_port = DEFAULT_MAIN_PORT
            cp_port = DEFAULT_CP_PORT
        
        return True
        
    except Exception as e:
        log_message(f"[ERROR] Failed to read config.ini: {e}")
        log_message(f"  Using default ports: main={DEFAULT_MAIN_PORT}, cp={DEFAULT_CP_PORT}")
        main_port = DEFAULT_MAIN_PORT
        cp_port = DEFAULT_CP_PORT
        return False


def start_config_provider():
    """Start configprovider.py from CP directory if it exists"""
    global config_provider, CP_DISABLED
    
    # Skip if CP is disabled
    if CP_DISABLED:
        log_message("[INFO] CP is disabled, skipping configprovider.py")
        return False
    
    # Download configprovider.py if needed
    if not download_configprovider():
        log_message("[WARN] Failed to download configprovider.py, skipping...")
        return False
    
    config_provider_path = os.path.join(CP_DIR, "configprovider.py")
    
    if not os.path.exists(config_provider_path):
        log_message("[WARN] configprovider.py not found in CP directory, skipping...")
        return False
    
    try:
        log_message(f"Starting configprovider.py from {CP_DIR}...")
        config_provider = subprocess.Popen(
            [
                sys.executable,  # Use current Python interpreter
                config_provider_path
            ],
            cwd=CP_DIR,  # Set working directory to CP
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            encoding='utf-8',
            errors='replace'
        )
        
        # Start threads to read output
        threading.Thread(
            target=read_config_provider_stdout,
            daemon=True
        ).start()
        
        threading.Thread(
            target=read_config_provider_stderr,
            daemon=True
        ).start()
        
        log_message(f"configprovider.py started successfully (PID: {config_provider.pid})")
        
        # Wait for configprovider to initialize
        log_message("Waiting 2 seconds for configprovider to initialize...")
        time.sleep(2)
        
        # Read configuration after waiting
        read_config()
        
        return True
        
    except Exception as e:
        log_message(f"[ERROR] Failed to start configprovider.py: {e}")
        return False


def read_config_provider_stdout():
    """Read stdout from configprovider.py"""
    if config_provider:
        for line in config_provider.stdout:
            line = line.strip()
            if line:
                timestamp = time.strftime("%m-%d %H:%M:%S")
                print(f"[{timestamp}][Worker-2-CP] {line}")


def read_config_provider_stderr():
    """Read stderr from configprovider.py"""
    if config_provider:
        for line in config_provider.stderr:
            line = line.strip()
            if line:
                timestamp = time.strftime("%m-%d %H:%M:%S")
                print(f"[{timestamp}][Worker-2-CP] {line}")


def start_node():
    global node

    # Initialize directories first
    if not init_directories():
        log_message("Failed to initialize directories. Exiting.")
        sys.exit(1)

    # Check .nocp file
    check_nocp_file()

    # Check and download files to independences directory
    if not check_and_download_files():
        log_message("  File download failed. Please follow these steps:")
        log_message("  > 1. Visit https://github.com/fishqaq123/gh-proxy-injesecure")
        log_message("  > 2. Download runtime.js and index.js")
        log_message(f"  > 3. Place both files in: {INDEPENDENCES_DIR}")
        log_message("  > 4. Re-start the program")
        log_message("Now exiting.")
        sys.exit(1)

    # Start config provider if available
    config_provider_started = start_config_provider()
    
    # If config provider wasn't started, try to read config directly
    if not config_provider_started:
        if not CP_DISABLED:
            log_message("Config provider not started, attempting to read config.ini directly...")
            read_config()
        else:
            log_message("CP is disabled, skipping config reading")

    # Set working directory to independences for Node.js process
    runtime_path = os.path.join(INDEPENDENCES_DIR, "runtime.js")
    
    # Check if runtime.js exists before starting
    if not os.path.exists(runtime_path):
        log_message(f"runtime.js not found in {INDEPENDENCES_DIR}")
        sys.exit(1)

    log_message(f"Starting Node.js process from {INDEPENDENCES_DIR}...")
    node = subprocess.Popen(
        [
            "node",
            runtime_path
        ],
        cwd=INDEPENDENCES_DIR,  # Set working directory to independences
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        encoding='utf-8',
        errors='replace'
    )

    threading.Thread(
        target=read_stdout,
        daemon=True
    ).start()

    threading.Thread(
        target=read_stderr,
        daemon=True
    ).start()
    


def read_stderr():
    """Read stderr from Node.js process"""
    global node
    while node is not None:  # 问题2：检查 node 是否为 None
        try:
            if node.stderr is None:
                break
            line = node.stderr.readline()
            if not line:
                break
            line = line.strip()
            if line:
                log_message(f"[node stderr] {line}")
        except (ValueError, OSError, AttributeError) as e:
            # 管道关闭或 node 被清理
            log_message(f"[node stderr] Reader stopped: {e}")
            break
        except Exception as e:
            log_message(f"[node stderr] Unexpected error: {e}")
            break


def read_stdout():
    """Read stdout from Node.js process"""
    global node
    while node is not None:  # 问题2：检查 node 是否为 None
        try:
            if node.stdout is None:
                break
            line = node.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                # 问题1：过滤掉包含替换字符的无效 JSON
                log_message(f"[bad node output] {line}")
                continue

            handle_node(msg)
        except (ValueError, OSError, AttributeError) as e:
            # 管道关闭或 node 被清理
            log_message(f"[node stdout] Reader stopped: {e}")
            break
        except Exception as e:
            log_message(f"[node stdout] Unexpected error: {e}")
            break


def send_node(msg):
    """Send message to Node.js process"""
    # 问题3：检查 node 是否可用
    if node is None:
        log_message("[WARN] Cannot send message: node is None")
        return
    if node.stdin is None or node.stdin.closed:
        log_message("[WARN] Cannot send message: stdin is closed")
        return
    
    try:
        node.stdin.write(
            json.dumps(msg)
            + "\n"
        )
        node.stdin.flush()
    except (BrokenPipeError, OSError, ValueError) as e:
        log_message(f"[WARN] Failed to send message: {e}")


def handle_node(msg):
    if msg["type"] == "fetch":
        log_message(f"[fetch] {msg['url']}")

        try:
            req = urllib.request.Request(msg["url"])
            req.add_header('User-Agent', 'Mozilla/5.0')

            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read().decode("utf-8", errors="ignore")
                send_node({
                    "type": "fetch_response",
                    "id": msg["id"],
                    "status": r.status,
                    "headers": dict(r.headers),
                    "body": body
                })
                log_message(f"[fetch] Completed {msg['url']} status={r.status}")

        except Exception as e:
            log_message(f"[fetch] Error {msg['url']}: {e}")
            # 问题5：即使出错也尝试发送响应
            send_node({
                "type": "fetch_response",
                "id": msg["id"],
                "status": 500,
                "headers": {},
                "body": str(e)
            })

    elif msg["type"] == "response":
        rid = msg["id"]
        with responses_lock:  # 问题12：使用锁保护
            if rid in responses:
                responses[rid] = msg


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        global request_id

        request_id += 1
        rid = str(request_id)

        with responses_lock:  # 问题12：使用锁保护
            responses[rid] = None

        send_node({
            "type": "request",
            "id": rid,
            "method": "GET",
            "url": "http://localhost" + self.path,
            "headers": {}
        })

        log_message(f"[HTTP] GET {self.path} id={rid}")

        # 问题4：添加超时机制
        timeout = 30  # 30秒超时
        elapsed = 0
        response_received = False
        
        while elapsed < timeout:
            with responses_lock:  # 问题12：使用锁保护
                if responses.get(rid) is not None:
                    response_received = True
                    break
            time.sleep(0.1)
            elapsed += 0.1
        
        if not response_received:
            # 超时
            log_message(f"[HTTP] Timeout GET {self.path} id={rid}")
            self.send_response(504)
            self.end_headers()
            try:
                self.wfile.write(b"Gateway Timeout")
            except (BrokenPipeError, OSError):
                pass
            with responses_lock:
                if rid in responses:
                    del responses[rid]
            return

        with responses_lock:  # 问题12：使用锁保护
            result = responses.pop(rid)

        self.send_response(result["status"])
        for k, v in result["headers"].items():
            self.send_header(k, v)
        self.end_headers()
        
        # 问题11：使用 errors='replace' 处理编码问题
        body = result.get("body", "")
        if isinstance(body, str):
            try:
                self.wfile.write(body.encode('utf-8', errors='replace'))
            except (BrokenPipeError, OSError):
                pass
        else:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, OSError):
                pass

        log_message(f"[HTTP] Response {self.path} status={result['status']}")

    def log_message(self, *args):
        pass


def cleanup():
    """Cleanup subprocesses on exit"""
    global node, config_provider
    
    if node:
        log_message("Terminating Node.js process...")
        try:
            node.terminate()
        except Exception:
            pass
        # 问题6：Windows 下更可靠的终止
        try:
            node.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                node.kill()
                node.wait()
            except Exception:
                pass
        except Exception:
            pass
        node = None
    
    if config_provider:
        log_message("Terminating configprovider.py process...")
        try:
            config_provider.terminate()
        except Exception:
            pass
        try:
            config_provider.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                config_provider.kill()
                config_provider.wait()
            except Exception:
                pass
        except Exception:
            pass
        config_provider = None


def restart_node_only():
    """Restart only the Node.js process, keep config provider running"""
    global node
    
    if node:
        log_message("Terminating Node.js process...")
        try:
            node.terminate()
        except Exception:
            pass
        try:
            node.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                node.kill()
                node.wait()
            except Exception:
                pass
        except Exception:
            pass
        node = None
    
    # Start Node.js again
    runtime_path = os.path.join(INDEPENDENCES_DIR, "runtime.js")
    
    if not os.path.exists(runtime_path):
        log_message(f"runtime.js not found in {INDEPENDENCES_DIR}")
        print("Error: runtime.js not found")
        return False
    
    log_message(f"Starting Node.js process from {INDEPENDENCES_DIR}...")
    try:
        node = subprocess.Popen(
            [
                "node",
                runtime_path
            ],
            cwd=INDEPENDENCES_DIR,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            encoding='utf-8',
            errors='replace'
        )
        
        # Restart stdout/stderr readers
        threading.Thread(
            target=read_stdout,
            daemon=True
        ).start()
        
        threading.Thread(
            target=read_stderr,
            daemon=True
        ).start()
        
        log_message(f"Node.js process restarted successfully (PID: {node.pid})")
        print(f"Node.js process restarted (PID: {node.pid})")
        return True
        
    except Exception as e:
        log_message(f"Failed to restart Node.js: {e}")
        print(f"Failed to restart Node.js: {e}")
        return False


def restart_cp_only():
    """Restart only the config provider process"""
    global config_provider, cp_port, CP_DISABLED, config_data, main_port
    
    # Skip if CP is disabled
    if CP_DISABLED:
        print("CP is disabled (.nocp file detected), cannot restart")
        log_message("CP is disabled, cannot restart")
        return False
    
    # Terminate existing CP process
    if config_provider:
        log_message("Terminating configprovider.py process...")
        try:
            config_provider.terminate()
        except Exception:
            pass
        try:
            config_provider.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                config_provider.kill()
                config_provider.wait()
            except Exception:
                pass
        except Exception:
            pass
        config_provider = None
    
    # Download configprovider.py if needed
    if not download_configprovider():
        log_message("[WARN] Failed to download configprovider.py, skipping...")
        print("Failed to download configprovider.py")
        return False
    
    config_provider_path = os.path.join(CP_DIR, "configprovider.py")
    
    if not os.path.exists(config_provider_path):
        log_message("[WARN] configprovider.py not found in CP directory, skipping...")
        print("configprovider.py not found")
        return False
    
    try:
        log_message(f"Starting configprovider.py from {CP_DIR}...")
        config_provider = subprocess.Popen(
            [
                sys.executable,
                config_provider_path
            ],
            cwd=CP_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            encoding='utf-8',
            errors='replace'
        )
        
        # Start threads to read output
        threading.Thread(
            target=read_config_provider_stdout,
            daemon=True
        ).start()
        
        threading.Thread(
            target=read_config_provider_stderr,
            daemon=True
        ).start()
        
        log_message(f"configprovider.py started successfully (PID: {config_provider.pid})")
        print(f"CP service restarted (PID: {config_provider.pid})")
        
        # Wait for configprovider to initialize
        log_message("Waiting 2 seconds for configprovider to initialize...")
        time.sleep(2)
        
        # ====== 问题8：强制重新读取配置文件，保留 set 命令设置的值 ======
        log_message("Force re-reading configuration from config.ini...")
        
        # 备份整个 config_data（包含 set 命令设置的所有值）
        backup_config = dict(config_data)
        log_message(f"Backed up {len(backup_config)} config items")
        
        # 清空 config_data
        config_data.clear()
        
        # 重新读取 config.ini
        config_path = os.path.join(CP_DIR, "config.ini")
        if os.path.exists(config_path):
            try:
                config = configparser.ConfigParser()
                config.read(config_path, encoding='utf-8')
                
                if config.has_section('ConfigProvider'):
                    # 从 config.ini 读取所有配置
                    for key, value in config.items('ConfigProvider'):
                        config_data[key] = value
                        log_message(f"Reloaded config from file: {key} = {value}")
                    
                    # 恢复 backup 中的所有配置（覆盖 config.ini 中相同的键）
                    for key, value in backup_config.items():
                        config_data[key] = value
                        log_message(f"Restored config from backup: {key} = {value}")
                    
                    # 更新端口变量
                    if 'main_working_port' in config_data:
                        try:
                            main_port = int(config_data['main_working_port'])
                            log_message(f"main_working_port set to: {main_port}")
                        except ValueError:
                            pass
                    if 'cp_working_port' in config_data:
                        try:
                            cp_port = int(config_data['cp_working_port'])
                            log_message(f"cp_working_port set to: {cp_port}")
                        except ValueError:
                            pass
                    
                    # 更新 index.js
                    log_message("Updating index.js with new configuration...")
                    update_index_js_config()
                    
                    # 获取 CP 版本
                    fetch_cp_version()
                    
                    print("Configuration reloaded successfully")
                else:
                    log_message("[WARN] [ConfigProvider] section not found in config.ini")
                    print("Warning: [ConfigProvider] section not found in config.ini")
            except Exception as e:
                log_message(f"[ERROR] Failed to reload config.ini: {e}")
                print(f"Failed to reload configuration: {e}")
        else:
            log_message("[WARN] config.ini not found, restoring backup config")
            # 恢复备份
            config_data = dict(backup_config)
            print("Warning: config.ini not found, keeping existing configuration")
        
        print("CP service restarted successfully")
        log_message("CP service restarted successfully")
        
        print("\nNote: CP service restarted. Use 'restart index' to reload Node.js if needed.")
        return True
        
    except Exception as e:
        log_message(f"Failed to restart configprovider.py: {e}")
        print(f"Failed to restart CP service: {e}")
        return False


def stop_cp_only():
    """Stop only the config provider process"""
    global config_provider, CP_DISABLED
    
    # Skip if CP is disabled
    if CP_DISABLED:
        print("CP is disabled (.nocp file detected), nothing to stop")
        log_message("CP is disabled, nothing to stop")
        return False
    
    if not config_provider:
        print("CP service is not running")
        log_message("CP service is not running")
        return False
    
    try:
        log_message("Terminating configprovider.py process...")
        try:
            config_provider.terminate()
        except Exception:
            pass
        try:
            config_provider.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                config_provider.kill()
                config_provider.wait()
            except Exception:
                pass
        except Exception:
            pass
        
        pid = config_provider.pid
        config_provider = None
        
        log_message(f"CP service stopped (PID: {pid})")
        print(f"CP service stopped (PID: {pid})")
        
        log_message("CP service disabled until restart")
        print("CP service is now stopped. Use 'restart cp' to start it again.")
        
        return True
        
    except Exception as e:
        log_message(f"Error stopping CP service: {e}")
        print(f"Error stopping CP service: {e}")
        return False


def console_help():
    """Display help information"""
    print("\n" + "=" * 60)
    print("Available commands:")
    print("  help          - Show this help message")
    print("  version       - Show version information")
    print("  restart       - Restart the entire server (all subprocesses)")
    print("  restart cp    - Restart CP service only")
    print("  restart index - Restart index.js (Node.js) only")
    print("  stop          - Stop the entire server and exit")
    print("  stop cp       - Stop CP service only")
    print("  get <key>     - Get configuration value (e.g., get main_working_port)")
    print("  set <k1> <v1> [<k2> <v2> ...] - Set configuration values and restart node")
    print("=" * 60 + "\n")


def console_version():
    """Display version information"""
    global CP_VERSION, CP_DISABLED
    
    print("\n" + "=" * 60)
    print("InjeSecure Python Server Version: v1.0.1stable(2608221736)")
    if CP_DISABLED:
        print("CP Version: Disabled (.nocp file detected)")
    else:
        print(f"CP Version: {CP_VERSION}")
    print("=" * 60 + "\n")


def console_get(key):
    """Get configuration value"""
    if key in config_data:
        print(f"{key} = {config_data[key]}")
    elif key == "main_working_port":
        print(f"main_working_port = {main_port} (runtime)")
    elif key == "cp_working_port":
        print(f"cp_working_port = {cp_port} (runtime)")
    else:
        print(f"Configuration key '{key}' not found")
        print("Available keys:")
        for k in config_data.keys():
            print(f"  - {k}")
        print("  - main_working_port")
        print("  - cp_working_port")


def console_set(args):
    """Set configuration values and restart node process"""
    global config_data, main_port, cp_port, set_by_console
    
    if len(args) < 2:
        print("Usage: set <key1> <value1> [<key2> <value2> ...]")
        print("Example: set my_key new_secret_key enable_injection false")
        print("\nAvailable keys to set:")
        print("  enable_key_auth       - true/false")
        print("  enable_injection      - true/false")
        print("  my_key                - your main key")
        print("  temp_key_time_limited - your temp key")
        print("  start_time            - YYYY-MM-DD HH:MM:SS")
        print("  end_time              - YYYY-MM-DD HH:MM:SS")
        print("  injection_config_url  - URL to injections.json")
        print("  whitelist             - JSON array or comma-separated list")
        print("  main_working_port     - port number (requires full server restart)")
        print("  cp_working_port       - port number (requires full server restart)")
        return
    
    # Parse key-value pairs
    updated_keys = []
    port_changed = False
    
    for i in range(0, len(args) - 1, 2):
        key = args[i]
        value = args[i + 1]
        
        # Check if key exists in config_data or is a known key
        known_keys = [
            'enable_key_auth', 'enable_injection', 'my_key', 
            'temp_key_time_limited', 'start_time', 'end_time',
            'injection_config_url', 'whitelist', 
            'main_working_port', 'cp_working_port'
        ]
        
        if key not in known_keys:
            print(f"Warning: '{key}' is not a known configuration key")
            continue
        
        # Update config_data
        config_data[key] = value
        set_by_console.add(key)  # 问题8：记录通过 set 命令设置的键
        updated_keys.append(key)
        
        # Check if port changed
        if key == 'main_working_port':
            port_changed = True
            try:
                new_port = int(value)
                main_port = new_port
                print(f"  Set main_working_port = {new_port} (global updated)")
            except ValueError:
                print(f"  Warning: '{value}' is not a valid port number")
        elif key == 'cp_working_port':
            port_changed = True
            try:
                new_port = int(value)
                cp_port = new_port
                print(f"  Set cp_working_port = {new_port} (global updated)")
            except ValueError:
                print(f"  Warning: '{value}' is not a valid port number")
        else:
            print(f"  Set {key} = {value}")
    
    if not updated_keys:
        print("No valid keys updated")
        return
    
    # If ports changed, we need full restart
    if port_changed:
        print("\n⚠️  Port configuration changed. Full server restart required.")
        print("  The server will now restart completely to apply port changes...")
        log_message("Console: Port changed, performing full server restart...")
        
        # 更新 index.js 中的其他配置（但不包括端口，因为 index.js 不直接使用端口）
        update_index_js_config()
        
        # 执行完整重启
        console_restart([])
        return
    
    # 非端口配置：更新 index.js 并重启 Node.js
    log_message("Console: Updating index.js with new configuration...")
    if update_index_js_config():
        print("Configuration written to index.js successfully")
        
        # Restart Node.js process only
        print("Restarting Node.js process...")
        restart_node_only()
    else:
        print("Failed to update index.js configuration")


def console_restart(args):
    """Restart the server or subprocesses"""
    global console_running, node, config_provider, main_port, cp_port
    
    if not args:
        # 没有参数：重启整个服务
        print("Restarting entire server...")
        log_message("Console: Restarting entire server...")
        
        # Cleanup old processes
        cleanup()
        
        # Reset references
        node = None
        config_provider = None
        
        # Restart everything
        try:
            # 重新读取配置（read_config 会优先使用 config_data 中的端口值）
            read_config()
            
            # 问题7：移除多余的端口覆盖逻辑，read_config 已经处理了
            
            # 重新启动 Node.js
            start_node()
            
            log_message(f"Worker running on :{main_port}")
            print(f"Worker running on :{main_port}")
            print(f"Logs are written to: {LOG_FILE}")
            print("Server restarted successfully!")
        except Exception as e:
            log_message(f"Failed to restart: {e}")
            print(f"Failed to restart: {e}")
        return
    
    # 有参数：处理子命令
    subcommand = args[0].lower()
    
    if subcommand == "cp":
        # 重启 CP 服务
        print("Restarting CP service...")
        log_message("Console: Restarting CP service...")
        restart_cp_only()
        
    elif subcommand == "index":
        # 重启 index.js (Node.js 进程)
        print("Restarting index.js (Node.js process)...")
        log_message("Console: Restarting index.js (Node.js process)...")
        
        # 先重新读取配置，确保使用最新配置
        log_message("Re-reading configuration...")
        read_config()
        
        # 重启 Node.js
        restart_node_only()
        
    else:
        print(f"Unknown restart target: {subcommand}")
        print("Usage: restart          - Restart entire server")
        print("       restart cp       - Restart CP service only")
        print("       restart index    - Restart index.js only")


def console_stop(args):
    """Stop the server or subprocesses"""
    global console_running, config_provider
    
    if not args:
        # 没有参数：停止整个服务
        print("Stopping server...")
        log_message("Console: Stopping server...")
        console_running = False
        
        # Cleanup and exit
        cleanup()
        print("Server stopped.")
        os._exit(0)
        return
    
    # 有参数：处理子命令
    subcommand = args[0].lower()
    
    if subcommand == "cp":
        # 只停止 CP 服务
        print("Stopping CP service...")
        log_message("Console: Stopping CP service...")
        stop_cp_only()
        
    else:
        print(f"Unknown stop target: {subcommand}")
        print("Usage: stop          - Stop entire server")
        print("       stop cp       - Stop CP service only")


def show_console_prompt():
    """Display the console prompt"""
    print("\n" + "-" * 40)
    print("Console")
    print("- type help to get what command you can run")
    print("-" * 40)


def console_input_handler():
    """Handle console input in a separate thread"""
    global console_running
    
    # Wait for server to be ready
    while not server_ready:
        time.sleep(0.1)
    
    # Show console prompt
    show_console_prompt()
    
    while console_running:
        try:
            # Read input
            user_input = input("> ").strip()
            
            if not user_input:
                continue
            
            # Parse command
            parts = user_input.split()
            command = parts[0].lower()
            
            if command == "help":
                console_help()
            elif command == "version":
                console_version()
            elif command == "restart":
                console_restart(parts[1:])
            elif command == "stop":
                console_stop(parts[1:])
            elif command == "exit":
                print("Unknown command: exit, did you mean 'stop'?")
            elif command == "getprop":
                print("Unknown command: getprop, did you mean 'get'?")
            elif command == "get":
                if len(parts) < 2:
                    print("Usage: get <key>")
                    print("Example: get main_working_port")
                else:
                    console_get(parts[1])
            elif command == "set":
                console_set(parts[1:])
            else:
                print(f"Unknown command: {command}")
                print("Type 'help' for available commands")
                
        except KeyboardInterrupt:
            print("\nReceived interrupt signal...")
            console_stop([])
            break
        except EOFError:
            # Handle Ctrl+D
            print("\nEOF detected, stopping...")
            console_stop([])
            break
        except Exception as e:
            print(f"Error in console: {e}")


def start_console():
    """Start the console input handler"""
    console_thread = threading.Thread(target=console_input_handler, daemon=True)
    console_thread.start()
    return console_thread


if __name__ == "__main__":
    # Ensure log directory exists before setting up tee
    os.makedirs(LOG_DIR, exist_ok=True)
    
    tee = Tee(LOG_FILE, 'a')
    sys.stdout = tee
    sys.stderr = tee

    log_message("=" * 60)
    log_message("Server starting")
    log_message(f"Base directory: {BASE_DIR}")
    log_message(f"Independences directory: {INDEPENDENCES_DIR}")
    log_message(f"CP directory: {CP_DIR}")
    log_message(f"Log directory: {LOG_DIR}")
    log_message("=" * 60)
    
    # Start Node.js and other services
    start_node()

    log_message(f"Worker running on :{main_port}")
    print(f"Worker running on :{main_port}")
    print(f"Logs are written to: {LOG_FILE}")

    # Mark server as ready
    server_ready = True
    
    # Start console input handler
    console_thread = start_console()

    # Start HTTP server
    try:
        http_server = HTTPServer(("0.0.0.0", main_port), Handler)
        
        # Run server in a separate thread
        server_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
        server_thread.start()
        
        # Keep main thread alive
        while console_running:
            time.sleep(1)
            
    except KeyboardInterrupt:
        log_message("\nServer interrupted by user")
        print("\nServer stopped")
    except Exception as e:
        log_message(f"Server error: {e}")
        print(f"Error: {e}")
    finally:
        console_running = False
        if http_server:
            http_server.shutdown()
        cleanup()
        tee.close()
        # Force exit
        os._exit(0)

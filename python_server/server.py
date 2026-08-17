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
                config_data[key] = value
                log_message(f"Read config: {key} = {value}")
            
            # Read main_working_port
            if 'main_working_port' in config_data:
                try:
                    main_port = int(config_data['main_working_port'])
                    log_message(f"Set main_working_port: {main_port}")
                except ValueError:
                    log_message(f"[ERROR] Invalid main_working_port value, using default {DEFAULT_MAIN_PORT}")
                    main_port = DEFAULT_MAIN_PORT
            else:
                log_message(f"[WARN] main_working_port not found in config.ini, using default {DEFAULT_MAIN_PORT}")
                main_port = DEFAULT_MAIN_PORT
            
            # Read cp_working_port
            if 'cp_working_port' in config_data:
                try:
                    cp_port = int(config_data['cp_working_port'])
                    log_message(f"Set cp_working_port: {cp_port}")
                except ValueError:
                    log_message(f"[ERROR] Invalid cp_working_port value, using default {DEFAULT_CP_PORT}")
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
        
        log_message(f"[DEBUG] After read_config: main_port={main_port}, cp_port={cp_port}")
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
            bufsize=1
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
        bufsize=1
    )

    threading.Thread(
        target=read_stdout,
        daemon=True
    ).start()

    threading.Thread(
        target=read_stderr,
        daemon=True
    ).start()
    
    log_message(f"[DEBUG] After start_node: main_port={main_port}")

def read_stderr():
    for line in node.stderr:
        line = line.strip()
        if line:
            log_message(f"[node stderr] {line}")

def read_stdout():
    for line in node.stdout:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except Exception:
            log_message(f"[bad node output] {line}")
            continue

        handle_node(msg)

def send_node(msg):
    node.stdin.write(
        json.dumps(msg)
        + "\n"
    )
    node.stdin.flush()

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
            send_node({
                "type": "fetch_response",
                "id": msg["id"],
                "status": 500,
                "headers": {},
                "body": str(e)
            })

    elif msg["type"] == "response":
        rid = msg["id"]
        if rid in responses:
            responses[rid] = msg

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        global request_id

        request_id += 1
        rid = str(request_id)

        responses[rid] = None

        send_node({
            "type": "request",
            "id": rid,
            "method": "GET",
            "url": "http://localhost" + self.path,
            "headers": {}
        })

        log_message(f"[HTTP] GET {self.path} id={rid}")

        while responses[rid] is None:
            pass

        result = responses.pop(rid)

        self.send_response(result["status"])
        for k, v in result["headers"].items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(result["body"].encode())

        log_message(f"[HTTP] Response {self.path} status={result['status']}")

    def log_message(self, *args):
        pass

def cleanup():
    """Cleanup subprocesses on exit"""
    global node, config_provider
    
    if node:
        log_message("Terminating Node.js process...")
        node.terminate()
        try:
            node.wait(timeout=5)
        except subprocess.TimeoutExpired:
            node.kill()
            node.wait()
    
    if config_provider:
        log_message("Terminating configprovider.py process...")
        config_provider.terminate()
        try:
            config_provider.wait(timeout=5)
        except subprocess.TimeoutExpired:
            config_provider.kill()
            config_provider.wait()

def console_help():
    """Display help information"""
    print("\n" + "=" * 60)
    print("Available commands:")
    print("  help     - Show this help message")
    print("  version  - Show version information")
    print("  restart  - Restart the server (kills all subprocesses and restarts)")
    print("  stop     - Stop the server and exit")
    print("  get <key> - Get configuration value (e.g., get main_working_port)")
    print("=" * 60 + "\n")

def console_version():
    """Display version information"""
    global CP_VERSION, CP_DISABLED
    
    print("\n" + "=" * 60)
    print("InjeSecure Python Server Version: SnapShot2608171140")
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
        print(f"main_working_port = {main_port}")
    elif key == "cp_working_port":
        print(f"cp_working_port = {cp_port}")
    else:
        print(f"Configuration key '{key}' not found")
        print("Available keys:")
        for k in config_data.keys():
            print(f"  - {k}")
        print("  - main_working_port")
        print("  - cp_working_port")

def console_restart():
    """Restart the server"""
    global console_running, node, config_provider
    
    print("Restarting server...")
    log_message("Console: Restarting server...")
    
    # Cleanup old processes
    cleanup()
    
    # Reset references
    node = None
    config_provider = None
    
    # Restart everything
    try:
        start_node()
        log_message(f"Worker running on :{main_port}")
        print(f"Worker running on :{main_port}")
        print(f"Logs are written to: {LOG_FILE}")
        print("Server restarted successfully!")
    except Exception as e:
        log_message(f"Failed to restart: {e}")
        print(f"Failed to restart: {e}")

def console_stop():
    """Stop the server"""
    global console_running
    
    print("Stopping server...")
    log_message("Console: Stopping server...")
    console_running = False
    
    # Cleanup and exit
    cleanup()
    print("Server stopped.")
    os._exit(0)

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
                console_restart()
            elif command == "stop":
                console_stop()
                break
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
            else:
                print(f"Unknown command: {command}")
                print("Type 'help' for available commands")
                
        except KeyboardInterrupt:
            print("\nReceived interrupt signal...")
            console_stop()
            break
        except EOFError:
            # Handle Ctrl+D
            print("\nEOF detected, stopping...")
            console_stop()
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
    log_message(f"[DEBUG] Before HTTP server: main_port={main_port}")
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

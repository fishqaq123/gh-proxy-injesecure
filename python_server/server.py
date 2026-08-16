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

node = None

request_id = 0
responses = {}

# Log file
LOG_FILE = "server.log"

class Tee:
    """Output to both console and file"""
    def __init__(self, filename, mode='a'):
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

def check_and_download_files():
    """Check and download missing files"""
    files_needed = [
        ("runtime.js", "https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/runtime/runtime.js"),
        ("index.js", "https://raw.githubusercontent.com/fishqaq123/gh-proxy-injesecure/master/index.js")
    ]
    
    all_ok = True
    for filename, url in files_needed:
        if os.path.exists(filename) and os.path.getsize(filename) > 0:
            log_message(f"File {filename} exists and is valid")
        else:
            if os.path.exists(filename):
                log_message(f"File {filename} exists but is empty or corrupted, re-downloading...")
            else:
                log_message(f"File {filename} does not exist, downloading...")
            if not download_file(url, filename):
                all_ok = False
    return all_ok

def start_node():
    global node

    if not check_and_download_files():
        log_message("  File download failed. Please follow these steps:")
        log_message("  > 1.Visit https://github.com/fishqaq123/gh-proxy-injesecure")
        log_message("  > 2.Download runtime.js and index.js")
        log_message("  > 3.Place both files in the current working directory")
        log_message("  > 4.Re-start the program")
        log_message("Now exiting.")
        sys.exit(1)

    log_message("Starting Node.js process...")
    node = subprocess.Popen(
        [
            "node",
            "runtime.js"
        ],
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

if __name__ == "__main__":
    tee = Tee(LOG_FILE, 'a')
    sys.stdout = tee
    sys.stderr = tee

    log_message("=" * 60)
    log_message("Server starting")
    log_message("=" * 60)
    
    start_node()

    log_message("Worker running on :8080")
    print("Worker running on :8080")
    print("Logs are written to both console and server.log")

    try:
        HTTPServer(
            ("0.0.0.0", 8080),
            Handler
        ).serve_forever()
    except KeyboardInterrupt:
        log_message("\nServer interrupted by user")
        print("\nServer stopped")
    except Exception as e:
        log_message(f"Server error: {e}")
        print(f"Error: {e}")
    finally:
        tee.close()

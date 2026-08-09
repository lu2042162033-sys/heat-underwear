#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HEAT UNDERWEAR 商品展示网站 — 零依赖 Python 服务（仅标准库，无需 pip 安装）

功能：
  - 静态托管 w/outputs/site（所有人可访问）
  - 管理员口令校验（服务端），登录后获得 HttpOnly 会话 Cookie
  - 商品数据存 server-data/products.json；图片上传保存到 w/outputs/site/images/products

环境变量：
  PORT            监听端口（默认 3000）
  ADMIN_PASSWORD  管理员口令（默认 8888，上线前务必修改）
  SECURE_COOKIE   设为 1 时 Cookie 使用 Secure（HTTPS 下）
"""

import base64
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

BASE = Path(__file__).resolve().parent
SITE_DIR = BASE / "w" / "outputs" / "site"
DATA_DIR = BASE / "server-data"
IMG_DIR = SITE_DIR / "images" / "products"
PRODUCTS_FILE = DATA_DIR / "products.json"

PORT = int(os.environ.get("PORT", "3000"))
PASSWORD = os.environ.get("ADMIN_PASSWORD", "8888")
SESSION_TTL_SECONDS = 12 * 3600
MAX_IMAGE_BYTES = 6 * 1024 * 1024
ALLOWED_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

DATA_DIR.mkdir(parents=True, exist_ok=True)
IMG_DIR.mkdir(parents=True, exist_ok=True)

_lock = threading.Lock()
_sessions = {}
_attempts = {}
_seed_cache = None


def load_seed():
    global _seed_cache
    if _seed_cache is not None:
        return _seed_cache
    txt = (SITE_DIR / "data" / "products.js").read_text(encoding="utf-8")
    start = txt.index("[")
    end = txt.rindex("]")
    arr = txt[start : end + 1]
    arr = re.sub(r",\s*\]$", "]", arr.strip())
    _seed_cache = json.loads(arr)
    return _seed_cache


def to_num(v):
    if isinstance(v, (int, float)):
        return int(v)
    if v is None:
        return 0
    s = re.sub(r"[^\d-]", "", str(v))
    try:
        return int(s)
    except ValueError:
        return 0


def normalize(p, pid):
    o = {
        "code": "" if p.get("code") is None else str(p["code"]),
        "name": p.get("name") or "",
        "category": p.get("category") or "文胸",
        "sizes": "" if p.get("sizes") is None else str(p["sizes"]),
        "unitPrice": to_num(p.get("unitPrice")),
        "dozenPrice": to_num(p.get("dozenPrice")),
        "image": p.get("image") or "",
        "status": p.get("status") or "",
        "note": p.get("note") or "",
    }
    if p.get("id") is not None:
        o["id"] = p["id"]
    elif pid is not None:
        o["id"] = pid
    return o


def load_products():
    try:
        obj = json.loads(PRODUCTS_FILE.read_text(encoding="utf-8"))
        if isinstance(obj, dict) and isinstance(obj.get("products"), list):
            return obj["products"]
        if isinstance(obj, list):
            return obj
    except Exception:
        pass
    return json.loads(json.dumps(load_seed()))


def save_products(lst):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 2,
        "updatedAt": datetime.now().isoformat(),
        "products": lst,
    }
    PRODUCTS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def new_session():
    token = secrets.token_hex(24)
    _sessions[token] = time.time() + SESSION_TTL_SECONDS
    return token


def parse_cookies(header):
    out = {}
    if header:
        for part in header.split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def authed(cookies):
    token = cookies.get("heat_session")
    if not token:
        return False
    exp = _sessions.get(token)
    if not exp:
        return False
    if exp < time.time():
        _sessions.pop(token, None)
        return False
    return True


def rate_limited(ip):
    now = time.time()
    a = _attempts.get(ip)
    if not a:
        return False
    if a["until"] > now:
        return True
    if a["count"] >= 5:
        _attempts[ip] = {"count": 0, "until": now + 60}
        return True
    return False


def note_attempt(ip, ok):
    now = time.time()
    if ok:
        _attempts.pop(ip, None)
        return
    a = _attempts.get(ip) or {"count": 0, "until": 0}
    _attempts[ip] = {"count": a["count"] + 1, "until": a["until"] if a["until"] > now else 0}


def make_cookie(name, value, max_age_seconds):
    c = "%s=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d" % (name, value, max_age_seconds)
    if os.environ.get("SECURE_COOKIE") == "1":
        c += "; Secure"
    return c


class Handler(BaseHTTPRequestHandler):
    server_version = "HEAT/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), fmt % args))

    # ---------- 基础工具 ----------
    def _send_json(self, obj, status=200, extra_headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for k, v in extra_headers:
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self, limit=16 * 1024 * 1024):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > limit:
            return None
        return self.rfile.read(n)

    def _json_body(self, limit=16 * 1024 * 1024):
        raw = self._read_body(limit)
        if raw is None:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def _cookies(self):
        return parse_cookies(self.headers.get("Cookie"))

    def _require_auth(self):
        if not authed(self._cookies()):
            self._send_json({"ok": False, "error": "unauthorized"}, 401)
            return False
        return True

    # ---------- 静态文件 ----------
    def _serve_static(self, path):
        rel = unquote(path.lstrip("/"))
        if not rel:
            rel = "index.html"
        target = (SITE_DIR / rel).resolve()
        site_resolved = SITE_DIR.resolve()
        if target != site_resolved and site_resolved not in target.parents:
            return self._send_json({"ok": False, "error": "not_found"}, 404)
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self._send_json({"ok": False, "error": "not_found"}, 404)
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.name.endswith(".js"):
            ctype = "text/javascript; charset=utf-8"
        elif target.name.endswith(".css"):
            ctype = "text/css; charset=utf-8"
        elif target.name.endswith(".html"):
            ctype = "text/html; charset=utf-8"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # ---------- GET ----------
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self._send_json({"ok": True})
        if path == "/api/me":
            return self._send_json({"server": True, "authed": authed(self._cookies())})
        if path == "/api/products":
            with _lock:
                products = load_products()
            return self._send_json({"ok": True, "products": products})
        if path == "/api/images":
            if not self._require_auth():
                return
            with _lock:
                names = sorted(
                    f.name
                    for f in IMG_DIR.iterdir()
                    if f.is_file() and re.search(r"\.(jpe?g|png|webp|gif)$", f.name, re.I)
                )
            return self._send_json({"ok": True, "images": names})
        return self._serve_static(path)

    # ---------- POST ----------
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            return self._login()
        if path == "/api/logout":
            token = self._cookies().get("heat_session")
            if token:
                _sessions.pop(token, None)
            return self._send_json(
                {"ok": True},
                extra_headers=[("Set-Cookie", make_cookie("heat_session", "", 0))],
            )
        if path == "/api/reset":
            if not self._require_auth():
                return
            with _lock:
                seed_list = json.loads(json.dumps(load_seed()))
                save_products(seed_list)
            return self._send_json({"ok": True, "count": len(seed_list)})
        if path == "/api/images":
            return self._upload()
        return self._send_json({"ok": False, "error": "not_found"}, 404)

    # ---------- PUT ----------
    def do_PUT(self):
        path = urlparse(self.path).path
        if path != "/api/products":
            return self._send_json({"ok": False, "error": "not_found"}, 404)
        if not self._require_auth():
            return
        body = self._json_body()
        lst = (body or {}).get("products")
        if not isinstance(lst, list):
            return self._send_json({"ok": False, "error": "bad_body"}, 400)
        normalized = [normalize(p, i + 1) for i, p in enumerate(lst)]
        with _lock:
            save_products(normalized)
        return self._send_json({"ok": True, "count": len(normalized)})

    # ---------- 登录 ----------
    def _login(self):
        ip = self.client_address[0]
        if rate_limited(ip):
            return self._send_json({"ok": False, "error": "too_many"}, 429)
        body = self._json_body(64 * 1024)
        pw = (body or {}).get("password", "")
        if pw != PASSWORD:
            note_attempt(ip, False)
            return self._send_json({"ok": False, "error": "bad_password"}, 401)
        note_attempt(ip, True)
        token = new_session()
        return self._send_json(
            {"ok": True},
            extra_headers=[("Set-Cookie", make_cookie("heat_session", token, SESSION_TTL_SECONDS))],
        )

    # ---------- 图片上传（base64 JSON） ----------
    def _upload(self):
        if not self._require_auth():
            return
        body = self._json_body(16 * 1024 * 1024)
        data = (body or {}).get("data", "")
        if not isinstance(data, str) or not data.startswith("data:"):
            return self._send_json({"ok": False, "error": "no_file"}, 400)
        m = re.match(r"data:([\w\-.+/]+);base64,(.*)$", data, re.S)
        if not m:
            return self._send_json({"ok": False, "error": "bad_data"}, 400)
        mime_type, b64 = m.group(1), m.group(2)
        ext = ALLOWED_MIME.get(mime_type)
        if not ext:
            return self._send_json({"ok": False, "error": "bad_type"}, 400)
        try:
            raw = base64.b64decode(b64)
        except Exception:
            return self._send_json({"ok": False, "error": "bad_data"}, 400)
        if len(raw) > MAX_IMAGE_BYTES:
            return self._send_json({"ok": False, "error": "LIMIT_FILE_SIZE"}, 413)
        name = "up_%d_%s%s" % (int(time.time() * 1000), secrets.token_hex(4), ext)
        with _lock:
            (IMG_DIR / name).write_bytes(raw)
        return self._send_json({"ok": True, "filename": name})


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("HEAT UNDERWEAR 服务已启动: http://localhost:%d" % PORT)
    print("站点目录: %s" % SITE_DIR)
    print("数据文件: %s" % PRODUCTS_FILE)
    if PASSWORD == "8888":
        print("警告: 正在使用默认口令 8888，上线前请通过环境变量 ADMIN_PASSWORD 修改！")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HEAT UNDERWEAR — 商品图片提取脚本（本地迁移 / GitHub Actions 共用）

读取 w/outputs/site/data/pending-products.json：
  - 把 image 以 data: 开头的商品图片解码为 images/products/admin_{id}_{sha1前8}.{ext}
  - 输出紧凑版 products.json / pending-products.json（图片只存文件名）
  - 再生 data/products.js（全量种子）与 data/images.js（图片清单）

用法：python3 .github/scripts/extract_images.py
"""

import base64
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone


def js_string(s):
    """JSON 编码为 JS 字符串字面量，并规避 </script 安全问题。"""
    return json.dumps(str(s), ensure_ascii=False).replace("</", "<\\/")


def mime_ext(mime):
    return {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get((mime or "").lower())


def extract_image(product, img_dir):
    """把 data: 开头的 image 解码为文件，返回提取的文件名；非 data: 原样返回。"""
    img = product.get("image") or ""
    if not img.startswith("data:"):
        return img
    m = re.match(r"data:image/([^;]+);base64,(.*)$", img, re.S)
    if not m:
        raise ValueError("无法解析 data URL: id=%s" % product.get("id"))
    mime, b64 = "image/" + m.group(1).lower(), m.group(2)
    ext = mime_ext(mime)
    if not ext:
        raise ValueError("不支持的图片 MIME: %s (id=%s)" % (mime, product.get("id")))
    raw = base64.b64decode(b64)
    digest = hashlib.sha1(raw).hexdigest()[:8]
    pid = product.get("id")
    if pid is None:
        raise ValueError("商品缺少 id 字段（image 为 data URL）")
    name = "admin_%s_%s%s" % (pid, digest, ext)
    os.makedirs(img_dir, exist_ok=True)
    with open(os.path.join(img_dir, name), "wb") as f:
        f.write(raw)
    return name


def write_products_js(products, path):
    lines = [
        "// 由 extract_images.py 自动生成（build_site.py 的线上等价物），请勿手动编辑",
        "window.PRODUCTS_SEED = [",
    ]
    items = ["  " + json.dumps(p, ensure_ascii=False).replace("</", "<\\/") for p in products]
    lines.append(",\n".join(items))
    lines.append("];")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def write_images_js(img_dir, path):
    names = sorted(os.listdir(img_dir)) if os.path.isdir(img_dir) else []
    lines = [
        "// 由 extract_images.py 自动生成：站点 images/products 下可用的图片清单",
        "window.PRODUCTS_IMAGES = [",
    ]
    lines.append(",\n".join("  " + js_string(n) for n in names))
    lines.append("];")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    site_dir = os.path.join(base, "w", "outputs", "site")
    data_dir = os.path.join(site_dir, "data")
    img_dir = os.path.join(site_dir, "images", "products")
    pending_path = os.path.join(data_dir, "pending-products.json")
    products_path = os.path.join(data_dir, "products.json")
    products_js_path = os.path.join(data_dir, "products.js")
    images_js_path = os.path.join(data_dir, "images.js")

    if not os.path.exists(pending_path):
        print("NO_PENDING_FILE")
        return 0

    with open(pending_path, encoding="utf-8") as f:
        obj = json.load(f)
    products = obj.get("products") if isinstance(obj, dict) else obj
    if isinstance(products, dict) and "value" in products:
        products = products["value"]
    if not isinstance(products, list) or len(products) < 1:
        print("BAD_PENDING_DATA")
        return 1

    extracted = 0
    for p in products:
        if not isinstance(p, dict):
            continue
        # 已彻底移除状态体系：任何来源的 status 都不再写入
        p.pop("status", None)
        if (p.get("image") or "").startswith("data:"):
            p["image"] = extract_image(p, img_dir)
            extracted += 1

    now = datetime.now(timezone.utc).isoformat()
    data = {"version": 2, "updatedAt": now, "products": products}
    with open(products_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    pending = {"schema": 2, "savedAt": now, "products": products}
    with open(pending_path, "w", encoding="utf-8") as f:
        json.dump(pending, f, ensure_ascii=False, indent=2)

    write_products_js(products, products_js_path)
    write_images_js(img_dir, images_js_path)

    print("products.json written:", len(products))
    print("base64 images extracted:", extracted)
    print("images.js entries:", len(os.listdir(img_dir)) if os.path.isdir(img_dir) else 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())

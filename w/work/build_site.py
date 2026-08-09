#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HEAT UNDERWEAR 商品展示网页 — 数据构建脚本
读取「价格核对表」Excel 与 E:\\image 商品图片，生成：
  w/outputs/site/data/products.js
  w/outputs/site/data/images.js
  w/outputs/site/images/products/  （图片副本）
用法：python build_site.py
"""

import glob
import json
import os
import shutil
import sys

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE_DIR = os.path.join(BASE, "w", "outputs", "site")
DATA_DIR = os.path.join(SITE_DIR, "data")
IMAGES_DST = os.path.join(SITE_DIR, "images", "products")
EXCEL_DIR = r"E:\Codex.WorkSpace\2026-08-05\w\outputs"
IMAGE_SRC = r"E:\image"

EXPECTED_CATEGORY_COUNTS = {
    "文胸": 28, "内裤": 54, "内衣裤套装": 6,
    "睡衣": 5, "束身衣": 8, "瑜伽裤": 85, "背心": 6,
}


def js_string(s):
    """JSON 编码为 JS 字符串字面量，并规避 </script 安全问题。"""
    return json.dumps(str(s), ensure_ascii=False).replace("</", "<\\/")


def to_int(v):
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    digits = "".join(ch for ch in str(v) if ch.isdigit() or ch == "-")
    try:
        return int(digits)
    except ValueError:
        return 0


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(IMAGES_DST, exist_ok=True)

    # 1. 读取 Excel
    import openpyxl

    xlsx_files = sorted(glob.glob(os.path.join(EXCEL_DIR, "*.xlsx")))
    if not xlsx_files:
        print("ERROR: 未在 %s 找到 xlsx 文件" % EXCEL_DIR)
        return 1
    wb = openpyxl.load_workbook(xlsx_files[0], data_only=True, read_only=True)
    ws = wb.worksheets[0]

    products = []
    warnings = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] is None:
            continue
        idx, code, sizes, unit, dozen, status, cat, img, note = (list(row) + [None] * 9)[:9]
        pid = to_int(idx)
        code_s = "" if code is None else str(code).strip()
        sizes_s = "" if sizes is None else str(sizes).strip()
        unit_i = to_int(unit)
        dozen_i = to_int(dozen)
        status_s = "" if status is None else str(status).strip()
        cat_s = "" if cat is None else str(cat).strip()
        if cat_s == "内裤-丁字裤":
            cat_s = "内裤"
        img_s = "" if img is None else str(img).strip()
        note_s = "" if note is None else str(note).strip()

        if not code_s or not sizes_s or not cat_s or not img_s:
            warnings.append("第 %s 行字段缺失: code=%r sizes=%r cat=%r img=%r" % (idx, code_s, sizes_s, cat_s, img_s))
        if not os.path.exists(os.path.join(IMAGE_SRC, img_s)):
            warnings.append("图片缺失: %s" % img_s)

        products.append({
            "id": pid,
            "code": code_s,
            "name": "",
            "category": cat_s,
            "sizes": sizes_s,
            "unitPrice": unit_i,
            "dozenPrice": dozen_i,
            "image": img_s,
            "status": status_s,
            "note": note_s,
        })
    wb.close()

    # 2. 复制图片（E:\image 全部文件）
    copied = 0
    for name in sorted(os.listdir(IMAGE_SRC)):
        src = os.path.join(IMAGE_SRC, name)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(IMAGES_DST, name)
        shutil.copy2(src, dst)
        copied += 1

    # 3. 生成 data/products.js
    lines = ["// 由 build_site.py 自动生成，请勿手动编辑（管理面板中的改动保存在浏览器 localStorage）", "window.PRODUCTS_SEED = ["]
    items = ["  " + json.dumps(p, ensure_ascii=False).replace("</", "<\\/") for p in products]
    lines.append(",\n".join(items))
    lines.append("];")
    with open(os.path.join(DATA_DIR, "products.js"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    # 4. 生成 data/images.js
    image_names = sorted(os.listdir(IMAGES_DST))
    img_lines = ["// 由 build_site.py 自动生成：站点 images/products 下可用的图片清单", "window.PRODUCTS_IMAGES = ["]
    for n in image_names:
        img_lines.append("  " + js_string(n) + ",")
    img_lines.append("];")
    with open(os.path.join(DATA_DIR, "images.js"), "w", encoding="utf-8") as f:
        f.write("\n".join(img_lines))

    # 5. 校验与汇总
    from collections import Counter
    cat_counts = Counter(p["category"] for p in products)
    print("商品总数: %d" % len(products))
    print("分类计数:", dict(cat_counts))
    print("图片复制: %d 张 -> %s" % (copied, IMAGES_DST))
    print("images.js 清单: %d 条" % len(image_names))
    missing = [p["image"] for p in products if p["image"] not in set(image_names)]
    print("商品引用的图片缺失: %d" % len(missing))
    for m in missing[:10]:
        print("  MISSING:", m)
    if warnings:
        print("警告 %d 条:" % len(warnings))
        for w in warnings[:20]:
            print("  WARN:", w)
    if EXPECTED_CATEGORY_COUNTS != dict(cat_counts):
        print("注意：分类计数与预期不一致")
    print("生成完成:")
    print("  products.js ->", os.path.join(DATA_DIR, "products.js"))
    print("  images.js   ->", os.path.join(DATA_DIR, "images.js"))
    return 0


if __name__ == "__main__":
    sys.exit(main())

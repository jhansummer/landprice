#!/usr/bin/env python3
"""
by_lawd 전체 스캔 → apt_id별 buildYear 추출 → apt_meta.json 출력.

출력: { "apt_id_hex": buildYear, ... }  (~65K entries, ~1.5MB)
"""
import hashlib
import json
from collections import Counter
from pathlib import Path

from lawd_codes import LAWD_CODES, lawd_name

DOCS_DIR = Path(__file__).resolve().parents[1] / "docs"
DATA_DIR = DOCS_DIR / "data" / "apt_trade"
BY_LAWD_DIR = DATA_DIR / "by_lawd"
OUTPUT_PATH = DATA_DIR / "apt_meta.json"


def build():
    # apt_id → list of build_year values (to pick mode later)
    year_counts: dict[str, Counter] = {}

    for lawd_dir in sorted(BY_LAWD_DIR.iterdir()):
        if not lawd_dir.is_dir():
            continue
        lawd_cd = lawd_dir.name
        sigungu = lawd_name(lawd_cd)

        for fpath in sorted(lawd_dir.glob("*.json")):
            with fpath.open("r", encoding="utf-8") as fp:
                records = json.load(fp)
            for r in records:
                apt_name = r.get("apt_name", "")
                area_m2 = r.get("area_m2", 0)
                build_year = r.get("build_year", 0)
                if not apt_name or not area_m2 or not build_year:
                    continue
                apt_id = hashlib.md5(
                    f"{sigungu}\t{apt_name}\t{area_m2}".encode()
                ).hexdigest()[:10]
                if apt_id not in year_counts:
                    year_counts[apt_id] = Counter()
                year_counts[apt_id][build_year] += 1

    # Pick mode (most frequent build_year) for each apt_id
    result = {}
    for apt_id, counter in year_counts.items():
        result[apt_id] = counter.most_common(1)[0][0]

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as fp:
        json.dump(result, fp, ensure_ascii=False, separators=(",", ":"))

    print(f"apt_meta.json: {len(result):,} entries → {OUTPUT_PATH}")


if __name__ == "__main__":
    build()

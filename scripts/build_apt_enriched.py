#!/usr/bin/env python3
"""
by_apt/{id}.json 파일들을 enriched 포맷으로 변환.

기존: [[date, price], ...]
변환: {"trades": [[date, price], ...], "info": {...}}

valuation_geo.json + apt_meta.json 에서 단지 메타정보 merge.
멱등: 이미 enriched된 파일도 trades 추출 후 재처리.
"""

import json
import os
import sys

DOCS = os.path.join(os.path.dirname(__file__), "..", "docs")
BY_APT_DIR = os.path.join(DOCS, "data", "apt_trade", "by_apt")
GEO_PATH = os.path.join(DOCS, "data", "apt_trade", "valuation_geo.json")
META_PATH = os.path.join(DOCS, "data", "apt_trade", "apt_meta.json")


def load_json(path):
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_info(apt_id, geo_all, meta_all):
    """단지별 info 블록 생성. 데이터 없으면 None."""
    geo = geo_all.get(apt_id)
    build_year = meta_all.get(apt_id)

    if not geo and not build_year:
        return None

    info = {}

    if build_year:
        info["build_year"] = build_year

    if geo:
        if geo.get("households"):
            info["households"] = geo["households"]
        if geo.get("subway"):
            info["subway"] = geo["subway"]
        if geo.get("subway_line"):
            info["subway_line"] = geo["subway_line"]
        if geo.get("subway_walk_min") is not None:
            info["subway_walk_min"] = geo["subway_walk_min"]

        # commute times
        if geo.get("commute"):
            info["commute"] = geo["commute"]

        # scores
        scores = {}
        # transport: 웹과 동일 공식
        if geo.get("subway_dist") is not None:
            scores["transport"] = max(5, round(100 - geo["subway_dist"] * 1000 / 30))
        if geo.get("infra_score") is not None:
            scores["infra"] = geo["infra_score"]
        if geo.get("academy_score") is not None:
            scores["academy"] = geo["academy_score"]
        if geo.get("brand_score") is not None:
            scores["brand"] = geo["brand_score"]
        if geo.get("livability_score") is not None:
            scores["livability"] = geo["livability_score"]
        if geo.get("loc_score") is not None:
            scores["loc"] = geo["loc_score"]
        if scores:
            info["scores"] = scores

    return info if info else None


def main():
    print("Loading valuation_geo.json ...")
    geo_all = load_json(GEO_PATH)
    print(f"  {len(geo_all)} entries")

    print("Loading apt_meta.json ...")
    meta_all = load_json(META_PATH)
    print(f"  {len(meta_all)} entries")

    if not os.path.isdir(BY_APT_DIR):
        print(f"ERROR: {BY_APT_DIR} not found")
        sys.exit(1)

    files = [f for f in os.listdir(BY_APT_DIR) if f.endswith(".json")]
    print(f"Processing {len(files)} by_apt files ...")

    enriched_count = 0
    skipped_count = 0

    for fname in files:
        apt_id = fname[:-5]  # strip .json
        fpath = os.path.join(BY_APT_DIR, fname)

        with open(fpath, "r", encoding="utf-8") as f:
            raw = json.load(f)

        # 멱등: 이미 enriched면 trades 추출
        if isinstance(raw, list):
            trades = raw
        elif isinstance(raw, dict) and "trades" in raw:
            trades = raw["trades"]
        else:
            trades = []

        info = build_info(apt_id, geo_all, meta_all)

        if info:
            enriched = {"trades": trades, "info": info}
            enriched_count += 1
        else:
            # info 없으면 trades만 있는 enriched 포맷
            enriched = {"trades": trades}
            skipped_count += 1

        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(enriched, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Done: {enriched_count} enriched, {skipped_count} trades-only")


if __name__ == "__main__":
    main()

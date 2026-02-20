#!/usr/bin/env python3
"""
search/{sido}.json (9개) + apt_meta.json → apt_lookup/{sido}.json (9개)

출력 포맷: {"apt_id": ["단지명", "시군구", "동", 면적, 건축년도], ...}
search 7MB → 각 200~500KB로 경량화.
"""
import json
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parents[1] / "docs"
DATA_DIR = DOCS_DIR / "data" / "apt_trade"
SEARCH_DIR = DATA_DIR / "search"
META_PATH = DATA_DIR / "apt_meta.json"
OUTPUT_DIR = DATA_DIR / "apt_lookup"


def build():
    # Load apt_meta (id → build_year)
    if META_PATH.exists():
        with META_PATH.open("r", encoding="utf-8") as fp:
            apt_meta = json.load(fp)
    else:
        print(f"WARNING: {META_PATH} not found, build_year will be 0")
        apt_meta = {}

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    total = 0

    for search_file in sorted(SEARCH_DIR.glob("*.json")):
        sido = search_file.stem  # e.g. "서울"
        with search_file.open("r", encoding="utf-8") as fp:
            data = json.load(fp)

        items = data.get("items", [])
        lookup = {}
        for item in items:
            apt_id = item.get("id")
            if not apt_id or apt_id in lookup:
                continue
            lookup[apt_id] = [
                item.get("apt_name", ""),
                item.get("sigungu", ""),
                item.get("dong_name", ""),
                item.get("area_m2", 0),
                apt_meta.get(apt_id, 0),
            ]

        out_path = OUTPUT_DIR / f"{sido}.json"
        with out_path.open("w", encoding="utf-8") as fp:
            json.dump(lookup, fp, ensure_ascii=False, separators=(",", ":"))

        size_kb = out_path.stat().st_size / 1024
        print(f"  {sido}: {len(lookup):,} entries → {size_kb:.0f}KB")
        total += len(lookup)

    print(f"\napt_lookup: {total:,} total entries across {len(list(OUTPUT_DIR.glob('*.json')))} files")


if __name__ == "__main__":
    build()

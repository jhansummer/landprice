#!/usr/bin/env python3
"""Build coords.json mapping apt_id -> [lat, lng] for the map view."""

import json
import glob
import os

BASE = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.join(BASE, "geocode_cache.json")
SEARCH_DIR = os.path.join(BASE, "..", "docs", "data", "apt_trade", "search")
OUT_PATH = os.path.join(BASE, "..", "docs", "data", "apt_trade", "coords.json")


def main():
    with open(CACHE_PATH, encoding="utf-8") as f:
        geo = json.load(f)

    coords = {}
    matched = 0
    total = 0

    for path in sorted(glob.glob(os.path.join(SEARCH_DIR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for item in data.get("items", []):
            apt_id = item.get("id")
            if not apt_id or apt_id in coords:
                continue
            total += 1
            key = f"{item['sigungu']} {item['dong_name']} {item['apt_name']}"
            loc = geo.get(key)
            if loc:
                coords[apt_id] = [
                    round(loc["lat"], 5),
                    round(loc["lng"], 5),
                ]
                matched += 1

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(coords, f, separators=(",", ":"))

    print(f"coords.json: {matched}/{total} matched ({len(coords)} unique ids), "
          f"{os.path.getsize(OUT_PATH) / 1024:.0f} KB")


if __name__ == "__main__":
    main()

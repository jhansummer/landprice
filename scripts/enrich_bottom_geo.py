#!/usr/bin/env python3
"""Enrich bottom JSON files with geo data (subway proximity + business district distances).

Reads bottom/{시도}.json, geocodes apartments via Kakao Local API,
calculates nearest subway station and business district distances,
then writes geo fields back into each apartment entry.
"""

import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
BOTTOM_DIR = SCRIPTS_DIR.parent / "docs" / "data" / "apt_trade" / "bottom"
CACHE_FILE = SCRIPTS_DIR / "geocode_cache.json"
STATIONS_FILE = SCRIPTS_DIR / "subway_stations.json"

KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "")

BIZ_HUBS = {
    "gangnam": {"name": "강남역", "lat": 37.497175, "lng": 127.027926},
    "gwanghwamun": {"name": "광화문역", "lat": 37.571607, "lng": 126.976853},
    "yeouido": {"name": "여의도역", "lat": 37.521624, "lng": 126.924191},
}

# 수도권 시도 (업무지구 거리 표시 대상)
METRO_SIDOS = {"서울", "서울특별시", "경기", "경기도", "인천", "인천광역시"}

# Rate limit: Kakao API allows 10 req/sec
API_DELAY = 0.12


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance in km between two coordinates using haversine formula."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def load_cache() -> Dict[str, Dict[str, float]]:
    if CACHE_FILE.exists():
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: Dict[str, Dict[str, float]]) -> None:
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)


def load_stations() -> List[Dict]:
    if not STATIONS_FILE.exists():
        print(f"Warning: {STATIONS_FILE} not found. Skipping subway distances.", flush=True)
        return []
    with open(STATIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def geocode_kakao(query: str) -> Optional[Tuple[float, float]]:
    """Geocode an address/keyword via Kakao Local API. Returns (lat, lng) or None."""
    if not KAKAO_REST_API_KEY:
        return None
    url = "https://dapi.kakao.com/v2/local/search/keyword.json"
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    params = {"query": query, "size": 1}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        docs = resp.json().get("documents", [])
        if docs:
            return float(docs[0]["y"]), float(docs[0]["x"])
    except Exception as e:
        print(f"  Geocode error for '{query}': {e}", flush=True)
    return None


def geocode_apartment(apt: Dict, cache: Dict) -> Optional[Tuple[float, float]]:
    """Try to geocode an apartment, using cache first, then Kakao API."""
    sigungu = apt.get("sigungu", "")
    dong = apt.get("dong_name", "")
    apt_name = apt.get("apt_name", "")
    jibun = apt.get("jibun", "")

    cache_key = f"{sigungu} {dong} {apt_name}"
    if cache_key in cache:
        c = cache[cache_key]
        return c["lat"], c["lng"]

    # Try keyword search with apt name
    query = f"{sigungu} {dong} {apt_name}"
    result = geocode_kakao(query)
    time.sleep(API_DELAY)

    # Fallback: address search with jibun
    if not result and jibun:
        fallback_query = f"{sigungu} {dong} {jibun}"
        result = geocode_kakao(fallback_query)
        time.sleep(API_DELAY)

    if result:
        cache[cache_key] = {"lat": result[0], "lng": result[1]}
        return result

    return None


def find_nearest_station(
    lat: float, lng: float, stations: List[Dict]
) -> Optional[Dict]:
    """Find the nearest subway station and return its info."""
    if not stations:
        return None
    best = None
    best_dist = float("inf")
    for st in stations:
        d = haversine(lat, lng, st["lat"], st["lng"])
        if d < best_dist:
            best_dist = d
            best = st
    if best is None:
        return None
    return {
        "name": best["name"],
        "line": best["line"],
        "dist": round(best_dist, 2),
    }


def compute_biz_distances(lat: float, lng: float) -> Dict[str, float]:
    """Compute distances to business district hubs."""
    result = {}
    for key, hub in BIZ_HUBS.items():
        d = haversine(lat, lng, hub["lat"], hub["lng"])
        result[f"biz_{key}"] = round(d, 1)
    return result


def enrich_sido(sido_file: Path, stations: List[Dict], cache: Dict) -> int:
    """Enrich a single sido JSON file. Returns number of apartments enriched."""
    with open(sido_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    sido_name = sido_file.stem
    is_metro = sido_name in METRO_SIDOS
    enriched = 0

    for section_key in ("items", "turning"):
        items = data.get(section_key, [])
        for apt in items:
            coords = geocode_apartment(apt, cache)
            if not coords:
                continue

            lat, lng = coords
            nearest = find_nearest_station(lat, lng, stations)
            if not nearest:
                continue

            geo = {
                "subway": nearest["name"],
                "subway_dist": nearest["dist"],
                "subway_line": nearest["line"],
            }

            if is_metro:
                geo.update(compute_biz_distances(lat, lng))

            apt["geo"] = geo
            enriched += 1

    with open(sido_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    return enriched


def main() -> int:
    if not KAKAO_REST_API_KEY:
        print("Warning: KAKAO_REST_API_KEY not set. Using cache only.", flush=True)

    if not BOTTOM_DIR.exists():
        print(f"Bottom directory not found: {BOTTOM_DIR}", flush=True)
        return 1

    stations = load_stations()
    print(f"Loaded {len(stations)} subway stations", flush=True)

    cache = load_cache()
    cache_size_before = len(cache)
    print(f"Geocode cache: {cache_size_before} entries", flush=True)

    index_file = BOTTOM_DIR / "index.json"
    if not index_file.exists():
        print("index.json not found in bottom dir", flush=True)
        return 1

    with open(index_file, "r", encoding="utf-8") as f:
        index = json.load(f)

    sido_order = index.get("sido_order", [])
    total_enriched = 0

    for sido in sido_order:
        sido_file = BOTTOM_DIR / f"{sido}.json"
        if not sido_file.exists():
            print(f"  Skipping {sido}: file not found", flush=True)
            continue
        print(f"Processing {sido}...", flush=True)
        count = enrich_sido(sido_file, stations, cache)
        print(f"  {sido}: {count} apartments enriched", flush=True)
        total_enriched += count

    # Save cache
    save_cache(cache)
    new_entries = len(cache) - cache_size_before
    print(
        f"Done. Total enriched: {total_enriched}. "
        f"Cache: {len(cache)} entries (+{new_entries} new)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

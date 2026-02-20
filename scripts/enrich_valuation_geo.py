#!/usr/bin/env python3
"""Enrich valuation JSON files with geo data.

Features:
1. Subway proximity (haversine) + estimated walking distance/time
2. Business district commute time (Kakao Navi API, 수도권 only)
3. Nearby facilities score (Kakao Category Search API)

Reads valuation/{시도}.json, geocodes apartments via Kakao Local API,
then writes a single valuation_geo.json mapping apt_id → geo info.
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
VALUATION_DIR = SCRIPTS_DIR.parent / "docs" / "data" / "apt_trade" / "valuation"
OUTPUT_FILE = SCRIPTS_DIR.parent / "docs" / "data" / "apt_trade" / "valuation_geo.json"
CACHE_FILE = SCRIPTS_DIR / "geocode_cache.json"
ENRICHMENT_CACHE_FILE = SCRIPTS_DIR / "enrichment_cache.json"
STATIONS_FILE = SCRIPTS_DIR / "subway_stations.json"

KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "")

BIZ_HUBS = {
    "gangnam": {"name": "강남역", "lat": 37.497175, "lng": 127.027926},
    "gwanghwamun": {"name": "광화문역", "lat": 37.571607, "lng": 126.976853},
    "yeouido": {"name": "여의도역", "lat": 37.521624, "lng": 126.924191},
}

# 수도권 시도 (업무지구 거리 + 출퇴근시간 표시 대상)
METRO_SIDOS = {"서울", "경기", "인천"}

# Rate limit: Kakao API ~10 req/sec
API_DELAY = 0.12

# Walking estimate constants
WALK_SPEED_M_PER_MIN = 67  # ~4km/h
HAVERSINE_WALK_FACTOR = 1.3  # urban road distance ≈ 1.3× haversine

# Kakao Navi API
NAVI_API_URL = "https://apis-navi.kakaomobility.com/v1/directions"

# Kakao Category Search — facility types for infra scoring
CATEGORY_CODES = {
    "MT1": "mart",      # 대형마트
    "CS2": "conv",      # 편의점
    "SC4": "school",    # 학교
    "HP8": "hospital",  # 병원
    "BK9": "bank",      # 은행
}
INFRA_WEIGHTS = {
    "mart":     {"max": 2,  "weight": 10},
    "conv":     {"max": 10, "weight": 15},
    "school":   {"max": 5,  "weight": 30},
    "hospital": {"max": 5,  "weight": 25},
    "bank":     {"max": 3,  "weight": 20},
}
INFRA_RADIUS = 1000  # meters

# 학군 점수: 학원(AC5) 수 기반
ACADEMY_CODE = "AC5"
ACADEMY_RADIUS = 1000  # meters
ACADEMY_MAX = 300  # 300개 이상이면 만점 (P75 수준, 대치동급 500+)


# ── Haversine ──

def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in km between two coordinates."""
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


# ── Geocode cache ──

def load_cache() -> Dict[str, Dict[str, float]]:
    if CACHE_FILE.exists():
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: Dict[str, Dict[str, float]]) -> None:
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)


# ── Enrichment cache (keyed by rounded coordinates) ──

def coord_key(lat: float, lng: float) -> str:
    """Round to 3 decimals (~111m) for cache sharing among nearby apartments."""
    return f"{lat:.3f},{lng:.3f}"


def load_enrichment_cache() -> Dict:
    if ENRICHMENT_CACHE_FILE.exists():
        with open(ENRICHMENT_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_enrichment_cache(cache: Dict) -> None:
    with open(ENRICHMENT_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)


# ── Stations ──

def load_stations() -> List[Dict]:
    if not STATIONS_FILE.exists():
        print(f"Warning: {STATIONS_FILE} not found.", flush=True)
        return []
    with open(STATIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


# ── Geocoding ──

def geocode_kakao(query: str) -> Optional[Tuple[float, float]]:
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
    sigungu = apt.get("sigungu", "")
    dong = apt.get("dong_name", "")
    apt_name = apt.get("apt_name", "")

    cache_key = f"{sigungu} {dong} {apt_name}"
    if cache_key in cache:
        c = cache[cache_key]
        return c["lat"], c["lng"]

    query = f"{sigungu} {dong} {apt_name}"
    result = geocode_kakao(query)
    time.sleep(API_DELAY)

    if result:
        cache[cache_key] = {"lat": result[0], "lng": result[1]}
        return result
    return None


# ── Subway proximity ──

def find_nearest_station(
    lat: float, lng: float, stations: List[Dict]
) -> Optional[Dict]:
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


def estimate_walking(haversine_km: float) -> Tuple[float, int]:
    """Estimate walking distance (km) and time (min) from haversine distance."""
    walk_km = haversine_km * HAVERSINE_WALK_FACTOR
    walk_min = max(1, round(walk_km * 1000 / WALK_SPEED_M_PER_MIN))
    return round(walk_km, 2), walk_min


# ── Business district distances ──

def compute_biz_distances(lat: float, lng: float) -> Dict[str, float]:
    result = {}
    for key, hub in BIZ_HUBS.items():
        d = haversine(lat, lng, hub["lat"], hub["lng"])
        result[f"biz_{key}"] = round(d, 1)
    return result


# ── Feature 2: Commute time via Kakao Navi API ──

def _call_navi_api(
    origin_lat: float, origin_lng: float,
    dest_lat: float, dest_lng: float,
) -> Optional[Tuple[int, int]]:
    """Call Kakao Navi API. Returns (distance_m, duration_sec) or None."""
    if not KAKAO_REST_API_KEY:
        return None
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    params = {
        "origin": f"{origin_lng},{origin_lat}",
        "destination": f"{dest_lng},{dest_lat}",
        "priority": "RECOMMEND",
    }
    try:
        resp = requests.get(NAVI_API_URL, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        routes = resp.json().get("routes", [])
        if routes and routes[0].get("result_code") == 0:
            s = routes[0]["summary"]
            return s["distance"], s["duration"]
    except Exception:
        pass  # fail silently, use fallback
    return None


navi_available: Optional[bool] = None  # lazy probe


def _probe_navi() -> bool:
    """Test if Navi API works with current key (single call)."""
    result = _call_navi_api(
        BIZ_HUBS["gangnam"]["lat"], BIZ_HUBS["gangnam"]["lng"],
        BIZ_HUBS["gwanghwamun"]["lat"], BIZ_HUBS["gwanghwamun"]["lng"],
    )
    return result is not None


def get_commute_times(
    lat: float, lng: float, ecache: Dict, ck: str,
) -> Dict[str, int]:
    """Get commute minutes to business hubs.

    Uses Kakao Navi API if available, otherwise estimates from haversine.
    Returns e.g. {"gangnam": 12, "gwanghwamun": 35, "yeouido": 30}.
    """
    global navi_available

    cached = ecache.get(ck, {}).get("commute")
    if cached:
        return cached

    # Lazy probe Navi API availability
    if navi_available is None:
        navi_available = _probe_navi()
        if navi_available:
            print("  Kakao Navi API available — using driving directions", flush=True)
        else:
            print("  Kakao Navi API unavailable — using distance estimates", flush=True)
        time.sleep(API_DELAY)

    commute = {}
    for key, hub in BIZ_HUBS.items():
        if navi_available:
            result = _call_navi_api(lat, lng, hub["lat"], hub["lng"])
            time.sleep(API_DELAY)
            if result:
                commute[key] = max(1, round(result[1] / 60))
                continue
        # Fallback: estimate from haversine (~25km/h average driving in Seoul)
        dist_km = haversine(lat, lng, hub["lat"], hub["lng"])
        commute[key] = max(1, round(dist_km / 25 * 60))

    # Update enrichment cache
    if ck not in ecache:
        ecache[ck] = {}
    ecache[ck]["commute"] = commute
    return commute


# ── Feature 3: Nearby facilities via Category Search ──

def _search_category_count(lat: float, lng: float, code: str) -> int:
    """Count nearby facilities of given category within INFRA_RADIUS."""
    if not KAKAO_REST_API_KEY:
        return 0
    url = "https://dapi.kakao.com/v2/local/search/category.json"
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    params = {
        "category_group_code": code,
        "x": str(lng),
        "y": str(lat),
        "radius": INFRA_RADIUS,
        "size": 1,  # only need meta.total_count
    }
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json().get("meta", {}).get("total_count", 0)
    except Exception:
        return 0


def get_facilities(
    lat: float, lng: float, ecache: Dict, ck: str,
) -> Dict[str, int]:
    """Get facility counts around a location. Cached by coord_key."""
    cached = ecache.get(ck, {}).get("infra")
    if cached:
        return cached

    infra = {}
    for code, name in CATEGORY_CODES.items():
        infra[name] = _search_category_count(lat, lng, code)
        time.sleep(API_DELAY)

    if ck not in ecache:
        ecache[ck] = {}
    ecache[ck]["infra"] = infra
    return infra


def calc_infra_score(infra: Dict[str, int]) -> int:
    """Calculate 0–100 infrastructure score from facility counts."""
    score = 0.0
    for key, cfg in INFRA_WEIGHTS.items():
        count = infra.get(key, 0)
        ratio = min(count / cfg["max"], 1.0)
        score += ratio * cfg["weight"]
    return round(score)


# ── Feature 4: School score from academy (AC5) count ──

def get_academy_score(
    lat: float, lng: float, ecache: Dict, ck: str,
) -> int:
    """Get school score (0–100) based on nearby academy count. Cached."""
    # Use cached count if available (recalculate score with current ACADEMY_MAX)
    cached_count = ecache.get(ck, {}).get("academy_count")
    if cached_count is not None:
        score = min(round(cached_count / ACADEMY_MAX * 100), 100)
        ecache[ck]["academy_score"] = score
        return score

    count = _search_category_count(lat, lng, ACADEMY_CODE)
    time.sleep(API_DELAY)

    score = min(round(count / ACADEMY_MAX * 100), 100)

    if ck not in ecache:
        ecache[ck] = {}
    ecache[ck]["academy_count"] = count
    ecache[ck]["academy_score"] = score
    return score


# ── Main ──

def main() -> int:
    if not KAKAO_REST_API_KEY:
        print("Warning: KAKAO_REST_API_KEY not set. Using cache only.", flush=True)

    index_file = VALUATION_DIR / "index.json"
    if not index_file.exists():
        print(f"index.json not found: {index_file}", flush=True)
        return 1

    with open(index_file, "r", encoding="utf-8") as f:
        index = json.load(f)

    sido_order = index.get("sido_order", [])
    if not sido_order:
        print("No sido_order in index.json", flush=True)
        return 1

    stations = load_stations()
    print(f"Loaded {len(stations)} subway stations", flush=True)

    cache = load_cache()
    cache_size_before = len(cache)
    print(f"Geocode cache: {cache_size_before} entries", flush=True)

    ecache = load_enrichment_cache()
    ecache_size_before = len(ecache)
    print(f"Enrichment cache: {ecache_size_before} entries", flush=True)

    geo_result: Dict[str, Dict] = {}
    total_enriched = 0

    for sido in sido_order:
        sido_file = VALUATION_DIR / f"{sido}.json"
        if not sido_file.exists():
            print(f"  Skipping {sido}: file not found", flush=True)
            continue

        with open(sido_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        is_metro = sido in METRO_SIDOS
        items = data.get("items", [])
        enriched = 0

        for apt in items:
            apt_id = apt.get("id", "")
            if not apt_id:
                continue

            coords = geocode_apartment(apt, cache)
            if not coords:
                continue

            lat, lng = coords
            ck = coord_key(lat, lng)

            # 1. Nearest subway station + walking estimate
            nearest = find_nearest_station(lat, lng, stations)
            if not nearest:
                continue

            walk_dist, walk_min = estimate_walking(nearest["dist"])

            geo: Dict = {
                "subway": nearest["name"],
                "subway_line": nearest["line"],
                "subway_dist": nearest["dist"],
                "subway_walk_dist": walk_dist,
                "subway_walk_min": walk_min,
            }

            # 2. Business district distances + commute times (수도권)
            if is_metro:
                geo.update(compute_biz_distances(lat, lng))
                commute = get_commute_times(lat, lng, ecache, ck)
                geo["commute"] = commute

            # 3. Nearby facilities
            infra = get_facilities(lat, lng, ecache, ck)
            geo["infra"] = infra
            geo["infra_score"] = calc_infra_score(infra)

            # 4. Academy-based school score
            geo["academy_score"] = get_academy_score(lat, lng, ecache, ck)

            geo_result[apt_id] = geo
            enriched += 1

        print(f"  {sido}: {enriched}/{len(items)} apartments enriched", flush=True)
        total_enriched += enriched

    # Save caches
    save_cache(cache)
    new_geo = len(cache) - cache_size_before
    print(f"Geocode cache: {len(cache)} entries (+{new_geo} new)", flush=True)

    save_enrichment_cache(ecache)
    new_enrich = len(ecache) - ecache_size_before
    print(f"Enrichment cache: {len(ecache)} entries (+{new_enrich} new)", flush=True)

    # Write output
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(geo_result, f, ensure_ascii=False, separators=(",", ":"))

    print(
        f"Done. Total enriched: {total_enriched}. "
        f"Output: {OUTPUT_FILE} ({len(geo_result)} entries)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

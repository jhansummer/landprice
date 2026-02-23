#!/usr/bin/env python3
"""Enrich valuation JSON files with geo data.

Features:
1. Subway proximity (haversine) + estimated walking distance/time
2. Business district commute time (ODsay 대중교통 API, 수도권 only)
3. Nearby facilities score (Kakao Category Search API)

Reads valuation/{시도}.json, geocodes apartments via Kakao Local API,
then writes a single valuation_geo.json mapping apt_id → geo info.
"""

import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPTS_DIR.parent / "docs" / "data" / "apt_trade"
VALUATION_DIR = DATA_DIR / "valuation"
OUTPUT_FILE = DATA_DIR / "valuation_geo.json"
SEARCH_DIR = DATA_DIR / "search"
BY_APT_DIR = DATA_DIR / "by_apt"
CACHE_FILE = SCRIPTS_DIR / "geocode_cache.json"
ENRICHMENT_CACHE_FILE = SCRIPTS_DIR / "enrichment_cache.json"
STATIONS_FILE = SCRIPTS_DIR / "subway_stations.json"
SCHOOLS_FILE = SCRIPTS_DIR / "schools.json"
HOUSEHOLD_FILE = SCRIPTS_DIR / "household_cache.json"

APT_META_FILE = SCRIPTS_DIR.parent / "docs" / "data" / "apt_trade" / "apt_meta.json"

KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "")
ODSAY_API_KEY = os.getenv("ODSAY_API_KEY", "")
ODSAY_API_URL = "https://api.odsay.com/v1/api/searchPubTransPathT"

# 프리미엄 브랜드 점수
BRAND_SCORES = {
    "디에이치": 95, "DH": 95, "아크로": 92, "래미안": 90,
    "자이": 88, "더샵": 83, "롯데캐슬": 82, "아이파크": 80,
    "힐스테이트": 80, "푸르지오": 78, "엘크루": 75, "포레나": 74,
    "e편한세상": 72, "호반써밋": 68, "하늘채": 65, "꿈에그린": 62,
}

BIZ_HUBS = {
    "gangnam": {"name": "강남역", "lat": 37.497175, "lng": 127.027926},
    "gwanghwamun": {"name": "광화문역", "lat": 37.571607, "lng": 126.976853},
    "yeouido": {"name": "여의도역", "lat": 37.521624, "lng": 126.924191},
}

# 수도권 시도 (업무지구 거리 + 출퇴근시간 표시 대상)
METRO_SIDOS = {"서울", "경기", "인천"}

# 비수도권 도심 좌표 (교통점수 산출용)
CITY_CENTERS = {
    "부산": [
        {"name": "동래온천", "lat": 35.2050, "lng": 129.0780},
        {"name": "센텀시티", "lat": 35.1695, "lng": 129.1310},
    ],
    "대구": [
        {"name": "동성로", "lat": 35.8690, "lng": 128.5950},
        {"name": "범어역", "lat": 35.8577, "lng": 128.6250},
    ],
    "울산": [
        {"name": "울산시청", "lat": 35.5396, "lng": 129.3114},
        {"name": "삼산동", "lat": 35.5405, "lng": 129.3376},
    ],
    "세종": [
        {"name": "세종시청", "lat": 36.4800, "lng": 127.2610},
    ],
    "광주": [
        {"name": "충장로", "lat": 35.1487, "lng": 126.9171},
    ],
    "대전": [
        {"name": "둔산동", "lat": 36.3515, "lng": 127.3779},
    ],
}

# Rate limit: Kakao API ~10 req/sec
API_DELAY = 0.12

# Walking estimate constants
WALK_SPEED_M_PER_MIN = 67  # ~4km/h
HAVERSINE_WALK_FACTOR = 1.3  # urban road distance ≈ 1.3× haversine

# Kakao Category Search — facility types for infra scoring
CATEGORY_CODES = {
    "MT1": "mart",      # 대형마트
    "CS2": "conv",      # 편의점
    "SC4": "school",    # 학교
    "HP8": "hospital",  # 병원
    "BK9": "bank",      # 은행
    "AC5": "academy",   # 학원
}
INFRA_WEIGHTS = {
    "mart":     {"max": 2,  "weight": 10},
    "conv":     {"max": 10, "weight": 10},
    "school":   {"max": 5,  "weight": 20},
    "hospital": {"max": 5,  "weight": 15},
    "bank":     {"max": 3,  "weight": 15},
    "academy":  {"max": 30, "weight": 30},
}
INFRA_RADIUS = 1000  # meters

# 학군 점수: 학교 성적 기반
SCHOOL_RADIUS_KM = 1.5       # 기본 반경 (km)
SCHOOL_RADIUS_MAX_KM = 3.0   # 확대 반경 (학교 없을 때)
SCHOOL_TYPE_WEIGHT = {"elementary": 1.0, "middle": 1.2}
SCHOOL_MIN_DIST_KM = 0.1     # 최소 거리 (가중치 발산 방지)

# loc_score OLS regression constants (R²=0.7551, N=23,545, 84m² 기준)
LOC_SIDO_BASE = {
    "서울": 0.5054, "경기": 0.0, "인천": -0.2961,
    "세종": 0.5118, "부산": -0.6202, "대구": -0.7063,
    "울산": -0.4869, "광주": -0.2367, "대전": -0.2387,
}
LOC_INTERCEPT = 5.7196
LOC_SCALE_LOW = 5.35    # ~2nd percentile
LOC_SCALE_HIGH = 8.30   # 목동신시가지≈95, 강남≈100


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


# ── Schools ──

def load_schools() -> List[Dict]:
    if not SCHOOLS_FILE.exists():
        print(f"Warning: {SCHOOLS_FILE} not found.", flush=True)
        return []
    with open(SCHOOLS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


# ── Geocoding ──

def geocode_kakao(query: str) -> Optional[Tuple[float, float, str]]:
    """Kakao 키워드 검색으로 좌표+주소를 반환. (lat, lng, address_name) or None."""
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
            addr = docs[0].get("address_name", "") or docs[0].get("road_address_name", "")
            return float(docs[0]["y"]), float(docs[0]["x"]), addr
    except Exception as e:
        print(f"  Geocode error for '{query}': {e}", flush=True)
    return None


def _normalize_region(s: str) -> str:
    """시군구 비교용 정규화. 공백·특별자치·광역 등 제거.
    '안산시단원구' == '안산시 단원구', '세종시' == '세종특별자치시'."""
    s = s.replace(" ", "")
    s = s.replace("특별자치", "")
    s = s.replace("특별", "")
    s = s.replace("광역", "")
    return s


def _verify_sigungu(result: Tuple[float, float, str], sigungu: str, query: str) -> bool:
    """지오코딩 결과 주소가 기대 시군구를 포함하는지 검증."""
    if not sigungu:
        return True
    addr = result[2]
    # 공백 제거 후 비교 (안산시단원구 vs 안산시 단원구 대응)
    if _normalize_region(sigungu) in _normalize_region(addr):
        return True
    print(f"  Geocode mismatch: '{query}' → '{addr}' (expected {sigungu})", flush=True)
    return False


def geocode_apartment(apt: Dict, cache: Dict) -> Optional[Tuple[float, float]]:
    sigungu = apt.get("sigungu", "")
    dong = apt.get("dong_name", "")
    apt_name = apt.get("apt_name", "")

    cache_key = f"{sigungu} {dong} {apt_name}"
    if cache_key in cache:
        c = cache[cache_key]
        return c["lat"], c["lng"]

    # 1차: 전체 쿼리
    query = f"{sigungu} {dong} {apt_name}"
    result = geocode_kakao(query)
    time.sleep(API_DELAY)

    # 주소 검증: 시군구 불일치 시 거부
    if result and not _verify_sigungu(result, sigungu, query):
        result = None

    if not result:
        # 2차: 괄호+내용 제거 후 재시도 (e.g. "신동아(22)" → "신동아")
        clean_name = re.sub(r"\(.*?\)", "", apt_name).strip()
        if clean_name and clean_name != apt_name:
            fallback_q = f"{sigungu} {dong} {clean_name}"
            result = geocode_kakao(fallback_q)
            time.sleep(API_DELAY)
            if result and not _verify_sigungu(result, sigungu, fallback_q):
                result = None

    if result:
        cache[cache_key] = {"lat": result[0], "lng": result[1]}
        return result[0], result[1]
    return None


def validate_geocode_cache(cache: Dict) -> int:
    """기존 캐시 항목을 Kakao 역지오코딩으로 검증. 불일치 항목 제거 후 제거 수 반환."""
    if not KAKAO_REST_API_KEY:
        print("KAKAO_REST_API_KEY not set. Cannot validate cache.", flush=True)
        return 0

    url = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json"
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    bad_keys = []
    checked = 0

    for key, coords in list(cache.items()):
        # 캐시 키에서 시군구 추출 (첫 토큰: "강남구", "수원시" 등)
        parts = key.split()
        if not parts:
            continue
        expected_sigungu = parts[0]

        lat, lng = coords["lat"], coords["lng"]
        try:
            resp = requests.get(url, headers=headers,
                                params={"x": lng, "y": lat}, timeout=10)
            resp.raise_for_status()
            docs = resp.json().get("documents", [])
            if docs:
                region = docs[0].get("address_name", "")
                if _normalize_region(expected_sigungu) not in _normalize_region(region):
                    print(f"  Cache mismatch: '{key}' → ({lat},{lng}) → '{region}'", flush=True)
                    bad_keys.append(key)
        except Exception as e:
            print(f"  Validate error for '{key}': {e}", flush=True)

        checked += 1
        if checked % 100 == 0:
            print(f"  Validated {checked}/{len(cache)} entries...", flush=True)
        time.sleep(API_DELAY)

    for key in bad_keys:
        del cache[key]
    print(f"Cache validation: {checked} checked, {len(bad_keys)} removed", flush=True)
    return len(bad_keys)


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


# ── Feature 2: Commute time via ODsay 대중교통 API ──

def _call_odsay_api(
    origin_lat: float, origin_lng: float,
    dest_lat: float, dest_lng: float,
) -> Optional[int]:
    """ODsay 대중교통 API 호출. 최소 totalTime(분) 반환, 실패 시 None."""
    if not ODSAY_API_KEY:
        return None
    params = {
        "SX": str(origin_lng),
        "SY": str(origin_lat),
        "EX": str(dest_lng),
        "EY": str(dest_lat),
        "apiKey": ODSAY_API_KEY,
        "SearchPathType": 0,  # 지하철+버스 전체
        "SearchDate": "20260223",  # 평일 월요일 기준
        "SearchTime": "0800",      # 출근시간 오전 8시 고정
    }
    try:
        resp = requests.get(ODSAY_API_URL, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        paths = data.get("result", {}).get("path", [])
        if paths:
            return min(p["info"]["totalTime"] for p in paths)
    except Exception:
        pass  # fail silently, use fallback
    return None


transit_available: Optional[bool] = None  # lazy probe


def _probe_transit() -> bool:
    """Test if ODsay API works with current key (single call)."""
    result = _call_odsay_api(
        BIZ_HUBS["gangnam"]["lat"], BIZ_HUBS["gangnam"]["lng"],
        BIZ_HUBS["gwanghwamun"]["lat"], BIZ_HUBS["gwanghwamun"]["lng"],
    )
    return result is not None


def get_commute_times(
    lat: float, lng: float, ecache: Dict, ck: str,
) -> Dict[str, int]:
    """Get commute minutes to business hubs via public transit.

    Uses ODsay 대중교통 API if available, otherwise estimates from haversine.
    Returns e.g. {"gangnam": 45, "gwanghwamun": 55, "yeouido": 50}.
    """
    global transit_available

    cached = ecache.get(ck, {}).get("commute_transit")
    if cached:
        return cached

    # Lazy probe ODsay API availability
    if transit_available is None:
        transit_available = _probe_transit()
        if transit_available:
            print("  ODsay transit API available — using public transit", flush=True)
        else:
            print("  ODsay transit API unavailable — using distance estimates", flush=True)
        time.sleep(API_DELAY)

    commute = {}
    for key, hub in BIZ_HUBS.items():
        if transit_available:
            result = _call_odsay_api(lat, lng, hub["lat"], hub["lng"])
            time.sleep(API_DELAY)
            if result:
                commute[key] = max(1, result)
                continue
        # Fallback: estimate from haversine (~20km/h average transit in Seoul)
        dist_km = haversine(lat, lng, hub["lat"], hub["lng"])
        commute[key] = max(1, round(dist_km / 20 * 60))

    # Update enrichment cache
    if ck not in ecache:
        ecache[ck] = {}
    ecache[ck]["commute_transit"] = commute
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


# ── Feature 4: School score from school performance data ──

def get_school_score(
    lat: float, lng: float, schools: List[Dict], ecache: Dict, ck: str,
) -> Optional[int]:
    """Get school score (0–100) based on nearby school performance. Cached.

    Uses distance-inverse weighted average of school perf scores within radius.
    Elementary: weight 1.0, Middle: weight 1.2.
    Returns None if no schools found within extended radius.
    """
    cached = ecache.get(ck, {}).get("school_score")
    if cached is not None:
        return cached

    # Search within primary radius
    nearby = []
    for s in schools:
        d = haversine(lat, lng, s["lat"], s["lng"])
        if d <= SCHOOL_RADIUS_KM:
            nearby.append((s, d))

    # Expand to max radius if no schools found
    if not nearby:
        for s in schools:
            d = haversine(lat, lng, s["lat"], s["lng"])
            if d <= SCHOOL_RADIUS_MAX_KM:
                nearby.append((s, d))

    if not nearby:
        return None

    # Distance-inverse weighted average
    w_sum = 0.0
    score_sum = 0.0
    for s, d in nearby:
        dist = max(d, SCHOOL_MIN_DIST_KM)
        type_w = SCHOOL_TYPE_WEIGHT.get(s.get("type", "elementary"), 1.0)
        w = (1.0 / dist) * type_w
        score_sum += s.get("perf", 50) * w
        w_sum += w

    score = round(score_sum / w_sum) if w_sum > 0 else None

    if ck not in ecache:
        ecache[ck] = {}
    ecache[ck]["school_score"] = score
    return score


def get_brand_score(apt_name: str) -> int:
    """브랜드 점수 (0-100). 프리미엄 브랜드일수록 높음."""
    for brand, score in BRAND_SCORES.items():
        if brand in apt_name:
            return score
    return 50  # 비브랜드/일반


def get_age_score(build_year: int) -> Optional[int]:
    """연식 점수 (0-100). 신축일수록 높음. 3년 이하 100, 40년 이상 0."""
    if build_year <= 0:
        return None
    age = 2026 - build_year
    if age <= 3:
        return 100
    if age >= 40:
        return 0
    return round(100 * (40 - age) / 37)


def get_household_score(households: int) -> int:
    """세대수 점수 (0-100). 대단지일수록 높음. 300세대=50, 1500세대+=100."""
    if households <= 0:
        return 0
    if households >= 1500:
        return 100
    if households <= 100:
        return round(households * 30 / 100)  # 0~30
    # 100~1500: 30~100
    return round(30 + (households - 100) * 70 / 1400)


def get_liquidity_score(trade_count: int) -> int:
    """환금성 점수 (0-100). 3년간 거래건수 기반. 30건=50, 60건+=100."""
    if trade_count <= 0:
        return 0
    if trade_count >= 60:
        return 100
    return round(min(100, trade_count * 100 / 60))



# ── Enrich single apartment ──

def enrich_apt(apt, apt_id, sido, cache, ecache, stations, schools, apt_meta,
               household_data, skip_odsay=False):
    """Enrich a single apartment and return geo dict, or None on failure."""
    coords = geocode_apartment(apt, cache)
    if not coords:
        return None

    lat, lng = coords
    ck = coord_key(lat, lng)

    nearest = find_nearest_station(lat, lng, stations)
    if not nearest:
        return None

    walk_dist, walk_min = estimate_walking(nearest["dist"])

    geo: Dict = {
        "subway": nearest["name"],
        "subway_line": nearest["line"],
        "subway_dist": nearest["dist"],
        "subway_walk_dist": walk_dist,
        "subway_walk_min": walk_min,
    }

    is_metro = sido in METRO_SIDOS
    if is_metro:
        geo.update(compute_biz_distances(lat, lng))
        if not skip_odsay:
            commute = get_commute_times(lat, lng, ecache, ck)
            geo["commute"] = commute

    infra = get_facilities(lat, lng, ecache, ck)
    geo["infra"] = infra
    geo["infra_score"] = calc_infra_score(infra)

    school_score = get_school_score(lat, lng, schools, ecache, ck)
    if school_score is not None:
        geo["academy_score"] = school_score

    brand_s = get_brand_score(apt.get("apt_name", ""))
    geo["brand_score"] = brand_s
    build_year = apt_meta.get(apt_id, 0)
    age_s = get_age_score(build_year)
    if age_s is not None:
        geo["age_score"] = age_s
    hh_key = f"{apt.get('sigungu', '')}|{apt.get('dong_name', '')}|{apt.get('apt_name', '')}"
    hh_data = household_data.get(hh_key)
    if not hh_data:
        hh_key_old = f"{apt.get('sigungu', '')}|{apt.get('apt_name', '')}"
        hh_data = household_data.get(hh_key_old)
    if hh_data and hh_data.get("households"):
        geo["households"] = hh_data["households"]
        geo["household_score"] = get_household_score(hh_data["households"])

    trade_count = apt.get("trade_count", 0)
    if trade_count <= 0:
        # Fallback: count trades from by_apt/{id}.json
        by_apt_file = BY_APT_DIR / f"{apt_id}.json"
        if by_apt_file.exists():
            try:
                with open(by_apt_file, "r", encoding="utf-8") as _f:
                    trade_count = len(json.load(_f))
            except Exception:
                pass
    liquidity_s = get_liquidity_score(trade_count)
    geo["liquidity_score"] = liquidity_s

    livability_parts = [brand_s]
    if age_s is not None:
        livability_parts.append(age_s)
    if geo.get("household_score") is not None:
        livability_parts.append(geo["household_score"])
    livability_s = round(sum(livability_parts) / len(livability_parts))
    geo["livability_score"] = livability_s

    subway_s_exp = round(100 * math.exp(-nearest["dist"] / 0.8))
    if geo.get("biz_gangnam") is not None:
        def _bds(d): return max(0, min(100, round(100 - (d - 3) * 100 / 47)))
        biz_dist = min(geo.get("biz_gangnam", 999), geo.get("biz_gwanghwamun", 999), geo.get("biz_yeouido", 999))
        biz_s = _bds(biz_dist)
        transport_s = biz_s * 0.7 + subway_s_exp * 0.3
    else:
        sido_short = sido.replace("광역시", "").replace("특별자치시", "").replace("특별시", "")
        centers = CITY_CENTERS.get(sido_short)
        if centers:
            center_dist = min(haversine(lat, lng, c["lat"], c["lng"]) for c in centers)
            center_s = max(0, min(100, round(100 - (center_dist - 1) * 100 / 24)))
            transport_s = center_s * 0.7 + subway_s_exp * 0.3
        else:
            transport_s = subway_s_exp

    # --- loc_score: OLS regression ---
    acad = school_score if school_score is not None else 50
    sw_dist = nearest["dist"]
    sw_walk = geo.get("subway_walk_min", 10)
    infra = geo.get("infra_score", 50)
    age_val = get_age_score(apt_meta.get(apt_id, 0))
    if age_val is None:
        age_val = 50
    liq = geo.get("liquidity_score", 50)
    liv = geo.get("livability_score", 50)

    raw_loc = (LOC_INTERCEPT
               + LOC_SIDO_BASE.get(sido, -0.5)
               + (-0.0673) * math.log1p(sw_dist)
               + 0.3885 * math.log1p(sw_walk)
               + (-0.000361) * (sw_walk ** 2 / 100)
               + (-0.002034) * infra
               + 0.002713 * (infra ** 2 / 100)
               + (-0.04354) * acad
               + 0.05478 * (acad ** 2 / 100)
               + (-0.01048) * age_val
               + 0.01186 * (age_val ** 2 / 100)
               + 0.01445 * liq
               + (-0.01169) * (liq ** 2 / 100)
               + 0.01308 * liv
               + 0.00311 * (acad * infra / 100)
               + (-0.00499) * (acad * math.log1p(sw_walk))
               + (-0.00116) * (infra * math.log1p(sw_dist)))
    geo["loc_score"] = round(max(0, min(100,
        (raw_loc - LOC_SCALE_LOW) / (LOC_SCALE_HIGH - LOC_SCALE_LOW) * 100)))

    return geo


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

    schools = load_schools()
    print(f"Loaded {len(schools)} schools", flush=True)

    apt_meta: Dict[str, int] = {}
    if APT_META_FILE.exists():
        with open(APT_META_FILE, "r", encoding="utf-8") as f:
            apt_meta = json.load(f)
        print(f"Loaded {len(apt_meta)} apt meta entries", flush=True)

    household_data: Dict[str, Dict] = {}
    if HOUSEHOLD_FILE.exists():
        with open(HOUSEHOLD_FILE, "r", encoding="utf-8") as f:
            household_data = json.load(f)
        print(f"Loaded {len(household_data)} household entries", flush=True)

    cache = load_cache()
    cache_size_before = len(cache)
    print(f"Geocode cache: {cache_size_before} entries", flush=True)

    # --validate-cache: 기존 캐시 역지오코딩 검증
    if "--validate-cache" in sys.argv:
        removed = validate_geocode_cache(cache)
        if removed:
            save_cache(cache)
            print(f"Removed {removed} mismatched cache entries. Re-run to re-geocode.", flush=True)
        else:
            print("All cache entries valid.", flush=True)
        return 0

    ecache = load_enrichment_cache()
    ecache_size_before = len(ecache)
    print(f"Enrichment cache: {ecache_size_before} entries", flush=True)

    geo_result: Dict[str, Dict] = {}
    total_enriched = 0

    # Phase 1: Enrich valuation items (with ODsay commute)
    for sido in sido_order:
        sido_file = VALUATION_DIR / f"{sido}.json"
        if not sido_file.exists():
            print(f"  Skipping {sido}: file not found", flush=True)
            continue

        with open(sido_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        items = data.get("items", [])
        enriched = 0

        for apt in items:
            apt_id = apt.get("id", "")
            if not apt_id:
                continue
            geo = enrich_apt(apt, apt_id, sido, cache, ecache, stations,
                             schools, apt_meta, household_data, skip_odsay=False)
            if geo:
                geo_result[apt_id] = geo
                enriched += 1

        print(f"  {sido}: {enriched}/{len(items)} apartments enriched", flush=True)
        total_enriched += enriched

    # Phase 2: Enrich remaining search items (without ODsay, one per complex)
    max_new = int(sys.argv[sys.argv.index("--max-new") + 1]) if "--max-new" in sys.argv else 0
    search_enriched = 0
    for sido in sido_order:
        search_file = SEARCH_DIR / f"{sido}.json"
        if not search_file.exists():
            continue
        with open(search_file, "r", encoding="utf-8") as f:
            search_data = json.load(f)

        # Build set of complexes already covered by geo_result
        covered_complexes: set = set()
        for item in search_data.get("items", []):
            if item.get("id", "") in geo_result:
                ckey = f"{item.get('apt_name', '')}|{item.get('sigungu', '')}|{item.get('dong_name', '')}"
                covered_complexes.add(ckey)

        # Pick one representative per uncovered complex
        complex_repr: Dict[str, Dict] = {}
        for item in search_data.get("items", []):
            aid = item.get("id", "")
            if not aid or aid in geo_result:
                continue
            ckey = f"{item.get('apt_name', '')}|{item.get('sigungu', '')}|{item.get('dong_name', '')}"
            if ckey in covered_complexes or ckey in complex_repr:
                continue
            complex_repr[ckey] = item

        enriched_sido = 0
        for ckey, apt in complex_repr.items():
            if max_new and search_enriched >= max_new:
                break
            apt_id = apt.get("id", "")
            geo = enrich_apt(apt, apt_id, sido, cache, ecache, stations,
                             schools, apt_meta, household_data, skip_odsay=True)
            if geo:
                geo_result[apt_id] = geo
                enriched_sido += 1
                search_enriched += 1

        if enriched_sido:
            print(f"  {sido} (search): {enriched_sido} new complexes enriched", flush=True)
        if max_new and search_enriched >= max_new:
            print(f"  Reached --max-new limit ({max_new})", flush=True)
            break

    if search_enriched:
        print(f"  Search total: {search_enriched} new complexes enriched", flush=True)
        total_enriched += search_enriched

    # Save caches
    save_cache(cache)
    new_geo = len(cache) - cache_size_before
    print(f"Geocode cache: {len(cache)} entries (+{new_geo} new)", flush=True)

    save_enrichment_cache(ecache)
    new_enrich = len(ecache) - ecache_size_before
    print(f"Enrichment cache: {len(ecache)} entries (+{new_enrich} new)", flush=True)

    # Propagate geo to other areas of same physical complex
    propagated = 0
    complex_geo: Dict[str, str] = {}  # complex_key -> apt_id with geo
    complex_missing: Dict[str, List[str]] = {}  # complex_key -> [apt_ids without geo]

    for sido in sido_order:
        search_file = SEARCH_DIR / f"{sido}.json"
        if not search_file.exists():
            continue
        with open(search_file, "r", encoding="utf-8") as f:
            search_data = json.load(f)
        for item in search_data.get("items", []):
            aid = item.get("id", "")
            if not aid:
                continue
            ckey = f"{item.get('apt_name', '')}|{item.get('sigungu', '')}|{item.get('dong_name', '')}"
            if aid in geo_result:
                if ckey not in complex_geo:
                    complex_geo[ckey] = aid
            else:
                complex_missing.setdefault(ckey, []).append(aid)

    # Copy geo data from existing area to missing areas
    SKIP_FIELDS = {"jeonse_ratio"}
    for ckey, missing_ids in complex_missing.items():
        source_id = complex_geo.get(ckey)
        if not source_id:
            continue
        source = geo_result[source_id]
        for mid in missing_ids:
            copied = {k: v for k, v in source.items() if k not in SKIP_FIELDS}
            geo_result[mid] = copied
            propagated += 1

    if propagated:
        print(f"  Propagated geo to {propagated} additional areas (same complex)", flush=True)

    # ── 학군점수 percentile 재스케일링 (변별력 향상) ──
    import bisect as _bisect
    raw_academy = sorted(
        g.get("academy_score", -1) for g in geo_result.values()
        if g.get("academy_score") is not None
    )
    if raw_academy:
        # apt_id → sido 매핑 (search index 기반)
        _apt_sido: Dict[str, str] = {}
        for _sn in sido_order:
            _sf = SEARCH_DIR / f"{_sn}.json"
            if _sf.exists():
                with open(_sf, "r", encoding="utf-8") as _f:
                    for _item in json.load(_f).get("items", []):
                        if _item.get("id"):
                            _apt_sido[_item["id"]] = _sn
            _vf = VALUATION_DIR / f"{_sn}.json"
            if _vf.exists():
                with open(_vf, "r", encoding="utf-8") as _f:
                    for _item in json.load(_f).get("items", []):
                        if _item.get("id"):
                            _apt_sido[_item["id"]] = _sn

        n_acad = len(raw_academy)
        rescaled = 0
        for apt_id, g in geo_result.items():
            acad = g.get("academy_score")
            if acad is None:
                continue
            g["academy_score_raw"] = acad
            new_acad = round(_bisect.bisect_left(raw_academy, acad) / n_acad * 100)
            g["academy_score"] = new_acad

            # loc_score 재계산
            sw_dist = g.get("subway_dist")
            if sw_dist is None or g.get("loc_score") is None:
                rescaled += 1
                continue
            _s = _apt_sido.get(apt_id, "")
            sw_walk = g.get("subway_walk_min", 10)
            infra_v = g.get("infra_score", 50)
            age_v = g.get("age_score") if g.get("age_score") is not None else 50
            liq_v = g.get("liquidity_score", 50)
            liv_v = g.get("livability_score", 50)
            raw_loc = (LOC_INTERCEPT + LOC_SIDO_BASE.get(_s, -0.5)
                       + (-0.0673) * math.log1p(sw_dist)
                       + 0.3885 * math.log1p(sw_walk)
                       + (-0.000361) * (sw_walk ** 2 / 100)
                       + (-0.002034) * infra_v
                       + 0.002713 * (infra_v ** 2 / 100)
                       + (-0.04354) * new_acad
                       + 0.05478 * (new_acad ** 2 / 100)
                       + (-0.01048) * age_v
                       + 0.01186 * (age_v ** 2 / 100)
                       + 0.01445 * liq_v
                       + (-0.01169) * (liq_v ** 2 / 100)
                       + 0.01308 * liv_v
                       + 0.00311 * (new_acad * infra_v / 100)
                       + (-0.00499) * (new_acad * math.log1p(sw_walk))
                       + (-0.00116) * (infra_v * math.log1p(sw_dist)))
            g["loc_score"] = round(max(0, min(100,
                (raw_loc - LOC_SCALE_LOW) / (LOC_SCALE_HIGH - LOC_SCALE_LOW) * 100)))
            rescaled += 1
        print(f"  Academy score percentile rescaling: {rescaled} entries", flush=True)

    # ── loc_score percentile 재스케일링 (100점 집중 방지) ──
    raw_locs = sorted(
        g.get("loc_score", -1) for g in geo_result.values()
        if g.get("loc_score") is not None
    )
    if raw_locs:
        n_loc = len(raw_locs)
        loc_rescaled = 0
        for g in geo_result.values():
            loc = g.get("loc_score")
            if loc is None:
                continue
            g["loc_score_raw"] = loc
            g["loc_score"] = round(_bisect.bisect_left(raw_locs, loc) / n_loc * 100)
            loc_rescaled += 1
        print(f"  loc_score percentile rescaling: {loc_rescaled} entries", flush=True)

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

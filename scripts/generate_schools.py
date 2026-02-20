#!/usr/bin/env python3
"""Generate schools.json from NEIS + Kakao + asil.kr.

Offline script — run once per semester to update school performance data.

Pipeline:
1. NEIS API → 전국 초/중학교 목록 (이름, 코드, 주소, 교육청코드)
2. Kakao API → 주소 → 좌표 (지오코딩)
3. asil.kr 스크래핑 → 중학교 학업성취도 (보통학력이상%)
   초등학교는 인근 중학교 성적의 거리역수 가중평균
4. Output: scripts/schools.json
"""

import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import requests
from bs4 import BeautifulSoup

SCRIPTS_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = SCRIPTS_DIR / "schools.json"
GEOCODE_CACHE_FILE = SCRIPTS_DIR / "school_geocode_cache.json"
PERF_CACHE_FILE = SCRIPTS_DIR / "school_perf_cache.json"

KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "")
NEIS_API_KEY = os.getenv("NEIS_API_KEY", "")

API_DELAY = 0.12  # Kakao rate limit ~10 req/sec

# 9개 시도 교육청 코드
SIDO_TO_ATPT = {
    "서울": "B10",
    "경기": "J10",
    "부산": "C10",
    "대구": "D10",
    "인천": "E10",
    "광주": "F10",
    "대전": "G10",
    "울산": "H10",
    "세종": "I10",
}

SCHOOL_TYPES = {
    "초등학교": "elementary",
    "중학교": "middle",
}

NEIS_BASE = "https://open.neis.go.kr/hub/schoolInfo"

DEFAULT_PERF = 50

# asil.kr 지역코드 → ATPT 매핑
ASIL_AREA_TO_ATPT = {
    "11": "B10",  # 서울
    "41": "J10",  # 경기
    "26": "C10",  # 부산
    "27": "D10",  # 대구
    "28": "E10",  # 인천
    "29": "F10",  # 광주
    "30": "G10",  # 대전
    "31": "H10",  # 울산
    "36": "I10",  # 세종
}
ASIL_URL = "https://asil.kr/asil/sub/school_list.jsp"


# ── Caches ──

def load_json_cache(path: Path) -> Dict:
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_json_cache(path: Path, data: Dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


# ── Step 1: NEIS API — 학교 목록 ──

def fetch_neis_schools(atpt_code: str, school_kind: str) -> List[Dict]:
    """Fetch school list from NEIS open API (no key required)."""
    schools = []
    page = 1
    while True:
        params = {
            "Type": "json",
            "ATPT_OFCDC_SC_CODE": atpt_code,
            "SCHUL_KND_SC_NM": school_kind,
            "pIndex": page,
            "pSize": 1000,
        }
        if NEIS_API_KEY:
            params["KEY"] = NEIS_API_KEY
        try:
            resp = requests.get(NEIS_BASE, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"  NEIS API error (atpt={atpt_code}, kind={school_kind}, page={page}): {e}", flush=True)
            break

        rows = None
        if "schoolInfo" in data:
            for section in data["schoolInfo"]:
                if "row" in section:
                    rows = section["row"]
                    break

        if not rows:
            break

        for row in rows:
            schools.append({
                "name": row.get("SCHUL_NM", ""),
                "code": row.get("SD_SCHUL_CODE", ""),
                "atpt": atpt_code,
                "address": row.get("ORG_RDNMA", "") or row.get("ORG_RDNDA", ""),
                "kind": school_kind,
            })

        if len(rows) < 1000:
            break
        page += 1
        time.sleep(0.3)

    return schools


def collect_all_schools() -> List[Dict]:
    """Collect elementary and middle schools across all target regions."""
    all_schools = []
    for sido, atpt in SIDO_TO_ATPT.items():
        for kind_kr, kind_en in SCHOOL_TYPES.items():
            print(f"  Fetching {sido} {kind_kr}...", flush=True)
            schools = fetch_neis_schools(atpt, kind_kr)
            for s in schools:
                s["type"] = kind_en
            all_schools.extend(schools)
            print(f"    → {len(schools)} schools", flush=True)
            time.sleep(0.3)
    return all_schools


# ── Step 2: Kakao geocoding ──

def geocode_address(address: str) -> Optional[Dict]:
    """Geocode a Korean address using Kakao Local API."""
    if not KAKAO_REST_API_KEY or not address:
        return None
    url = "https://dapi.kakao.com/v2/local/search/address.json"
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    params = {"query": address, "size": 1}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        docs = resp.json().get("documents", [])
        if docs:
            return {"lat": round(float(docs[0]["y"]), 6), "lng": round(float(docs[0]["x"]), 6)}
    except Exception as e:
        print(f"    Geocode error for '{address}': {e}", flush=True)
    return None


def geocode_schools(schools: List[Dict], cache: Dict) -> int:
    """Geocode all schools, using cache. Returns count of new geocodes."""
    new_count = 0
    for i, school in enumerate(schools):
        code = school["code"]
        if code in cache:
            school["lat"] = cache[code]["lat"]
            school["lng"] = cache[code]["lng"]
            continue

        result = geocode_address(school["address"])
        time.sleep(API_DELAY)

        if result:
            school["lat"] = result["lat"]
            school["lng"] = result["lng"]
            cache[code] = result
            new_count += 1
        else:
            # Try keyword search as fallback
            url = "https://dapi.kakao.com/v2/local/search/keyword.json"
            headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
            params = {"query": school["name"], "size": 1}
            try:
                resp = requests.get(url, headers=headers, params=params, timeout=10)
                resp.raise_for_status()
                docs = resp.json().get("documents", [])
                if docs:
                    lat = round(float(docs[0]["y"]), 6)
                    lng = round(float(docs[0]["x"]), 6)
                    school["lat"] = lat
                    school["lng"] = lng
                    cache[code] = {"lat": lat, "lng": lng}
                    new_count += 1
            except Exception:
                pass
            time.sleep(API_DELAY)

        if (i + 1) % 500 == 0:
            print(f"    Geocoded {i + 1}/{len(schools)} (+{new_count} new)", flush=True)

    return new_count


# ── Haversine (for elementary school proximity matching) ──

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


# ── Step 3: asil.kr 스크래핑 — 중학교 학업성취도 ──

def scrape_asil_area(area_code: str) -> List[Dict]:
    """Scrape middle school achievement data from asil.kr for one area.

    Returns list of {name, perf} dicts.
    """
    params = {"area": area_code, "type1": "3", "order": "1", "orderby": "desc"}
    try:
        resp = requests.get(ASIL_URL, params=params, timeout=30)
        resp.encoding = "utf-8"
        resp.raise_for_status()
    except Exception as e:
        print(f"    asil.kr error (area={area_code}): {e}", flush=True)
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    tbody = soup.find("tbody")
    if not tbody:
        return []

    results = []
    for row in tbody.find_all("tr"):
        tds = row.find_all("td")
        if len(tds) < 8:
            continue
        a_tag = tds[2].find("a")
        if not a_tag:
            continue
        name = a_tag.get_text(strip=True)
        avg_text = tds[4].get_text(strip=True).replace("%", "")
        try:
            perf = float(avg_text)
        except (ValueError, TypeError):
            continue
        results.append({"name": name, "perf": perf})

    return results


def scrape_all_achievement() -> Dict[str, Dict[str, float]]:
    """Scrape all areas from asil.kr.

    Returns {atpt: {school_name: perf}} mapping.
    """
    result = {}
    for area, atpt in ASIL_AREA_TO_ATPT.items():
        print(f"    Scraping asil.kr area={area} ({atpt})...", flush=True)
        schools = scrape_asil_area(area)
        name_map = {}
        for s in schools:
            name_map[s["name"]] = s["perf"]
        result[atpt] = name_map
        print(f"      → {len(schools)} middle schools", flush=True)
        time.sleep(1)
    return result


def enrich_perf(schools: List[Dict], perf_cache: Dict) -> int:
    """Enrich schools with performance data.

    Middle schools: match by (atpt, name) to asil.kr achievement data.
    Elementary schools: distance-inverse weighted average of nearby middle schools.
    """
    # Scrape asil.kr
    achievement = scrape_all_achievement()

    # First pass: middle schools
    matched = 0
    for school in schools:
        if school["type"] != "middle":
            continue
        atpt_data = achievement.get(school["atpt"], {})
        name = school["name"].strip()
        if name in atpt_data:
            school["perf"] = atpt_data[name]
            school["perf_src"] = "achievement"
            matched += 1
        else:
            school["perf"] = DEFAULT_PERF
            school["perf_src"] = "default"

    print(f"    Middle schools matched: {matched}", flush=True)

    # Second pass: elementary schools → nearby middle school average
    middle_with_perf = [
        s for s in schools
        if s["type"] == "middle" and "lat" in s and s.get("perf_src") == "achievement"
    ]

    elem_matched = 0
    for school in schools:
        if school["type"] != "elementary":
            continue
        if "lat" not in school:
            school["perf"] = DEFAULT_PERF
            school["perf_src"] = "default"
            continue

        # Find nearest middle schools with achievement data (within 3km)
        nearby = []
        for ms in middle_with_perf:
            d = haversine(school["lat"], school["lng"], ms["lat"], ms["lng"])
            if d <= 3.0:
                nearby.append((d, ms["perf"]))

        if nearby:
            nearby.sort()
            top = nearby[:5]
            w_sum = 0.0
            s_sum = 0.0
            for d, perf in top:
                w = 1.0 / max(d, 0.1)
                s_sum += perf * w
                w_sum += w
            school["perf"] = round(s_sum / w_sum, 1)
            school["perf_src"] = "nearby_middle"
            elem_matched += 1
        else:
            # Fallback: regional average
            atpt_data = achievement.get(school["atpt"], {})
            if atpt_data:
                school["perf"] = round(sum(atpt_data.values()) / len(atpt_data), 1)
                school["perf_src"] = "region_avg"
            else:
                school["perf"] = DEFAULT_PERF
                school["perf_src"] = "default"

    print(f"    Elementary from nearby middle: {elem_matched}", flush=True)

    # Save to perf_cache for reference
    for school in schools:
        perf_cache[school["code"]] = {
            "perf": school.get("perf", DEFAULT_PERF),
            "perf_src": school.get("perf_src", "default"),
        }

    return matched + elem_matched


# ── Step 4: Output ──

def build_output(schools: List[Dict]) -> List[Dict]:
    """Build final output array, filtering schools without coordinates."""
    output = []
    for s in schools:
        if "lat" not in s or "lng" not in s:
            continue
        output.append({
            "name": s["name"],
            "type": s["type"],
            "code": s["code"],
            "atpt": s["atpt"],
            "lat": s["lat"],
            "lng": s["lng"],
            "perf": s.get("perf", DEFAULT_PERF),
            "perf_src": s.get("perf_src", "default"),
        })
    return output


# ── Main ──

def main() -> int:
    print("=== Generate schools.json ===", flush=True)

    # Step 1: Collect schools from NEIS
    print("\n[1/4] Collecting schools from NEIS API...", flush=True)
    schools = collect_all_schools()
    print(f"  Total: {len(schools)} schools", flush=True)

    if not schools:
        print("ERROR: No schools fetched. Check NEIS API.", flush=True)
        return 1

    # Step 2: Geocode
    print("\n[2/4] Geocoding schools via Kakao API...", flush=True)
    geo_cache = load_json_cache(GEOCODE_CACHE_FILE)
    print(f"  Geocode cache: {len(geo_cache)} entries", flush=True)
    new_geo = geocode_schools(schools, geo_cache)
    save_json_cache(GEOCODE_CACHE_FILE, geo_cache)
    print(f"  Geocoded: +{new_geo} new (cache: {len(geo_cache)} total)", flush=True)

    geocoded = sum(1 for s in schools if "lat" in s)
    print(f"  Schools with coordinates: {geocoded}/{len(schools)}", flush=True)

    # Step 3: Performance data (asil.kr scraping)
    print("\n[3/4] Scraping achievement data from asil.kr...", flush=True)
    perf_cache = load_json_cache(PERF_CACHE_FILE)
    print(f"  Performance cache: {len(perf_cache)} entries", flush=True)
    new_perf = enrich_perf(schools, perf_cache)
    save_json_cache(PERF_CACHE_FILE, perf_cache)
    print(f"  Performance: +{new_perf} new (cache: {len(perf_cache)} total)", flush=True)

    # Stats
    src_counts = {}
    for s in schools:
        src = s.get("perf_src", "default")
        src_counts[src] = src_counts.get(src, 0) + 1
    for src, cnt in sorted(src_counts.items()):
        print(f"    {src}: {cnt}", flush=True)

    # Step 4: Output
    print("\n[4/4] Writing schools.json...", flush=True)
    output = build_output(schools)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=1)
    print(f"  Generated {len(output)} schools → {OUTPUT_FILE}", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())

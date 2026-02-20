#!/usr/bin/env python3
"""Generate schools.json from NEIS + Kakao + 학교알리미 APIs.

Offline script — run once per semester to update school performance data.

Pipeline:
1. NEIS API → 전국 초/중학교 목록 (이름, 코드, 주소, 교육청코드)
2. Kakao API → 주소 → 좌표 (지오코딩)
3. 학교알리미 API → 학업성취도 / 졸업생진로
4. Output: scripts/schools.json
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = SCRIPTS_DIR / "schools.json"
GEOCODE_CACHE_FILE = SCRIPTS_DIR / "school_geocode_cache.json"
PERF_CACHE_FILE = SCRIPTS_DIR / "school_perf_cache.json"

KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "")
SCHOOLINFO_API_KEY = os.getenv("SCHOOLINFO_API_KEY", "")
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
SCHOOLINFO_BASE = "https://www.schoolinfo.go.kr/openApi.do"

DEFAULT_PERF = 50


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


# ── Step 3: 학교알리미 API — 성적 데이터 ──

def fetch_achievement(atpt: str, school_code: str) -> Optional[float]:
    """Fetch 학업성취도 '보통학력이상' 비율 (국/수/영 평균).

    Returns 0~100 or None if data unavailable.
    """
    if not SCHOOLINFO_API_KEY:
        return None
    params = {
        "apiKey": SCHOOLINFO_API_KEY,
        "svcType": "api",
        "svcCode": "SCHOOL",
        "contentType": "json",
        "gubun": "achievement",
        "thisPage": 1,
        "perPage": 100,
        "searchCondition": "ATPT_OFCDC_SC_CODE",
        "searchKeyword": atpt,
        "searchCondition2": "SD_SCHUL_CODE",
        "searchKeyword2": school_code,
    }
    try:
        resp = requests.get(SCHOOLINFO_BASE, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    rows = data.get("list", []) or data.get("data", []) or []
    if not rows:
        # Try alternative response structure
        content = data.get("content", [])
        if content:
            rows = content

    if not rows:
        return None

    # Find most recent year's data
    # Look for 보통학력이상 비율 across 국어/수학/영어
    subject_scores = []
    for row in rows:
        above_normal = None
        # Various field name patterns from 학교알리미
        for key in ("ABOVE_NORMAL_RATE", "aboveNormalRate", "above_normal",
                     "ABOVE_AVG_RT", "보통학력이상비율"):
            if key in row and row[key] is not None:
                try:
                    above_normal = float(row[key])
                    break
                except (ValueError, TypeError):
                    continue
        if above_normal is not None:
            subject_scores.append(above_normal)

    if subject_scores:
        return round(sum(subject_scores) / len(subject_scores), 1)
    return None


def fetch_career_path(atpt: str, school_code: str) -> Optional[float]:
    """Fetch 졸업생진로: 특목고/자사고 진학률 (중학교 only).

    Returns 0~100 score or None.
    """
    if not SCHOOLINFO_API_KEY:
        return None
    params = {
        "apiKey": SCHOOLINFO_API_KEY,
        "svcType": "api",
        "svcCode": "SCHOOL",
        "contentType": "json",
        "gubun": "career",
        "thisPage": 1,
        "perPage": 100,
        "searchCondition": "ATPT_OFCDC_SC_CODE",
        "searchKeyword": atpt,
        "searchCondition2": "SD_SCHUL_CODE",
        "searchKeyword2": school_code,
    }
    try:
        resp = requests.get(SCHOOLINFO_BASE, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    rows = data.get("list", []) or data.get("data", []) or data.get("content", []) or []
    if not rows:
        return None

    total_grads = 0
    special_high = 0
    for row in rows:
        # 졸업생 수
        for key in ("GRADT_CNT", "gradtCnt", "졸업자수", "total"):
            if key in row and row[key] is not None:
                try:
                    total_grads += int(row[key])
                    break
                except (ValueError, TypeError):
                    continue
        # 특목고/자사고 진학자 수
        for key in ("SPCL_PURPOSE_HS_CNT", "spclPurposeHsCnt", "특목고진학자수",
                     "AUTON_PRIV_HS_CNT", "autonPrivHsCnt", "자사고진학자수"):
            if key in row and row[key] is not None:
                try:
                    special_high += int(row[key])
                    break
                except (ValueError, TypeError):
                    continue

    if total_grads > 0:
        rate = special_high / total_grads * 100
        # Scale: min(100, rate × 3) — 33%+ maps to 100
        return round(min(100, rate * 3), 1)
    return None


def fetch_school_perf(school: Dict, perf_cache: Dict) -> Dict:
    """Get performance data for a school. Returns {perf, perf_src}."""
    code = school["code"]

    if code in perf_cache:
        return perf_cache[code]

    atpt = school["atpt"]
    result = {"perf": DEFAULT_PERF, "perf_src": "default"}

    # Priority 1: 학업성취도
    achievement = fetch_achievement(atpt, code)
    time.sleep(API_DELAY)
    if achievement is not None:
        result = {"perf": achievement, "perf_src": "achievement"}
        perf_cache[code] = result
        return result

    # Priority 2: 졸업생진로 (middle school only)
    if school["type"] == "middle":
        career = fetch_career_path(atpt, code)
        time.sleep(API_DELAY)
        if career is not None:
            result = {"perf": career, "perf_src": "career"}
            perf_cache[code] = result
            return result

    # Priority 3: default
    perf_cache[code] = result
    return result


def enrich_perf(schools: List[Dict], perf_cache: Dict) -> int:
    """Enrich schools with performance data. Returns count of new lookups."""
    new_count = 0
    for i, school in enumerate(schools):
        code = school["code"]
        if code in perf_cache:
            perf = perf_cache[code]
        else:
            perf = fetch_school_perf(school, perf_cache)
            new_count += 1

        school["perf"] = perf["perf"]
        school["perf_src"] = perf["perf_src"]

        if (i + 1) % 500 == 0:
            print(f"    Performance: {i + 1}/{len(schools)} (+{new_count} new)", flush=True)

    return new_count


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

    # Step 3: Performance data
    print("\n[3/4] Fetching performance data from 학교알리미...", flush=True)
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

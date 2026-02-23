#!/usr/bin/env python3
"""Fetch apartment household counts (세대수) from K-apt API.

Uses 공동주택 단지 목록제공 서비스 + 공동주택 기본 정보제공 서비스 (data.go.kr).
Requires MOLIT_SERVICE_KEY environment variable.

Output: scripts/household_cache.json  {apt_name_key: {households, dong_count, builder, ...}}
"""
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
CACHE_FILE = SCRIPTS_DIR / "household_cache.json"
VALUATION_DIR = SCRIPTS_DIR.parent / "docs" / "data" / "apt_trade" / "valuation"
SEARCH_DIR = SCRIPTS_DIR.parent / "docs" / "data" / "apt_trade" / "search"

SERVICE_KEY = os.getenv("MOLIT_SERVICE_KEY", "")

# K-apt API endpoints (V3/V4 — JSON responses)
APT_LIST_URL = "https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3"
APT_TOTAL_URL = "https://apis.data.go.kr/1613000/AptListService3/getTotalAptList3"
APT_INFO_URL = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4"

API_DELAY = 0.15  # seconds between calls


def load_cache() -> Dict:
    if CACHE_FILE.exists():
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: Dict) -> None:
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)


def get_target_apartments() -> List[Dict]:
    """Get list of apartments we need household data for.

    Sources: valuation index + search index (for daejang coverage).
    """
    seen = set()
    apts = []

    def add_apt(item):
        key = f"{item.get('sigungu', '')}|{item.get('dong_name', '')}|{item.get('apt_name', '')}"
        if key in seen:
            return
        seen.add(key)
        apts.append({
            "id": item.get("id", ""),
            "apt_name": item.get("apt_name", ""),
            "sigungu": item.get("sigungu", ""),
            "dong_name": item.get("dong_name", ""),
        })

    # 1) Valuation index
    index_path = VALUATION_DIR / "index.json"
    if index_path.exists():
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)
        for sido in index.get("sido_order", []):
            fpath = VALUATION_DIR / f"{sido}.json"
            if not fpath.exists():
                continue
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            for item in data.get("items", []):
                add_apt(item)

    # 2) Search index (covers all daejang candidates)
    if SEARCH_DIR.exists():
        for fpath in sorted(SEARCH_DIR.glob("*.json")):
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            for item in data.get("items", []):
                add_apt(item)

    return apts


def fetch_apt_info(kapt_code: str) -> Optional[Dict]:
    """Fetch apartment basic info including household count."""
    params = {
        "serviceKey": SERVICE_KEY,
        "kaptCode": kapt_code,
    }
    try:
        resp = requests.get(APT_INFO_URL, params=params, timeout=30)
        if resp.status_code != 200:
            return None

        data = resp.json()
        header = data.get("response", {}).get("header", {})
        if header.get("resultCode") != "00":
            return None

        item = data.get("response", {}).get("body", {}).get("item")
        if not item:
            return None

        households = item.get("kaptdaCnt") or item.get("hoCnt") or 0
        return {
            "kaptCode": kapt_code,
            "kaptName": item.get("kaptName", ""),
            "households": int(households),
            "dong_count": int(item.get("kaptDongCnt") or 0),
            "builder": item.get("kaptBcompany") or "",
            "use_date": item.get("kaptUsedate") or "",
            "address": item.get("doroJuso") or item.get("kaptAddr") or "",
        }
    except Exception:
        return None


def normalize_name(name: str) -> str:
    """Normalize apartment name for matching."""
    import re
    name = re.sub(r"\(.*?\)", "", name).strip()
    name = re.sub(r"\s+", "", name)
    name = name.replace("아파트", "")
    return name.lower()


def main() -> int:
    if not SERVICE_KEY:
        print("Error: MOLIT_SERVICE_KEY not set", flush=True)
        return 1

    cache = load_cache()
    cache_before = len(cache)
    print(f"Household cache: {cache_before} entries", flush=True)

    # Get target apartments
    targets = get_target_apartments()
    print(f"Target apartments: {len(targets)}", flush=True)

    # Check which ones are missing from cache (skip estimated ones too)
    missing = []
    for apt in targets:
        cache_key = f"{apt['sigungu']}|{apt['dong_name']}|{apt['apt_name']}"
        cached = cache.get(cache_key)
        if not cached or cached.get("source") == "estimated":
            missing.append(apt)

    if not missing:
        print("All apartments already cached. Done.", flush=True)
        return 0

    print(f"Missing/estimated from cache: {len(missing)}", flush=True)

    # Fetch nationwide apartment list (JSON)
    print("Fetching nationwide apartment list...", flush=True)
    all_kapt = []
    page = 1
    while True:
        params = {
            "serviceKey": SERVICE_KEY,
            "numOfRows": "1000",
            "pageNo": str(page),
        }
        try:
            resp = requests.get(APT_TOTAL_URL, params=params, timeout=30)
            if resp.status_code != 200:
                print(f"  Error status: {resp.status_code} on page {page}", flush=True)
                break

            data = resp.json()
            header = data.get("response", {}).get("header", {})
            if header.get("resultCode") != "00":
                print(f"  API result: {header.get('resultCode')} {header.get('resultMsg')}", flush=True)
                break

            body = data.get("response", {}).get("body", {})
            items = body.get("items", [])
            if not items:
                break

            for item in items:
                all_kapt.append({
                    "code": item.get("kaptCode", ""),
                    "name": item.get("kaptName", ""),
                    "sido": item.get("as1", ""),
                    "sigungu": item.get("as2", ""),
                    "dong": item.get("as4") or item.get("as3", ""),
                })

            total = body.get("totalCount", 0)
            if len(all_kapt) >= total:
                break

            if page % 10 == 0:
                print(f"  Page {page}: {len(all_kapt)}/{total} complexes", flush=True)
            page += 1
            time.sleep(API_DELAY)

        except Exception as e:
            print(f"  Exception on page {page}: {e}", flush=True)
            break

    print(f"Fetched {len(all_kapt)} complexes nationwide", flush=True)

    if not all_kapt:
        print("Failed to fetch apartment list. API may not be registered.", flush=True)
        return 1

    # Build name index for matching
    name_index = {}
    for k in all_kapt:
        norm = normalize_name(k["name"])
        key = f"{k['sigungu']}|{norm}"
        if key not in name_index:
            name_index[key] = k

    # Match and fetch details
    matched = 0
    fetched = 0
    for apt in missing:
        norm = normalize_name(apt["apt_name"])
        # Try matching with sigungu
        sigungu_short = apt["sigungu"].replace("시 ", "").replace("군 ", "").replace("구 ", "")
        key = f"{sigungu_short}|{norm}"

        kapt = name_index.get(key)
        if not kapt:
            # Try fuzzy: just name match
            for k_key, k_val in name_index.items():
                if norm in normalize_name(k_val["name"]) or normalize_name(k_val["name"]) in norm:
                    if sigungu_short in k_key:
                        kapt = k_val
                        break

        if not kapt:
            continue

        matched += 1

        # Fetch detail info
        info = fetch_apt_info(kapt["code"])
        time.sleep(API_DELAY)

        if info and info["households"] > 0:
            cache_key = f"{apt['sigungu']}|{apt['dong_name']}|{apt['apt_name']}"
            cache[cache_key] = {
                "households": info["households"],
                "dong_count": info["dong_count"],
                "builder": info["builder"],
            }
            fetched += 1

            if fetched % 50 == 0:
                print(f"  Fetched {fetched} household counts...", flush=True)
                save_cache(cache)

    save_cache(cache)
    new_entries = len(cache) - cache_before
    print(f"Matched: {matched}, Fetched: {fetched}, New cache entries: {new_entries}", flush=True)
    print(f"Total cache: {len(cache)} entries", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

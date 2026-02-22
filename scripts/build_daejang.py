#!/usr/bin/env python3
"""동별 대장아파트 데이터 생성

각 (sigungu, dong_name)별로 직전 3년 m²당 평균가가 가장 높은 아파트를
대장아파트로 선정한다.
- 국민평형(80~90m²) 우선, 없으면 전체 면적 중 최고
- by_apt/*.json 거래 내역에서 3년 평균 계산

출력: docs/data/apt_trade/daejang.json
"""

import json
import os
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEARCH_DIR = os.path.join(BASE_DIR, "docs", "data", "apt_trade", "search")
BY_APT_DIR = os.path.join(BASE_DIR, "docs", "data", "apt_trade", "by_apt")
GEO_PATH = os.path.join(BASE_DIR, "docs", "data", "apt_trade", "valuation_geo.json")
OUT_PATH = os.path.join(BASE_DIR, "docs", "data", "apt_trade", "daejang.json")

SIDOS = ["서울", "경기", "인천", "부산", "대구", "대전", "광주", "울산", "세종"]
CUTOFF = (datetime.now() - timedelta(days=365 * 3)).strftime("%Y-%m-%d")


def avg_price_per_m2(apt_id, area):
    """직전 3년 거래의 m²당 평균가 계산"""
    path = os.path.join(BY_APT_DIR, f"{apt_id}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        txns = json.load(f)
    recent = [t for t in txns if t[0] >= CUTOFF]
    if not recent:
        return None
    return sum(t[1] / area for t in recent) / len(recent)


def main():
    # valuation_geo.json → households 매핑
    with open(GEO_PATH, encoding="utf-8") as f:
        geo = json.load(f)
    households_map = {}
    for apt_id, info in geo.items():
        hh = info.get("households")
        if hh:
            households_map[apt_id] = hh

    result = {}

    for sido in SIDOS:
        search_path = os.path.join(SEARCH_DIR, f"{sido}.json")
        if not os.path.exists(search_path):
            continue
        with open(search_path, encoding="utf-8") as f:
            data = json.load(f)

        # 동별 국민평형/전체 후보 수집 (apt_id 기준 중복 제거)
        # dong_key → { apt_id: (area, is_kukmin) }
        dong_candidates = {}
        for item in data["items"]:
            area = item["area_m2"]
            if not area or area <= 0 or not item["latest_price"] or item["latest_price"] <= 0:
                continue
            dong_key = item["sigungu"] + "/" + item["dong_name"]
            apt_id = item["id"]
            is_kukmin = 80 <= area <= 90

            if dong_key not in dong_candidates:
                dong_candidates[dong_key] = {}
            # 같은 apt_id가 여러 면적으로 나올 수 있음 → 국민평형 우선
            prev = dong_candidates[dong_key].get(apt_id)
            if prev is None or (is_kukmin and not prev[1]) or (is_kukmin == prev[1] and area > prev[0]):
                dong_candidates[dong_key][apt_id] = (area, is_kukmin)

        print(f"{sido}: {len(dong_candidates)}개 동, 후보 계산 중...")

        sido_dict = {}
        for dong_key, candidates in sorted(dong_candidates.items()):
            # 국민평형 후보가 있으면 국민평형만, 없으면 전체
            kukmin_cands = {aid: (a, k) for aid, (a, k) in candidates.items() if k}
            pool = kukmin_cands if kukmin_cands else candidates

            best_score = -1
            best_entry = None
            for apt_id, (area, _) in pool.items():
                score = avg_price_per_m2(apt_id, area)
                if score is not None and score > best_score:
                    best_score = score
                    hh = households_map.get(apt_id, 0)
                    best_entry = [apt_id, None, area, hh]
                    # apt_name은 search에서 찾기
                    for item in data["items"]:
                        if item["id"] == apt_id:
                            best_entry[1] = item["apt_name"]
                            break

            if best_entry and best_entry[1]:
                sido_dict[dong_key] = best_entry

        if sido_dict:
            result[sido] = sido_dict

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

    # 통계 출력
    total = sum(len(v) for v in result.values())
    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"\ndaejang.json 생성 완료: {total}개 동, {size_kb:.1f}KB")
    for sido, dongs in result.items():
        print(f"  {sido}: {len(dongs)}개 동")


if __name__ == "__main__":
    main()

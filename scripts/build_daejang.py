#!/usr/bin/env python3
"""동별 대장아파트 데이터 생성

각 (sigungu, dong_name)별로 m²당 가격(평당가)이 가장 높은 아파트를
대장아파트로 선정한다.
- 국민평형(80~90m²) 거래 우선, 없으면 전체 면적 중 최고
- 세대수 필터 없음 (평당가 순수 1위)

출력: docs/data/apt_trade/daejang.json
"""

import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEARCH_DIR = os.path.join(BASE_DIR, "docs", "data", "apt_trade", "search")
GEO_PATH = os.path.join(BASE_DIR, "docs", "data", "apt_trade", "valuation_geo.json")
OUT_PATH = os.path.join(BASE_DIR, "docs", "data", "apt_trade", "daejang.json")

SIDOS = ["서울", "경기", "인천", "부산", "대구", "대전", "광주", "울산", "세종"]


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

        # dong별 후보 수집: 국민평형 우선, fallback 전체
        # key: "sigungu/dong_name"
        kukmin = {}   # 국민평형 (59~90m²) 최고
        fallback = {} # 전체 면적 최고

        for item in data["items"]:
            area = item["area_m2"]
            price = item["latest_price"]
            if not area or area <= 0 or not price or price <= 0:
                continue

            price_per_m2 = price / area
            dong_key = item["sigungu"] + "/" + item["dong_name"]
            apt_id = item["id"]
            hh = households_map.get(apt_id, 0)
            entry = (price_per_m2, apt_id, item["apt_name"], area, hh)

            # 국민평형 범위 (34평, 80~90m²)
            if 80 <= area <= 90:
                if dong_key not in kukmin or price_per_m2 > kukmin[dong_key][0]:
                    kukmin[dong_key] = entry

            # 전체 면적 fallback
            if dong_key not in fallback or price_per_m2 > fallback[dong_key][0]:
                fallback[dong_key] = entry

        # 국민평형 우선, 없으면 fallback
        best = {}
        all_dongs = set(list(kukmin.keys()) + list(fallback.keys()))
        for dong_key in all_dongs:
            best[dong_key] = kukmin.get(dong_key) or fallback[dong_key]

        if best:
            sido_dict = {}
            for dong_key, (_, apt_id, apt_name, area, hh) in sorted(best.items()):
                sido_dict[dong_key] = [apt_id, apt_name, area, hh]
            result[sido] = sido_dict

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

    # 통계 출력
    total = sum(len(v) for v in result.values())
    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"daejang.json 생성 완료: {total}개 동, {size_kb:.1f}KB")
    for sido, dongs in result.items():
        print(f"  {sido}: {len(dongs)}개 동")


if __name__ == "__main__":
    main()

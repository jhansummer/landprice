#!/usr/bin/env python3
"""동별 대장아파트 데이터 생성

각 (sigungu, dong_name)별로 households × (latest_price / area_m2) 점수가
가장 높은 아파트를 대장아파트로 선정한다.

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

        # dong별 최고 점수 아파트 선정
        # key: "sigungu/dong_name" → (score, apt_id, apt_name, area_m2, households)
        best = {}

        for item in data["items"]:
            apt_id = item["id"]
            hh = households_map.get(apt_id)
            if not hh:
                continue
            area = item["area_m2"]
            price = item["latest_price"]
            if not area or area <= 0 or not price or price <= 0:
                continue

            price_per_m2 = price / area
            score = hh * price_per_m2

            dong_key = item["sigungu"] + "/" + item["dong_name"]

            if dong_key not in best or score > best[dong_key][0]:
                best[dong_key] = (score, apt_id, item["apt_name"], area, hh)

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

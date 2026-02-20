#!/usr/bin/env python3
"""Build location-value ranking: apartments with high location scores but low prices.

Reads valuation_geo.json + valuation/{sido}.json, computes location scores,
and outputs a ranking of location-undervalued apartments.
"""
import json
import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data" / "apt_trade"
GEO_PATH = DATA_DIR / "valuation_geo.json"
LOC_SCORES_PATH = DATA_DIR / "location_scores.json"
VALUATION_DIR = DATA_DIR / "valuation"
OUT_PATH = DATA_DIR / "location_value.json"


def calc_subway_score(dist_km):
    dist_m = dist_km * 1000
    return max(5, round(100 - dist_m / 30))


def calc_biz_dist_score(dist_km):
    """업무지구 거리 → 점수. 가까울수록 높음. 3km=100, 50km=0."""
    return max(0, min(100, round(100 - (dist_km - 3) * 100 / 47)))


def build_transport_minmax(loc_scores):
    mn, mx = float("inf"), float("-inf")
    for gus in loc_scores.values():
        for data in gus.values():
            t = data["transport"]
            score = t["gangnam"] * 0.5 + t["gwanghwamun"] * 0.25 + t["yeouido"] * 0.25
            mn = min(mn, score)
            mx = max(mx, score)
    return mn, mx


def calc_location_score(item, geo, gu_lookup, transport_min, transport_max):
    """Calculate location score matching valuation.js calcValueScore (3:1:1 weights)."""
    sigungu = item.get("sigungu", "")
    dong_name = item.get("dong_name", "")

    gu_info = gu_lookup.get(sigungu)
    gu_data = gu_info[1] if gu_info else None
    sido_name = gu_info[0] if gu_info else None
    is_seoul = sido_name == "서울"

    subway_score = None
    if geo and geo.get("subway_dist") is not None:
        subway_score = calc_subway_score(geo["subway_dist"])

    infra_score = geo.get("infra_score") if geo else None

    school_score = None
    if geo and geo.get("academy_score") is not None:
        school_score = geo["academy_score"]
    elif is_seoul and gu_data:
        school_score = gu_data["school_base"]
        school_dong = gu_data.get("school_dong", {})
        if dong_name in school_dong:
            school_score = school_dong[dong_name]

    if is_seoul and gu_data:
        t = gu_data["transport"]
        biz_raw = t["gangnam"] * 0.5 + t["gwanghwamun"] * 0.25 + t["yeouido"] * 0.25
        biz_score = biz_raw
        if transport_max > transport_min:
            biz_score = ((biz_raw - transport_min) / (transport_max - transport_min)) * 100

        transport_score = biz_score
        if subway_score is not None:
            transport_score = subway_score * 0.5 + biz_score * 0.5

        w_sum = transport_score * 3
        w_total = 3
        if school_score is not None:
            w_sum += school_score
            w_total += 1
        if infra_score is not None:
            w_sum += infra_score
            w_total += 1
        total = w_sum / w_total

        return {
            "transport": round(transport_score),
            "school": round(school_score) if school_score is not None else None,
            "infra": infra_score,
            "total": round(total),
        }

    # 비서울 수도권: geo에서 업무지구 거리가 있으면 반영
    biz_score_from_geo = None
    if geo and geo.get("biz_gangnam") is not None:
        # 3대 업무지구 중 가장 가까운 곳 기준 가점 (max)
        scores = [
            calc_biz_dist_score(geo["biz_gangnam"]),
            calc_biz_dist_score(geo.get("biz_gwanghwamun", 99)),
            calc_biz_dist_score(geo.get("biz_yeouido", 99)),
        ]
        biz_score_from_geo = max(scores)

    if subway_score is not None:
        transport_score = subway_score
        if biz_score_from_geo is not None:
            # 역세권 50% + 업무지구 접근성 50%
            transport_score = subway_score * 0.5 + biz_score_from_geo * 0.5
        w_sum = transport_score * 3
        w_total = 3
        if school_score is not None:
            w_sum += school_score
            w_total += 1
        if infra_score is not None:
            w_sum += infra_score
            w_total += 1
        total = w_sum / w_total
        return {
            "transport": round(transport_score),
            "school": round(school_score) if school_score is not None else None,
            "infra": infra_score,
            "total": round(total),
        }

    if gu_data:
        t = gu_data["transport"]
        biz_raw = t["gangnam"] * 0.5 + t["gwanghwamun"] * 0.25 + t["yeouido"] * 0.25
        biz_score = biz_raw
        if transport_max > transport_min:
            biz_score = ((biz_raw - transport_min) / (transport_max - transport_min)) * 100
        school_score2 = gu_data["school_base"]
        if dong_name in gu_data.get("school_dong", {}):
            school_score2 = gu_data["school_dong"][dong_name]
        total = (biz_score * 3 + school_score2) / 4
        return {
            "transport": round(biz_score),
            "school": round(school_score2),
            "infra": None,
            "total": round(total),
        }

    return None


def main():
    if not GEO_PATH.exists():
        print("valuation_geo.json not found, skipping location value ranking")
        return

    geo_data = json.loads(GEO_PATH.read_text(encoding="utf-8"))
    loc_scores = {}
    if LOC_SCORES_PATH.exists():
        loc_scores = json.loads(LOC_SCORES_PATH.read_text(encoding="utf-8"))

    transport_min, transport_max = build_transport_minmax(loc_scores)

    gu_lookup = {}
    for sido, gus in loc_scores.items():
        for gu, data in gus.items():
            gu_lookup[gu] = (sido, data)

    val_index_path = VALUATION_DIR / "index.json"
    if not val_index_path.exists():
        print("valuation/index.json not found")
        return
    val_index = json.loads(val_index_path.read_text(encoding="utf-8"))
    sido_order = val_index.get("sido_order", [])

    # Collect all apartments with scores
    all_apts = []
    for sido in sido_order:
        fpath = VALUATION_DIR / f"{sido}.json"
        if not fpath.exists():
            continue
        data = json.loads(fpath.read_text(encoding="utf-8"))
        for item in data.get("items", []):
            apt_id = item["id"]
            geo = geo_data.get(apt_id)
            scores = calc_location_score(item, geo, gu_lookup, transport_min, transport_max)
            if scores is None:
                continue
            all_apts.append({
                "id": apt_id,
                "apt_name": item["apt_name"],
                "sigungu": item["sigungu"],
                "dong_name": item.get("dong_name", ""),
                "area_m2": item["area_m2"],
                "price": item["current_price"],
                "gap_pct": item.get("gap_pct"),
                "status": item.get("status", ""),
                "sido": sido,
                "loc": scores,
            })

    print(f"총 {len(all_apts)}개 아파트 입지점수 계산 완료")

    # Calculate price percentile within sido
    sido_prices = {}
    for a in all_apts:
        sido_prices.setdefault(a["sido"], []).append(a["price"])
    for sido in sido_prices:
        sido_prices[sido].sort()

    def price_percentile(sido, price):
        ps = sido_prices.get(sido, [])
        if not ps:
            return 50
        rank = sum(1 for p in ps if p <= price)
        return rank / len(ps) * 100

    # Find location-undervalued: location score >= 60, price in bottom 40%
    results = {}
    for sido in sido_order:
        sido_apts = [a for a in all_apts if a["sido"] == sido]
        candidates = []
        for a in sido_apts:
            if a["loc"]["total"] >= 60:
                pct = price_percentile(a["sido"], a["price"])
                if pct <= 40:
                    location_gap = round(a["loc"]["total"] - pct, 1)
                    candidates.append({
                        "id": a["id"],
                        "apt_name": a["apt_name"],
                        "sigungu": a["sigungu"],
                        "dong_name": a["dong_name"],
                        "area_m2": a["area_m2"],
                        "price": a["price"],
                        "gap_pct": a["gap_pct"],
                        "status": a["status"],
                        "loc_score": a["loc"]["total"],
                        "loc_transport": a["loc"]["transport"],
                        "loc_school": a["loc"]["school"],
                        "loc_infra": a["loc"]["infra"],
                        "price_pct": round(pct, 1),
                        "location_gap": location_gap,
                    })

        candidates.sort(key=lambda x: -x["location_gap"])
        results[sido] = candidates[:20]
        if candidates:
            print(f"  {sido}: {len(candidates)}개 → 상위 {min(20, len(candidates))}개 저장")

    output = {
        "updated_at": val_index.get("updated_at"),
        "sidos": results,
    }
    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    total = sum(len(v) for v in results.values())
    print(f"결과: {OUT_PATH} ({total}개)")


if __name__ == "__main__":
    main()

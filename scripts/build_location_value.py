#!/usr/bin/env python3
"""Build location-value ranking: apartments with high location scores but low prices.

Reads valuation_geo.json + valuation/{sido}.json, uses backend-computed loc_score,
and outputs a ranking of location-undervalued apartments.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data" / "apt_trade"
GEO_PATH = DATA_DIR / "valuation_geo.json"
VALUATION_DIR = DATA_DIR / "valuation"
OUT_PATH = DATA_DIR / "location_value.json"


def main():
    if not GEO_PATH.exists():
        print("valuation_geo.json not found, skipping location value ranking")
        return

    geo_data = json.loads(GEO_PATH.read_text(encoding="utf-8"))

    val_index_path = VALUATION_DIR / "index.json"
    if not val_index_path.exists():
        print("valuation/index.json not found")
        return
    val_index = json.loads(val_index_path.read_text(encoding="utf-8"))
    sido_order = val_index.get("sido_order", [])

    # Collect all apartments with geo loc_score
    all_apts = []
    for sido in sido_order:
        fpath = VALUATION_DIR / f"{sido}.json"
        if not fpath.exists():
            continue
        data = json.loads(fpath.read_text(encoding="utf-8"))
        for item in data.get("items", []):
            apt_id = item["id"]
            geo = geo_data.get(apt_id)
            if not geo or geo.get("loc_score") is None:
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
                "loc_score": geo["loc_score"],
                "geo": geo,
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
            if a["loc_score"] >= 60:
                pct = price_percentile(a["sido"], a["price"])
                if pct <= 40:
                    location_gap = round(a["loc_score"] - pct, 1)
                    geo = a["geo"]
                    candidates.append({
                        "id": a["id"],
                        "apt_name": a["apt_name"],
                        "sigungu": a["sigungu"],
                        "dong_name": a["dong_name"],
                        "area_m2": a["area_m2"],
                        "price": a["price"],
                        "gap_pct": a["gap_pct"],
                        "status": a["status"],
                        "loc_score": a["loc_score"],
                        "loc_transport": None,  # display-only, not used in ranking
                        "loc_school": geo.get("academy_score"),
                        "loc_livability": geo.get("livability_score"),
                        "loc_infra": geo.get("infra_score"),
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

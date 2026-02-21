"""신고가 전용 경량 JSON 생성.

summary.json에서 역대 최고가를 돌파한 아파트(vs_all_time_peak > 0)만 추출하여
newhigh_summary.json으로 출력한다.

price(3개월 평균)와 별도로, by_apt 데이터에서 최신 월 평균가(latest_price)를
계산하여 추가한다. 신고가 카드에서는 latest_price를 현재가로 표시.
"""

import hashlib
import json
import os

SUMMARY_PATH = os.path.join(
    os.path.dirname(__file__), "..", "docs", "data", "apt_trade", "summary.json"
)
OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "docs", "data", "apt_trade", "newhigh_summary.json"
)
BY_APT_DIR = os.path.join(
    os.path.dirname(__file__), "..", "docs", "data", "apt_trade", "by_apt"
)

APT_FIELDS = ("id", "apt_name", "area_m2", "price", "all_time_peak", "vs_all_time_peak", "chg6m", "status", "last_deal_date")


def _latest_month_price(apt_id, area_m2):
    """by_apt/{id}.json에서 최신 월 평균 단가(만원/m²)와 고점 단가를 계산.

    Returns: (latest_price_per_m2, peak_price_per_m2) or (None, None)
    """
    path = os.path.join(BY_APT_DIR, f"{apt_id}.json")
    if not os.path.exists(path) or area_m2 <= 0:
        return None, None
    try:
        with open(path) as f:
            txns = json.load(f)
    except Exception:
        return None, None
    if not txns:
        return None, None

    txns.sort(key=lambda x: x[0])

    # 월별 평균 총매매가
    monthly = {}
    for t in txns:
        ym = t[0][:4] + t[0][5:7]
        monthly.setdefault(ym, []).append(t[1])

    yms = sorted(monthly.keys())
    if not yms:
        return None, None

    # 최신 월 평균 → 만원/m²
    last_ym = yms[-1]
    latest_avg = sum(monthly[last_ym]) / len(monthly[last_ym])
    latest_per_m2 = round(latest_avg / area_m2, 1)

    # 역대 월별 최고 → 만원/m² (최근 3개월 제외)
    historical_yms = yms[:-3] if len(yms) > 3 else yms[:-1]
    peak_per_m2 = 0
    for ym in historical_yms:
        avg = sum(monthly[ym]) / len(monthly[ym])
        pm2 = avg / area_m2
        if pm2 > peak_per_m2:
            peak_per_m2 = pm2
    peak_per_m2 = round(peak_per_m2, 1) if peak_per_m2 > 0 else None

    return latest_per_m2, peak_per_m2


def build():
    with open(SUMMARY_PATH, encoding="utf-8") as f:
        data = json.load(f)

    out = {"sido_order": data.get("sido_order", []), "sidos": {}}

    total = 0
    enriched = 0
    for sido_name in out["sido_order"]:
        sido = data.get("sidos", {}).get(sido_name)
        if not sido:
            continue

        sido_out = {"district_order": sido.get("district_order", []), "districts": {}}

        for dist_name in sido_out["district_order"]:
            dist = sido.get("districts", {}).get(dist_name)
            if not dist:
                continue

            dr = dist.get("dong_recovery")
            if not dr or not isinstance(dr, dict):
                continue

            dong_items = []
            for item in dr.get("items", []):
                apts = item.get("apt_details", [])
                newhigh_apts = []
                for apt in apts:
                    if apt.get("vs_all_time_peak", 0) > 0:
                        apt_id = hashlib.md5(
                            f"{dist_name}\t{apt['apt_name']}\t{apt['area_m2']}".encode()
                        ).hexdigest()[:10]
                        entry = {"id": apt_id}
                        entry.update({k: apt[k] for k in APT_FIELDS if k in apt and k != "id"})

                        # by_apt에서 최신 월 가격 보강
                        latest, peak = _latest_month_price(apt_id, apt.get("area_m2", 0))
                        if latest is not None:
                            entry["latest_price"] = latest
                            # 고점 대비 %도 최신가 기준으로 재계산
                            atp = peak if peak and peak > 0 else entry.get("all_time_peak", 0)
                            if atp > 0:
                                entry["latest_vs_atp"] = round(
                                    (latest - atp) / atp * 100, 1
                                )
                            enriched += 1

                        newhigh_apts.append(entry)

                if newhigh_apts:
                    dong_items.append({"name": item["name"], "apt_details": newhigh_apts})
                    total += len(newhigh_apts)

            if dong_items:
                dong_order = dist.get("dong_order", [])
                dong_names = {d["name"] for d in dong_items}
                filtered_dong_order = [d for d in dong_order if d in dong_names]
                sido_out["districts"][dist_name] = {
                    "dong_order": filtered_dong_order,
                    "dong_recovery": {"items": dong_items},
                }

        if sido_out["districts"]:
            sido_out["district_order"] = [
                d for d in sido_out["district_order"] if d in sido_out["districts"]
            ]
            out["sidos"][sido_name] = sido_out

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"newhigh_summary.json: {total}개 신고가 단지 ({enriched}개 최신가 보강), {size_kb:.0f}KB")


if __name__ == "__main__":
    build()

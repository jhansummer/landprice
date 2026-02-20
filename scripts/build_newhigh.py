"""신고가 전용 경량 JSON 생성.

summary.json에서 역대 최고가를 돌파한 아파트(vs_all_time_peak > 0)만 추출하여
newhigh_summary.json으로 출력한다.
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

APT_FIELDS = ("id", "apt_name", "area_m2", "price", "all_time_peak", "vs_all_time_peak", "chg6m", "status", "last_deal_date")


def build():
    with open(SUMMARY_PATH, encoding="utf-8") as f:
        data = json.load(f)

    out = {"sido_order": data.get("sido_order", []), "sidos": {}}

    total = 0
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
            # district_order도 데이터 있는 것만
            sido_out["district_order"] = [
                d for d in sido_out["district_order"] if d in sido_out["districts"]
            ]
            out["sidos"][sido_name] = sido_out

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"newhigh_summary.json: {total}개 신고가 단지, {size_kb:.0f}KB")


if __name__ == "__main__":
    build()

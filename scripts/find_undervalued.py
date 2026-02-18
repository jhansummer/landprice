#!/usr/bin/env python3
import json
import math
import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data" / "apt_trade"
BY_APT_DIR = DATA_DIR / "by_apt"
SUMMARY_PATH = DATA_DIR / "summary.json"
SEARCH_INDEX_PATH = DATA_DIR / "search_index.json"
SEARCH_DIR = DATA_DIR / "search"
OUT_PATH = DATA_DIR / "undervalued.json"
VALUATION_DIR = DATA_DIR / "valuation"


def month_add(yyyymm: str, delta: int) -> str:
    dt = datetime.strptime(yyyymm, "%Y%m")
    y = dt.year + (dt.month - 1 + delta) // 12
    m = (dt.month - 1 + delta) % 12 + 1
    return f"{y:04d}{m:02d}"


def month_range(end_yyyymm: str, months: int) -> List[str]:
    return [month_add(end_yyyymm, -i) for i in reversed(range(months))]


def parse_month(date_str: str) -> str:
    return date_str[:7].replace("-", "")


def pearson_corr(a: List[float], b: List[float]) -> Optional[float]:
    if len(a) != len(b) or len(a) == 0:
        return None
    mean_a = sum(a) / len(a)
    mean_b = sum(b) / len(b)
    da = [x - mean_a for x in a]
    db = [x - mean_b for x in b]
    var_a = sum(x * x for x in da)
    var_b = sum(x * x for x in db)
    if var_a <= 0 or var_b <= 0:
        return None
    cov = sum(x * y for x, y in zip(da, db))
    return cov / math.sqrt(var_a * var_b)


def series_corr(sa: List[Optional[float]], sb: List[Optional[float]], min_valid: int) -> Optional[float]:
    paired = [(a, b) for a, b in zip(sa, sb) if a is not None and b is not None]
    if len(paired) < min_valid:
        return None
    aa = [p[0] for p in paired]
    bb = [p[1] for p in paired]
    return pearson_corr(aa, bb)


def mean_abs_pct_diff(sa: List[Optional[float]], sb: List[Optional[float]]) -> Optional[float]:
    paired = [(a, b) for a, b in zip(sa, sb) if a is not None and b is not None and b != 0]
    if not paired:
        return None
    diffs = [abs(a - b) / b for a, b in paired]
    return sum(diffs) / len(diffs)


def mean_recent_gap(sa: List[Optional[float]], sb: List[Optional[float]], recent_months: int = 6) -> Optional[float]:
    ra = sa[-recent_months:]
    rb = sb[-recent_months:]
    paired = [(a, b) for a, b in zip(ra, rb) if a is not None and b is not None and b != 0]
    if len(paired) < 3:
        return None
    ma = sum(p[0] for p in paired) / len(paired)
    mb = sum(p[1] for p in paired) / len(paired)
    if mb == 0:
        return None
    return abs(ma - mb) / mb


def recent_avg(series: List[Optional[float]], months: int = 6) -> Optional[float]:
    tail = series[-months:]
    vals = [v for v in tail if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def series_avg(series: List[Optional[float]]) -> Optional[float]:
    vals = [v for v in series if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def level_similar(a: Optional[float], b: Optional[float], max_ratio: float = 1.30) -> bool:
    if a is None or b is None or a <= 0 or b <= 0:
        return False
    ratio = max(a, b) / min(a, b)
    return ratio <= max_ratio


def forward_fill(values: List[Optional[float]]) -> List[Optional[float]]:
    out: List[Optional[float]] = []
    last: Optional[float] = None
    for v in values:
        if v is None:
            out.append(last)
        else:
            last = v
            out.append(v)
    return out


def build_series(txns: List[List], months: List[str]) -> Tuple[List[Optional[float]], int]:
    # txns: [[date, price], ...]
    month_values: Dict[str, List[float]] = {}
    for d, p in txns:
        m = parse_month(d)
        if m in months:
            month_values.setdefault(m, []).append(float(p))
    monthly_avg: Dict[str, float] = {m: sum(v) / len(v) for m, v in month_values.items()}
    series: List[Optional[float]] = [monthly_avg.get(m) for m in months]
    series = forward_fill(series)
    valid = sum(1 for v in series if v is not None)
    return series, valid


def load_txns(apt_id: str) -> List[List]:
    p = BY_APT_DIR / f"{apt_id}.json"
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))


# 인접 구/시 매핑 — 같은 구 + 인접 지역까지 비교 대상 확장
ADJACENT: Dict[str, List[str]] = {
    # ── 서울 ──
    "강남구": ["서초구", "송파구", "강동구"],
    "서초구": ["강남구", "동작구", "관악구"],
    "송파구": ["강남구", "강동구", "광진구"],
    "강동구": ["송파구", "강남구", "광진구"],
    "용산구": ["서초구", "마포구", "중구", "성동구"],
    "성동구": ["광진구", "용산구", "동대문구", "중구"],
    "광진구": ["성동구", "송파구", "강동구", "중랑구"],
    "마포구": ["서대문구", "용산구", "은평구"],
    "서대문구": ["마포구", "은평구", "종로구", "중구"],
    "은평구": ["마포구", "서대문구", "종로구"],
    "종로구": ["중구", "서대문구", "은평구", "성북구"],
    "중구": ["종로구", "용산구", "성동구", "동대문구"],
    "동대문구": ["중랑구", "성동구", "성북구", "중구"],
    "중랑구": ["노원구", "동대문구", "광진구", "성북구"],
    "성북구": ["강북구", "종로구", "동대문구", "중랑구", "노원구"],
    "강북구": ["도봉구", "노원구", "성북구"],
    "도봉구": ["강북구", "노원구"],
    "노원구": ["도봉구", "강북구", "중랑구"],
    "영등포구": ["동작구", "양천구", "구로구", "마포구"],
    "동작구": ["서초구", "관악구", "영등포구"],
    "관악구": ["서초구", "동작구", "금천구", "구로구"],
    "구로구": ["영등포구", "금천구", "관악구", "양천구"],
    "금천구": ["관악구", "구로구"],
    "양천구": ["강서구", "영등포구", "구로구"],
    "강서구": ["양천구", "영등포구"],
    # ── 경기 ──
    "성남시": ["과천시", "광주시", "하남시", "용인시"],
    "과천시": ["성남시", "안양시", "의왕시"],
    "광명시": ["구로구", "안양시", "시흥시"],
    "하남시": ["성남시", "광주시", "남양주시"],
    "구리시": ["남양주시", "의정부시"],
    "안양시": ["과천시", "군포시", "의왕시", "광명시"],
    "군포시": ["안양시", "의왕시", "수원시"],
    "의왕시": ["안양시", "군포시", "과천시", "수원시"],
    "수원시": ["용인시", "화성시", "오산시", "군포시", "의왕시"],
    "용인시": ["수원시", "성남시", "광주시", "화성시"],
    "화성시": ["수원시", "오산시", "용인시"],
    "오산시": ["수원시", "화성시", "평택시"],
    "고양시": ["파주시", "김포시", "양주시"],
    "김포시": ["고양시", "파주시"],
    "파주시": ["고양시", "김포시"],
    "남양주시": ["구리시", "하남시", "양주시", "의정부시"],
    "의정부시": ["남양주시", "양주시", "구리시", "포천시"],
    "양주시": ["의정부시", "고양시", "남양주시", "포천시"],
    "부천시": ["광명시", "시흥시"],
    "시흥시": ["광명시", "안산시", "부천시"],
    "안산시": ["시흥시", "화성시"],
    "광주시": ["성남시", "하남시", "용인시", "이천시", "여주시"],
    "이천시": ["광주시", "여주시"],
    "여주시": ["이천시", "광주시"],
    "평택시": ["오산시", "안성시"],
    "안성시": ["평택시"],
    "동두천시": ["양주시", "포천시"],
    "포천시": ["의정부시", "양주시", "동두천시"],
    "양평군": ["광주시", "여주시"],
    # ── 부산 ──
    "해운대구": ["수영구", "기장군", "동래구"],
    "수영구": ["해운대구", "남구", "동래구"],
    "동래구": ["수영구", "해운대구", "부산진구", "연제구"],
    "남구": ["수영구", "동래구", "연제구"],
    "연제구": ["동래구", "남구", "부산진구"],
    "부산진구": ["동래구", "연제구", "중구"],
    # ── 대구 ──
    "수성구": ["달서구", "중구", "남구"],
    "달서구": ["수성구", "남구", "서구"],
    # ── 인천 ──
    "연수구": ["남동구", "미추홀구"],
    "남동구": ["연수구", "미추홀구", "부평구"],
    "부평구": ["남동구", "계양구", "서구"],
    "계양구": ["부평구", "서구"],
    "서구": ["부평구", "계양구"],
    "미추홀구": ["연수구", "남동구"],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corr", type=float, default=0.93, help="Pearson correlation threshold")
    ap.add_argument("--months", type=int, default=36, help="Months window")
    ap.add_argument("--min-trades", type=int, default=15, help="Min trades in window")
    ap.add_argument("--min-valid", type=int, default=30, help="Min non-empty months after fill")
    ap.add_argument("--gap", type=float, default=0.20, help="Undervalued gap (20% => 0.20)")
    args = ap.parse_args()

    summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    search_meta = json.loads(SEARCH_INDEX_PATH.read_text(encoding="utf-8"))

    # 분할된 search 파일 또는 기존 통합 구조 모두 지원
    if "sidos" in search_meta:
        search_sidos = search_meta["sidos"]
    else:
        search_sidos = {}
        sido_order = search_meta.get("sido_order", [])
        for sido_name in sido_order:
            sido_file = SEARCH_DIR / f"{sido_name}.json"
            if sido_file.exists():
                search_sidos[sido_name] = json.loads(sido_file.read_text(encoding="utf-8"))

    current_month = summary.get("current_month")
    if not current_month:
        raise SystemExit("current_month not found in summary.json")

    months = month_range(current_month, args.months)

    bands = [
        ("5억 미만", 0, 50000),
        ("5~8억", 50000, 80000),
        ("8~12억", 80000, 120000),
        ("12~15억", 120000, 150000),
        ("15~20억", 150000, 200000),
        ("20~25억", 200000, 250000),
        ("25~30억", 250000, 300000),
        ("30~40억", 300000, 400000),
        ("40~50억", 400000, 500000),
        ("50억 이상", 500000, None),
    ]

    # Region-specific parameters: relaxed for non-Seoul/Gyeonggi regions
    RELAXED_SIDOS = {"부산", "대구", "인천", "광주", "대전", "울산", "세종"}

    def sido_params(sido: str):
        if sido in RELAXED_SIDOS:
            return {
                "corr": min(args.corr, 0.90),
                "min_trades": min(args.min_trades, 8),
                "min_valid": min(args.min_valid, 18),
                "min_cluster": 2,
            }
        return {
            "corr": args.corr,
            "min_trades": args.min_trades,
            "min_valid": args.min_valid,
            "min_cluster": 2,
        }

    output = {
        "updated_at": summary.get("updated_at"),
        "current_month": current_month,
        "params": {
            "months": args.months,
            "min_trades": args.min_trades,
            "min_valid_months": args.min_valid,
            "corr_threshold": args.corr,
            "undervalued_gap": args.gap,
            "region_level": "district+adjacent",
            "bands": [b[0] for b in bands],
            "relaxed_sidos": sorted(RELAXED_SIDOS),
        },
        "sidos": {},
    }

    def recent_gap_score(u):
        """Lower = more recently undervalued. (6m ratio) - (3y ratio)."""
        r6 = u["recent_avg"] / u["compare_avg_recent"] - 1
        if u.get("avg_36") and u.get("compare_avg_36") and u["compare_avg_36"] > 0:
            r36 = u["avg_36"] / u["compare_avg_36"] - 1
            return r6 - r36
        return r6

    def find_undervalued_in_group(item_list, sp, gap):
        """Run undervalued detection on a list of items (same district)."""
        series_map: Dict[str, Dict] = {}
        months_set = set(months)

        for item in item_list:
            apt_id = item["id"]
            txns = load_txns(apt_id)
            if not txns:
                continue
            trades_window = [t for t in txns if parse_month(t[0]) in months_set]
            if len(trades_window) < sp["min_trades"]:
                continue
            recent_3m_set = set(months[-3:])
            recent_3m_trades = sum(1 for t in trades_window if parse_month(t[0]) in recent_3m_set)
            series, valid = build_series(txns, months)
            if valid < sp["min_valid"]:
                continue
            current_price = series[-1]
            if current_price is None:
                continue
            key = f"{item['apt_name']}\t{item['area_m2']}"
            series_map[key] = {
                "id": apt_id,
                "apt_name": item["apt_name"],
                "sigungu": item.get("sigungu", ""),
                "dong_name": item.get("dong_name", ""),
                "area_m2": item.get("area_m2"),
                "district": item.get("district", ""),
                "series": series,
                "current_price": current_price,
                "recent_avg": recent_avg(series, 6),
                "avg_36": series_avg(series),
                "trade_count": len(trades_window),
                "recent_3m_trades": recent_3m_trades,
            }

        keys = list(series_map.keys())
        n = len(keys)
        if n == 0:
            return [], [], [], []

        adj: Dict[int, List[int]] = {i: [] for i in range(n)}
        for i in range(n):
            si = series_map[keys[i]]["series"]
            area_i = series_map[keys[i]].get("area_m2") or 0
            for j in range(i + 1, n):
                # 면적 30% 이내만 비교
                area_j = series_map[keys[j]].get("area_m2") or 0
                if area_i > 0 and area_j > 0:
                    area_ratio = max(area_i, area_j) / min(area_i, area_j)
                    if area_ratio > 1.30:
                        continue
                sj = series_map[keys[j]]["series"]
                paired: List[Tuple[float, float]] = [(a, b) for a, b in zip(si, sj) if a is not None and b is not None]
                if len(paired) < sp["min_valid"]:
                    continue
                ai = [p[0] for p in paired]
                bj = [p[1] for p in paired]
                corr = pearson_corr(ai, bj)
                if corr is not None and corr >= sp["corr"]:
                    adj[i].append(j)
                    adj[j].append(i)

        visited = [False] * n
        clusters = []
        undervalued = []
        band_candidates = []
        all_valued = []

        for i in range(n):
            if visited[i]:
                continue
            stack = [i]
            comp = []
            visited[i] = True
            while stack:
                cur = stack.pop()
                comp.append(cur)
                for nb in adj[cur]:
                    if not visited[nb]:
                        visited[nb] = True
                        stack.append(nb)

            if len(comp) < sp["min_cluster"]:
                continue

            members = [series_map[keys[idx]] for idx in comp]
            avg_current = sum(m["current_price"] for m in members) / len(members)

            cluster = {
                "size": len(members),
                "avg_current_price": round(avg_current, 2),
                "members": [
                    {
                        "id": m["id"],
                        "apt_name": m["apt_name"],
                        "sigungu": m["sigungu"],
                        "dong_name": m["dong_name"],
                        "area_m2": m["area_m2"],
                        "current_price": m["current_price"],
                        "trade_count": m["trade_count"],
                    }
                    for m in members
                ],
            }
            clusters.append(cluster)

            for m in members:
                sims = []
                for other in members:
                    if other["id"] == m["id"]:
                        continue
                    if other["apt_name"] == m["apt_name"] and other["sigungu"] == m["sigungu"]:
                        continue
                    # 면적 30% 이내만 비교
                    m_area = m.get("area_m2") or 0
                    o_area = other.get("area_m2") or 0
                    if m_area > 0 and o_area > 0 and max(m_area, o_area) / min(m_area, o_area) > 1.30:
                        continue
                    corr = series_corr(m["series"], other["series"], sp["min_valid"])
                    if corr is None:
                        continue
                    hist_diff = mean_abs_pct_diff(m["series"], other["series"])
                    if hist_diff is None or hist_diff > 0.10:
                        continue
                    if not level_similar(m["recent_avg"], other["recent_avg"], 1.30):
                        continue
                    sims.append((corr, hist_diff, other))

                if not sims:
                    continue

                sims.sort(key=lambda x: (-x[0], x[1]))
                compares = [
                    {
                        "id": o["id"],
                        "apt_name": o["apt_name"],
                        "sigungu": o["sigungu"],
                        "dong_name": o["dong_name"],
                        "area_m2": o["area_m2"],
                        "current_price": o["current_price"],
                        "recent_avg": o["recent_avg"],
                        "avg_36": o["avg_36"],
                        "trade_count": o["trade_count"],
                        "corr": round(c, 3),
                        "hist_diff_pct": round(hdiff * 100, 2),
                    }
                    for c, hdiff, o in sims[:2]
                ]

                compare_avg_recent = sum(c["recent_avg"] for c in compares if c.get("recent_avg")) / max(
                    1, sum(1 for c in compares if c.get("recent_avg"))
                )
                compare_avg_36 = sum(c["avg_36"] for c in compares if c.get("avg_36")) / max(
                    1, sum(1 for c in compares if c.get("avg_36"))
                )

                if m["recent_avg"] is None or compare_avg_recent <= 0:
                    continue
                ratio = m["recent_avg"] / compare_avg_recent
                gap_pct = round((ratio - 1) * 100, 2)

                # Classify valuation status
                if gap_pct < -5:
                    status = "undervalued"
                elif gap_pct > 5:
                    status = "leading"
                else:
                    status = "market"

                entry = {
                    "id": m["id"],
                    "apt_name": m["apt_name"],
                    "sigungu": m["sigungu"],
                    "dong_name": m["dong_name"],
                    "area_m2": m["area_m2"],
                    "current_price": m["current_price"],
                    "recent_avg": m["recent_avg"],
                    "avg_36": m["avg_36"],
                    "compare_avg_recent": compare_avg_recent,
                    "compare_avg_36": compare_avg_36,
                    "cluster_avg": round(avg_current, 2),
                    "gap_pct": gap_pct,
                    "status": status,
                    "trade_count": m["trade_count"],
                    "recent_3m_trades": m["recent_3m_trades"],
                    "cluster_size": len(members),
                    "compare": compares,
                }

                # All entries go to valuation output
                all_valued.append(entry)

                # Existing undervalued/band logic (ratio < 1.0 only)
                if ratio < 1.0:
                    if m["current_price"] <= (1.0 - gap) * avg_current:
                        undervalued.append(entry)
                    band_candidates.append(entry)

        return clusters, undervalued, band_candidates, all_valued

    for sido in search_sidos.keys():
        sp = sido_params(sido)
        items = search_sidos[sido]["items"]

        # 구(district)별로 그룹핑
        district_items: Dict[str, List] = {}
        for item in items:
            dist = item.get("district", "")
            if dist:
                district_items.setdefault(dist, []).append(item)

        all_clusters = []
        all_undervalued = []
        all_band_candidates = []
        all_valued_entries = []
        seen_uv: set = set()
        seen_bc: set = set()
        seen_val: set = set()

        for dist_name, dist_items in district_items.items():
            # 같은 구 + 인접 구 아이템 합치기
            group_items = list(dist_items)
            group_ids = {it["id"] for it in group_items}
            for adj_dist in ADJACENT.get(dist_name, []):
                for it in district_items.get(adj_dist, []):
                    if it["id"] not in group_ids:
                        group_items.append(it)
                        group_ids.add(it["id"])

            clusters, undervalued, band_cands, valued = find_undervalued_in_group(group_items, sp, args.gap)
            all_clusters.extend(clusters)
            # 중복 제거: 인접 구 확장으로 같은 아파트가 여러 그룹에서 나올 수 있음
            # 같은 아파트가 여러번 나오면 gap_pct가 더 낮은(더 저평가된) 걸 유지
            for u in undervalued:
                if u["id"] not in seen_uv:
                    seen_uv.add(u["id"])
                    all_undervalued.append(u)
            for bc in band_cands:
                if bc["id"] not in seen_bc:
                    seen_bc.add(bc["id"])
                    all_band_candidates.append(bc)
            for v in valued:
                if v["id"] not in seen_val:
                    seen_val.add(v["id"])
                    all_valued_entries.append(v)

        all_undervalued = [u for u in all_undervalued if u.get("recent_avg") is not None and u.get("compare_avg_recent") and u.get("recent_3m_trades", 0) > 0]
        all_undervalued.sort(key=recent_gap_score)

        all_band_candidates.sort(key=recent_gap_score)
        bands_out = []
        for label, low, high in bands:
            if high is None:
                b_items = [u for u in all_band_candidates if u["recent_avg"] >= low and u.get("recent_3m_trades", 0) > 0]
            else:
                b_items = [u for u in all_band_candidates if low <= u["recent_avg"] < high and u.get("recent_3m_trades", 0) > 0]
            bands_out.append({
                "label": label,
                "top3": b_items[:3],
            })

        output["sidos"][sido] = {
            "clusters": all_clusters,
            "undervalued": all_undervalued[:3],
            "bands": bands_out,
        }

        # Write per-sido valuation JSON (compact, no indent)
        VALUATION_DIR.mkdir(parents=True, exist_ok=True)
        val_output = {
            "updated_at": summary.get("updated_at"),
            "current_month": current_month,
            "count": len(all_valued_entries),
            "items": all_valued_entries,
        }
        val_path = VALUATION_DIR / f"{sido}.json"
        val_path.write_text(json.dumps(val_output, ensure_ascii=False), encoding="utf-8")
        print(f"Valuation: {val_path} ({len(all_valued_entries)} items)")

    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved: {OUT_PATH}")

    # Write valuation index
    val_index = {
        "updated_at": summary.get("updated_at"),
        "sido_order": list(search_sidos.keys()),
    }
    (VALUATION_DIR / "index.json").write_text(
        json.dumps(val_index, ensure_ascii=False), encoding="utf-8"
    )


if __name__ == "__main__":
    main()

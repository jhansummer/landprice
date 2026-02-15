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
OUT_PATH = DATA_DIR / "undervalued.json"


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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corr", type=float, default=0.97, help="Pearson correlation threshold")
    ap.add_argument("--months", type=int, default=36, help="Months window")
    ap.add_argument("--min-trades", type=int, default=15, help="Min trades in window")
    ap.add_argument("--min-valid", type=int, default=30, help="Min non-empty months after fill")
    ap.add_argument("--gap", type=float, default=0.20, help="Undervalued gap (20% => 0.20)")
    args = ap.parse_args()

    summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    search = json.loads(SEARCH_INDEX_PATH.read_text(encoding="utf-8"))

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
                "corr": min(args.corr, 0.93),
                "min_trades": min(args.min_trades, 10),
                "min_valid": min(args.min_valid, 20),
                "min_cluster": 2,
            }
        return {
            "corr": args.corr,
            "min_trades": args.min_trades,
            "min_valid": args.min_valid,
            "min_cluster": 3,
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
            "region_level": "sido",
            "bands": [b[0] for b in bands],
            "relaxed_sidos": sorted(RELAXED_SIDOS),
        },
        "sidos": {},
    }

    for sido in search.get("sidos", {}).keys():
        sp = sido_params(sido)
        items = search["sidos"][sido]["items"]
        series_map: Dict[str, Dict] = {}

        for item in items:
            apt_id = item["id"]
            txns = load_txns(apt_id)
            if not txns:
                continue

            # trades in last N months
            trades_window = [t for t in txns if parse_month(t[0]) in months]
            if len(trades_window) < sp["min_trades"]:
                continue

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
            }

        keys = list(series_map.keys())
        n = len(keys)
        if n == 0:
            output["sidos"][sido] = {"clusters": [], "undervalued": []}
            continue

        adj: Dict[int, List[int]] = {i: [] for i in range(n)}
        for i in range(n):
            si = series_map[keys[i]]["series"]
            for j in range(i + 1, n):
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

        for i in range(n):
            if visited[i]:
                continue
            # BFS component
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
            # Precompute representative compare candidates (highest recent avg)
            compare_sorted = sorted(members, key=lambda x: x["recent_avg"] or 0, reverse=True)
            compare_list = [
                {
                    "id": m["id"],
                    "apt_name": m["apt_name"],
                    "sigungu": m["sigungu"],
                    "dong_name": m["dong_name"],
                    "area_m2": m["area_m2"],
                    "current_price": m["current_price"],
                    "recent_avg": m["recent_avg"],
                }
                for m in compare_sorted
            ]

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
                if m["current_price"] <= (1.0 - args.gap) * avg_current:
                    # Pick up to 2 compare units: most similar price series
                    sims = []
                    for other in members:
                        if other["id"] == m["id"]:
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
                            "corr": round(c, 3),
                            "hist_diff_pct": round(hdiff * 100, 2),
                        }
                        for c, hdiff, o in sims[:2]
                    ]

                    if not compares:
                        continue
                    compare_avg_recent = sum(c["recent_avg"] for c in compares if c.get("recent_avg")) / max(
                        1, sum(1 for c in compares if c.get("recent_avg"))
                    )
                    compare_avg_36 = sum(c["avg_36"] for c in compares if c.get("avg_36")) / max(
                        1, sum(1 for c in compares if c.get("avg_36"))
                    )
                    undervalued.append(
                        {
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
                            "gap_pct": round((m["current_price"] / avg_current - 1) * 100, 2),
                            "trade_count": m["trade_count"],
                            "cluster_size": len(members),
                            "compare": compares,
                        }
                    )

        undervalued = [u for u in undervalued if u.get("recent_avg") is not None and u.get("compare_avg_recent")]
        undervalued.sort(key=lambda x: (x["recent_avg"] / x["compare_avg_recent"]))

        bands_out = []
        for label, low, high in bands:
            if high is None:
                items = [u for u in undervalued if u["recent_avg"] >= low]
            else:
                items = [u for u in undervalued if low <= u["recent_avg"] < high]
            bands_out.append({
                "label": label,
                "top3": items[:3],
            })

        output["sidos"][sido] = {
            "clusters": clusters,
            "undervalued": undervalued[:3],
            "bands": bands_out,
        }

    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved: {OUT_PATH}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
히스토리컬 백테스트: 과거 거래 데이터(201903~현재)를 활용해
저평가 알고리즘을 과거 시점으로 소급 실행하여 실제 수익률을 검증한다.

Git 히스토리 의존 없이, by_apt 트랜잭션 데이터만으로 시뮬레이션.
"""
import json
import sys
import time
import argparse
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data" / "apt_trade"
BY_APT_DIR = DATA_DIR / "by_apt"
SUMMARY_PATH = DATA_DIR / "summary.json"
SEARCH_INDEX_PATH = DATA_DIR / "search_index.json"
SEARCH_DIR = DATA_DIR / "search"
OUT_PATH = DATA_DIR / "backtest.json"

# Import core functions from find_undervalued
sys.path.insert(0, str(Path(__file__).resolve().parent))
from find_undervalued import (
    month_add,
    month_range,
    parse_month,
    build_series,
    recent_avg as calc_recent_avg,
    find_undervalued_in_group,
    sido_params,
    recent_gap_score,
    ADJACENT,
)


def load_all_txns() -> Dict[str, List]:
    """by_apt/ 전체를 메모리에 캐시."""
    cache: Dict[str, List] = {}
    files = list(BY_APT_DIR.glob("*.json"))
    print(f"by_apt 캐시 로딩: {len(files)}개 파일...", end="", flush=True)
    t0 = time.time()
    for f in files:
        apt_id = f.stem
        try:
            cache[apt_id] = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
    elapsed = time.time() - t0
    print(f" {elapsed:.1f}초 ({len(cache)}개 로드)")
    return cache


def get_current_price(apt_id: str, txn_cache: Dict[str, List]) -> Optional[float]:
    """최근 3건 평균가 반환."""
    txns = txn_cache.get(apt_id)
    if not txns:
        return None
    txns_sorted = sorted(txns, key=lambda x: x[0])
    recent = txns_sorted[-3:] if len(txns_sorted) >= 3 else txns_sorted
    return sum(t[1] for t in recent) / len(recent)


def get_flagged_price(apt_id: str, sim_month: str, txn_cache: Dict[str, List]) -> Optional[float]:
    """시뮬레이션 시점의 recent_avg (최근 6개월 평균).

    미래 데이터 누출 방지: sim_month 이전 데이터만 사용.
    """
    txns = txn_cache.get(apt_id)
    if not txns:
        return None
    # sim_month 이전 거래만 필터
    cutoff = sim_month + "32"  # sim_month 포함
    filtered = [t for t in txns if t[0].replace("-", "") <= cutoff]
    if not filtered:
        return None
    # 6개월 윈도우 구축
    months_window = month_range(sim_month, 6)
    series, valid = build_series(filtered, months_window)
    avg = calc_recent_avg(series, 6)
    return avg


def get_market_return(summary_data: Dict, sido: str, flag_ym: str, current_month: str) -> Optional[float]:
    """시도 trend 데이터에서 시장 수익률 계산 (3개월 이동평균 스무딩)."""
    sido_data = summary_data.get("sidos", {}).get(sido)
    if not sido_data:
        return None
    trend = sido_data.get("trend")
    if not trend:
        return None
    ym_price = {t[0]: t[1] for t in trend}
    sorted_yms = sorted(ym_price.keys())

    def avg_around(target_ym, n=3):
        """target_ym 포함 직전 n개월 평균 (스무딩)."""
        if target_ym not in ym_price:
            # target_ym이 없으면 가장 가까운 이전 월 찾기
            candidates = [ym for ym in sorted_yms if ym <= target_ym]
            if not candidates:
                return None
            target_ym = candidates[-1]
        idx = sorted_yms.index(target_ym)
        window = sorted_yms[max(0, idx - n + 1):idx + 1]
        vals = [ym_price[ym] for ym in window]
        return sum(vals) / len(vals) if vals else None

    flag_avg = avg_around(flag_ym)
    cur_avg = avg_around(current_month)
    if not flag_avg or not cur_avg or flag_avg <= 0:
        return None
    return round((cur_avg - flag_avg) / flag_avg * 100, 2)


def run_simulation_month(
    sim_month: str,
    search_sidos: Dict,
    txn_cache: Dict[str, List],
    gap: float,
    corr: float,
    min_trades: int,
    min_valid: int,
) -> List[Dict]:
    """한 시뮬레이션 월에 대해 저평가 단지 선정."""
    months = month_range(sim_month, 36)
    all_picks = []

    for sido, sido_data in search_sidos.items():
        sp = sido_params(sido, corr, min_trades, min_valid)
        items = sido_data["items"]

        # 구(district)별로 그룹핑
        district_items: Dict[str, List] = {}
        for item in items:
            dist = item.get("district", "")
            if dist:
                district_items.setdefault(dist, []).append(item)

        all_undervalued = []
        all_band_candidates = []
        seen_uv: set = set()
        seen_bc: set = set()

        for dist_name, dist_items in district_items.items():
            group_items = list(dist_items)
            group_ids = {it["id"] for it in group_items}
            for adj_dist in ADJACENT.get(dist_name, []):
                for it in district_items.get(adj_dist, []):
                    if it["id"] not in group_ids:
                        group_items.append(it)
                        group_ids.add(it["id"])

            clusters, undervalued, band_cands, valued = find_undervalued_in_group(
                group_items, sp, gap, months, txn_cache
            )

            for u in undervalued:
                if u["id"] not in seen_uv:
                    seen_uv.add(u["id"])
                    all_undervalued.append(u)
            for bc in band_cands:
                if bc["id"] not in seen_bc:
                    seen_bc.add(bc["id"])
                    all_band_candidates.append(bc)

        # undervalued 필터 + 정렬 (main()과 동일 로직)
        all_undervalued = [
            u for u in all_undervalued
            if u.get("recent_avg") is not None
            and u.get("compare_avg_recent")
            and u.get("recent_3m_trades", 0) > 0
        ]
        all_undervalued.sort(key=recent_gap_score)

        # bands top3 수집
        all_band_candidates.sort(key=recent_gap_score)
        bands_def = [
            (0, 50000), (50000, 80000), (80000, 120000),
            (120000, 150000), (150000, 200000), (200000, 250000),
            (250000, 300000), (300000, 400000), (400000, 500000),
            (500000, None),
        ]
        band_top3_ids: set = set()
        for low, high in bands_def:
            if high is None:
                b_items = [u for u in all_band_candidates if u["recent_avg"] >= low and u.get("recent_3m_trades", 0) > 0]
            else:
                b_items = [u for u in all_band_candidates if low <= u["recent_avg"] < high and u.get("recent_3m_trades", 0) > 0]
            for item in b_items[:3]:
                band_top3_ids.add(item["id"])

        # 저평가 top3 + bands top3 수집 (중복 제거)
        seen_ids: set = set()
        candidates = []
        for item in all_undervalued[:3]:
            if item["id"] not in seen_ids:
                seen_ids.add(item["id"])
                candidates.append(item)
        for item in all_band_candidates:
            if item["id"] in band_top3_ids and item["id"] not in seen_ids:
                seen_ids.add(item["id"])
                candidates.append(item)

        for item in candidates:
            all_picks.append({
                "id": item["id"],
                "apt_name": item["apt_name"],
                "sigungu": item.get("sigungu", ""),
                "dong_name": item.get("dong_name", ""),
                "area_m2": item.get("area_m2"),
                "sido": sido,
                "recent_avg": item.get("recent_avg"),
                "compare_ids": [c["id"] for c in item.get("compare", [])],
                "compare_names": [c["apt_name"] for c in item.get("compare", [])],
            })

    return all_picks


def main():
    ap = argparse.ArgumentParser(description="히스토리컬 백테스트 시뮬레이션")
    ap.add_argument("--lookback", type=int, default=6, help="시뮬레이션 개월 수 (default: 6)")
    ap.add_argument("--corr", type=float, default=0.93, help="Pearson correlation threshold")
    ap.add_argument("--min-trades", type=int, default=15, help="Min trades in window")
    ap.add_argument("--min-valid", type=int, default=30, help="Min non-empty months after fill")
    ap.add_argument("--gap", type=float, default=0.20, help="Undervalued gap (20% => 0.20)")
    args = ap.parse_args()

    print("=== 히스토리컬 백테스트 시뮬레이션 ===", flush=True)
    print(f"lookback: {args.lookback}개월", flush=True)

    # 1. summary.json, search 데이터 로드
    if not SUMMARY_PATH.exists():
        print("summary.json 없음. 종료.")
        return
    summary_data = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    current_month = summary_data.get("current_month", "")
    if not current_month:
        raise SystemExit("current_month not found in summary.json")

    search_meta = json.loads(SEARCH_INDEX_PATH.read_text(encoding="utf-8"))
    if "sidos" in search_meta:
        search_sidos = search_meta["sidos"]
    else:
        search_sidos = {}
        sido_order = search_meta.get("sido_order", [])
        for sido_name in sido_order:
            sido_file = SEARCH_DIR / f"{sido_name}.json"
            if sido_file.exists():
                search_sidos[sido_name] = json.loads(sido_file.read_text(encoding="utf-8"))

    # 2. by_apt 전체 메모리 캐시
    txn_cache = load_all_txns()

    # 3. 시뮬레이션 월 목록 생성 (current_month-lookback ~ current_month-1)
    sim_months = []
    for i in range(args.lookback, 0, -1):
        sim_months.append(month_add(current_month, -i))

    print(f"시뮬레이션 기간: {sim_months[0]} ~ {sim_months[-1]} ({len(sim_months)}개월)")
    print(f"현재 월: {current_month}")

    # 4. 각 월 시뮬레이션 실행
    all_picks = []
    total_start = time.time()

    for idx, sim_month in enumerate(sim_months):
        t0 = time.time()
        print(f"  [{idx+1}/{len(sim_months)}] {sim_month}...", end="", flush=True)

        month_picks = run_simulation_month(
            sim_month, search_sidos, txn_cache,
            args.gap, args.corr, args.min_trades, args.min_valid,
        )

        elapsed = time.time() - t0
        print(f" {len(month_picks)}건 ({elapsed:.1f}초)")

        # 5. 각 선정 단지의 실제 수익률 계산
        for pick in month_picks:
            apt_id = pick["id"]
            # flagged_price = 시뮬레이션 시점의 recent_avg
            flagged_price = pick.get("recent_avg")
            if not flagged_price:
                flagged_price = get_flagged_price(apt_id, sim_month, txn_cache)
            if not flagged_price or flagged_price <= 0:
                continue

            # current_price = 현재 최근 3건 평균
            cur_price = get_current_price(apt_id, txn_cache)
            if not cur_price or cur_price <= 0:
                continue

            return_pct = round((cur_price - flagged_price) / flagged_price * 100, 2)
            market_ret = get_market_return(summary_data, pick["sido"], sim_month, current_month)
            alpha = round(return_pct - market_ret, 2) if market_ret is not None else None

            all_picks.append({
                "flag_ym": sim_month,
                "id": apt_id,
                "apt_name": pick["apt_name"],
                "sigungu": pick["sigungu"],
                "dong_name": pick["dong_name"],
                "area_m2": pick["area_m2"],
                "sido": pick["sido"],
                "flagged_price": round(flagged_price),
                "current_price": round(cur_price),
                "return_pct": return_pct,
                "market_return": market_ret,
                "alpha": alpha,
                "compare_ids": pick.get("compare_ids", []),
                "compare_names": pick.get("compare_names", []),
            })

    total_elapsed = time.time() - total_start
    print(f"\n시뮬레이션 완료: {total_elapsed:.1f}초")

    # 6. 중복 제거 (같은 apt_id는 최초 선정 시점만 유지)
    seen = {}
    for pick in all_picks:
        key = pick["id"]
        if key not in seen or pick["flag_ym"] < seen[key]["flag_ym"]:
            seen[key] = pick
    unique_picks = sorted(seen.values(), key=lambda x: x["flag_ym"])

    total = len(unique_picks)
    if total == 0:
        print("백테스트 대상 없음.")
        output = {
            "updated_at": summary_data.get("updated_at", ""),
            "current_month": current_month,
            "snapshots_count": len(sim_months),
            "first_snapshot": sim_months[0] if sim_months else "",
            "last_snapshot": sim_months[-1] if sim_months else "",
            "summary": {
                "total_picks": 0, "went_up": 0, "went_up_pct": 0,
                "avg_return": 0, "avg_market_return": None, "avg_alpha": None,
            },
            "six_month": None,
            "timeline": [],
            "picks": [],
        }
        with OUT_PATH.open("w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
        return

    # 7. 통계
    went_up = sum(1 for p in unique_picks if p["return_pct"] > 0)
    avg_return = round(sum(p["return_pct"] for p in unique_picks) / total, 2)
    with_market = [p for p in unique_picks if p["market_return"] is not None]
    avg_market = round(sum(p["market_return"] for p in with_market) / len(with_market), 2) if with_market else None
    avg_alpha = round(sum(p["alpha"] for p in with_market) / len(with_market), 2) if with_market else None

    # 8. 월별 타임라인
    by_month = defaultdict(list)
    for p in unique_picks:
        by_month[p["flag_ym"]].append(p)
    timeline = []
    for ym in sorted(by_month.keys()):
        picks = by_month[ym]
        m_up = sum(1 for p in picks if p["return_pct"] > 0)
        m_avg = round(sum(p["return_pct"] for p in picks) / len(picks), 2)
        timeline.append({
            "ym": ym,
            "count": len(picks),
            "went_up": m_up,
            "went_up_pct": round(m_up / len(picks) * 100, 1),
            "avg_return": m_avg,
        })

    # 9. N개월 전 저평가 리딩 검증 (6개월, 24개월)
    cur_y, cur_m = int(current_month[:4]), int(current_month[4:])
    available_yms = sorted(set(p["flag_ym"] for p in all_picks))

    def build_period_data(target_months, tolerance=2):
        """target_months개월 전 저평가 picks의 현재 실적을 집계."""
        t_m = cur_m - target_months
        t_y = cur_y
        while t_m <= 0:
            t_m += 12
            t_y -= 1
        target_ym = f"{t_y:04d}{t_m:02d}"

        if not available_yms:
            return None
        closest_ym = min(available_yms, key=lambda ym: abs(int(ym) - int(target_ym)))
        if abs(int(closest_ym) - int(target_ym)) > tolerance:
            return None
        period_picks = [p for p in all_picks if p["flag_ym"] == closest_ym]
        seen_p = {}
        for p in period_picks:
            if p["id"] not in seen_p:
                seen_p[p["id"]] = p
        p_unique = sorted(seen_p.values(), key=lambda x: x["return_pct"], reverse=True)
        p_total = len(p_unique)
        if p_total == 0:
            return None
        p_went_up = sum(1 for p in p_unique if p["return_pct"] > 0)
        p_avg = round(sum(p["return_pct"] for p in p_unique) / p_total, 2)
        p_with_market = [p for p in p_unique if p["market_return"] is not None]
        p_avg_market = round(sum(p["market_return"] for p in p_with_market) / len(p_with_market), 2) if p_with_market else None
        p_avg_alpha = round(sum(p["alpha"] for p in p_with_market) / len(p_with_market), 2) if p_with_market else None
        result = {
            "flag_ym": closest_ym,
            "months_elapsed": (cur_y - int(closest_ym[:4])) * 12 + (cur_m - int(closest_ym[4:])),
            "total": p_total,
            "went_up": p_went_up,
            "went_up_pct": round(p_went_up / p_total * 100, 1),
            "avg_return": p_avg,
            "avg_market_return": p_avg_market,
            "avg_alpha": p_avg_alpha,
            "picks": p_unique,
        }
        print(f"  {target_months}개월 전 ({closest_ym}): {p_total}건, 상승 {p_went_up}건 ({result['went_up_pct']}%), 평균 {p_avg}%")
        return result

    six_month_data = build_period_data(6)
    two_year_data = build_period_data(24, tolerance=3)

    # 10. 출력 (build_backtest.py와 동일 포맷)
    output = {
        "updated_at": summary_data.get("updated_at", ""),
        "current_month": current_month,
        "snapshots_count": len(sim_months),
        "first_snapshot": sim_months[0] if sim_months else "",
        "last_snapshot": sim_months[-1] if sim_months else "",
        "summary": {
            "total_picks": total,
            "went_up": went_up,
            "went_up_pct": round(went_up / total * 100, 1),
            "avg_return": avg_return,
            "avg_market_return": avg_market,
            "avg_alpha": avg_alpha,
        },
        "six_month": six_month_data,
        "two_year": two_year_data,
        "timeline": timeline,
        "picks": unique_picks,
    }
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\n결과: {OUT_PATH}")
    print(f"  총 {total}건, 상승 {went_up}건 ({output['summary']['went_up_pct']}%)")
    print(f"  평균 수익률: {avg_return}%, 시장 평균: {avg_market}%, 알파: {avg_alpha}%")


if __name__ == "__main__":
    main()

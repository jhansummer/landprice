#!/usr/bin/env python3
"""
저평가 백테스트: git 히스토리에서 undervalued.json 스냅샷을 추출하고,
과거 저평가 판정 단지의 실제 수익률을 계산한다.
"""
import json
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT / "docs" / "data" / "apt_trade"
BY_APT_DIR = DATA_DIR / "by_apt"
OUT_PATH = DATA_DIR / "backtest.json"
UNDERVALUED_REL = "docs/data/apt_trade/undervalued.json"
BACKTEST_CACHE_FILE = SCRIPTS_DIR / "backtest_cache.json"


def git_run(*args: str) -> str:
    """Run a git command and return stdout."""
    result = subprocess.run(
        ["git"] + list(args),
        capture_output=True, text=True, cwd=str(ROOT),
    )
    if result.returncode != 0:
        return ""
    return result.stdout


def get_monthly_snapshots():
    """undervalued.json 변경 커밋에서 월별 1개씩 추출."""
    raw = git_run("log", "--format=%H %aI", "--follow", "--diff-filter=M",
                   "--", UNDERVALUED_REL)
    if not raw.strip():
        # fallback: --diff-filter 없이
        raw = git_run("log", "--format=%H %aI", "--", UNDERVALUED_REL)
    if not raw.strip():
        return []

    commits = []
    for line in raw.strip().split("\n"):
        parts = line.strip().split(" ", 1)
        if len(parts) < 2:
            continue
        commit_hash = parts[0]
        try:
            dt = datetime.fromisoformat(parts[1].replace("Z", "+00:00"))
            yyyymm = dt.strftime("%Y%m")
        except (ValueError, IndexError):
            continue
        commits.append((yyyymm, commit_hash, dt))

    # 월별 첫 커밋 선택
    by_month = defaultdict(list)
    for yyyymm, h, dt in commits:
        by_month[yyyymm].append((dt, h))

    monthly = []
    for yyyymm in sorted(by_month.keys()):
        entries = sorted(by_month[yyyymm], key=lambda x: x[0])
        monthly.append((yyyymm, entries[0][1]))
    return monthly


def extract_snapshot(commit_hash: str):
    """특정 커밋에서 undervalued.json 복원."""
    raw = git_run("show", f"{commit_hash}:{UNDERVALUED_REL}")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def get_current_price(apt_id: str):
    """by_apt/{id}.json에서 최근 3건 평균가 반환."""
    path = BY_APT_DIR / f"{apt_id}.json"
    if not path.exists():
        return None
    try:
        txns = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not txns:
        return None
    txns.sort(key=lambda x: x[0])
    recent = txns[-3:] if len(txns) >= 3 else txns
    return sum(t[1] for t in recent) / len(recent)


def get_market_return(summary_data, sido, flag_ym, current_month):
    """시도 trend 데이터에서 시장 수익률 계산."""
    sido_data = summary_data.get("sidos", {}).get(sido)
    if not sido_data:
        return None
    trend = sido_data.get("trend")
    if not trend:
        return None
    ym_price = {t[0]: t[1] for t in trend}
    flag_price = ym_price.get(flag_ym)
    current_price = ym_price.get(current_month)
    if not flag_price or not current_price or flag_price <= 0:
        return None
    return round((current_price - flag_price) / flag_price * 100, 2)


def load_backtest_cache():
    """스냅샷별 후보 캐시 로드. {commit_hash: [{apt_id, flag_ym, sido, flagged_price, ...}]}"""
    if BACKTEST_CACHE_FILE.exists():
        try:
            return json.loads(BACKTEST_CACHE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_backtest_cache(cache):
    with BACKTEST_CACHE_FILE.open("w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, separators=(",", ":"))


def extract_candidates_from_snapshot(snapshot):
    """스냅샷에서 저평가 후보 리스트 추출 (현재가 계산 제외)."""
    candidates = []
    for sido, sido_data in snapshot.get("sidos", {}).items():
        seen_ids = set()
        items = []
        for item in sido_data.get("undervalued", []):
            if item.get("id") and item["id"] not in seen_ids:
                seen_ids.add(item["id"])
                items.append(item)
        for band in sido_data.get("bands", []):
            for item in band.get("top3", []):
                if item.get("id") and item["id"] not in seen_ids:
                    seen_ids.add(item["id"])
                    items.append(item)
        for item in items:
            flagged_price = item.get("recent_avg") or item.get("current_price")
            if not flagged_price or flagged_price <= 0:
                continue
            candidates.append({
                "id": item["id"],
                "apt_name": item.get("apt_name", ""),
                "sigungu": item.get("sigungu", ""),
                "dong_name": item.get("dong_name", ""),
                "area_m2": item.get("area_m2"),
                "sido": sido,
                "flagged_price": round(flagged_price),
            })
    return candidates


def main():
    print("=== 저평가 백테스트 빌드 ===", flush=True)

    # 1. 월별 스냅샷 추출
    snapshots = get_monthly_snapshots()
    print(f"월별 스냅샷: {len(snapshots)}개", flush=True)
    if not snapshots:
        print("스냅샷 없음. 종료.")
        return

    # 2. summary.json 로드 (시장 비교용)
    summary_path = DATA_DIR / "summary.json"
    if not summary_path.exists():
        print("summary.json 없음. 종료.")
        return
    summary_data = json.loads(summary_path.read_text(encoding="utf-8"))
    current_month = summary_data.get("current_month", "")

    # 3. 캐시 로드 — 스냅샷별 후보 추출 결과 캐싱 (git show 호출 절약)
    bt_cache = load_backtest_cache()
    cache_hits = 0

    # 4. 각 스냅샷에서 후보 추출 (캐시 활용) + 현재가로 수익률 계산
    all_picks = []
    for yyyymm, commit_hash in snapshots:
        print(f"  {yyyymm} ({commit_hash[:8]})...", end="", flush=True)

        # 캐시에 후보가 있으면 git show 스킵
        if commit_hash in bt_cache:
            candidates = bt_cache[commit_hash]
            cache_hits += 1
        else:
            snapshot = extract_snapshot(commit_hash)
            if not snapshot:
                print(" skip (parse fail)")
                continue
            candidates = extract_candidates_from_snapshot(snapshot)
            bt_cache[commit_hash] = candidates

        count = 0
        for cand in candidates:
            apt_id = cand["id"]
            flagged_price = cand["flagged_price"]

            cur_price = get_current_price(apt_id)
            if not cur_price or cur_price <= 0:
                continue

            return_pct = round((cur_price - flagged_price) / flagged_price * 100, 2)
            market_ret = get_market_return(summary_data, cand["sido"], yyyymm, current_month)
            alpha = round(return_pct - market_ret, 2) if market_ret is not None else None

            all_picks.append({
                "flag_ym": yyyymm,
                "id": apt_id,
                "apt_name": cand["apt_name"],
                "sigungu": cand["sigungu"],
                "dong_name": cand["dong_name"],
                "area_m2": cand["area_m2"],
                "sido": cand["sido"],
                "flagged_price": flagged_price,
                "current_price": round(cur_price),
                "return_pct": return_pct,
                "market_return": market_ret,
                "alpha": alpha,
            })
            count += 1
        print(f" {count}건")

    print(f"캐시 히트: {cache_hits}/{len(snapshots)}", flush=True)
    save_backtest_cache(bt_cache)

    # 4. 중복 제거: 같은 apt_id는 최초 flag만
    seen = {}
    for pick in all_picks:
        key = pick["id"]
        if key not in seen or pick["flag_ym"] < seen[key]["flag_ym"]:
            seen[key] = pick
    unique_picks = sorted(seen.values(), key=lambda x: x["flag_ym"])

    total = len(unique_picks)
    if total == 0:
        print("백테스트 대상 없음.")
        # 빈 결과라도 저장
        output = {
            "updated_at": summary_data.get("updated_at", ""),
            "current_month": current_month,
            "snapshots_count": len(snapshots),
            "first_snapshot": snapshots[0][0],
            "last_snapshot": snapshots[-1][0],
            "summary": {
                "total_picks": 0, "went_up": 0, "went_up_pct": 0,
                "avg_return": 0, "avg_market_return": None, "avg_alpha": None,
            },
            "timeline": [],
            "picks": [],
        }
        with OUT_PATH.open("w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
        return

    # 5. 통계
    went_up = sum(1 for p in unique_picks if p["return_pct"] > 0)
    avg_return = round(sum(p["return_pct"] for p in unique_picks) / total, 2)
    with_market = [p for p in unique_picks if p["market_return"] is not None]
    avg_market = round(sum(p["market_return"] for p in with_market) / len(with_market), 2) if with_market else None
    avg_alpha = round(sum(p["alpha"] for p in with_market) / len(with_market), 2) if with_market else None

    # 6. 월별 타임라인
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

    # 7. N개월 전 저평가 리딩 검증 (6개월, 24개월)
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

    # 8. 출력
    output = {
        "updated_at": summary_data.get("updated_at", ""),
        "current_month": current_month,
        "snapshots_count": len(snapshots),
        "first_snapshot": snapshots[0][0],
        "last_snapshot": snapshots[-1][0],
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

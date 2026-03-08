#!/usr/bin/env python3
"""Build today_trades.json — 어제 대비 오늘 신규 유입된 실거래 목록.

by_lawd/{code}/{YYYYMM}.json 의 최근 6개월 데이터를 이전 캐시와 비교하여
신규 거래만 추출한 뒤 docs/data/apt_trade/today_trades.json 으로 저장한다.
aptmine-app Edge Function이 이 파일을 읽어 실거래 알림을 발송한다.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dateutil.relativedelta import relativedelta

from lawd_codes import all_lawd_list, lawd_name

SCRIPTS_DIR = Path(__file__).resolve().parent
DOCS_DIR = SCRIPTS_DIR.parent / "docs"
DATA_DIR = DOCS_DIR / "data" / "apt_trade"
BY_LAWD_DIR = DATA_DIR / "by_lawd"
OUTPUT_PATH = DATA_DIR / "today_trades.json"
CACHE_PATH = SCRIPTS_DIR / "today_trades_cache.json"

KST = timezone(timedelta(hours=9))
SCAN_MONTHS = 6


def make_apt_id(sigungu: str, apt_name: str, area_m2: float) -> str:
    return hashlib.md5(f"{sigungu}\t{apt_name}\t{area_m2}".encode()).hexdigest()[:10]


def dedupe_key(r: dict) -> tuple:
    return (r["apt_name"], r["deal_date"], r["price_man"], r["area_m2"], r["floor"], r["jibun"])


def scan_months_list() -> list[str]:
    today = datetime.now(KST).date().replace(day=1)
    return [(today - relativedelta(months=i)).strftime("%Y%m") for i in range(SCAN_MONTHS)]


def load_cache() -> set[tuple]:
    if not CACHE_PATH.exists():
        return set()
    with CACHE_PATH.open("r", encoding="utf-8") as fp:
        return {tuple(k) for k in json.load(fp)}


def save_cache(keys: set[tuple]) -> None:
    with CACHE_PATH.open("w", encoding="utf-8") as fp:
        json.dump([list(k) for k in keys], fp)


def main() -> int:
    today = datetime.now(KST).date()
    today_str = today.strftime("%Y-%m-%d")
    months = scan_months_list()

    # 이전 캐시 로드
    old_keys = load_cache()

    # 현재 데이터 스캔
    current_keys: set[tuple] = set()
    new_records: list[dict] = []

    for lawd_cd in all_lawd_list():
        sigungu = lawd_name(lawd_cd)
        for ym in months:
            month_file = BY_LAWD_DIR / lawd_cd / f"{ym}.json"
            if not month_file.exists():
                continue
            with month_file.open("r", encoding="utf-8") as fp:
                records = json.load(fp)
            for r in records:
                r["sigungu"] = sigungu
                key = dedupe_key(r)
                current_keys.add(key)
                if key not in old_keys:
                    new_records.append(r)

    # 신규 거래 → today_trades.json 포맷
    trades = []
    seen_ids = set()
    for r in new_records:
        apt_id = make_apt_id(r["sigungu"], r["apt_name"], r["area_m2"])
        entry_key = (apt_id, r["deal_date"], r["price_man"], r["floor"])
        if entry_key in seen_ids:
            continue
        seen_ids.add(entry_key)
        trades.append({
            "id": apt_id,
            "apt_name": r["apt_name"],
            "sigungu": r["sigungu"],
            "area_m2": r["area_m2"],
            "price": r["price_man"],
            "floor": r["floor"],
        })

    output = {"date": today_str, "trades": trades}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as fp:
        json.dump(output, fp, ensure_ascii=False)

    # 캐시 갱신
    save_cache(current_keys)

    print(f"today_trades.json: {today_str}, {len(trades)} new trades (cache: {len(old_keys)} → {len(current_keys)})", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

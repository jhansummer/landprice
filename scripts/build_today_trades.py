#!/usr/bin/env python3
"""Build today_trades.json — 오늘 날짜 실거래 전체 목록.

by_lawd/{code}/{YYYYMM}.json 에서 오늘(KST) 날짜 거래를 추출하여
docs/data/apt_trade/today_trades.json 으로 저장한다.
aptmine-app Edge Function이 이 파일을 읽어 실거래 알림을 발송한다.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from lawd_codes import LAWD_CODES, all_lawd_list, lawd_name

DOCS_DIR = Path(__file__).resolve().parents[1] / "docs"
DATA_DIR = DOCS_DIR / "data" / "apt_trade"
BY_LAWD_DIR = DATA_DIR / "by_lawd"
OUTPUT_PATH = DATA_DIR / "today_trades.json"

KST = timezone(timedelta(hours=9))


def make_apt_id(sigungu: str, apt_name: str, area_m2: float) -> str:
    return hashlib.md5(f"{sigungu}\t{apt_name}\t{area_m2}".encode()).hexdigest()[:10]


def main() -> int:
    today = datetime.now(KST).date()
    today_str = today.strftime("%Y-%m-%d")
    current_ym = today.strftime("%Y%m")

    trades = []
    seen = set()

    for lawd_cd in all_lawd_list():
        sigungu = lawd_name(lawd_cd)
        month_file = BY_LAWD_DIR / lawd_cd / f"{current_ym}.json"
        if not month_file.exists():
            continue
        with month_file.open("r", encoding="utf-8") as fp:
            records = json.load(fp)
        for r in records:
            if r.get("deal_date") != today_str:
                continue
            apt_id = make_apt_id(sigungu, r["apt_name"], r["area_m2"])
            dedup_key = (apt_id, r["deal_date"], r["price_man"], r["floor"])
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            trades.append({
                "id": apt_id,
                "apt_name": r["apt_name"],
                "sigungu": sigungu,
                "area_m2": r["area_m2"],
                "price": r["price_man"],
                "floor": r["floor"],
            })

    output = {"date": today_str, "trades": trades}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as fp:
        json.dump(output, fp, ensure_ascii=False)

    print(f"today_trades.json: {today_str}, {len(trades)} trades", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

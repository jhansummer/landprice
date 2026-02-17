#!/usr/bin/env python3
"""전세(순수 전세) 실거래가만 수집하는 경량 스크립트.

최근 6개월분만 수집하여 by_rent/{LAWD_CD}/{YYYYMM}.json에 저장.
전체 fetch_apt_trade.py 실행 없이 전세 데이터만 빠르게 갱신.

사용법:
  python scripts/fetch_rent_only.py              # 최근 6개월 수집
  python scripts/fetch_rent_only.py --months 12  # 최근 12개월 수집
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from dateutil.relativedelta import relativedelta

from lawd_codes import all_lawd_list, lawd_name
from fetch_apt_trade import (
    fetch_rent_month,
    write_json,
    month_list,
)

DOCS_DIR = Path(__file__).resolve().parents[1] / "docs"
DATA_DIR = DOCS_DIR / "data" / "apt_trade"
BY_RENT_DIR = DATA_DIR / "by_rent"


def main() -> int:
    service_key = os.getenv("MOLIT_SERVICE_KEY")
    if not service_key:
        print("MOLIT_SERVICE_KEY is not set", file=sys.stderr)
        return 1

    # 개월 수 옵션
    months_count = 6
    if "--months" in sys.argv:
        idx = sys.argv.index("--months")
        if idx + 1 < len(sys.argv):
            months_count = int(sys.argv[idx + 1])

    BY_RENT_DIR.mkdir(parents=True, exist_ok=True)

    lawd_list = all_lawd_list()
    months = month_list(months_count)

    total_jobs = len(lawd_list) * len(months)
    done = 0
    fetched = 0
    skipped = 0
    errors = 0
    consecutive_errors = 0
    rate_limited = False

    print(f"전세 수집 시작: {len(lawd_list)}개 지역 × {len(months)}개월 = {total_jobs}건", flush=True)

    for lawd_cd in lawd_list:
        for deal_ym in months:
            done += 1
            rent_dir = BY_RENT_DIR / lawd_cd
            rent_dir.mkdir(parents=True, exist_ok=True)
            out_path = rent_dir / f"{deal_ym}.json"
            name = lawd_name(lawd_cd)

            if rate_limited:
                skipped += 1
                continue

            print(f"[{done}/{total_jobs}] {lawd_cd} ({name}) {deal_ym}", flush=True)
            try:
                rent_recs = fetch_rent_month(service_key, lawd_cd, deal_ym)
                consecutive_errors = 0
            except Exception as e:
                print(f"  ERROR: {e} - skipping", flush=True)
                errors += 1
                consecutive_errors += 1
                if consecutive_errors >= 3:
                    print("  3 consecutive errors - stopping", flush=True)
                    rate_limited = True
                continue

            if rent_recs:
                write_json(out_path, rent_recs)
                fetched += 1
            else:
                print(f"  {lawd_cd}/{deal_ym}: empty", flush=True)

    print(f"\n전세 수집 완료: fetched={fetched}, skipped={skipped}, errors={errors}", flush=True)
    print(f"다음 단계: python scripts/fetch_apt_trade.py --summary-only", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

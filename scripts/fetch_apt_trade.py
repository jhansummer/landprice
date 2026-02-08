#!/usr/bin/env python3
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import requests
from dateutil.relativedelta import relativedelta
from lxml import etree

from lawd_codes import LAWD_CODES, SIDO_ORDER, all_lawd_list, sido_for_lawd, lawd_name

BASE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade"
DEFAULT_OPERATION_PATH = "getRTMSDataSvcAptTrade"

DOCS_DIR = Path(__file__).resolve().parents[1] / "docs"
DATA_DIR = DOCS_DIR / "data" / "apt_trade"
BY_LAWD_DIR = DATA_DIR / "by_lawd"
INDEX_PATH = DATA_DIR / "index.json"
SUMMARY_PATH = DATA_DIR / "summary.json"


def iso_now_utc() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def month_list(months_kept: int) -> List[str]:
    today = datetime.utcnow().date().replace(day=1)
    months = []
    for i in range(months_kept):
        dt = today - relativedelta(months=i)
        months.append(dt.strftime("%Y%m"))
    return sorted(months)


def chunk_iterable(items: Iterable[str]) -> List[str]:
    return list(items)


def build_params(service_key: str, lawd_cd: str, deal_ymd: str, page_no: int) -> Dict[str, str]:
    return {
        "serviceKey": service_key,
        "LAWD_CD": lawd_cd,
        "DEAL_YMD": deal_ymd,
        "pageNo": str(page_no),
        "numOfRows": "1000",
    }


def parse_items(xml_bytes: bytes) -> Tuple[List[Dict[str, str]], Dict[str, str]]:
    root = etree.fromstring(xml_bytes)
    header = root.find(".//header")
    result = {
        "resultCode": header.findtext("resultCode") if header is not None else None,
        "resultMsg": header.findtext("resultMsg") if header is not None else None,
    }
    items = []
    for item in root.findall(".//item"):
        items.append({
            "apt_name": (item.findtext("aptNm") or item.findtext("아파트") or "").strip(),
            "deal_year": (item.findtext("dealYear") or item.findtext("년") or "").strip(),
            "deal_month": (item.findtext("dealMonth") or item.findtext("월") or "").strip(),
            "deal_day": (item.findtext("dealDay") or item.findtext("일") or "").strip(),
            "price": (item.findtext("dealAmount") or item.findtext("거래금액") or "").strip(),
            "area": (item.findtext("excluUseAr") or item.findtext("전용면적") or "").strip(),
            "floor": (item.findtext("floor") or item.findtext("층") or "").strip(),
            "build_year": (item.findtext("buildYear") or item.findtext("건축년도") or "").strip(),
            "dong_name": (item.findtext("umdNm") or item.findtext("법정동") or "").strip(),
            "jibun": (item.findtext("jibun") or item.findtext("지번") or "").strip(),
        })
    return items, result


def normalize_item(raw: Dict[str, str], lawd_cd: str, deal_ym: str) -> Dict[str, object]:
    year = int(raw["deal_year"]) if raw["deal_year"] else int(deal_ym[:4])
    month = int(raw["deal_month"]) if raw["deal_month"] else int(deal_ym[4:6])
    day = int(raw["deal_day"]) if raw["deal_day"] else 1
    price = int(raw["price"].replace(",", "")) if raw["price"] else 0
    area = float(raw["area"]) if raw["area"] else 0.0
    floor = int(raw["floor"]) if raw["floor"] else 0
    build_year = int(raw["build_year"]) if raw["build_year"] else 0

    return {
        "lawd_cd": lawd_cd,
        "deal_ym": deal_ym,
        "apt_name": raw["apt_name"],
        "deal_date": f"{year:04d}-{month:02d}-{day:02d}",
        "price_man": price,
        "area_m2": area,
        "floor": floor,
        "build_year": build_year,
        "dong_name": raw["dong_name"],
        "jibun": raw["jibun"],
    }


def dedupe_key(item: Dict[str, object]) -> Tuple:
    return (
        item["apt_name"],
        item["deal_date"],
        item["price_man"],
        item["area_m2"],
        item["floor"],
        item["jibun"],
    )


def fetch_month(service_key: str, lawd_cd: str, deal_ym: str, operation_path: str) -> List[Dict[str, object]]:
    records: List[Dict[str, object]] = []
    seen = set()
    page_no = 1
    while True:
        params = build_params(service_key, lawd_cd, deal_ym, page_no)
        url = f"{BASE_URL}/{operation_path}"
        resp = None
        for attempt in range(8):
            try:
                resp = requests.get(url, params=params, timeout=30)
                if resp.status_code == 429:
                    wait = min(60, 15 * (attempt + 1))
                    print(f"  429 rate-limited, waiting {wait}s (attempt {attempt+1}/8)", flush=True)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException:
                if attempt == 7:
                    raise
                time.sleep(5 * (attempt + 1))
        if resp is None or resp.status_code == 429:
            raise RuntimeError("API rate limit exceeded after 8 retries")
        items, result = parse_items(resp.content)
        if result.get("resultCode") and result.get("resultCode") not in ("00", "000"):
            raise RuntimeError(f"API error {result.get('resultCode')}: {result.get('resultMsg')}")
        if not items:
            break
        for raw in items:
            norm = normalize_item(raw, lawd_cd, deal_ym)
            key = dedupe_key(norm)
            if key in seen:
                continue
            seen.add(key)
            records.append(norm)
        page_no += 1
        time.sleep(2.0)
    records.sort(key=lambda x: (x["deal_date"], x["apt_name"], x["floor"]))
    return records


def load_lawd_list() -> List[str]:
    env_val = os.getenv("LAWD_LIST", "")
    if env_val.strip():
        return [v.strip() for v in env_val.split(",") if v.strip()]
    return all_lawd_list()


def ensure_dirs() -> None:
    BY_LAWD_DIR.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def cleanup_old_files(lawd_list: List[str], months: List[str]) -> None:
    if not BY_LAWD_DIR.exists():
        return
    keep_set = {(lawd, month) for lawd in lawd_list for month in months}
    for lawd_dir in BY_LAWD_DIR.iterdir():
        if not lawd_dir.is_dir():
            continue
        lawd = lawd_dir.name
        for file in lawd_dir.glob("*.json"):
            month = file.stem
            if (lawd, month) not in keep_set:
                file.unlink()


def gather_sido_records(lawd_codes: List[str]) -> List[Dict[str, object]]:
    """Load all saved JSON files for the given LAWD codes and add sigungu field."""
    records: List[Dict[str, object]] = []
    for lawd_cd in lawd_codes:
        sigungu = lawd_name(lawd_cd)
        lawd_dir = BY_LAWD_DIR / lawd_cd
        if not lawd_dir.exists():
            continue
        for f in sorted(lawd_dir.glob("*.json")):
            with f.open("r", encoding="utf-8") as fp:
                for r in json.load(fp):
                    r["sigungu"] = sigungu
                    records.append(r)
    return records


def build_history(txns: List[Dict[str, object]]) -> List[List]:
    """Convert transactions to [[date, price], ...] sorted by date."""
    txns.sort(key=lambda x: x["deal_date"])
    return [[t["deal_date"], t["price_man"]] for t in txns]


def _compare_groups(groups: Dict[str, List[Dict[str, object]]], filter_month: str = None) -> List[Dict[str, object]]:
    """Compare latest vs past high in each group, return list sorted by pct desc."""
    compared = []
    for txns in groups.values():
        txns_sorted = sorted(txns, key=lambda x: (x["deal_date"], -x["price_man"]), reverse=True)
        if filter_month:
            latest_candidates = [t for t in txns_sorted if t["deal_date"][:7].replace("-", "") == filter_month]
            if not latest_candidates:
                continue
            latest = latest_candidates[0]
        else:
            latest = txns_sorted[0]
        # Find past high: max price among all transactions before the latest date
        prev_txns = [t for t in txns_sorted if t["deal_date"] < latest["deal_date"] and t["price_man"]]
        if not prev_txns:
            continue
        prev = max(prev_txns, key=lambda x: x["price_man"])
        if not prev["price_man"]:
            continue
        change = latest["price_man"] - prev["price_man"]
        pct = (change / prev["price_man"]) * 100
        if pct <= 0:
            continue
        entry = {
            "apt_name": latest["apt_name"],
            "sigungu": latest.get("sigungu", ""),
            "dong_name": latest["dong_name"],
            "area_m2": latest["area_m2"],
            "latest_date": latest["deal_date"],
            "latest_price": latest["price_man"],
            "prev_date": prev["deal_date"],
            "prev_price": prev["price_man"],
            "change": change,
            "pct": round(pct, 2),
            "history": build_history(txns),
        }
        compared.append(entry)
    compared.sort(key=lambda x: -x["pct"])
    return compared


def section1_top3(records: List[Dict[str, object]], current_month: str) -> Dict[str, object]:
    """이번달 거래 중 상승률 TOP 3. 데이터 부족 시 전월 fallback."""
    groups: Dict[str, List[Dict[str, object]]] = {}
    for r in records:
        key = f"{r['apt_name']}\t{r['area_m2']}"
        groups.setdefault(key, []).append(r)

    compared = _compare_groups(groups, filter_month=current_month)
    month_label = current_month
    if len(compared) < 3:
        # fallback to previous month
        dt = datetime.strptime(current_month, "%Y%m") - relativedelta(months=1)
        prev_month = dt.strftime("%Y%m")
        compared_prev = _compare_groups(groups, filter_month=prev_month)
        if len(compared_prev) > len(compared):
            compared = compared_prev
            month_label = prev_month

    return {
        "title": "이번달 직전 3년 최고가 대비 상승률 TOP 3",
        "month": month_label,
        "top3": compared[:3],
    }


def section2_top3(records: List[Dict[str, object]], min_trades: int = 20) -> Dict[str, object]:
    """3년간 거래량 min_trades건 이상 단지 중 상승률 TOP 3."""
    groups: Dict[str, List[Dict[str, object]]] = {}
    for r in records:
        key = f"{r['apt_name']}\t{r['area_m2']}"
        groups.setdefault(key, []).append(r)

    # Filter to groups with enough trades
    filtered = {k: v for k, v in groups.items() if len(v) >= min_trades}
    compared = _compare_groups(filtered)

    # Add total_trades to each entry
    for entry in compared:
        key = f"{entry['apt_name']}\t{entry['area_m2']}"
        entry["total_trades"] = len(groups.get(key, []))

    return {
        "title": "거래량 %d건 이상 단지 직전 3년 최고가 대비 상승률 TOP 3" % min_trades,
        "top3": compared[:3],
    }


def section3_top3(records: List[Dict[str, object]], today_str: str) -> Dict[str, object]:
    """오늘 거래 중 상승률 TOP 3. 오늘 데이터 없으면 가장 최근 거래일 fallback."""
    groups: Dict[str, List[Dict[str, object]]] = {}
    for r in records:
        key = f"{r['apt_name']}\t{r['area_m2']}"
        groups.setdefault(key, []).append(r)

    # Find latest deal_date in the dataset
    all_dates = sorted(set(r["deal_date"] for r in records), reverse=True)
    target_date = today_str
    if today_str not in all_dates:
        target_date = all_dates[0] if all_dates else today_str

    # Filter: latest transaction must be on target_date
    compared = []
    for txns in groups.values():
        txns_sorted = sorted(txns, key=lambda x: (x["deal_date"], -x["price_man"]), reverse=True)
        latest = txns_sorted[0]
        if latest["deal_date"] != target_date:
            continue
        prev_txns = [t for t in txns_sorted if t["deal_date"] < latest["deal_date"] and t["price_man"]]
        if not prev_txns:
            continue
        prev = max(prev_txns, key=lambda x: x["price_man"])
        if not prev["price_man"]:
            continue
        change = latest["price_man"] - prev["price_man"]
        pct = (change / prev["price_man"]) * 100
        if pct <= 0:
            continue
        compared.append({
            "apt_name": latest["apt_name"],
            "sigungu": latest.get("sigungu", ""),
            "dong_name": latest["dong_name"],
            "area_m2": latest["area_m2"],
            "latest_date": latest["deal_date"],
            "latest_price": latest["price_man"],
            "prev_date": prev["deal_date"],
            "prev_price": prev["price_man"],
            "change": change,
            "pct": round(pct, 2),
            "history": build_history(txns),
        })
    compared.sort(key=lambda x: -x["pct"])

    return {
        "title": "오늘의 실거래",
        "date": target_date,
        "top3": compared,
    }


def _district_group(sido: str, sigungu_name: str) -> str:
    """서울은 구 그대로, 경기는 시 단위로 묶기, 나머지는 그대로."""
    if sido == "경기":
        m = re.match(r'^(.+시).+[구군]$', sigungu_name)
        if m:
            return m.group(1)
    return sigungu_name


def build_summary(lawd_list: List[str], months_kept: int, total_txns: int) -> None:
    """Read saved JSON files and write summary.json with 시도-level + district sections."""
    # Group lawd codes by sido
    sido_lawds: Dict[str, List[str]] = {}
    for lawd_cd in lawd_list:
        sido = sido_for_lawd(lawd_cd)
        if sido:
            sido_lawds.setdefault(sido, []).append(lawd_cd)

    today = datetime.utcnow().date()
    current_month = today.strftime("%Y%m")
    today_str = today.strftime("%Y-%m-%d")

    sidos: Dict[str, Dict] = {}
    for sido, codes in sido_lawds.items():
        records = gather_sido_records(codes)

        # District grouping
        dist_groups: Dict[str, List[str]] = {}
        for lawd_cd in codes:
            name = lawd_name(lawd_cd)
            group = _district_group(sido, name)
            dist_groups.setdefault(group, []).append(lawd_cd)

        district_order = sorted(dist_groups.keys())
        districts: Dict[str, Dict] = {}
        for group_name, group_codes in dist_groups.items():
            group_set = set(group_codes)
            dist_records = [r for r in records if r["lawd_cd"] in group_set]
            if not dist_records:
                continue
            districts[group_name] = {
                "section1": section1_top3(dist_records, current_month),
                "section2": section2_top3(dist_records),
                "section3": section3_top3(dist_records, today_str),
            }

        sidos[sido] = {
            "section1": section1_top3(records, current_month),
            "section2": section2_top3(records),
            "section3": section3_top3(records, today_str),
            "district_order": district_order,
            "districts": districts,
        }

    summary = {
        "updated_at": iso_now_utc(),
        "months_kept": months_kept,
        "total_txns": total_txns,
        "current_month": current_month,
        "sido_order": [s for s in SIDO_ORDER if s in sidos],
        "sidos": sidos,
    }
    write_json(SUMMARY_PATH, summary)


def main() -> int:
    service_key = os.getenv("MOLIT_SERVICE_KEY")
    if not service_key:
        print("MOLIT_SERVICE_KEY is not set", file=sys.stderr)
        return 1

    operation_path = os.getenv("APT_TRADE_OPERATION_PATH", DEFAULT_OPERATION_PATH)
    months_kept = int(os.getenv("MONTHS_KEPT", "84"))
    refresh_months = int(os.getenv("REFRESH_MONTHS", "3"))
    lawd_list = load_lawd_list()
    months = month_list(months_kept)
    refresh_set = set(month_list(refresh_months))

    ensure_dirs()
    cleanup_old_files(lawd_list, months)

    index_files = []
    total_jobs = len(lawd_list) * len(months)
    done = 0
    fetched = 0
    skipped = 0
    errors = 0
    consecutive_errors = 0
    rate_limited = False
    for lawd_cd in lawd_list:
        for deal_ym in months:
            done += 1
            out_path = BY_LAWD_DIR / lawd_cd / f"{deal_ym}.json"
            name = lawd_name(lawd_cd)

            # Skip: file exists and not in refresh window
            if out_path.exists() and deal_ym not in refresh_set:
                with out_path.open("r", encoding="utf-8") as fp:
                    existing = json.load(fp)
                index_files.append({
                    "lawd_cd": lawd_cd,
                    "deal_ym": deal_ym,
                    "count": len(existing),
                    "path": f"data/apt_trade/by_lawd/{lawd_cd}/{deal_ym}.json",
                })
                skipped += 1
                continue

            # If rate-limited, skip remaining API calls but keep existing data
            if rate_limited:
                if out_path.exists():
                    with out_path.open("r", encoding="utf-8") as fp:
                        existing = json.load(fp)
                    index_files.append({
                        "lawd_cd": lawd_cd,
                        "deal_ym": deal_ym,
                        "count": len(existing),
                        "path": f"data/apt_trade/by_lawd/{lawd_cd}/{deal_ym}.json",
                    })
                skipped += 1
                continue

            print(f"[{done}/{total_jobs}] {lawd_cd} ({name}) {deal_ym}", flush=True)
            try:
                records = fetch_month(service_key, lawd_cd, deal_ym, operation_path)
                consecutive_errors = 0
            except Exception as e:
                print(f"  ERROR: {e} - skipping", flush=True)
                errors += 1
                consecutive_errors += 1
                if consecutive_errors >= 3:
                    print("  3 consecutive errors - stopping API calls, keeping existing data", flush=True)
                    rate_limited = True
                # Keep existing file if available
                if out_path.exists():
                    with out_path.open("r", encoding="utf-8") as fp:
                        existing = json.load(fp)
                    index_files.append({
                        "lawd_cd": lawd_cd,
                        "deal_ym": deal_ym,
                        "count": len(existing),
                        "path": f"data/apt_trade/by_lawd/{lawd_cd}/{deal_ym}.json",
                    })
                continue
            write_json(out_path, records)
            index_files.append({
                "lawd_cd": lawd_cd,
                "deal_ym": deal_ym,
                "count": len(records),
                "path": f"data/apt_trade/by_lawd/{lawd_cd}/{deal_ym}.json",
            })
            fetched += 1

    print(f"Done: fetched={fetched}, skipped={skipped}, errors={errors}", flush=True)

    index = {
        "updated_at": iso_now_utc(),
        "months_kept": months_kept,
        "lawd_list": lawd_list,
        "files": index_files,
    }
    write_json(INDEX_PATH, index)

    total_txns = sum(e["count"] for e in index_files)
    build_summary(lawd_list, months_kept, total_txns)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

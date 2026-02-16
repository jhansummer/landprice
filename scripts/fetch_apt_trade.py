#!/usr/bin/env python3
import hashlib
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

RENT_BASE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent"
RENT_OPERATION_PATH = "getRTMSDataSvcAptRent"
BY_RENT_DIR = None  # set in ensure_dirs()
RENT_MONTHS_KEPT = 84

DOCS_DIR = Path(__file__).resolve().parents[1] / "docs"
DATA_DIR = DOCS_DIR / "data" / "apt_trade"
BY_LAWD_DIR = DATA_DIR / "by_lawd"
BY_APT_DIR = DATA_DIR / "by_apt"
INDEX_PATH = DATA_DIR / "index.json"
SUMMARY_PATH = DATA_DIR / "summary.json"
SEARCH_INDEX_PATH = DATA_DIR / "search_index.json"


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
            "deal_type": (item.findtext("dealType") or item.findtext("거래유형") or "").strip(),
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

    deal_type = raw.get("deal_type", "")

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
        "deal_type": deal_type,
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


def parse_rent_items(xml_bytes: bytes) -> Tuple[List[Dict[str, str]], Dict[str, str]]:
    root = etree.fromstring(xml_bytes)
    header = root.find(".//header")
    result = {
        "resultCode": header.findtext("resultCode") if header is not None else None,
        "resultMsg": header.findtext("resultMsg") if header is not None else None,
    }
    items = []
    for item in root.findall(".//item"):
        monthly_rent = (item.findtext("monthlyRent") or item.findtext("월세금액") or "0").strip()
        # 순수 전세만 (월세=0)
        if monthly_rent.replace(",", "").strip() not in ("", "0"):
            continue
        items.append({
            "apt_name": (item.findtext("aptNm") or item.findtext("아파트") or "").strip(),
            "deal_year": (item.findtext("dealYear") or item.findtext("년") or "").strip(),
            "deal_month": (item.findtext("dealMonth") or item.findtext("월") or "").strip(),
            "deal_day": (item.findtext("dealDay") or item.findtext("일") or "").strip(),
            "deposit": (item.findtext("deposit") or item.findtext("보증금액") or "").strip(),
            "area": (item.findtext("excluUseAr") or item.findtext("전용면적") or "").strip(),
            "floor": (item.findtext("floor") or item.findtext("층") or "").strip(),
            "build_year": (item.findtext("buildYear") or item.findtext("건축년도") or "").strip(),
            "dong_name": (item.findtext("umdNm") or item.findtext("법정동") or "").strip(),
            "jibun": (item.findtext("jibun") or item.findtext("지번") or "").strip(),
        })
    return items, result


def normalize_rent_item(raw: Dict[str, str], lawd_cd: str, deal_ym: str) -> Dict[str, object]:
    year = int(raw["deal_year"]) if raw["deal_year"] else int(deal_ym[:4])
    month = int(raw["deal_month"]) if raw["deal_month"] else int(deal_ym[4:6])
    day = int(raw["deal_day"]) if raw["deal_day"] else 1
    deposit = int(raw["deposit"].replace(",", "")) if raw["deposit"] else 0
    area = float(raw["area"]) if raw["area"] else 0.0
    floor = int(raw["floor"]) if raw["floor"] else 0
    build_year = int(raw["build_year"]) if raw["build_year"] else 0
    return {
        "lawd_cd": lawd_cd,
        "deal_ym": deal_ym,
        "apt_name": raw["apt_name"],
        "deal_date": f"{year:04d}-{month:02d}-{day:02d}",
        "deposit_man": deposit,
        "area_m2": area,
        "floor": floor,
        "build_year": build_year,
        "dong_name": raw["dong_name"],
        "jibun": raw["jibun"],
    }


def fetch_rent_month(service_key: str, lawd_cd: str, deal_ym: str) -> List[Dict[str, object]]:
    records: List[Dict[str, object]] = []
    seen = set()
    page_no = 1
    while True:
        params = build_params(service_key, lawd_cd, deal_ym, page_no)
        url = f"{RENT_BASE_URL}/{RENT_OPERATION_PATH}"
        resp = None
        for attempt in range(8):
            try:
                resp = requests.get(url, params=params, timeout=30)
                if resp.status_code == 429:
                    wait = min(60, 15 * (attempt + 1))
                    print(f"  429 rent rate-limited, waiting {wait}s (attempt {attempt+1}/8)", flush=True)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException:
                if attempt == 7:
                    raise
                time.sleep(5 * (attempt + 1))
        if resp is None or resp.status_code == 429:
            raise RuntimeError("Rent API rate limit exceeded after 8 retries")
        items, result = parse_rent_items(resp.content)
        if result.get("resultCode") and result.get("resultCode") not in ("00", "000"):
            raise RuntimeError(f"Rent API error {result.get('resultCode')}: {result.get('resultMsg')}")
        if not items:
            break
        for raw in items:
            norm = normalize_rent_item(raw, lawd_cd, deal_ym)
            key = (norm["apt_name"], norm["deal_date"], norm["deposit_man"], norm["area_m2"], norm["floor"])
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
    global BY_RENT_DIR
    BY_LAWD_DIR.mkdir(parents=True, exist_ok=True)
    BY_RENT_DIR = DATA_DIR / "by_rent"
    BY_RENT_DIR.mkdir(parents=True, exist_ok=True)


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
    """Convert transactions to [[date, price], ...] sorted by date, last 7 years only."""
    cutoff = (datetime.utcnow() - relativedelta(years=7)).strftime("%Y-%m-%d")
    txns.sort(key=lambda x: x["deal_date"])
    return [[t["deal_date"], t["price_man"]] for t in txns if t["deal_date"] >= cutoff]


def _compare_groups(groups: Dict[str, List[Dict[str, object]]], filter_month: str = None, filter_months: set = None) -> List[Dict[str, object]]:
    """Compare latest vs prior all-time high in each group, return list sorted by pct desc."""
    compared = []
    for txns in groups.values():
        txns_sorted = sorted(txns, key=lambda x: (x["deal_date"], -x["price_man"]), reverse=True)
        if filter_months:
            latest_candidates = [t for t in txns_sorted if t["deal_date"][:7].replace("-", "") in filter_months]
            if not latest_candidates:
                continue
            latest = latest_candidates[0]
        elif filter_month:
            latest_candidates = [t for t in txns_sorted if t["deal_date"][:7].replace("-", "") == filter_month]
            if not latest_candidates:
                continue
            latest = latest_candidates[0]
        else:
            latest = txns_sorted[0]
        # 직전 신고가: latest 이전 전체 기간 중 최고가
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
        apt_id = hashlib.md5(f"{latest.get('sigungu','')}\t{latest['apt_name']}\t{latest['area_m2']}".encode()).hexdigest()[:10]
        history = build_history(txns)
        if history:
            apt_path = BY_APT_DIR / f"{apt_id}.json"
            write_json(apt_path, history)
        entry = {
            "id": apt_id,
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
            "floor": latest.get("floor", 0),
            "deal_type": latest.get("deal_type", ""),
            "history": history,
        }
        compared.append(entry)
    compared.sort(key=lambda x: -x["pct"])
    return compared


def section1_top3(records: List[Dict[str, object]], current_month: str,
                   new_records: List[Dict[str, object]] = None) -> Dict[str, object]:
    """오늘의 실거래 TOP 3. new_records가 있으면 신규 거래 기준, 없으면 전체 최신 거래 기준."""
    # 전체 거래를 그룹핑 (직전 최고가 비교용)
    all_groups: Dict[str, List[Dict[str, object]]] = {}
    for r in records:
        key = f"{r['apt_name']}\t{r['area_m2']}"
        all_groups.setdefault(key, []).append(r)

    if new_records:
        # 신규 거래만으로 비교: 각 신규 거래의 직전 최고가를 전체 이력에서 찾음
        compared = []
        new_groups: Dict[str, List[Dict[str, object]]] = {}
        for r in new_records:
            key = f"{r['apt_name']}\t{r['area_m2']}"
            new_groups.setdefault(key, []).append(r)

        for key, new_txns in new_groups.items():
            all_txns = all_groups.get(key, new_txns)
            new_txns_sorted = sorted(new_txns, key=lambda x: (x["deal_date"], -x["price_man"]), reverse=True)
            latest = new_txns_sorted[0]

            # 직전 최고가: latest 이전 전체 기간 중 최고가
            prev_txns = [t for t in all_txns if t["deal_date"] < latest["deal_date"] and t["price_man"]]
            if not prev_txns:
                continue
            prev = max(prev_txns, key=lambda x: x["price_man"])
            if not prev["price_man"]:
                continue
            change = latest["price_man"] - prev["price_man"]
            pct = (change / prev["price_man"]) * 100
            if pct <= 0:
                continue

            apt_id = hashlib.md5(f"{latest.get('sigungu','')}\t{latest['apt_name']}\t{latest['area_m2']}".encode()).hexdigest()[:10]
            history = build_history(all_txns)
            if history:
                apt_path = BY_APT_DIR / f"{apt_id}.json"
                write_json(apt_path, history)

            compared.append({
                "id": apt_id,
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
                "floor": latest.get("floor", 0),
                "deal_type": latest.get("deal_type", ""),
                "history": history,
            })
        compared.sort(key=lambda x: -x["pct"])
    else:
        # 폴백: 전체 최신 거래 기준
        compared = _compare_groups(all_groups)

    return {
        "title": "오늘의 실거래 TOP 3",
        "top3": compared[:3],
    }


def section2_top3(records: List[Dict[str, object]], current_month: str, min_trades: int = 20) -> Dict[str, object]:
    """거래량 min_trades건 이상 단지 중 상승률 TOP 3."""
    groups: Dict[str, List[Dict[str, object]]] = {}
    for r in records:
        key = f"{r['apt_name']}\t{r['area_m2']}"
        groups.setdefault(key, []).append(r)

    # Filter: 20건 이상
    filtered = {k: v for k, v in groups.items() if len(v) >= min_trades}

    compared = _compare_groups(filtered)

    # Add total_trades to each entry
    for entry in compared:
        key = f"{entry['apt_name']}\t{entry['area_m2']}"
        entry["total_trades"] = len(groups.get(key, []))

    return {
        "title": "오늘의 실거래(거래 %d건이상 단지) TOP 3" % min_trades,
        "top3": compared[:3],
    }


def section3_3m_top3(records: List[Dict[str, object]], current_month: str) -> Dict[str, object]:
    """최근 3개월 거래 중 상승률 TOP 3."""
    dt = datetime.strptime(current_month, "%Y%m")
    months_3 = set()
    for i in range(3):
        m = dt - relativedelta(months=i)
        months_3.add(m.strftime("%Y%m"))

    groups: Dict[str, List[Dict[str, object]]] = {}
    for r in records:
        key = f"{r['apt_name']}\t{r['area_m2']}"
        groups.setdefault(key, []).append(r)

    compared = _compare_groups(groups, filter_months=months_3)
    return {
        "title": "3개월내 실거래 TOP 3",
        "top3": compared[:3],
    }


def section4_3m_min_trades(records: List[Dict[str, object]], current_month: str, min_trades: int = 20) -> Dict[str, object]:
    """최근 3개월 거래, 거래 20건 이상 단지 상승률 TOP 3."""
    dt = datetime.strptime(current_month, "%Y%m")
    months_3 = set()
    for i in range(3):
        m = dt - relativedelta(months=i)
        months_3.add(m.strftime("%Y%m"))

    groups: Dict[str, List[Dict[str, object]]] = {}
    for r in records:
        key = f"{r['apt_name']}\t{r['area_m2']}"
        groups.setdefault(key, []).append(r)

    filtered = {}
    for k, v in groups.items():
        if len(v) < min_trades:
            continue
        filtered[k] = v

    compared = _compare_groups(filtered, filter_months=months_3)
    for entry in compared:
        key = f"{entry['apt_name']}\t{entry['area_m2']}"
        entry["total_trades"] = len(groups.get(key, []))

    return {
        "title": "3개월내 실거래(거래 %d건이상 단지) TOP 3" % min_trades,
        "top3": compared[:3],
    }


def build_trend_data(records: List[Dict[str, object]]) -> List[List]:
    """월별 평균 m²당 가격 + 거래량 시계열. [[yyyymm, avg_per_m2, count], ...]"""
    by_month: Dict[str, List] = {}
    for r in records:
        ym = r["deal_ym"]
        if r["area_m2"] and r["area_m2"] > 0 and r["price_man"]:
            by_month.setdefault(ym, []).append(r["price_man"] / r["area_m2"])
    trend = []
    for ym in sorted(by_month.keys()):
        prices = by_month[ym]
        trend.append([ym, round(sum(prices) / len(prices), 1), len(prices)])
    return trend


def _pearson(a: List[float], b: List[float]):
    n = len(a)
    if n < 24:
        return None
    ma = sum(a) / n
    mb = sum(b) / n
    da = [x - ma for x in a]
    db = [x - mb for x in b]
    va = sum(x * x for x in da)
    vb = sum(x * x for x in db)
    if va <= 0 or vb <= 0:
        return None
    import math
    return sum(x * y for x, y in zip(da, db)) / math.sqrt(va * vb)


def _cross_corr(a: List[float], b: List[float], lag: int):
    """a를 lag만큼 앞당겼을 때 b와의 상관. lag>0 => a 선행."""
    if lag >= 0:
        sa, sb = a[lag:], b[:len(a) - lag]
    else:
        sb, sa = b[-lag:], a[:len(b) + lag]
    paired = [(x, y) for x, y in zip(sa, sb) if x is not None and y is not None]
    if len(paired) < 24:
        return None
    return _pearson([p[0] for p in paired], [p[1] for p in paired])


def build_lead_lag(sido_data: Dict) -> List[Dict]:
    """구별 trend 데이터로 시차(교차상관) 분석. 정규화 레벨 기반."""
    districts = sido_data.get("districts", {})
    if len(districts) < 3:
        return []

    # 구별 정규화 시세 추출
    norm_series: Dict[str, List[float]] = {}
    for dname, ddata in districts.items():
        trend = ddata.get("trend", [])
        if len(trend) < 48:
            continue
        prices = [t[1] for t in trend]
        mn, mx = min(prices), max(prices)
        r = mx - mn if mx != mn else 1
        norm_series[dname] = [(p - mn) / r for p in prices]

    names = sorted(norm_series.keys())
    if len(names) < 3:
        return []

    MAX_LAG = 12
    edges = []
    for i, a_name in enumerate(names):
        for j in range(i + 1, len(names)):
            b_name = names[j]
            a_s, b_s = norm_series[a_name], norm_series[b_name]
            c0 = _cross_corr(a_s, b_s, 0)
            best_lag, best_corr = 0, c0 if c0 is not None else -1
            for lag in range(-MAX_LAG, MAX_LAG + 1):
                if lag == 0:
                    continue
                c = _cross_corr(a_s, b_s, lag)
                if c is not None and c > best_corr:
                    best_corr, best_lag = c, lag
            improvement = (best_corr - (c0 or 0)) if best_lag != 0 else 0
            if best_lag != 0 and improvement > 0.02 and best_corr >= 0.4:
                leader = a_name if best_lag > 0 else b_name
                follower = b_name if best_lag > 0 else a_name
                edges.append({
                    "from": leader,
                    "to": follower,
                    "lag": abs(best_lag),
                    "corr": round(best_corr, 3),
                })

    edges.sort(key=lambda e: (-e["corr"], -e["lag"]))
    return edges[:40]


def build_apt_lead_lag(records: List[Dict[str, object]], current_month: str) -> List[Dict]:
    """단지별 시세 선행/후행 관계 분석. 거래량 상위 단지 대상."""
    dt = datetime.strptime(current_month, "%Y%m")
    months_36 = set()
    for i in range(36):
        m = dt - relativedelta(months=i)
        months_36.add(m.strftime("%Y%m"))

    # 전체 기간 월 목록
    all_yms = sorted(set(r["deal_ym"] for r in records))
    if len(all_yms) < 36:
        return []
    ym_idx = {ym: i for i, ym in enumerate(all_yms)}

    # 단지별 월별 m²단가 시계열 구축 (apt_name + area_m2 조합을 키로)
    apt_series: Dict[str, Dict] = {}  # key -> {name, series, count}
    for r in records:
        if not r.get("area_m2") or r["area_m2"] <= 0 or not r.get("price_man"):
            continue
        key = f"{r.get('apt_name', '')}\t{r.get('area_m2', 0)}"
        if key not in apt_series:
            apt_series[key] = {
                "name": r.get("apt_name", ""),
                "dong": r.get("dong_name", ""),
                "area": r.get("area_m2", 0),
                "by_month": {},
                "count_36": 0,
            }
        ym = r["deal_ym"]
        price_m2 = r["price_man"] / r["area_m2"]
        apt_series[key]["by_month"].setdefault(ym, []).append(price_m2)
        if ym in months_36:
            apt_series[key]["count_36"] += 1

    # 36개월 거래 8건 이상만, 상위 15개
    candidates = [(k, v) for k, v in apt_series.items() if v["count_36"] >= 8]
    candidates.sort(key=lambda x: -x[1]["count_36"])
    candidates = candidates[:15]

    if len(candidates) < 3:
        return []

    # 월별 평균 시계열 → 정규화
    def make_norm_series(by_month):
        series = []
        for ym in all_yms:
            vals = by_month.get(ym)
            series.append(sum(vals) / len(vals) if vals else None)
        # forward fill
        last = None
        for i in range(len(series)):
            if series[i] is None:
                series[i] = last
            else:
                last = series[i]
        vals = [v for v in series if v is not None]
        if len(vals) < 36:
            return None
        mn, mx = min(vals), max(vals)
        r = mx - mn if mx != mn else 1
        return [(v - mn) / r if v is not None else None for v in series]

    norm_map = {}
    label_map = {}
    for key, info in candidates:
        ns = make_norm_series(info["by_month"])
        if ns:
            short = info["name"]
            if len(short) > 8:
                short = short[:7] + ".."
            label = short + " " + str(round(info["area"], 0)).replace(".0", "") + "m²"
            norm_map[key] = ns
            label_map[key] = label

    keys = list(norm_map.keys())
    if len(keys) < 3:
        return []

    MAX_LAG = 6
    edges = []
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a_s, b_s = norm_map[keys[i]], norm_map[keys[j]]
            c0 = _cross_corr(a_s, b_s, 0)
            best_lag, best_corr = 0, c0 if c0 is not None else -1
            for lag in range(-MAX_LAG, MAX_LAG + 1):
                if lag == 0:
                    continue
                c = _cross_corr(a_s, b_s, lag)
                if c is not None and c > best_corr:
                    best_corr, best_lag = c, lag
            improvement = (best_corr - (c0 or 0)) if best_lag != 0 else 0
            if best_lag != 0 and improvement > 0.02 and best_corr >= 0.4:
                li = i if best_lag > 0 else j
                fi = j if best_lag > 0 else i
                edges.append({
                    "from": label_map[keys[li]],
                    "to": label_map[keys[fi]],
                    "lag": abs(best_lag),
                    "corr": round(best_corr, 3),
                })

    edges.sort(key=lambda e: (-e["corr"], -e["lag"]))
    return edges[:20]


def build_dong_stats(records: List[Dict[str, object]], current_month: str) -> List[Dict[str, object]]:
    """최근 3개월 동별 평균 m²당 가격 통계."""
    dt = datetime.strptime(current_month, "%Y%m")
    months_3 = set()
    for i in range(3):
        m = dt - relativedelta(months=i)
        months_3.add(m.strftime("%Y%m"))

    by_dong: Dict[str, List] = {}
    for r in records:
        if r["deal_ym"] not in months_3:
            continue
        if not r["area_m2"] or r["area_m2"] <= 0 or not r["price_man"]:
            continue
        by_dong.setdefault(r["dong_name"], []).append(r)

    stats = []
    for dong, txns in by_dong.items():
        prices_per_m2 = [t["price_man"] / t["area_m2"] for t in txns]
        prices = sorted([t["price_man"] for t in txns])
        median_price = prices[len(prices) // 2]
        stats.append({
            "dong_name": dong,
            "avg_per_m2": round(sum(prices_per_m2) / len(prices_per_m2), 1),
            "txn_count": len(txns),
            "median_price": median_price,
        })
    stats.sort(key=lambda x: -x["avg_per_m2"])
    return stats


def build_jeonse_summary(rent_records: List[Dict[str, object]],
                          sale_records: List[Dict[str, object]]) -> Dict[str, object]:
    """전세가율 계산. 최신 전세 vs 최신 매매가 비교."""
    # 매매 최신가 {(apt_name, area_m2): price_man}
    sale_latest: Dict[Tuple, int] = {}
    sale_sorted = sorted(sale_records, key=lambda x: x["deal_date"], reverse=True)
    for r in sale_sorted:
        key = (r["apt_name"], r["area_m2"])
        if key not in sale_latest and r["price_man"]:
            sale_latest[key] = r["price_man"]

    # 전세 최신가 {(apt_name, area_m2): deposit_man}
    rent_latest: Dict[Tuple, int] = {}
    rent_sorted = sorted(rent_records, key=lambda x: x["deal_date"], reverse=True)
    for r in rent_sorted:
        key = (r["apt_name"], r["area_m2"])
        if key not in rent_latest and r["deposit_man"]:
            rent_latest[key] = r["deposit_man"]

    # 매칭
    ratios = []
    sample_apts = []
    for key, deposit in rent_latest.items():
        sale_price = sale_latest.get(key)
        if not sale_price or sale_price <= 0:
            continue
        ratio = (deposit / sale_price) * 100
        if ratio > 120 or ratio < 10:
            continue  # 이상치 제외
        ratios.append(ratio)
        if len(sample_apts) < 10:
            sample_apts.append({
                "apt_name": key[0],
                "area_m2": key[1],
                "sale_price": sale_price,
                "jeonse_price": deposit,
                "ratio": round(ratio, 1),
            })

    if not ratios:
        return {}

    avg_ratio = round(sum(ratios) / len(ratios), 1)
    sample_apts.sort(key=lambda x: x["ratio"])
    return {
        "avg_ratio": avg_ratio,
        "count": len(ratios),
        "sample_apts": sample_apts[:5],
    }


def build_jeonse_trend(rent_records: List[Dict[str, object]],
                        sale_records: List[Dict[str, object]]) -> List[List]:
    """월별 전세가율 시계열. [[yyyymm, avg_ratio, count], ...]
    각 월의 전세가율 = 해당 월 전세거래 보증금 / 동일 단지·면적 최근 매매가 * 100
    """
    # 매매 이력: (apt_name, area_m2) → [(deal_date, price_man), ...] sorted by date
    sale_by_key: Dict[Tuple, List[Tuple[str, int]]] = {}
    for r in sale_records:
        if r["price_man"] and r["area_m2"]:
            key = (r["apt_name"], r["area_m2"])
            sale_by_key.setdefault(key, []).append((r["deal_date"], r["price_man"]))
    for v in sale_by_key.values():
        v.sort()

    # 전세 월별 그룹핑
    rent_by_month: Dict[str, List] = {}
    for r in rent_records:
        if not r["deposit_man"] or not r["area_m2"]:
            continue
        ym = r["deal_ym"]
        rent_by_month.setdefault(ym, []).append(r)

    trend = []
    for ym in sorted(rent_by_month.keys()):
        ratios = []
        for r in rent_by_month[ym]:
            key = (r["apt_name"], r["area_m2"])
            sale_history = sale_by_key.get(key)
            if not sale_history:
                continue
            # 해당 전세 거래일 이전 가장 가까운 매매가 찾기
            rent_date = r["deal_date"]
            sale_price = None
            for sd, sp in reversed(sale_history):
                if sd <= rent_date:
                    sale_price = sp
                    break
            if not sale_price:
                # 전세 거래일 이후의 첫 매매가 사용 (fallback)
                for sd, sp in sale_history:
                    if sd >= rent_date:
                        sale_price = sp
                        break
            if not sale_price or sale_price <= 0:
                continue
            ratio = (r["deposit_man"] / sale_price) * 100
            if 10 <= ratio <= 120:
                ratios.append(ratio)
        if ratios:
            avg_ratio = round(sum(ratios) / len(ratios), 1)
            trend.append([ym, avg_ratio, len(ratios)])
    return trend


def gather_rent_records(lawd_codes: List[str]) -> List[Dict[str, object]]:
    """Load saved rent JSON files."""
    if BY_RENT_DIR is None:
        return []
    records: List[Dict[str, object]] = []
    for lawd_cd in lawd_codes:
        lawd_dir = BY_RENT_DIR / lawd_cd
        if not lawd_dir.exists():
            continue
        for f in sorted(lawd_dir.glob("*.json")):
            with f.open("r", encoding="utf-8") as fp:
                for r in json.load(fp):
                    r["sigungu"] = lawd_name(lawd_cd)
                    records.append(r)
    return records


def section3_recent(records: List[Dict[str, object]], current_month: str, limit: int = 0) -> Dict[str, object]:
    """최근 3개월내 거래 중 5년 최고가 대비 상승률. limit>0이면 상위 N건만."""
    dt = datetime.strptime(current_month, "%Y%m")
    months_3 = set()
    for i in range(3):
        m = dt - relativedelta(months=i)
        months_3.add(m.strftime("%Y%m"))

    groups: Dict[str, List[Dict[str, object]]] = {}
    for r in records:
        key = f"{r['apt_name']}\t{r['area_m2']}"
        groups.setdefault(key, []).append(r)

    compared = []
    for txns in groups.values():
        txns_sorted = sorted(txns, key=lambda x: (x["deal_date"], -x["price_man"]), reverse=True)
        # 최근 3개월내 최신 거래
        latest = None
        for t in txns_sorted:
            if t["deal_date"][:7].replace("-", "") in months_3:
                latest = t
                break
        if not latest:
            continue
        cutoff_5y = (datetime.strptime(latest["deal_date"][:10], "%Y-%m-%d") - relativedelta(years=5)).strftime("%Y-%m-%d")
        prev_txns = [t for t in txns_sorted if cutoff_5y <= t["deal_date"] < latest["deal_date"] and t["price_man"]]
        if not prev_txns:
            continue
        prev = max(prev_txns, key=lambda x: x["price_man"])
        if not prev["price_man"]:
            continue
        change = latest["price_man"] - prev["price_man"]
        pct = (change / prev["price_man"]) * 100
        apt_id = hashlib.md5(f"{latest.get('sigungu','')}\t{latest['apt_name']}\t{latest['area_m2']}".encode()).hexdigest()[:10]
        history = build_history(txns)

        # 개별 history 파일 저장
        if history:
            apt_path = BY_APT_DIR / f"{apt_id}.json"
            write_json(apt_path, history)

        compared.append({
            "id": apt_id,
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
            "floor": latest.get("floor", 0),
            "deal_type": latest.get("deal_type", ""),
        })
    compared.sort(key=lambda x: -x["pct"])

    return {
        "title": "최근 3개월 실거래",
        "top3": compared[:limit] if limit else compared,
    }


def build_search_items(records: List[Dict[str, object]]) -> List[Dict[str, object]]:
    """모든 단지의 최신 거래 vs 5년 내 이전 최고가 비교. 3개월 제한 없음."""
    groups: Dict[str, List[Dict[str, object]]] = {}
    for r in records:
        key = f"{r['apt_name']}\t{r['area_m2']}"
        groups.setdefault(key, []).append(r)

    items = []
    for txns in groups.values():
        txns_sorted = sorted(txns, key=lambda x: (x["deal_date"], -x["price_man"]), reverse=True)
        latest = txns_sorted[0]
        apt_id = hashlib.md5(f"{latest.get('sigungu','')}\t{latest['apt_name']}\t{latest['area_m2']}".encode()).hexdigest()[:10]

        # by_apt 파일 생성
        history = build_history(txns)
        if history:
            apt_path = BY_APT_DIR / f"{apt_id}.json"
            write_json(apt_path, history)

        # 5년 내 이전 최고가 비교
        cutoff_5y = (datetime.strptime(latest["deal_date"][:10], "%Y-%m-%d") - relativedelta(years=5)).strftime("%Y-%m-%d")
        prev_txns = [t for t in txns_sorted if cutoff_5y <= t["deal_date"] < latest["deal_date"] and t["price_man"]]
        if prev_txns:
            prev = max(prev_txns, key=lambda x: x["price_man"])
            change = latest["price_man"] - prev["price_man"]
            pct = (change / prev["price_man"]) * 100 if prev["price_man"] else 0
        else:
            prev = None
            change = 0
            pct = 0

        items.append({
            "id": apt_id,
            "apt_name": latest["apt_name"],
            "sigungu": latest.get("sigungu", ""),
            "dong_name": latest["dong_name"],
            "area_m2": latest["area_m2"],
            "latest_date": latest["deal_date"],
            "latest_price": latest["price_man"],
            "prev_price": prev["price_man"] if prev else latest["price_man"],
            "pct": round(pct, 2),
            "change": change,
            "floor": latest.get("floor", 0),
            "deal_type": latest.get("deal_type", ""),
        })
    items.sort(key=lambda x: -x["pct"])
    return items


def _district_group(sido: str, sigungu_name: str) -> str:
    """서울은 구 그대로, 경기는 시 단위로 묶기, 나머지는 그대로."""
    if sido == "경기":
        m = re.match(r'^(.+시).+[구군]$', sigungu_name)
        if m:
            return m.group(1)
    return sigungu_name


def build_summary(lawd_list: List[str], months_kept: int, total_txns: int,
                   new_records: List[Dict[str, object]] = None) -> None:
    """Read saved JSON files and write summary.json with 시도-level + district sections."""
    # Group lawd codes by sido
    sido_lawds: Dict[str, List[str]] = {}
    for lawd_cd in lawd_list:
        sido = sido_for_lawd(lawd_cd)
        if sido:
            sido_lawds.setdefault(sido, []).append(lawd_cd)

    # new_records를 sido별로 분리
    new_by_sido: Dict[str, List[Dict[str, object]]] = {}
    if new_records:
        for r in new_records:
            sido = sido_for_lawd(r["lawd_cd"])
            if sido:
                new_by_sido.setdefault(sido, []).append(r)

    today = datetime.utcnow().date()
    current_month = today.strftime("%Y%m")
    today_str = today.strftime("%Y-%m-%d")

    sidos: Dict[str, Dict] = {}
    search_sidos: Dict[str, Dict] = {}
    for sido, codes in sido_lawds.items():
        records = gather_sido_records(codes)
        rent_records = gather_rent_records(codes)
        sido_new = new_by_sido.get(sido, [])

        # District grouping
        dist_groups: Dict[str, List[str]] = {}
        for lawd_cd in codes:
            name = lawd_name(lawd_cd)
            group = _district_group(sido, name)
            dist_groups.setdefault(group, []).append(lawd_cd)

        district_order = sorted(dist_groups.keys())
        districts: Dict[str, Dict] = {}
        search_items: List[Dict[str, object]] = []
        seen_ids: set = set()
        for group_name, group_codes in dist_groups.items():
            group_set = set(group_codes)
            dist_records = [r for r in records if r["lawd_cd"] in group_set]
            if not dist_records:
                continue
            # district별 신규 거래 필터링
            dist_new = [r for r in sido_new if r["lawd_cd"] in group_set] if sido_new else []
            dong_names = sorted(set(r["dong_name"] for r in dist_records if r["dong_name"]))
            dist_rent = [r for r in rent_records if r["lawd_cd"] in group_set]
            dist_data = {
                "section1": section1_top3(dist_records, current_month, dist_new or None),
                "section2": section2_top3(dist_records, current_month),
                "section3": section3_3m_top3(dist_records, current_month),
                "section4": section4_3m_min_trades(dist_records, current_month),
                "dong_order": dong_names,
                "trend": build_trend_data(dist_records),
                "dong_stats": build_dong_stats(dist_records, current_month),
            }
            if dist_rent:
                jeonse = build_jeonse_summary(dist_rent, dist_records)
                if jeonse:
                    dist_data["jeonse"] = jeonse
                jeonse_trend = build_jeonse_trend(dist_rent, dist_records)
                if jeonse_trend:
                    dist_data["jeonse_trend"] = jeonse_trend
            # 단지별 선행/후행 관계
            apt_ll = build_apt_lead_lag(dist_records, current_month)
            if apt_ll:
                dist_data["apt_lead_lag"] = apt_ll
            districts[group_name] = dist_data
            # 검색 인덱스 (3개월 제한 없음)
            for item in build_search_items(dist_records):
                item["district"] = group_name
                if item["id"] not in seen_ids:
                    seen_ids.add(item["id"])
                    search_items.append(item)

        sido_data = {
            "section1": section1_top3(records, current_month, sido_new or None),
            "section2": section2_top3(records, current_month),
            "section3": section3_3m_top3(records, current_month),
            "section4": section4_3m_min_trades(records, current_month),
            "district_order": district_order,
            "districts": districts,
            "trend": build_trend_data(records),
        }
        if rent_records:
            jeonse = build_jeonse_summary(rent_records, records)
            if jeonse:
                sido_data["jeonse"] = jeonse
            jeonse_trend = build_jeonse_trend(rent_records, records)
            if jeonse_trend:
                sido_data["jeonse_trend"] = jeonse_trend
        sidos[sido] = sido_data
        search_items.sort(key=lambda x: -x["pct"])
        search_sidos[sido] = {
            "district_order": district_order,
            "items": search_items,
        }

    # 시차(lead-lag) 분석: 구별 시세 선행/후행 관계
    for sido_name, sido_data in sidos.items():
        lead_lag = build_lead_lag(sido_data)
        if lead_lag:
            sido_data["lead_lag"] = lead_lag

    summary = {
        "updated_at": iso_now_utc(),
        "months_kept": months_kept,
        "total_txns": total_txns,
        "current_month": current_month,
        "sido_order": [s for s in SIDO_ORDER if s in sidos],
        "sidos": sidos,
    }
    write_json(SUMMARY_PATH, summary)

    search_index = {
        "updated_at": iso_now_utc(),
        "sido_order": [s for s in SIDO_ORDER if s in search_sidos],
        "sidos": search_sidos,
    }
    write_json(SEARCH_INDEX_PATH, search_index)


def main() -> int:
    summary_only = "--summary-only" in sys.argv

    months_kept = int(os.getenv("MONTHS_KEPT", "84"))

    if summary_only:
        global BY_RENT_DIR
        BY_RENT_DIR = DATA_DIR / "by_rent"
        lawd_list = load_lawd_list()
        # Count existing transactions
        total_txns = 0
        for lawd_cd in lawd_list:
            lawd_dir = BY_LAWD_DIR / lawd_cd
            if not lawd_dir.exists():
                continue
            for f in lawd_dir.glob("*.json"):
                with f.open("r", encoding="utf-8") as fp:
                    total_txns += len(json.load(fp))
        print(f"Rebuilding summary from existing data ({total_txns} txns)...", flush=True)
        build_summary(lawd_list, months_kept, total_txns)
        size = SUMMARY_PATH.stat().st_size
        print(f"summary.json: {size:,} bytes ({size/1024/1024:.1f} MB)", flush=True)
        return 0

    service_key = os.getenv("MOLIT_SERVICE_KEY")
    if not service_key:
        print("MOLIT_SERVICE_KEY is not set", file=sys.stderr)
        return 1

    operation_path = os.getenv("APT_TRADE_OPERATION_PATH", DEFAULT_OPERATION_PATH)
    refresh_months = int(os.getenv("REFRESH_MONTHS", "3"))
    lawd_list = load_lawd_list()
    months = month_list(months_kept)
    refresh_set = set(month_list(refresh_months))

    ensure_dirs()
    cleanup_old_files(lawd_list, months)

    # 리프레시 전 기존 거래 키 수집 (신규 거래 탐지용)
    old_keys: set = set()
    for lawd_cd in lawd_list:
        for deal_ym in refresh_set:
            out_path = BY_LAWD_DIR / lawd_cd / f"{deal_ym}.json"
            if out_path.exists():
                with out_path.open("r", encoding="utf-8") as fp:
                    for r in json.load(fp):
                        old_keys.add(dedupe_key(r))
    print(f"Old keys collected: {len(old_keys):,}", flush=True)

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
            if not records:
                print(f"  {lawd_cd}/{deal_ym}: empty response, skipping save", flush=True)
                continue
            write_json(out_path, records)
            index_files.append({
                "lawd_cd": lawd_cd,
                "deal_ym": deal_ym,
                "count": len(records),
                "path": f"data/apt_trade/by_lawd/{lawd_cd}/{deal_ym}.json",
            })
            fetched += 1

    print(f"Done trade: fetched={fetched}, skipped={skipped}, errors={errors}", flush=True)

    # 전세 데이터 fetch (RENT_MONTHS_KEPT=84 전체 범위, 리프레시는 RENT_REFRESH_MONTHS만)
    rent_refresh_months = int(os.getenv("RENT_REFRESH_MONTHS", "6"))
    rent_months = month_list(RENT_MONTHS_KEPT)
    rent_refresh_set = set(month_list(rent_refresh_months))
    rent_fetched = 0
    rent_skipped = 0
    rent_errors = 0
    rent_consecutive_errors = 0
    rent_rate_limited = False
    total_rent_jobs = len(lawd_list) * len(rent_months)
    rent_done = 0
    for lawd_cd in lawd_list:
        for deal_ym in rent_months:
            rent_done += 1
            rent_dir = BY_RENT_DIR / lawd_cd
            rent_dir.mkdir(parents=True, exist_ok=True)
            out_path = rent_dir / f"{deal_ym}.json"
            name = lawd_name(lawd_cd)

            # 파일 있고 리프레시 대상 아니면 스킵
            if out_path.exists() and deal_ym not in rent_refresh_set:
                rent_skipped += 1
                continue

            if rent_rate_limited:
                rent_skipped += 1
                continue

            print(f"[rent {rent_done}/{total_rent_jobs}] {lawd_cd} ({name}) {deal_ym}", flush=True)
            try:
                rent_recs = fetch_rent_month(service_key, lawd_cd, deal_ym)
                rent_consecutive_errors = 0
            except Exception as e:
                print(f"  RENT ERROR: {e} - skipping", flush=True)
                rent_errors += 1
                rent_consecutive_errors += 1
                if rent_consecutive_errors >= 3:
                    print("  3 consecutive rent errors - stopping rent fetch", flush=True)
                    rent_rate_limited = True
                continue
            if rent_recs:
                write_json(out_path, rent_recs)
                rent_fetched += 1

    print(f"Done rent: fetched={rent_fetched}, skipped={rent_skipped}, errors={rent_errors}", flush=True)

    # 리프레시 후 신규 거래 수집
    new_records: List[Dict[str, object]] = []
    for lawd_cd in lawd_list:
        for deal_ym in refresh_set:
            out_path = BY_LAWD_DIR / lawd_cd / f"{deal_ym}.json"
            if out_path.exists():
                with out_path.open("r", encoding="utf-8") as fp:
                    for r in json.load(fp):
                        if dedupe_key(r) not in old_keys:
                            new_records.append(r)
    print(f"New records found: {len(new_records):,}", flush=True)

    index = {
        "updated_at": iso_now_utc(),
        "months_kept": months_kept,
        "lawd_list": lawd_list,
        "files": index_files,
    }
    write_json(INDEX_PATH, index)

    total_txns = sum(e["count"] for e in index_files)
    build_summary(lawd_list, months_kept, total_txns, new_records=new_records)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

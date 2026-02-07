#!/usr/bin/env python3
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import requests
from dateutil.relativedelta import relativedelta
from lxml import etree

BASE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade"
DEFAULT_OPERATION_PATH = "getRTMSDataSvcAptTrade"

DOCS_DIR = Path(__file__).resolve().parents[1] / "docs"
DATA_DIR = DOCS_DIR / "data" / "apt_trade"
BY_LAWD_DIR = DATA_DIR / "by_lawd"
INDEX_PATH = DATA_DIR / "index.json"


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
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
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
        time.sleep(0.2)
    records.sort(key=lambda x: (x["deal_date"], x["apt_name"], x["floor"]))
    return records


def load_lawd_list() -> List[str]:
    env_val = os.getenv("LAWD_LIST", "")
    if env_val.strip():
        return [v.strip() for v in env_val.split(",") if v.strip()]
    return ["11110", "11680"]


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


def main() -> int:
    service_key = os.getenv("MOLIT_SERVICE_KEY")
    if not service_key:
        print("MOLIT_SERVICE_KEY is not set", file=sys.stderr)
        return 1

    operation_path = os.getenv("APT_TRADE_OPERATION_PATH", DEFAULT_OPERATION_PATH)
    months_kept = int(os.getenv("MONTHS_KEPT", "12"))
    lawd_list = load_lawd_list()
    months = month_list(months_kept)

    ensure_dirs()
    cleanup_old_files(lawd_list, months)

    index_files = []
    for lawd_cd in lawd_list:
        for deal_ym in months:
            records = fetch_month(service_key, lawd_cd, deal_ym, operation_path)
            out_path = BY_LAWD_DIR / lawd_cd / f"{deal_ym}.json"
            write_json(out_path, records)
            index_files.append({
                "lawd_cd": lawd_cd,
                "deal_ym": deal_ym,
                "count": len(records),
                "path": f"data/apt_trade/by_lawd/{lawd_cd}/{deal_ym}.json",
            })

    index = {
        "updated_at": iso_now_utc(),
        "months_kept": months_kept,
        "lawd_list": lawd_list,
        "files": index_files,
    }
    write_json(INDEX_PATH, index)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

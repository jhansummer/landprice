#!/usr/bin/env python3
"""호가 < 비교단지 저평가 아파트 — 기존 포맷 + 매물호가 비교 추가, 노션 전송"""
import json, os, sys, subprocess
from datetime import datetime

script_dir = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(script_dir, "..", "docs", "data", "apt_trade")
BY_APT_DIR = os.path.join(DATA_DIR, "by_apt")
TODAY = datetime.now()

# .env
env_path = os.path.join(script_dir, "..", ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

import requests

NOTION_API_KEY = os.environ.get("NOTION_API_KEY", "")
PAGE_ID = "30c499fc-6e6d-8066-85be-ecbf98c12134"
HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}
BASE = "https://api.notion.com/v1"


def load_json(path):
    with open(os.path.join(DATA_DIR, path)) as f:
        return json.load(f)


def rich(text):
    return {"type": "text", "text": {"content": text}}


def create_child_page(parent_id, title, blocks):
    payload = {
        "parent": {"page_id": parent_id},
        "properties": {"title": [{"text": {"content": title}}]},
        "children": blocks[:100],
    }
    r = requests.post(f"{BASE}/pages", headers=HEADERS, json=payload)
    if r.status_code != 200:
        print(f"Error: {r.status_code} {r.text[:300]}")
        return None
    new_page_id = r.json()["id"]
    if len(blocks) > 100:
        for i in range(100, len(blocks), 100):
            batch = blocks[i : i + 100]
            requests.patch(
                f"{BASE}/blocks/{new_page_id}/children",
                headers=HEADERS,
                json={"children": batch},
            )
    return new_page_id


def fetch_listings(apartments, batch_size=6):
    script = os.path.join(script_dir, "fetch_naver_listings.py")
    all_results = []
    for start in range(0, len(apartments), batch_size):
        batch = apartments[start : start + batch_size]
        args = [sys.executable, script]
        for apt_name, sigungu, dong_name, area_m2 in batch:
            args.append(f"{apt_name}|{sigungu}|{dong_name}|{area_m2}")
        try:
            result = subprocess.run(args, capture_output=True, text=True, timeout=600)
            if result.stderr:
                for line in result.stderr.strip().split("\n"):
                    print(line)
            if result.returncode == 0 and result.stdout.strip():
                all_results.extend(json.loads(result.stdout.strip()))
            else:
                all_results.extend([None] * len(batch))
        except Exception as e:
            print(f"  [호가] subprocess 에러: {e}")
            all_results.extend([None] * len(batch))
    return all_results


def get_latest_deal(apt_id):
    path = os.path.join(BY_APT_DIR, f"{apt_id}.json")
    if not os.path.exists(path):
        return None, None
    try:
        with open(path) as f:
            txns = json.load(f)
    except Exception:
        return None, None
    if not txns:
        return None, None
    txns.sort(key=lambda x: x[0])
    return txns[-1][1], txns[-1][0]


def fmt_block(range_label, items, geo, listing_map):
    """기존 _fmt_uv_block 포맷 + 매물호가/비교단지 비교 추가"""
    lines = []
    lines.append(f"📍 서울·경기 저평가 아파트 — {range_label}")
    lines.append(f"{TODAY.strftime('%Y-%m-%d')} 기준 · 국토부 실거래가 분석")
    lines.append("")
    lines.append("비교단지 대비 최근 3개월이 3년 평균보다 더 벌어진 단지")
    lines.append("= 시장에서 상대적으로 못 올라온 아파트")
    lines.append("")

    for i, a in enumerate(items, 1):
        area = a["area_m2"]
        recent_eok = a["recent_avg"] / 10000

        # 최근 실거래
        deal_price, deal_date = get_latest_deal(a["id"])
        if deal_price:
            deal_eok = deal_price / 10000
            deal_date_fmt = deal_date.replace("-", ".")
            deal_str = f"최근실거래가 {deal_eok:.1f}억원({deal_date_fmt})"
        else:
            deal_str = f"최근실거래가 {recent_eok:.1f}억원"

        # geo
        g = geo.get(a["id"], {})
        station = g.get("subway", "?")
        sline = g.get("subway_line", "")
        walk = g.get("subway_walk_min", "?")
        gangnam = g.get("commute", {}).get("gangnam", "?")

        # 비교단지
        compares = a.get("compare", [])
        comp_names = ", ".join(c["apt_name"] for c in compares)
        comp_recent = (
            sum(c.get("recent_avg", 0) for c in compares) / max(1, len(compares))
            if compares
            else 0
        )
        comp_36 = (
            sum(c.get("avg_36", 0) for c in compares) / max(1, len(compares))
            if compares
            else 0
        )

        avg36_eok = (a.get("avg_36", 0) or 0) / 10000
        comp36_eok = comp_36 / 10000
        diff36 = ((a.get("avg_36", 0) / comp_36) - 1) * 100 if comp_36 else 0
        comp_recent_eok = comp_recent / 10000
        diff_recent = (
            ((a["recent_avg"] / comp_recent) - 1) * 100 if comp_recent else 0
        )
        gap_widening = diff_recent - diff36

        # 매물호가
        listing = listing_map.get(a["id"])
        if listing:
            l_min = listing["min"] / 10000
            l_max = listing["max"] / 10000
            if l_min == l_max:
                listing_str = f"매물호가 {l_min:.1f}억({listing['count']}건)"
            else:
                listing_str = f"매물호가 {l_min:.1f}~{l_max:.1f}억({listing['count']}건)"
            diff_vs_comp = comp_recent_eok - l_min
            if diff_vs_comp > 0:
                comp_vs_str = f"비교단지평균 {comp_recent_eok:.1f}억 → 호가보다 {diff_vs_comp:.1f}억 높음 ✓"
            else:
                comp_vs_str = f"비교단지평균 {comp_recent_eok:.1f}억 → 호가가 {-diff_vs_comp:.1f}억 높음 ✗"
        else:
            listing_str = "매물 없음"
            comp_vs_str = ""

        lines.append(
            f"{i}. {a['apt_name']} ({a['sigungu']} {a.get('dong_name', '')}, {area}m²)"
        )
        lines.append(f"  {deal_str}")
        lines.append(f"  {station}({sline}) 도보{walk}분 · 강남{gangnam}분")
        lines.append(f"  비교단지: {comp_names}")
        lines.append(
            f"  3년 {avg36_eok:.1f}억 vs {comp36_eok:.1f}억 (차이 {diff36:+.1f}%)"
        )
        lines.append(
            f"  3개월 {recent_eok:.1f}억 vs {comp_recent_eok:.1f}억 (차이 {diff_recent:+.1f}%) → 벌어짐 {gap_widening:+.1f}%p"
        )
        lines.append(f"  {listing_str}")
        if comp_vs_str:
            lines.append(f"  {comp_vs_str}")
        lines.append("")

    lines.append("aptmine.com")
    return lines


def main():
    data = load_json("undervalued.json")
    geo = load_json("valuation_geo.json")

    # 서울/경기 저평가 아파트
    all_items = []
    for sido in ["서울", "경기"]:
        items = data["sidos"].get(sido, {}).get("undervalued", [])
        for item in items:
            item["sido"] = sido
            all_items.append(item)

    # 금액대별 그룹 → TOP3
    price_ranges = [
        ("5~10억", 50000, 100000),
        ("10~15억", 100000, 150000),
        ("15~20억", 150000, 200000),
        ("20억이상", 200000, float("inf")),
    ]

    all_top = []
    for label, lo, hi in price_ranges:
        group = [a for a in all_items if lo <= (a.get("current_price") or 0) < hi]
        group.sort(key=lambda x: x.get("gap_pct", 0))
        for item in group[:3]:
            item["price_range"] = label
        all_top.extend(group[:3])

    print(f"총 {len(all_top)}개 아파트 호가 조회 시작...\n")

    # 호가 일괄 조회
    apts_for_listing = [
        (a["apt_name"], a.get("sigungu", ""), a.get("dong_name", ""), a["area_m2"])
        for a in all_top
    ]
    listing_results = fetch_listings(apts_for_listing)

    # listing_map 구성 + 호가<비교단지 필터
    listing_map = {}
    for a, lr in zip(all_top, listing_results):
        if lr:
            listing_map[a["id"]] = lr

    # 금액대별로 호가<비교단지 / 나머지 분류
    filtered_items = []  # 호가 < 비교단지
    rest_items = []  # 호가 >= 비교단지 또는 호가 없음
    for a in all_top:
        lr = listing_map.get(a["id"])
        comp_recent = a.get("compare_avg_recent", 0)
        if not comp_recent:
            compares = a.get("compare", [])
            comp_recent = (
                sum(c.get("recent_avg", 0) for c in compares)
                / max(1, len(compares))
                if compares
                else 0
            )
        a["_comp_recent"] = comp_recent

        if lr and lr["min"] < comp_recent:
            filtered_items.append(a)
            print(
                f"  ✓ {a['apt_name']} ({a['price_range']}): 호가 {lr['min']/10000:.1f}억 < 비교 {comp_recent/10000:.1f}억"
            )
        elif lr:
            rest_items.append(a)
            print(
                f"  ✗ {a['apt_name']} ({a['price_range']}): 호가 {lr['min']/10000:.1f}억 >= 비교 {comp_recent/10000:.1f}억"
            )
        else:
            rest_items.append(a)
            print(f"  - {a['apt_name']} ({a['price_range']}): 호가 없음")

    print(f"\n호가<비교단지: {len(filtered_items)}개 / 나머지: {len(rest_items)}개\n")

    if not filtered_items and not rest_items:
        print("데이터 없음.")
        return

    # 블록 생성: 호가<비교단지 먼저
    all_blocks = []
    if filtered_items:
        block_lines = fmt_block("호가 < 비교단지 ✓", filtered_items, geo, listing_map)
        all_blocks.append(block_lines)

    if rest_items:
        block_lines = fmt_block("전체 (나머지)", rest_items, geo, listing_map)
        all_blocks.append(block_lines)

    # 콘솔 출력
    for block in all_blocks:
        for line in block:
            print(line)
        print()

    # 노션 전송
    if not NOTION_API_KEY:
        print("\nNOTION_API_KEY 없음")
        return

    blocks = []
    for block_lines in all_blocks:
        text = "\n".join(block_lines)
        blocks.append(
            {
                "type": "code",
                "code": {"rich_text": [rich(text)], "language": "plain text"},
            }
        )

    page_title = f"{TODAY.strftime('%Y-%m-%d')} 호가<비교단지 저평가 아파트 (서울·경기)"
    print(f"\n노션 전송 중... ({page_title})")
    new_id = create_child_page(PAGE_ID, page_title, blocks)
    if new_id:
        print(f"✓ 노션 페이지 생성 완료! (id: {new_id})")
    else:
        print("✗ 노션 전송 실패")


if __name__ == "__main__":
    main()

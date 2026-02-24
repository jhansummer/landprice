#!/usr/bin/env python3
"""매일 서울/경기 저평가 매물 1건씩 추천 → 노션 페이지 생성

비교단지 대비 실거래가가 저평가되어 상승 여력이 있고,
네이버 호가도 비교단지 대비 높지 않은 매물을 선별한다.

사용법:
  python scripts/daily_recommendation.py           # 노션 게시
  python scripts/daily_recommendation.py --dry-run  # 콘솔 출력만
"""
import json, math, os, subprocess, sys
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

import requests

# ── .env ──
def _load_dotenv():
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())

_load_dotenv()

DRY_RUN = "--dry-run" in sys.argv
NOTION_API_KEY = os.environ.get("NOTION_API_KEY", "")
PAGE_ID = "30c499fc-6e6d-8066-85be-ecbf98c12134"
HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}
BASE = "https://api.notion.com/v1"
DATA_DIR = "docs/data/apt_trade"
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST)


# ── 유틸 ──
def load_json(path: str):
    with open(os.path.join(DATA_DIR, path), encoding="utf-8") as f:
        return json.load(f)


def get_txns(apt_id: str) -> list:
    try:
        with open(os.path.join(DATA_DIR, "by_apt", f"{apt_id}.json"), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return []


def fmt_price(v: float) -> str:
    if v >= 10000:
        r = int(v) % 10000
        if r == 0:
            return f"{int(v // 10000)}억"
        return f"{int(v // 10000)}억 {r:,}만"
    return f"{int(v):,}만"


# ── 매물 선별 ──
def pick_best(candidates: list, vgeo: dict, exclude_ids: set = None) -> Optional[dict]:
    """저평가 후보 중 추천 1건 선별.

    기준:
      1. 최근 3개월 거래 1건 이상
      2. gap_pct 가 클수록 좋음 (더 저평가)
      3. 비교단지가 최근 상승 추세 (compare_avg_recent > compare_avg_36)
      4. 이전에 추천한 단지 제외
    """
    if exclude_ids is None:
        exclude_ids = set()

    scored = []
    for apt in candidates:
        apt_id = apt["id"]
        if apt_id in exclude_ids:
            continue
        if apt.get("recent_3m_trades", 0) < 1:
            continue

        # 비교단지가 상승 추세인지
        comp_rising = apt.get("compare_avg_recent", 0) > apt.get("compare_avg_36", 0)
        if not comp_rising:
            continue

        gap = abs(apt.get("gap_pct", 0))
        trades = apt.get("recent_3m_trades", 0)
        geo = vgeo.get(apt_id, {})
        loc = geo.get("loc_score", 0) if isinstance(geo, dict) else 0

        # 점수: gap 비중 크게 + 입지 + 거래빈도
        score = gap * 3 + loc * 0.1 + min(trades, 10) * 0.5
        scored.append((score, apt))

    if not scored:
        return None

    scored.sort(key=lambda x: -x[0])
    return scored[0][1]


# ── 네이버 호가 조회 (선택적) ──
def fetch_naver_listings(apts: List[dict]) -> List[Optional[dict]]:
    """fetch_naver_listings.py 호출. 실패 시 빈 리스트 반환."""
    try:
        script = os.path.join(os.path.dirname(__file__), "fetch_naver_listings.py")
        if not os.path.exists(script):
            return [None] * len(apts)
        result = subprocess.run(
            [sys.executable, script, json.dumps(apts)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout.strip())
            if isinstance(data, list):
                return data
    except Exception:
        pass
    return [None] * len(apts)


# ── 추천 텍스트 생성 ──
def build_text(pick: dict, vgeo: dict, listing: Optional[dict] = None) -> str:
    geo = vgeo.get(pick["id"], {})
    if not isinstance(geo, dict):
        geo = {}
    txns = get_txns(pick["id"])
    last_txn = txns[-1] if txns else None

    subway = geo.get("subway", "")
    sw_dist = geo.get("subway_dist", 0)
    sw_line = geo.get("subway_line", "")
    loc = geo.get("loc_score", "")

    lines = [
        f"📍 {pick['sigungu']} {pick['dong_name']}",
        f"🏢 {pick['apt_name']} ({pick['area_m2']:.0f}m²)",
    ]

    if subway:
        dist_str = f"도보 {int(sw_dist * 1000)}m" if sw_dist < 1 else f"{round(sw_dist, 1)}km"
        lines.append(f"🚇 {subway}역 {sw_line} {dist_str}")

    if loc:
        lines.append(f"📊 입지점수: {loc}")

    lines.append("")

    if last_txn:
        lines.append(f"최근 실거래: {fmt_price(last_txn[1])} ({last_txn[0]})")

    lines.append(f"비교단지 대비 {abs(pick['gap_pct']):.1f}% 저평가")

    # 네이버 호가
    if listing and listing.get("count"):
        lines.append(f"네이버 매물: {listing['count']}건 ({fmt_price(listing['min'])}~{fmt_price(listing['max'])})")

    lines.append("")
    lines.append("비교단지 최근 거래:")

    for c in pick.get("compare", [])[:2]:
        ctxns = get_txns(c["id"])
        clast = ctxns[-1] if ctxns else None
        cprice = fmt_price(clast[1]) if clast else "?"
        cdate = clast[0] if clast else "?"
        cgeo = vgeo.get(c["id"], {})
        cloc = cgeo.get("loc_score", "") if isinstance(cgeo, dict) else ""
        loc_str = f" (입지 {cloc})" if cloc else ""
        lines.append(f"  · {c['apt_name']}: {cprice} ({cdate}){loc_str}")

    return "\n".join(lines)


# ── 노션 게시 ──
def post_to_notion(title: str, blocks: list) -> Optional[str]:
    if DRY_RUN:
        print(f"\n[DRY-RUN] 노션 페이지: {title}")
        for b in blocks:
            bt = b.get("type", "")
            if bt == "code":
                print(b["code"]["rich_text"][0]["text"]["content"])
            elif bt in ("heading_1", "heading_2"):
                print(f"\n### {b[bt]['rich_text'][0]['text']['content']}")
            elif bt == "callout":
                print(f"  > {b['callout']['rich_text'][0]['text']['content']}")
        return None

    if not NOTION_API_KEY:
        print("NOTION_API_KEY 미설정 — 건너뜀")
        return None

    resp = requests.post(
        f"{BASE}/pages",
        headers=HEADERS,
        json={
            "parent": {"page_id": PAGE_ID},
            "properties": {"title": [{"text": {"content": title}}]},
            "children": blocks,
        },
    )
    if resp.status_code in (200, 201):
        url = resp.json().get("url", "")
        print(f"✅ 노션 페이지 생성: {url}")
        return url
    else:
        print(f"❌ 노션 실패: {resp.status_code} {resp.text[:300]}")
        return None


# ── 메인 ──
def main():
    print(f"=== 일일 매물 추천 ({TODAY.strftime('%Y-%m-%d')}) ===")

    uv = load_json("undervalued.json")
    vgeo = load_json("valuation_geo.json") if os.path.exists(os.path.join(DATA_DIR, "valuation_geo.json")) else {}

    picks = {}
    for sido in ["서울", "경기"]:
        candidates = uv.get("sidos", {}).get(sido, {}).get("undervalued", [])
        if not candidates:
            print(f"  {sido}: 저평가 후보 없음")
            continue

        best = pick_best(candidates, vgeo)
        if not best:
            print(f"  {sido}: 조건 맞는 매물 없음")
            continue

        picks[sido] = best
        print(f"  {sido}: {best['apt_name']} ({best['sigungu']}) gap={best['gap_pct']:.1f}%")

    if not picks:
        print("추천할 매물이 없습니다.")
        return

    # 네이버 호가 조회 (선택적)
    naver_apts = []
    pick_order = []
    for sido, p in picks.items():
        naver_apts.append({
            "name": p["apt_name"],
            "region": f"{p['sigungu']} {p['dong_name']}",
            "area": p["area_m2"],
        })
        pick_order.append(sido)

    listings_raw = fetch_naver_listings(naver_apts)
    listings = {}
    for i, sido in enumerate(pick_order):
        if i < len(listings_raw) and listings_raw[i]:
            listings[sido] = listings_raw[i]

    # 노션 블록 구성
    date_str = TODAY.strftime("%m/%d")
    title = f"오늘의 매물 추천 ({date_str})"

    blocks = [
        {
            "object": "block", "type": "heading_1",
            "heading_1": {"rich_text": [{"type": "text", "text": {"content": "오늘의 추천 매물"}}]},
        },
        {
            "object": "block", "type": "callout",
            "callout": {
                "icon": {"type": "emoji", "emoji": "📌"},
                "color": "blue_background",
                "rich_text": [{"type": "text", "text": {
                    "content": "비교단지 대비 실거래가가 저평가된 매물 중 상승 여력이 있는 단지를 선별했습니다."
                }}],
            },
        },
    ]

    for sido in ["서울", "경기"]:
        p = picks.get(sido)
        if not p:
            continue

        text = build_text(p, vgeo, listings.get(sido))
        blocks.append({
            "object": "block", "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": f"{sido} — {p['apt_name']}"}}]},
        })
        blocks.append({
            "object": "block", "type": "code",
            "code": {"language": "plain text", "rich_text": [{"type": "text", "text": {"content": text}}]},
        })
        blocks.append({"object": "block", "type": "divider", "divider": {}})

    post_to_notion(title, blocks)


if __name__ == "__main__":
    main()

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
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
HISTORY_FILE = os.path.join(SCRIPTS_DIR, "daily_rec_history.json")
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST)


# ── 7일 이력 관리 (중복 방지) ──
def load_history() -> list:
    """최근 7일 추천 이력 로드. [{date, sido, apt_id, apt_name}, ...]"""
    if not os.path.exists(HISTORY_FILE):
        return []
    with open(HISTORY_FILE, "r", encoding="utf-8") as f:
        entries = json.load(f)
    cutoff = (TODAY - timedelta(days=7)).strftime("%Y-%m-%d")
    return [e for e in entries if e.get("date", "") >= cutoff]


def save_history(entries: list):
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=1)


def get_excluded_ids() -> set:
    """최근 7일간 추천된 단지 ID 집합"""
    return {e["apt_id"] for e in load_history() if "apt_id" in e}


def record_pick(sido: str, apt: dict):
    """추천 단지를 이력에 기록"""
    history = load_history()
    history.append({
        "date": TODAY.strftime("%Y-%m-%d"),
        "sido": sido,
        "apt_id": apt["id"],
        "apt_name": apt["apt_name"],
    })
    save_history(history)


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
    """fetch_naver_listings.py 호출. 실패 시 빈 리스트 반환.

    apts: [{"name", "region" (시군구 동), "area"}]
    인자 형식: "아파트명|시군구|동|면적"
    """
    try:
        script = os.path.join(os.path.dirname(__file__), "fetch_naver_listings.py")
        if not os.path.exists(script):
            return [None] * len(apts)
        # fetch_naver_listings.py는 "이름|시군구|동|면적" 형식 인자
        args = [sys.executable, script]
        for a in apts:
            region_parts = a["region"].split()
            sigungu = region_parts[0] if region_parts else ""
            dong = region_parts[1] if len(region_parts) > 1 else ""
            args.append(f"{a['name']}|{sigungu}|{dong}|{a['area']}")
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=180,
        )
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout.strip())
            if isinstance(data, list):
                return data
    except Exception as e:
        print(f"  네이버 호가 조회 실패: {e}")
    return [None] * len(apts)


# ── 추천 텍스트 생성 ──
def build_text(pick: dict, vgeo: dict, listing: Optional[dict] = None,
               comp_listings: Optional[List[Optional[dict]]] = None) -> str:
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

    # ── 실거래가 ──
    if last_txn:
        lines.append(f"최근 실거래: {fmt_price(last_txn[1])} ({last_txn[0]})")

    lines.append(f"비교단지 대비 {abs(pick['gap_pct']):.1f}% 저평가")

    # ── 3년평균 vs 최근평균 비교 ──
    lines.append("")
    lines.append("━━ 가격 추이 비교 ━━")

    avg_36 = pick.get("avg_36", 0)
    recent_avg = pick.get("recent_avg", 0)
    comp_avg_36 = pick.get("compare_avg_36", 0)
    comp_avg_recent = pick.get("compare_avg_recent", 0)

    if avg_36 and recent_avg:
        own_chg = (recent_avg - avg_36) / avg_36 * 100
        lines.append(f"  {pick['apt_name']}")
        lines.append(f"    3년평균 {fmt_price(avg_36)} → 최근평균 {fmt_price(recent_avg)} ({own_chg:+.1f}%)")

    if comp_avg_36 and comp_avg_recent:
        comp_chg = (comp_avg_recent - comp_avg_36) / comp_avg_36 * 100
        lines.append(f"  비교단지")
        lines.append(f"    3년평균 {fmt_price(comp_avg_36)} → 최근평균 {fmt_price(comp_avg_recent)} ({comp_chg:+.1f}%)")

    if avg_36 and comp_avg_36 and recent_avg and comp_avg_recent:
        lines.append(f"  → 비교단지는 {abs(comp_chg):.1f}% 올랐지만 이 단지는 아직 덜 올라 격차 발생")

    # ── 네이버 호가 비교 ──
    lines.append("")
    lines.append("━━ 네이버 매물 호가 ━━")

    if listing and listing.get("count"):
        lines.append(f"  {pick['apt_name']}: {listing['count']}건, {fmt_price(listing['min'])}~{fmt_price(listing['max'])}")
    else:
        lines.append(f"  {pick['apt_name']}: 매물 없음 또는 조회 실패")

    comparisons = pick.get("compare", [])[:2]
    if comp_listings is None:
        comp_listings = []

    for i, c in enumerate(comparisons):
        cl = comp_listings[i] if i < len(comp_listings) else None
        if cl and cl.get("count"):
            lines.append(f"  {c['apt_name']}: {cl['count']}건, {fmt_price(cl['min'])}~{fmt_price(cl['max'])}")
        else:
            lines.append(f"  {c['apt_name']}: 매물 없음 또는 조회 실패")

    # 호가 비교 해석
    if listing and listing.get("count") and comp_listings:
        comp_mins = [cl["min"] for cl in comp_listings if cl and cl.get("count")]
        if comp_mins:
            avg_comp_min = sum(comp_mins) / len(comp_mins)
            diff = (listing["min"] - avg_comp_min) / avg_comp_min * 100
            if diff < 0:
                lines.append(f"  → 호가가 비교단지보다 {abs(diff):.0f}% 낮아 진입 기회")
            else:
                lines.append(f"  → 호가는 비교단지 대비 {diff:.0f}% 높음")

    # ── 비교단지 상세 ──
    lines.append("")
    lines.append("━━ 비교단지 상세 ━━")

    for i, c in enumerate(comparisons):
        ctxns = get_txns(c["id"])
        clast = ctxns[-1] if ctxns else None
        cprice = fmt_price(clast[1]) if clast else "?"
        cdate = clast[0] if clast else "?"
        c_avg36 = c.get("avg_36", 0)
        c_recent = c.get("recent_avg", 0)
        corr = c.get("corr", 0)
        c_chg = (c_recent - c_avg36) / c_avg36 * 100 if c_avg36 else 0
        lines.append(f"  · {c['apt_name']} ({c['sigungu']} {c['dong_name']}, {c['area_m2']:.0f}m²)")
        lines.append(f"    최근거래 {cprice} ({cdate}), 상관계수 {corr:.2f}")
        if c_avg36 and c_recent:
            lines.append(f"    3년평균 {fmt_price(c_avg36)} → 최근평균 {fmt_price(c_recent)} ({c_chg:+.1f}%)")

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

    # 최근 7일 추천 이력에서 제외할 단지 ID
    exclude_ids = get_excluded_ids()
    print(f"  최근 7일 추천 이력: {len(exclude_ids)}건 제외")

    MAX_RETRIES = 5  # 호가 없으면 다음 후보로 (최대 5회 시도)

    picks = {}
    listings = {}
    comp_listings = {}

    for sido in ["서울", "경기"]:
        candidates = uv.get("sidos", {}).get(sido, {}).get("undervalued", [])
        if not candidates:
            print(f"  {sido}: 저평가 후보 없음")
            continue

        tried_ids = set()
        for attempt in range(MAX_RETRIES):
            best = pick_best(candidates, vgeo, exclude_ids | tried_ids)
            if not best:
                print(f"  {sido}: 조건 맞는 매물 없음")
                break

            tried_ids.add(best["id"])
            print(f"  {sido} 시도 {attempt + 1}: {best['apt_name']} ({best['sigungu']}) gap={best['gap_pct']:.1f}%")

            # 네이버 호가 조회 — 추천 단지 + 비교단지
            naver_apts = [{
                "name": best["apt_name"],
                "region": f"{best['sigungu']} {best['dong_name']}",
                "area": best["area_m2"],
            }]
            for c in best.get("compare", [])[:2]:
                naver_apts.append({
                    "name": c["apt_name"],
                    "region": f"{c['sigungu']} {c['dong_name']}",
                    "area": c["area_m2"],
                })

            print(f"    네이버 호가 조회: {len(naver_apts)}건")
            lr_raw = fetch_naver_listings(naver_apts)

            pick_listing = lr_raw[0] if lr_raw else None
            c_listings = lr_raw[1:] if len(lr_raw) > 1 else []

            if pick_listing and pick_listing.get("count"):
                picks[sido] = best
                listings[sido] = pick_listing
                comp_listings[sido] = c_listings
                print(f"    ✓ 호가 확인: {pick_listing['count']}건, {pick_listing['min']/10000:.1f}~{pick_listing['max']/10000:.1f}억")
                break
            else:
                print(f"    ✗ 호가 없음 — 다음 후보 시도")

    if not picks:
        print("추천할 매물이 없습니다.")
        return

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
                    "content": "비교단지 대비 실거래가가 저평가되고, 네이버 호가도 비교단지보다 낮은 매물을 선별했습니다."
                }}],
            },
        },
    ]

    for sido in ["서울", "경기"]:
        p = picks.get(sido)
        if not p:
            continue

        text = build_text(p, vgeo, listings.get(sido), comp_listings.get(sido))
        blocks.append({
            "object": "block", "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": f"{sido} — {p['apt_name']}"}}]},
        })
        blocks.append({
            "object": "block", "type": "code",
            "code": {"language": "plain text", "rich_text": [{"type": "text", "text": {"content": text}}]},
        })
        blocks.append({"object": "block", "type": "divider", "divider": {}})

    result = post_to_notion(title, blocks)

    # 게시 성공 시 이력 기록 (7일간 중복 방지)
    if result or DRY_RUN:
        for sido, p in picks.items():
            record_pick(sido, p)
        print(f"  이력 기록 완료 ({len(picks)}건)")


if __name__ == "__main__":
    main()

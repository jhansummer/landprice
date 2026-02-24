#!/usr/bin/env python3
"""요일별 Threads 게시용 콘텐츠 → 노션 업데이트

DOW 환경변수(0=월~6=일)로 요일 오버라이드 가능.
--dry-run 플래그로 노션 업데이트 없이 콘솔 출력만 확인.
--volume 플래그로 거래량 TOP5 콘텐츠 생성.
"""
import json, os, re, sys, time
from collections import defaultdict
from datetime import datetime

import requests

BY_APT_DIR = os.path.join("docs", "data", "apt_trade", "by_apt")

# ── .env 로드 (로컬 실행용, CI에서는 secrets로 주입) ──
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

# ── 설정 ──
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
TODAY = datetime.now()
SIDOS = ["서울", "경기", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]


# ── 공통 유틸 ──
def load_json(path):
    with open(os.path.join(DATA_DIR, path)) as f:
        return json.load(f)


def fmt_price(v):
    """만원 단위(총액) → 억 표시"""
    if v >= 10000:
        return f"{v / 10000:.1f}억"
    return f"{v:.0f}만"


def fmt_price_m2(price_per_m2, area_m2):
    """만원/m² 단위 → 총액 억 표시 (summary/bottom/newhigh용)"""
    total = price_per_m2 * area_m2
    return fmt_price(total)


def fmt_area(m2):
    return f"{int(m2)}m²"


def fmt_loc(item):
    """'시군구 동' 형식"""
    return f'{item["sigungu"]} {item.get("dong_name", "")}'.strip()


# ── Threads 500자 분할 ──
def split_threads(lines, max_chars=500):
    """줄 목록을 받아 500자 이하 파트로 분할 (들여쓰기 줄은 이전 줄과 그룹)"""
    # 줄들을 청크로 그룹핑: 들여쓰기 줄(공백 시작)은 이전 줄과 합침
    chunks = []
    for line in lines:
        if line.startswith("   ") and chunks:
            chunks[-1] += "\n" + line
        else:
            chunks.append(line)

    parts = []
    current = ""
    for chunk in chunks:
        test = (current + "\n" + chunk).strip() if current else chunk
        if len(test) <= max_chars - 8:  # [n/m] 여유
            current = test
        else:
            if current:
                parts.append(current)
            current = chunk
    if current:
        parts.append(current)
    total = len(parts)
    return [f"{p}\n[{i + 1}/{total}]" for i, p in enumerate(parts)]


# ── 노션 API (기존 패턴 재사용) ──
def get_children(page_id):
    blocks = []
    url = f"{BASE}/blocks/{page_id}/children?page_size=100"
    while url:
        r = requests.get(url, headers=HEADERS)
        data = r.json()
        blocks.extend(data.get("results", []))
        nc = data.get("next_cursor")
        url = (
            f"{BASE}/blocks/{page_id}/children?page_size=100&start_cursor={nc}"
            if nc
            else None
        )
    return blocks


def delete_block(bid):
    requests.delete(f"{BASE}/blocks/{bid}", headers=HEADERS)


def rich(text):
    return {"type": "text", "text": {"content": text}}


def append_blocks(page_id, block_list):
    for i in range(0, len(block_list), 100):
        batch = block_list[i : i + 100]
        r = requests.patch(
            f"{BASE}/blocks/{page_id}/children",
            headers=HEADERS,
            json={"children": batch},
        )
        if r.status_code != 200:
            print(f"Error: {r.status_code} {r.text[:300]}")
            return False
    return True


def create_child_page(parent_id, title, blocks):
    """부모 페이지 안에 하위 페이지(파일) 생성"""
    payload = {
        "parent": {"page_id": parent_id},
        "properties": {
            "title": [{"text": {"content": title}}]
        },
        "children": blocks[:100],
    }
    r = requests.post(f"{BASE}/pages", headers=HEADERS, json=payload)
    if r.status_code != 200:
        print(f"Error creating page: {r.status_code} {r.text[:300]}")
        return None
    new_page_id = r.json()["id"]
    if len(blocks) > 100:
        append_blocks(new_page_id, blocks[100:])
    return new_page_id


# ══════════════════════════════════════════════
# 월요일: 저평가 TOP 3 (전국)
# ══════════════════════════════════════════════
def _get_latest_deal(apt_id):
    """by_apt/{id}.json에서 최근 실거래 가격(만원 총액)과 날짜 반환."""
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
    return txns[-1][1], txns[-1][0]  # price(만원), date(YYYY-MM-DD)


def enrich_naver_prices(items, geo=None):
    """items 리스트의 각 항목에 naver_price(만원) 필드를 추가.

    네이버 매물 호가 최저가를 가져와서 naver_price에 저장.
    실패 시 naver_price=None.
    """
    if not items:
        return
    apts_for_listing = []
    for a in items:
        apt_name = a.get("apt_name", "")
        sigungu = a.get("sigungu", "")
        dong = a.get("dong_name", "")
        area = a.get("area_m2", 0)
        apts_for_listing.append((apt_name, sigungu, dong, area))

    results = _fetch_naver_listings_batch(apts_for_listing)
    for a, lr in zip(items, results):
        if lr and lr.get("min"):
            a["naver_price"] = lr["min"]
        else:
            a["naver_price"] = None


def _fetch_naver_listings_batch(apartments, batch_size=6):
    """네이버 부동산 매물 호가 일괄 조회 (subprocess → fetch_naver_listings.py).

    apartments: [(apt_name, sigungu, dong_name, area_m2), ...]
    반환: [{min, max, count}, ...] (실패 시 None)
    """
    import subprocess
    script = os.path.join(os.path.dirname(__file__), "fetch_naver_listings.py")
    all_results = []
    for start in range(0, len(apartments), batch_size):
        batch = apartments[start:start + batch_size]
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


def _fmt_uv_block(sido_label, top3, geo, fetch_listings=False):
    """저평가 아파트 스토리형 블록 생성"""
    # 호가 일괄 조회 (옵션)
    listing_map = {}
    if fetch_listings and top3:
        apts_for_listing = [
            (a["apt_name"], a.get("sigungu", ""), a.get("dong_name", ""), a["area_m2"])
            for a in top3
        ]
        listing_results = _fetch_naver_listings_batch(apts_for_listing)
        for a, lr in zip(top3, listing_results):
            if lr:
                listing_map[a["id"]] = lr

    lines = []
    if not top3:
        return lines

    # 1위 단지 기준 스토리
    a = top3[0]
    recent_eok = a["recent_avg"] / 10000
    compares = a.get("compare", [])
    comp_recent = sum(c.get("recent_avg", 0) for c in compares) / max(1, len(compares)) if compares else 0
    comp_36 = sum(c.get("avg_36", 0) for c in compares) / max(1, len(compares)) if compares else 0
    diff36 = ((a.get("avg_36", 0) / comp_36) - 1) * 100 if comp_36 else 0
    diff_recent = ((a["recent_avg"] / comp_recent) - 1) * 100 if comp_recent else 0
    gap_widening = diff_recent - diff36

    lines.append("비교단지는 올랐는데")
    lines.append("왜 이 아파트만 안 올랐을까?")
    lines.append("")
    lines.append(f"{a['sigungu']} {a.get('dong_name', '')},")
    lines.append(f"3년 평균으로는 비슷한 가격대였는데")
    lines.append(f"최근 3개월간 {abs(gap_widening):.1f}%p 더 벌어졌다.")
    lines.append("")

    for i, a in enumerate(top3):
        # 가격: 네이버 호가 우선, 없으면 실거래가 폴백
        naver_p = a.get("naver_price")
        if naver_p:
            price_str = f"{naver_p / 10000:.1f}억"
        else:
            deal_price, deal_date = _get_latest_deal(a["id"])
            if deal_price:
                price_str = f"{deal_price / 10000:.1f}억"
            else:
                price_str = f"{a['recent_avg'] / 10000:.1f}억"

        g = geo.get(a["id"], {})
        station = g.get("subway", "?")
        sline = g.get("subway_line", "")
        walk = g.get("subway_walk_min", "?")
        commute_gn = (g.get("commute") or {}).get("gangnam")

        compares = a.get("compare", [])
        comp_names = ", ".join(c["apt_name"] for c in compares)
        comp_recent = sum(c.get("recent_avg", 0) for c in compares) / max(1, len(compares)) if compares else 0
        comp_36 = sum(c.get("avg_36", 0) for c in compares) / max(1, len(compares)) if compares else 0
        comp_recent_eok = comp_recent / 10000
        avg36_eok = (a.get("avg_36", 0) or 0) / 10000
        comp36_eok = comp_36 / 10000
        diff36 = ((a.get("avg_36", 0) / comp_36) - 1) * 100 if comp_36 else 0
        diff_recent = ((a["recent_avg"] / comp_recent) - 1) * 100 if comp_recent else 0
        gap_widening = diff_recent - diff36

        lines.append(f"→ {a['apt_name']} ({a['sigungu']} {a.get('dong_name', '')}, {int(a['area_m2'])}m²)")
        gangnam_str = f" · 강남 {commute_gn}분" if commute_gn else ""
        lines.append(f"  {price_str}{gangnam_str}")
        lines.append(f"  {station}({sline}) 도보{walk}분")
        lines.append(f"  비교단지: {comp_names}")
        lines.append(f"  3년 {avg36_eok:.1f}억 vs {comp36_eok:.1f}억 ({diff36:+.1f}%)")
        lines.append(f"  3개월 {recent_eok:.1f}억 vs {comp_recent_eok:.1f}억 ({diff_recent:+.1f}%) → 벌어짐 {gap_widening:+.1f}%p")
        lines.append("")

    lines.append("벌어짐 = 3개월차이 - 3년차이")
    lines.append("음수 클수록 최근에 더 저평가")
    lines.append(f"네이버 매물 호가 기준 · {TODAY.strftime('%Y.%m.%d')}")
    lines.append("aptmine.com")
    return lines


def generate_monday():
    data = load_json("undervalued.json")
    geo = load_json("valuation_geo.json")

    all_uv = []
    for sido in SIDOS:
        items = data["sidos"].get(sido, {}).get("undervalued", [])
        for item in items:
            item["sido"] = sido
            all_uv.append(item)

    all_uv.sort(key=lambda x: x.get("gap_pct", 0))
    top3 = all_uv[:3]

    enrich_naver_prices(top3)
    lines = _fmt_uv_block("전국", top3, geo, fetch_listings=False)

    title = "비교단지는 올랐는데 왜 이 아파트만?"
    return title, lines, top3


# ══════════════════════════════════════════════
# 화요일: 강남 30분 출퇴근 가성비 아파트
# ══════════════════════════════════════════════
def generate_tuesday():
    geo = load_json("valuation_geo.json")

    gangnam_ids = set()
    for apt_id, g in geo.items():
        commute = g.get("commute", {})
        if commute.get("gangnam") is not None and commute["gangnam"] <= 30:
            gangnam_ids.add(apt_id)

    candidates = []
    for sido in SIDOS:
        path = os.path.join(DATA_DIR, "valuation", f"{sido}.json")
        if not os.path.exists(path):
            continue
        with open(path) as f:
            val = json.load(f)
        for item in val.get("items", []):
            if item["id"] in gangnam_ids:
                item["sido"] = sido
                item["commute_gangnam"] = geo[item["id"]]["commute"]["gangnam"]
                candidates.append(item)

    candidates.sort(key=lambda x: x.get("current_price", float("inf")))
    top3 = candidates[:3]

    enrich_naver_prices(top3)

    lines = []
    if top3:
        cheapest = top3[0]
        cp = cheapest.get("naver_price") or cheapest["current_price"]
        lines.append("강남까지 30분이면 되는데")
        lines.append(f"이 가격이면 살 만하지 않을까?")
        lines.append("")
        lines.append(f'{fmt_loc(cheapest)},')
        lines.append(f'대중교통 기준 강남 {cheapest["commute_gangnam"]}분.')
        lines.append(f"현재 {fmt_price(cp)}.")
        lines.append("")

        for a in top3:
            g = geo.get(a["id"], {})
            station = g.get("subway", "?")
            sline = g.get("subway_line", "")
            walk = g.get("subway_walk_min", "?")
            ap = a.get("naver_price") or a["current_price"]
            lines.append(f'→ {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})')
            lines.append(f'  {fmt_price(ap)} · 강남 {a["commute_gangnam"]}분')
            lines.append(f'  {station}({sline}) 도보{walk}분')
            lines.append("")

    lines.append("강남 30분 이내 + 가격 낮은 순")
    lines.append(f"네이버 매물 호가 기준 · {TODAY.strftime('%Y.%m.%d')}")
    lines.append("aptmine.com")

    title = "강남 30분인데 이 가격이면?"
    return title, lines, top3


# ══════════════════════════════════════════════
# 수요일: 학군 좋은 저평가 단지
# ══════════════════════════════════════════════
def generate_wednesday():
    geo = load_json("valuation_geo.json")
    uv_data = load_json("undervalued.json")

    academy_ids = {}
    for apt_id, g in geo.items():
        score = g.get("academy_score")
        if score is not None and score >= 70:
            academy_ids[apt_id] = score

    uv_map = {}
    for sido in SIDOS:
        for item in uv_data["sidos"].get(sido, {}).get("undervalued", []):
            item["sido"] = sido
            uv_map[item["id"]] = item

    candidates = []
    for apt_id in academy_ids:
        if apt_id in uv_map:
            item = uv_map[apt_id]
            item["academy_score"] = academy_ids[apt_id]
            candidates.append(item)

    candidates.sort(key=lambda x: x.get("gap_pct", 0))
    top3 = candidates[:3]

    enrich_naver_prices(top3)

    lines = []
    if top3:
        a = top3[0]
        lines.append("학군은 검증됐는데")
        lines.append("가격은 아직 안 올랐다?")
        lines.append("")
        lines.append(f"{fmt_loc(a)}, 학원가 점수 {a['academy_score']}점.")
        lines.append(f"비교단지 대비 {abs(a['gap_pct']):.1f}%p 저평가 상태.")
        lines.append("")

        for a in top3:
            ap = a.get("naver_price") or a["current_price"]
            lines.append(f'→ {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})')
            lines.append(f'  {fmt_price(ap)} · 학원가 {a["academy_score"]}점 · 벌어짐 {a["gap_pct"]:+.1f}%p')
            lines.append("")
    else:
        lines.append("학군 + 저평가 교집합에 해당하는")
        lines.append("단지가 현재 없습니다.")
        lines.append("")

    lines.append("학원가 점수: 반경 1.5km 내 학업성취도 기반")
    lines.append(f"네이버 매물 호가 기준 · {TODAY.strftime('%Y.%m.%d')}")
    lines.append("aptmine.com")

    title = "학군 좋은데 왜 이 단지만 저평가?"
    return title, lines, top3


# ══════════════════════════════════════════════
# 목요일: 신고가 갱신 단지
# ══════════════════════════════════════════════
def generate_thursday():
    data = load_json("newhigh_summary.json")

    all_items = []
    for sido in SIDOS:
        districts = data["sidos"].get(sido, {}).get("districts", {})
        for gu, dd in districts.items():
            dong_recovery = dd.get("dong_recovery", {})
            items = dong_recovery.get("items", [])
            for dong in items:
                for apt in dong.get("apt_details", []):
                    apt["sido"] = sido
                    apt["sigungu"] = gu
                    apt["dong_name"] = dong["name"]
                    all_items.append(apt)

    all_items.sort(key=lambda x: x.get("vs_all_time_peak", 0), reverse=True)
    top3 = all_items[:3]

    enrich_naver_prices(top3)

    lines = []
    if top3:
        a = top3[0]
        loc = f'{a["sigungu"]} {a["dong_name"]}'
        total_price = fmt_price(a.get("naver_price") or 0) if a.get("naver_price") else fmt_price_m2(a["price"], a["area_m2"])
        lines.append("역대 최고가를 뚫었다.")
        lines.append("")
        lines.append(f"{loc},")
        lines.append(f'전고점 대비 +{a["vs_all_time_peak"]:.1f}%.')
        lines.append(f"이 시장에서 가장 강한 단지는 어디일까?")
        lines.append("")

        for a in top3:
            loc = f'{a["sigungu"]} {a["dong_name"]}'
            ap = fmt_price(a["naver_price"]) if a.get("naver_price") else fmt_price_m2(a["price"], a["area_m2"])
            lines.append(f'→ {a["apt_name"]} ({loc}, {fmt_area(a["area_m2"])})')
            lines.append(f'  현재 {ap} · 전고점 대비 +{a["vs_all_time_peak"]:.1f}%')
            lines.append("")

    lines.append("역대 최고가 돌파 단지")
    lines.append(f"네이버 매물 호가 기준 · {TODAY.strftime('%Y.%m.%d')}")
    lines.append("aptmine.com")

    title = "역대 최고가를 뚫은 단지"
    return title, lines, top3


# ══════════════════════════════════════════════
# 금요일: 바닥 반등 단지
# ══════════════════════════════════════════════
def generate_friday():
    all_turning = []
    for sido in SIDOS:
        path = os.path.join(DATA_DIR, "bottom", f"{sido}.json")
        if not os.path.exists(path):
            continue
        with open(path) as f:
            d = json.load(f)
        for item in d.get("turning", []):
            item["sido"] = sido
            if item.get("price") and item.get("trough") and item["trough"] > 0:
                item["bounce_pct"] = (item["price"] / item["trough"] - 1) * 100
            else:
                item["bounce_pct"] = 0
            all_turning.append(item)

    all_turning.sort(key=lambda x: x["bounce_pct"], reverse=True)
    top3 = all_turning[:3]

    enrich_naver_prices(top3)

    lines = []
    if top3:
        a = top3[0]
        trough_ym = a.get("trough_ym", "")
        trough_str = f"{trough_ym[:4]}.{trough_ym[4:]}" if len(trough_ym) == 6 else trough_ym
        lines.append("바닥을 찍고 올라오기 시작했다.")
        lines.append("")
        lines.append(f"{fmt_loc(a)},")
        lines.append(f"{trough_str} 저점 이후 +{a['bounce_pct']:.1f}% 반등.")
        lines.append(f"아직 전고점 대비 {a['vs_all_time_peak']:+.1f}%.")
        lines.append("회복 여력이 남아 있을까?")
        lines.append("")

        for a in top3:
            trough_ym = a.get("trough_ym", "")
            trough_str = f"{trough_ym[:4]}.{trough_ym[4:]}" if len(trough_ym) == 6 else trough_ym
            ap = fmt_price(a["naver_price"]) if a.get("naver_price") else fmt_price_m2(a["price"], a["area_m2"])
            lines.append(f'→ {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})')
            lines.append(f'  저점 {fmt_price_m2(a["trough"], a["area_m2"])}({trough_str}) → 현재 {ap}')
            lines.append(f'  반등 +{a["bounce_pct"]:.1f}% · 전고점 대비 {a["vs_all_time_peak"]:+.1f}%')
            lines.append("")

    lines.append("저점 대비 반등폭 기준")
    lines.append(f"네이버 매물 호가 기준 · {TODAY.strftime('%Y.%m.%d')}")
    lines.append("aptmine.com")

    title = "바닥 찍고 올라오는 단지"
    return title, lines, top3


# ══════════════════════════════════════════════
# 토요일: 인프라 대비 가성비 좋은 아파트 단지
# ══════════════════════════════════════════════
def _infra_label(score):
    if score >= 90:
        return "최상"
    if score >= 70:
        return "우수"
    if score >= 50:
        return "양호"
    return "보통"


def generate_saturday():
    data = load_json("location_value.json")
    geo = load_json("valuation_geo.json")

    all_items = []
    for sido in SIDOS:
        items = data.get("sidos", {}).get(sido, [])
        for item in items:
            item["sido"] = sido
            all_items.append(item)

    all_items.sort(key=lambda x: x.get("location_gap", 0), reverse=True)
    top3 = all_items[:3]

    enrich_naver_prices(top3)

    lines = []
    if top3:
        a = top3[0]
        g = geo.get(a["id"], {})
        inf = g.get("infra", {})
        academy = inf.get("academy", 0)
        inf_score = g.get("infra_score", 0)
        ap = a.get("naver_price") or a["price"]
        lines.append("주변에 다 있는데 가격은 싸다?")
        lines.append("")
        lines.append(f"{fmt_loc(a)},")
        lines.append(f"학원 {academy}개, 생활인프라 {_infra_label(inf_score)}등급.")
        lines.append(f"그런데 가격은 {fmt_price(ap)}.")
        lines.append("")

        for a in top3:
            g = geo.get(a["id"], {})
            if g:
                station = g.get("subway", "?")
                sline = g.get("subway_line", "")
                walk = g.get("subway_walk_min", "?")
                inf = g.get("infra", {})
                inf_score = g.get("infra_score", 0)
                hh = g.get("households", 0)
                ap = a.get("naver_price") or a["price"]
                lines.append(f'→ {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})')
                lines.append(f'  {fmt_price(ap)} · {station}({sline}) 도보{walk}분')
                lines.append(f'  인프라 {_infra_label(inf_score)} · {hh:,}세대')
                lines.append("")

    lines.append("입지점수 대비 가격순위가 낮은 단지")
    lines.append(f"네이버 매물 호가 기준 · {TODAY.strftime('%Y.%m.%d')}")
    lines.append("aptmine.com")

    title = "인프라는 좋은데 가격은 왜 이럴까"
    return title, lines, top3


# ══════════════════════════════════════════════
# 일요일: 주간 백테스트 성적표
# ══════════════════════════════════════════════
def generate_sunday():
    data = load_json("backtest.json")
    summary = data["summary"]
    timeline = data.get("timeline", [])

    lines = []
    went_up_pct = summary["went_up_pct"]
    avg_alpha = summary["avg_alpha"]

    lines.append("저평가 아파트를 사면 정말 오를까?")
    lines.append("")
    lines.append(f'실제로 {summary["total_picks"]}건 추천 중')
    lines.append(f'{summary["went_up"]}건이 올랐다. ({went_up_pct:.1f}%)')
    lines.append("")
    lines.append(f'평균수익률 {summary["avg_return"]:+.1f}%')
    lines.append(f'시장 평균은 {summary["avg_market_return"]:+.1f}%')
    lines.append(f'초과수익 {avg_alpha:+.1f}%p')
    lines.append("")

    recent = timeline[-3:] if len(timeline) >= 3 else timeline
    if recent:
        lines.append("최근 추이:")
        for t in recent:
            ym = t["ym"]
            ym_str = f"{ym[:4]}.{ym[4:]}"
            lines.append(
                f'  {ym_str}: {t["count"]}건 중 {t["went_up"]}건↑ ({t["went_up_pct"]:.0f}%) {t["avg_return"]:+.1f}%'
            )

    six = data.get("six_month", {})
    if six:
        lines.append("")
        lines.append(f'6개월 전 추천 → 지금:')
        lines.append(
            f'  {six.get("total", 0)}건 중 {six.get("went_up", 0)}건↑ · 수익률 {six.get("avg_return", 0):+.1f}%'
        )

    lines.append("")
    lines.append("aptmine 저평가 알고리즘 실적")
    lines.append(f"{TODAY.strftime('%Y.%m.%d')} 기준")
    lines.append("aptmine.com")

    title = "저평가 아파트 사면 정말 오를까?"
    return title, lines, None


# ══════════════════════════════════════════════
# 거래량 TOP 5 (서울+경기 합산, --volume)
# ══════════════════════════════════════════════
def _load_lawd_codes():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, script_dir)
    from lawd_codes import LAWD_CODES
    rev = {}
    seoul_set = set()
    for sido, districts in LAWD_CODES.items():
        for code, sigungu in districts.items():
            rev[code] = (sido, sigungu)
            if sido == "서울":
                seoul_set.add(sigungu)
    return rev, seoul_set


def _short_sigungu(name):
    """용인시기흥구 → 용인 기흥구"""
    m = re.match(r"(.+?)시(.+)", name)
    if m and ("구" in m.group(2) or "군" in m.group(2)):
        return f"{m.group(1)} {m.group(2)}"
    return name


def generate_volume_ranking():
    """서울+경기 거래량 TOP5 — YTD vs 전년 동기 & 연간"""
    rev, seoul_set = _load_lawd_codes()
    idx = load_json("index.json")

    year = TODAY.year
    ytd_months = {f"{year}{m:02d}" for m in range(1, TODAY.month + 1)}
    prev_same = {f"{year - 1}{m:02d}" for m in range(1, TODAY.month + 1)}
    prev_full = {f"{year - 1}{m:02d}" for m in range(1, 13)}

    ytd_cnt = defaultdict(int)
    ps_cnt = defaultdict(int)
    pf_cnt = defaultdict(int)

    for e in idx["files"]:
        code = str(e["lawd_cd"])
        if code not in rev:
            continue
        sido, sigungu = rev[code]
        if sido not in ("서울", "경기"):
            continue
        ym = e["deal_ym"]
        if ym in ytd_months:
            ytd_cnt[sigungu] += e["count"]
        if ym in prev_same:
            ps_cnt[sigungu] += e["count"]
        if ym in prev_full:
            pf_cnt[sigungu] += e["count"]

    ranked = sorted(ytd_cnt.items(), key=lambda x: -x[1])
    top5 = ranked[:5]

    # 서울 최다 & 전체 순위
    seoul_top = [(n, c) for n, c in ranked if n in seoul_set]
    seoul_rank = next(
        (i + 1 for i, (n, _) in enumerate(ranked) if n in seoul_set), None
    )

    ml = f"1~{TODAY.month}월"
    lines = []
    lines.append(f"🏠 {year}년 서울+경기 거래량 TOP 5")
    lines.append(f"({ml} 누적, {TODAY.strftime('%m/%d')} 기준)")
    lines.append("")

    for i, (name, cnt) in enumerate(top5, 1):
        sn = _short_sigungu(name)
        ps = ps_cnt.get(name, 0)
        pf = pf_cnt.get(name, 0)

        yoy = ""
        if ps > 0:
            pct = (cnt / ps - 1) * 100
            yoy = f"전년동기 {ps:,d}건({pct:+.0f}%)"
        annual = f"{year - 1}년 연간 {pf:,d}건" if pf > 0 else ""
        sub = " | ".join(s for s in [yoy, annual] if s)

        lines.append(f"{i}. {sn} {cnt:,d}건")
        if sub:
            lines.append(f"   └ {sub}")

    # 서울 TOP3 별도 표시 (TOP5에 없으면)
    seoul_in_top5 = any(n in seoul_set for n, _ in top5)
    if not seoul_in_top5 and seoul_top:
        lines.append("")
        s3 = " > ".join(
            f"{_short_sigungu(n)}({c:,d})" for n, c in seoul_top[:3]
        )
        lines.append(f"서울 최다: {s3}")
        if seoul_rank:
            lines.append(
                f"(서울 1위 {_short_sigungu(seoul_top[0][0])}는 전체 {seoul_rank}위)"
            )

    lines.append("")
    if TODAY.month <= 2:
        lines.append(f"{TODAY.month}월은 신고접수 중, 추가 반영 예정")
    lines.append("📊 aptmine.com")

    title = "서울+경기 거래량 TOP 5"
    return title, lines, top5


# ── 요일 → 생성 함수 매핑 ──
# ══════════════════════════════════════════════
# 상세 데이터 블록 생성 (노션 하위 페이지용)
# ══════════════════════════════════════════════
def _build_detail_blocks(top_items):
    """top_items 리스트에서 노션 상세 데이터 블록 생성."""
    if not top_items:
        return []

    geo_data = None
    blocks = []

    for a in top_items:
        apt_name = a.get("apt_name", "?")
        sigungu = a.get("sigungu", "")
        dong = a.get("dong_name", "")
        area = a.get("area_m2", 0)

        # heading_2: 아파트명
        blocks.append({
            "type": "heading_2",
            "heading_2": {"rich_text": [rich(f"{apt_name} ({sigungu} {dong}, {int(area)}m²)")]}
        })

        # callout: 상세 정보
        detail_lines = []

        # 가격 정보
        if a.get("current_price"):
            detail_lines.append(f"현재가: {fmt_price(a['current_price'])}")
        elif a.get("price"):
            if a.get("area_m2") and a["area_m2"] > 0 and a["price"] < 1000:
                # price is per m² (summary/bottom/newhigh)
                detail_lines.append(f"현재가: {fmt_price_m2(a['price'], a['area_m2'])}")
            else:
                detail_lines.append(f"현재가: {fmt_price(a['price'])}")

        # 최근 실거래
        apt_id = a.get("id", "")
        if apt_id:
            deal_price, deal_date = _get_latest_deal(apt_id)
            if deal_price:
                detail_lines.append(f"최근실거래: {deal_price/10000:.1f}억 ({deal_date})")

        # 저평가 관련 (월/수)
        if a.get("gap_pct") is not None:
            detail_lines.append(f"벌어짐: {a['gap_pct']:+.1f}%p")
        if a.get("recent_avg"):
            detail_lines.append(f"3개월 평균: {a['recent_avg']/10000:.1f}억")
        if a.get("avg_36"):
            detail_lines.append(f"3년 평균: {a['avg_36']/10000:.1f}억")
        if a.get("compare_avg_recent"):
            detail_lines.append(f"비교단지 3개월: {a['compare_avg_recent']/10000:.1f}억")

        # 출퇴근 (화)
        if a.get("commute_gangnam"):
            detail_lines.append(f"강남 출퇴근: {a['commute_gangnam']}분")

        # 학군 (수)
        if a.get("academy_score"):
            detail_lines.append(f"학원가 점수: {a['academy_score']}점")

        # 신고가 (목)
        if a.get("vs_all_time_peak") is not None:
            detail_lines.append(f"전고점 대비: {a['vs_all_time_peak']:+.1f}%")

        # 바닥 반등 (금)
        if a.get("bounce_pct"):
            detail_lines.append(f"반등폭: +{a['bounce_pct']:.1f}%")
        if a.get("trough"):
            trough_ym = a.get("trough_ym", "")
            trough_str = f"{trough_ym[:4]}.{trough_ym[4:]}" if len(trough_ym) == 6 else trough_ym
            detail_lines.append(f"저점: {fmt_price_m2(a['trough'], a.get('area_m2', 1))} ({trough_str})")

        # 인프라 (토)
        if a.get("loc_score"):
            detail_lines.append(f"입지점수: {a['loc_score']}점")
        if a.get("location_gap"):
            detail_lines.append(f"입지갭: +{a['location_gap']}")

        # geo 정보
        if geo_data is None:
            try:
                geo_data = load_json("valuation_geo.json")
            except Exception:
                geo_data = {}
        g = geo_data.get(apt_id, {})
        if g:
            station = g.get("subway", "")
            sline = g.get("subway_line", "")
            walk = g.get("subway_walk_min", "")
            if station:
                detail_lines.append(f"지하철: {station}({sline}) 도보{walk}분")
            commute = g.get("commute", {})
            if commute.get("gangnam"):
                detail_lines.append(f"강남: {commute['gangnam']}분")
            if g.get("households"):
                detail_lines.append(f"세대수: {g['households']:,}")
            if g.get("infra_score") is not None:
                detail_lines.append(f"인프라: {_infra_label(g['infra_score'])}({g['infra_score']}점)")
            if g.get("academy_score") is not None:
                detail_lines.append(f"학군: {g['academy_score']}점")

        # 최근 거래 흐름 (최근 5건)
        if apt_id:
            path = os.path.join(BY_APT_DIR, f"{apt_id}.json")
            if os.path.exists(path):
                try:
                    with open(path) as f:
                        txns = json.load(f)
                    txns.sort(key=lambda x: x[0])
                    recent5 = txns[-5:]
                    if recent5:
                        flow = " → ".join(f"{t[1]/10000:.1f}억" for t in recent5)
                        detail_lines.append(f"최근 거래: {flow}")
                except Exception:
                    pass

        callout_text = "\n".join(detail_lines)
        blocks.append({
            "type": "callout",
            "callout": {
                "rich_text": [rich(callout_text)],
                "icon": {"type": "emoji", "emoji": "📊"},
            }
        })

        # 비교단지 bulleted_list
        compares = a.get("compare", [])
        if compares:
            blocks.append({"type": "paragraph", "paragraph": {"rich_text": [rich("비교단지:")]}})
            for c in compares:
                c_text = f'{c["apt_name"]} ({c.get("sigungu", "")} {c.get("dong_name", "")}, {int(c.get("area_m2", 0))}m²)'
                if c.get("recent_avg"):
                    c_text += f' · 3개월 {c["recent_avg"]/10000:.1f}억'
                if c.get("corr"):
                    c_text += f' · 상관 {c["corr"]:.2f}'
                blocks.append({
                    "type": "bulleted_list_item",
                    "bulleted_list_item": {"rich_text": [rich(c_text)]}
                })

        # 거래량 관련 (volume mode)
        if a.get("ytd_count") is not None:
            vol_text = f'YTD {a["ytd_count"]}건'
            if a.get("prev_same_count") is not None:
                vol_text += f' (전년동기 {a["prev_same_count"]}건)'
            blocks.append({"type": "paragraph", "paragraph": {"rich_text": [rich(vol_text)]}})

    return blocks


GENERATORS = {
    0: generate_monday,
    1: generate_tuesday,
    2: generate_wednesday,
    3: generate_thursday,
    4: generate_friday,
    5: generate_saturday,
    6: generate_sunday,
}

DAY_NAMES = {
    0: "월요일",
    1: "화요일",
    2: "수요일",
    3: "목요일",
    4: "금요일",
    5: "토요일",
    6: "일요일",
}


# ── 메인 ──
def main():
    volume_mode = "--volume" in sys.argv

    # DOW 환경변수로 요일 오버라이드 (0=월 ~ 6=일)
    dow_env = os.environ.get("DOW")
    if dow_env is not None:
        dow = int(dow_env)
    else:
        dow = TODAY.weekday()

    if volume_mode:
        print("모드: 거래량 TOP 5")
    else:
        print(f"요일: {DAY_NAMES[dow]} (DOW={dow})")
    print(f"Dry-run: {DRY_RUN}")
    print()

    if volume_mode:
        title, lines, top_items = generate_volume_ranking()
    else:
        gen_fn = GENERATORS[dow]
        title, lines, top_items = gen_fn()

    print(f"주제: {title}")
    print(f"생성 라인: {len(lines)}줄")
    print()

    thread_parts = split_threads(lines)
    print(f"Threads 파트 수: {len(thread_parts)}")
    for i, p in enumerate(thread_parts):
        print(f"  파트{i + 1}: {len(p)}자")
    print()

    # 콘솔 출력
    for i, p in enumerate(thread_parts):
        print(f"── 파트 {i + 1} ──")
        print(p)
        print()

    if DRY_RUN:
        print("(dry-run 모드: 노션 업데이트 건너뜀)")
        return

    if not NOTION_API_KEY:
        print("NOTION_API_KEY가 설정되지 않았습니다. 노션 업데이트를 건너뜁니다.")
        return

    # 하위 페이지(파일) 방식: 부모 페이지 안에 새 페이지 생성
    date_str = TODAY.strftime("%Y-%m-%d")
    day_label = f" {DAY_NAMES[dow]} |" if not volume_mode else ""
    page_title = f"{date_str}{day_label} {title}"

    blocks = []
    # Threads 게시용
    blocks.append({"type": "heading_1", "heading_1": {"rich_text": [rich("Threads 게시용")]}})
    for part in thread_parts:
        blocks.append(
            {"type": "code", "code": {"rich_text": [rich(part)], "language": "plain text"}}
        )

    # 상세 데이터
    detail_blocks = _build_detail_blocks(top_items)
    if detail_blocks:
        blocks.append({"type": "divider", "divider": {}})
        blocks.append({"type": "heading_1", "heading_1": {"rich_text": [rich("상세 데이터")]}})
        blocks.extend(detail_blocks)

    print(f"노션에 하위 페이지 생성 중... ({page_title})")
    new_id = create_child_page(PAGE_ID, page_title, blocks)
    if new_id:
        print(f"✓ 노션 하위 페이지 생성 완료! (id: {new_id})")
    else:
        print("✗ 노션 업데이트 실패")


if __name__ == "__main__":
    main()

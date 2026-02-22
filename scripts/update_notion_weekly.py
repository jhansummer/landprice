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
    """저평가 TOP3 한 블록(시도별) 생성 — 비교단지·3년/3개월·벌어짐 포함"""
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
    lines.append(f"📍 {sido_label} 저평가 아파트 TOP 3")
    lines.append(f"{TODAY.strftime('%Y-%m-%d')} 기준 · 국토부 실거래가 분석")
    lines.append("")
    lines.append("비교단지 대비 최근 3개월이 3년 평균보다 더 벌어진 단지")
    lines.append("= 시장에서 상대적으로 못 올라온 아파트")
    lines.append("")

    for i, a in enumerate(top3, 1):
        pyeong = int(round(a["area_m2"] / 3.306))
        recent_eok = a["recent_avg"] / 10000

        # 최근 실거래 정보
        deal_price, deal_date = _get_latest_deal(a["id"])
        if deal_price:
            deal_eok = deal_price / 10000
            deal_date_fmt = deal_date.replace("-", ".")
            deal_str = f"최근실거래가 {deal_eok:.1f}억원({deal_date_fmt})"
        else:
            deal_str = f"최근실거래가 {recent_eok:.1f}억원"

        # geo 정보
        g = geo.get(a["id"], {})
        station = g.get("subway", "?")
        sline = g.get("subway_line", "")
        walk = g.get("subway_walk_min", "?")
        gangnam = g.get("commute", {}).get("gangnam", "?")

        # 호가 표시
        listing_str = ""
        listing = listing_map.get(a["id"])
        if listing:
            l_min = listing["min"] / 10000
            l_max = listing["max"] / 10000
            if l_min == l_max:
                listing_str = f" · 매물 {l_min:.1f}억({listing['count']}건)"
            else:
                listing_str = f" · 매물 {l_min:.1f}~{l_max:.1f}억({listing['count']}건)"

        # 비교단지 정보
        compares = a.get("compare", [])
        comp_names = ", ".join(c["apt_name"] for c in compares)
        comp_recent = sum(c.get("recent_avg", 0) for c in compares) / max(1, len(compares)) if compares else 0
        comp_36 = sum(c.get("avg_36", 0) for c in compares) / max(1, len(compares)) if compares else 0

        avg36_eok = (a.get("avg_36", 0) or 0) / 10000
        comp36_eok = comp_36 / 10000
        diff36 = ((a.get("avg_36", 0) / comp_36) - 1) * 100 if comp_36 else 0
        comp_recent_eok = comp_recent / 10000
        diff_recent = ((a["recent_avg"] / comp_recent) - 1) * 100 if comp_recent else 0
        gap_widening = diff_recent - diff36

        lines.append(f"{i}. {a['apt_name']} ({a['sigungu']} {a.get('dong_name', '')}, {pyeong}평)")
        lines.append(f"  {deal_str}{listing_str}")
        lines.append(f"  {station}({sline}) 도보{walk}분 · 강남{gangnam}분")
        lines.append(f"  비교단지: {comp_names}")
        lines.append(f"  3년 {avg36_eok:.1f}억 vs {comp36_eok:.1f}억 (차이 {diff36:+.1f}%)")
        lines.append(f"  3개월 {recent_eok:.1f}억 vs {comp_recent_eok:.1f}억 (차이 {diff_recent:+.1f}%) → 벌어짐 {gap_widening:+.1f}%p")
        lines.append("")

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

    with_listings = "--with-listings" in sys.argv
    lines = _fmt_uv_block("전국", top3, geo, fetch_listings=with_listings)

    title = "저평가 TOP 3 (전국)"
    return title, lines, top3


# ══════════════════════════════════════════════
# 화요일: 강남 30분 출퇴근 가성비 아파트
# ══════════════════════════════════════════════
def generate_tuesday():
    geo = load_json("valuation_geo.json")

    # 강남 출퇴근 30분 이내 아파트 ID 추출
    gangnam_ids = set()
    for apt_id, g in geo.items():
        commute = g.get("commute", {})
        if commute.get("gangnam") is not None and commute["gangnam"] <= 30:
            gangnam_ids.add(apt_id)

    # 모든 valuation 파일에서 가격 정보 수집
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

    # 가격 낮은 순 TOP 3
    candidates.sort(key=lambda x: x.get("current_price", float("inf")))
    top5 = candidates[:3]

    lines = []
    lines.append("🏢 강남 30분 출퇴근 가성비 아파트 TOP 3")
    lines.append(f"({TODAY.strftime('%Y.%m.%d')} 기준)")
    lines.append("")
    lines.append("대중교통 기준 강남까지 30분 이내")
    lines.append("가격 낮은 순 정렬")
    lines.append("")

    for i, a in enumerate(top5):
        lines.append(
            f'{i + 1}. {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})'
        )
        lines.append(
            f'   {fmt_price(a["current_price"])} | 강남 {a["commute_gangnam"]}분'
        )

    lines.append("")
    lines.append("대중교통 통근시간은 ODsay API 기준")
    lines.append("aptmine.com")

    title = "강남 30분 출퇴근 가성비 아파트"
    return title, lines, top5


# ══════════════════════════════════════════════
# 수요일: 학군 좋은 저평가 단지
# ══════════════════════════════════════════════
def generate_wednesday():
    geo = load_json("valuation_geo.json")
    uv_data = load_json("undervalued.json")

    # 학군 좋은 아파트 (academy_score >= 70)
    academy_ids = {}
    for apt_id, g in geo.items():
        score = g.get("academy_score")
        if score is not None and score >= 70:
            academy_ids[apt_id] = score

    # 저평가 아파트 수집
    uv_map = {}
    for sido in SIDOS:
        for item in uv_data["sidos"].get(sido, {}).get("undervalued", []):
            item["sido"] = sido
            uv_map[item["id"]] = item

    # 교집합
    candidates = []
    for apt_id in academy_ids:
        if apt_id in uv_map:
            item = uv_map[apt_id]
            item["academy_score"] = academy_ids[apt_id]
            candidates.append(item)

    candidates.sort(key=lambda x: x.get("gap_pct", 0))
    top5 = candidates[:3]

    lines = []
    lines.append("🎓 학군 좋은 저평가 아파트 TOP 3")
    lines.append(f"({TODAY.strftime('%Y.%m.%d')} 기준)")
    lines.append("")
    lines.append("학원가 점수 70점↑ & 저평가 단지 교집합")
    lines.append("")

    for i, a in enumerate(top5):
        lines.append(
            f'{i + 1}. {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})'
        )
        lines.append(
            f'   {fmt_price(a["current_price"])} | 괴리율 {a["gap_pct"]:+.1f}% | 학원가 {a["academy_score"]}점'
        )

    if not top5:
        lines.append("해당 조건에 맞는 단지가 없습니다.")

    lines.append("")
    lines.append("학원가 점수: 반경 1km 내 학원 밀집도 기준")
    lines.append("aptmine.com")

    title = "학군 좋은 저평가 단지"
    return title, lines, top5


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

    # vs_all_time_peak 큰 순 (= 역대 최고가 대비 가장 많이 오른)
    all_items.sort(key=lambda x: x.get("vs_all_time_peak", 0), reverse=True)
    top5 = all_items[:3]

    lines = []
    lines.append("🚀 신고가 갱신 아파트 TOP 3")
    lines.append(f"({TODAY.strftime('%Y.%m.%d')} 기준)")
    lines.append("")
    lines.append("역대 최고가를 넘어선 단지들")
    lines.append("")

    for i, a in enumerate(top5):
        loc = f'{a["sigungu"]} {a["dong_name"]}'
        lines.append(
            f'{i + 1}. {a["apt_name"]} ({loc}, {fmt_area(a["area_m2"])})'
        )
        lines.append(
            f'   현재 {fmt_price_m2(a["price"], a["area_m2"])} | 전고점 대비 +{a["vs_all_time_peak"]:.1f}%'
        )

    lines.append("")
    lines.append("전고점 대비 상승률 기준 정렬")
    lines.append("aptmine.com")

    title = "신고가 갱신 단지"
    return title, lines, top5


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
            # 바닥 대비 반등폭 계산
            if item.get("price") and item.get("trough") and item["trough"] > 0:
                item["bounce_pct"] = (item["price"] / item["trough"] - 1) * 100
            else:
                item["bounce_pct"] = 0
            all_turning.append(item)

    all_turning.sort(key=lambda x: x["bounce_pct"], reverse=True)
    top5 = all_turning[:3]

    lines = []
    lines.append("📈 바닥 반등 아파트 TOP 3")
    lines.append(f"({TODAY.strftime('%Y.%m.%d')} 기준)")
    lines.append("")
    lines.append("저점 찍고 반등 중인 단지들")
    lines.append("")

    for i, a in enumerate(top5):
        lines.append(
            f'{i + 1}. {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})'
        )
        trough_ym = a.get("trough_ym", "")
        trough_str = f"{trough_ym[:4]}.{trough_ym[4:]}" if len(trough_ym) == 6 else trough_ym
        lines.append(
            f'   현재 {fmt_price_m2(a["price"], a["area_m2"])} | 저점 {fmt_price_m2(a["trough"], a["area_m2"])} ({trough_str})'
        )
        lines.append(
            f'   반등 +{a["bounce_pct"]:.1f}% | 전고점 대비 {a["vs_all_time_peak"]:+.1f}%'
        )

    lines.append("")
    lines.append("저점 대비 반등폭 기준 정렬")
    lines.append("aptmine.com")

    title = "바닥 반등 단지"
    return title, lines, top5


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
    top5 = all_items[:3]

    lines = []
    lines.append("🏘️ 인프라 대비 가성비 좋은 아파트 단지 TOP 3")
    lines.append(f"({TODAY.strftime('%Y.%m.%d')} 기준)")
    lines.append("")
    lines.append("주변 인프라는 좋은데 가격은 아직 저렴한 단지")
    lines.append("")

    for i, a in enumerate(top5):
        lines.append(
            f'{i + 1}. {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})'
        )
        lines.append(f'   {fmt_price(a["price"])}')
        g = geo.get(a["id"])
        if g:
            subway = g.get("subway", "?")
            sline = g.get("subway_line", "")
            walk = g.get("subway_walk_min", "?")
            gangnam = g.get("commute", {}).get("gangnam", "?")
            inf = g.get("infra", {})
            hh = g.get("households", 0)
            inf_score = g.get("infra_score", 0)
            academy = inf.get("academy", 0)
            school = inf.get("school", 0)
            lines.append(f'   {subway}({sline}) 도보{walk}분, 강남{gangnam}분')
            lines.append(
                f'   학원{academy}개·학교{school}개, '
                f'생활인프라 {_infra_label(inf_score)}, '
                f'{hh:,}세대'
            )

    lines.append("")
    lines.append("aptmine.com")

    title = "인프라 대비 가성비 좋은 단지"
    return title, lines, top5


# ══════════════════════════════════════════════
# 일요일: 주간 백테스트 성적표
# ══════════════════════════════════════════════
def generate_sunday():
    data = load_json("backtest.json")
    summary = data["summary"]
    timeline = data.get("timeline", [])

    lines = []
    lines.append("📊 주간 백테스트 성적표")
    lines.append(f"({TODAY.strftime('%Y.%m.%d')} 기준)")
    lines.append("")
    lines.append("aptmine 저평가 알고리즘 실제 수익률")
    lines.append("")

    lines.append("▸ 전체 성적")
    lines.append(f'  총 {summary["total_picks"]}건 중 {summary["went_up"]}건 상승 ({summary["went_up_pct"]:.1f}%)')
    lines.append(f'  평균수익률 {summary["avg_return"]:+.1f}% (시장 {summary["avg_market_return"]:+.1f}%)')
    lines.append(f'  초과수익(알파) {summary["avg_alpha"]:+.1f}%')
    lines.append("")

    # 최근 3개월 타임라인
    recent = timeline[-3:] if len(timeline) >= 3 else timeline
    if recent:
        lines.append("▸ 최근 추이")
        for t in recent:
            ym = t["ym"]
            ym_str = f"{ym[:4]}.{ym[4:]}"
            lines.append(
                f'  {ym_str}: {t["count"]}건 중 {t["went_up"]}건↑ ({t["went_up_pct"]:.0f}%) 수익률 {t["avg_return"]:+.1f}%'
            )

    # 6개월 성적
    six = data.get("six_month", {})
    if six:
        lines.append("")
        lines.append(f'▸ 6개월 전 추천 성적 ({six.get("flag_ym", "")})')
        lines.append(
            f'  {six.get("total", 0)}건 중 {six.get("went_up", 0)}건↑ ({six.get("went_up_pct", 0):.0f}%)'
        )
        lines.append(
            f'  평균수익률 {six.get("avg_return", 0):+.1f}% | 알파 {six.get("avg_alpha", 0):+.1f}%'
        )

    lines.append("")
    lines.append("aptmine.com")

    title = "주간 백테스트 성적표"
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
    for part in thread_parts:
        blocks.append(
            {"type": "code", "code": {"rich_text": [rich(part)], "language": "plain text"}}
        )

    print(f"노션에 하위 페이지 생성 중... ({page_title})")
    new_id = create_child_page(PAGE_ID, page_title, blocks)
    if new_id:
        print(f"✓ 노션 하위 페이지 생성 완료! (id: {new_id})")
    else:
        print("✗ 노션 업데이트 실패")


if __name__ == "__main__":
    main()

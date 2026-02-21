#!/usr/bin/env python3
"""요일별 Threads 게시용 콘텐츠 → 노션 업데이트

DOW 환경변수(0=월~6=일)로 요일 오버라이드 가능.
--dry-run 플래그로 노션 업데이트 없이 콘솔 출력만 확인.
"""
import json, os, sys
from datetime import datetime

import requests

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


# ══════════════════════════════════════════════
# 월요일: 저평가 TOP 5 (전국)
# ══════════════════════════════════════════════
def generate_monday():
    data = load_json("undervalued.json")
    all_uv = []
    for sido in SIDOS:
        items = data["sidos"].get(sido, {}).get("undervalued", [])
        for item in items:
            item["sido"] = sido
            all_uv.append(item)

    all_uv.sort(key=lambda x: x.get("gap_pct", 0))
    top5 = all_uv[:5]

    lines = []
    lines.append("📉 이번 주 저평가 아파트 TOP 5 (전국)")
    lines.append(f"({TODAY.strftime('%Y.%m.%d')} 기준)")
    lines.append("")
    lines.append("비교단지 대비 최근 시세가 저평가된 단지")
    lines.append("국토부 실거래가 기준이라 실제 매물가와 다를 수 있음")
    lines.append("")

    for i, a in enumerate(top5):
        lines.append(
            f'{i + 1}. {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})'
        )
        lines.append(f'   현재 {fmt_price(a["current_price"])} | 괴리율 {a["gap_pct"]:+.1f}%')

    lines.append("")
    lines.append("괴리율 = 비교단지 대비 가격 차이 → 음수 클수록 저평가")
    lines.append("aptmine.com")

    title = "저평가 TOP 5 (전국)"
    return title, lines, top5


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

    # 가격 낮은 순 TOP 5
    candidates.sort(key=lambda x: x.get("current_price", float("inf")))
    top5 = candidates[:5]

    lines = []
    lines.append("🏢 강남 30분 출퇴근 가성비 아파트 TOP 5")
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
    top5 = candidates[:5]

    lines = []
    lines.append("🎓 학군 좋은 저평가 아파트 TOP 5")
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
    top5 = all_items[:5]

    lines = []
    lines.append("🚀 신고가 갱신 아파트 TOP 5")
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
    top5 = all_turning[:5]

    lines = []
    lines.append("📈 바닥 반등 아파트 TOP 5")
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
# 토요일: 입지 좋은데 싼 아파트
# ══════════════════════════════════════════════
def generate_saturday():
    data = load_json("location_value.json")

    all_items = []
    for sido in SIDOS:
        items = data.get("sidos", {}).get(sido, [])
        for item in items:
            item["sido"] = sido
            all_items.append(item)

    all_items.sort(key=lambda x: x.get("location_gap", 0), reverse=True)
    top5 = all_items[:5]

    lines = []
    lines.append("📍 입지 좋은데 싼 아파트 TOP 5")
    lines.append(f"({TODAY.strftime('%Y.%m.%d')} 기준)")
    lines.append("")
    lines.append("입지 점수 대비 가격이 낮은 단지")
    lines.append("")

    for i, a in enumerate(top5):
        lines.append(
            f'{i + 1}. {a["apt_name"]} ({fmt_loc(a)}, {fmt_area(a["area_m2"])})'
        )
        lines.append(
            f'   {fmt_price(a["price"])} | 입지 {a.get("loc_score", "?")}점 | 입지갭 {a["location_gap"]:.1f}'
        )

    lines.append("")
    lines.append("입지갭 = 입지점수 - 가격순위 → 클수록 가성비 좋음")
    lines.append("aptmine.com")

    title = "입지 좋은데 싼 아파트"
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
    # DOW 환경변수로 요일 오버라이드 (0=월 ~ 6=일)
    dow_env = os.environ.get("DOW")
    if dow_env is not None:
        dow = int(dow_env)
    else:
        dow = TODAY.weekday()  # 0=월 ~ 6=일

    print(f"요일: {DAY_NAMES[dow]} (DOW={dow})")
    print(f"Dry-run: {DRY_RUN}")
    print()

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

    # 기존 블록 삭제
    print("기존 블록 삭제 중...")
    for b in get_children(PAGE_ID):
        delete_block(b["id"])

    # 새 블록 작성
    blocks = []
    blocks.append(
        {"type": "heading_1", "heading_1": {"rich_text": [rich(f"{DAY_NAMES[dow]} | {title}")]}}
    )
    blocks.append(
        {
            "type": "paragraph",
            "paragraph": {"rich_text": [rich(f"업데이트: {TODAY.strftime('%Y-%m-%d %H:%M')}")]}
        }
    )
    blocks.append({"type": "divider", "divider": {}})

    # Threads 파트 → 코드 블록
    blocks.append(
        {"type": "heading_2", "heading_2": {"rich_text": [rich("Threads 게시용")]}}
    )
    for part in thread_parts:
        blocks.append(
            {"type": "code", "code": {"rich_text": [rich(part)], "language": "plain text"}}
        )

    print(f"노션에 {len(blocks)}개 블록 전송 중...")
    if append_blocks(PAGE_ID, blocks):
        print("✓ 노션 업데이트 완료!")
    else:
        print("✗ 노션 업데이트 실패")


if __name__ == "__main__":
    main()

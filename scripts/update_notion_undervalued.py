#!/usr/bin/env python3
"""분당구 20평대 저평가 아파트 TOP 10 → 노션 업데이트 (3개월 기준, Threads 게시용)"""
import json, os, requests
from datetime import datetime, timedelta
from collections import defaultdict

NOTION_API_KEY = os.environ["NOTION_API_KEY"]
PAGE_ID = "30c499fc-6e6d-8066-85be-ecbf98c12134"
HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}
BASE = "https://api.notion.com/v1"
BY_APT_DIR = "docs/data/apt_trade/by_apt"
TODAY = datetime.now()
THREE_MONTHS_AGO = TODAY - timedelta(days=90)

# ── 3개월 평균 계산 ──
def calc_avg_3m(apt_id):
    """by_apt/{id}.json에서 최근 3개월 거래 평균 계산"""
    path = os.path.join(BY_APT_DIR, f"{apt_id}.json")
    if not os.path.exists(path):
        return None, None
    with open(path) as f:
        trades = json.load(f)
    recent = []
    last_date = None
    for t in trades:
        d = datetime.strptime(t[0], "%Y-%m-%d")
        if d >= THREE_MONTHS_AGO:
            recent.append(t[1])
        last_date = t[0]
    avg = sum(recent) / len(recent) if recent else None
    return avg, last_date

# ── valuation 데이터 로드 ──
with open("docs/data/apt_trade/valuation/경기.json") as f:
    val_data = json.load(f)

# ── 분당구 20평대 필터 ──
candidates = []
for item in val_data["items"]:
    if "분당구" not in item["sigungu"]:
        continue
    if not (59 <= item["area_m2"] <= 84):
        continue
    if item.get("recent_3m_trades", 0) <= 0:
        continue

    # 3년 gap 체크
    compare_avg_36 = item.get("compare_avg_36", 0)
    if not compare_avg_36 or compare_avg_36 <= 0:
        continue
    avg_36 = item.get("avg_36", 0)
    if not avg_36:
        continue
    hist_gap = avg_36 / compare_avg_36 - 1
    if abs(hist_gap) > 0.15:
        continue

    # 3개월 평균 계산 (본인)
    my_avg_3m, last_trade = calc_avg_3m(item["id"])
    if my_avg_3m is None:
        continue

    # 비교단지 3개월 평균 계산
    comp_avgs_3m = []
    comp_details = []
    for c in item.get("compare", []):
        c_avg_3m, _ = calc_avg_3m(c["id"])
        if c_avg_3m is not None:
            comp_avgs_3m.append(c_avg_3m)
        comp_details.append({
            "apt": c["apt_name"],
            "dong": c["dong_name"],
            "area": c["area_m2"],
        })

    if not comp_avgs_3m:
        continue
    compare_avg_3m = sum(comp_avgs_3m) / len(comp_avgs_3m)

    recent_gap_3m = my_avg_3m / compare_avg_3m - 1
    divergence = (recent_gap_3m - hist_gap) * 100

    candidates.append({
        "id": item["id"],
        "apt": item["apt_name"],
        "dong": item["dong_name"],
        "area": item["area_m2"],
        "my_avg_3m": my_avg_3m,
        "compare_avg_3m": compare_avg_3m,
        "avg36": avg_36,
        "compare_avg36": compare_avg_36,
        "divergence": round(divergence, 2),
        "hist_gap": round(hist_gap * 100, 2),
        "recent_gap_3m": round(recent_gap_3m * 100, 2),
        "last_trade": last_trade,
        "trades_3m": item["recent_3m_trades"],
        "comps": comp_details,
    })

# TOP 10 정렬
candidates.sort(key=lambda x: x["divergence"])
top10 = candidates[:10]
for i, a in enumerate(top10):
    a["rank"] = i + 1

print(f"후보: {len(candidates)}개 → TOP 10 추출")
for a in top10:
    print(f"  {a['rank']}. {a['apt']} ({a['dong']}, 전용{int(a['area'])}m²) "
          f"벌어짐 {a['divergence']:.1f}% 3개월 {a['my_avg_3m']/10000:.1f}억 vs 비교 {a['compare_avg_3m']/10000:.1f}억")

# ── Threads 텍스트 ──
def fmt_price(v):
    return f"{v/10000:.1f}억"

def fmt_date_short(d):
    if d is None:
        return "?"
    y, m, day = d.split("-")
    if y == "2026":
        return f"{m}.{day}"
    return f"{y[2:]}.{m}.{day}"

lines = []
lines.append("오늘의 분석, 분당구 20평대")
lines.append("국토부 실거래가 기준이라 실제 매물은 비싸거나 없을수도 있어")
lines.append("직전 3년에 비해 최근 3개월 시세가 벌어진 단지니까 참고해봐")
lines.append("")
lines.append("분당구 20평대 저평가 아파트 TOP 10")
lines.append(f"({TODAY.strftime('%Y.%m.%d')} 기준, 최근3개월 거래 있는 단지)")
lines.append("")

for a in top10:
    area_int = int(a["area"])
    lines.append(
        f'{a["rank"]}. {a["apt"]} ({a["dong"]}, {area_int}m²) 최근거래 {fmt_date_short(a["last_trade"])}'
    )
    lines.append(
        f'   3년 {fmt_price(a["avg36"])} vs {fmt_price(a["compare_avg36"])} ({a["hist_gap"]:+.1f}%)'
    )
    lines.append(
        f'   3개월 {fmt_price(a["my_avg_3m"])} vs {fmt_price(a["compare_avg_3m"])} ({a["recent_gap_3m"]:+.1f}%) → 벌어짐 {a["divergence"]:.1f}%'
    )
    comp_names = ", ".join(f'{c["apt"]} ({int(c["area"])}m²)' for c in a["comps"])
    lines.append(f'   ↳ 비교: {comp_names}')

lines.append("")
lines.append("비교단지: 같은 지역, 비슷한 면적, 가격흐름 유사(상관계수 0.9↑)")
lines.append("벌어짐 = 3개월괴리 - 3년괴리 → 음수 클수록 저평가")
lines.append("")
lines.append("aptmine.com")

# ── 500자 분할 ──
def split_threads(max_chars=500):
    parts = []
    chunks = []
    chunks.append("\n".join(lines[:7]))
    # Each apartment = 4 lines now (name, 3yr, 3mo, comps)
    for i in range(10):
        idx = 7 + i * 4
        chunks.append("\n".join(lines[idx:idx+4]))
    outro_idx = 7 + 10 * 4
    chunks.append("\n".join(lines[outro_idx:]))

    current = ""
    for chunk in chunks:
        test = (current + "\n" + chunk).strip() if current else chunk
        if len(test) <= max_chars - 8:
            current = test
        else:
            if current:
                parts.append(current)
            current = chunk
    if current:
        parts.append(current)
    total = len(parts)
    return [f"{p}\n[{i+1}/{total}]" for i, p in enumerate(parts)]

thread_parts = split_threads()
print(f"\nThreads 파트 수: {len(thread_parts)}")
for i, p in enumerate(thread_parts):
    print(f"  파트{i+1}: {len(p)}자")

# ── Notion 업데이트 ──
def get_children(page_id):
    blocks = []
    url = f"{BASE}/blocks/{page_id}/children?page_size=100"
    while url:
        r = requests.get(url, headers=HEADERS)
        data = r.json()
        blocks.extend(data.get("results", []))
        nc = data.get("next_cursor")
        url = f"{BASE}/blocks/{page_id}/children?page_size=100&start_cursor={nc}" if nc else None
    return blocks

def delete_block(bid):
    requests.delete(f"{BASE}/blocks/{bid}", headers=HEADERS)

def rich(text):
    return {"type": "text", "text": {"content": text}}

print("\n기존 블록 삭제 중...")
for b in get_children(PAGE_ID):
    delete_block(b["id"])

blocks = []
blocks.append({"type": "heading_1", "heading_1": {"rich_text": [rich("Threads 게시용")]}})

for part in thread_parts:
    blocks.append({"type": "code", "code": {"rich_text": [rich(part)], "language": "plain text"}})

blocks.append({"type": "divider", "divider": {}})
blocks.append({"type": "heading_1", "heading_1": {"rich_text": [rich("상세 데이터")]}})

for a in top10:
    area_int = int(a["area"])
    blocks.append({
        "type": "heading_2",
        "heading_2": {"rich_text": [rich(f'{a["rank"]}. {a["apt"]} ({a["dong"]}, {area_int}m²)')]}
    })
    callout_text = (
        f'벌어짐: {a["divergence"]:.1f}% | '
        f'3년괴리: {a["hist_gap"]:+.1f}% | 3개월괴리: {a["recent_gap_3m"]:+.1f}%\n'
        f'3개월평균: {fmt_price(a["my_avg_3m"])} | 비교: {fmt_price(a["compare_avg_3m"])}\n'
        f'3년평균: {fmt_price(a["avg36"])} | 비교: {fmt_price(a["compare_avg36"])}\n'
        f'최근3개월 거래: {a["trades_3m"]}건 | 최근거래일자: {a["last_trade"]}'
    )
    blocks.append({
        "type": "callout",
        "callout": {
            "rich_text": [rich(callout_text)],
            "icon": {"type": "emoji", "emoji": "📊"},
            "color": "blue_background" if a["divergence"] < -3 else "gray_background"
        }
    })
    for c in a["comps"]:
        blocks.append({
            "type": "bulleted_list_item",
            "bulleted_list_item": {"rich_text": [rich(f'비교: {c["apt"]} ({c["dong"]}, {int(c["area"])}m²)')]}
        })

def append_blocks(page_id, block_list):
    for i in range(0, len(block_list), 100):
        batch = block_list[i:i+100]
        r = requests.patch(f"{BASE}/blocks/{page_id}/children", headers=HEADERS, json={"children": batch})
        if r.status_code != 200:
            print(f"Error: {r.status_code} {r.text[:300]}")
            return False
    return True

print(f"노션에 {len(blocks)}개 블록 전송 중...")
if append_blocks(PAGE_ID, blocks):
    print("✓ 노션 업데이트 완료!")
else:
    print("✗ 노션 업데이트 실패")

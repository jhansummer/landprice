#!/usr/bin/env python3
"""매매x전세 포지셔닝 분석 → Threads 텍스트 + 노션 페이지 생성"""

import json
import os
import requests
from datetime import datetime

BASE = os.path.join(os.path.dirname(__file__), '..', 'docs', 'data', 'apt_trade')
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '.env')
TODAY = datetime.now().strftime('%Y-%m-%d')
NOTION_PARENT_ID = '30c499fc-6e6d-8066-85be-ecbf98c12134'


def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env


def load_summary():
    with open(os.path.join(BASE, 'summary.json'), encoding='utf-8') as f:
        return json.load(f)


def compute_positioning(summary, sido):
    """Compute district-level positioning data (same logic as regional.js)."""
    sidos = summary.get('sidos', {})
    sido_data = sidos.get(sido)
    if not sido_data or 'districts' not in sido_data:
        return []

    districts = sido_data['districts']
    result = []

    for gu_name, dist in districts.items():
        trend = dist.get('trend', [])
        j_trend = dist.get('jeonse_trend', [])
        if not trend or len(trend) < 6:
            continue

        recent6 = trend[-6:]
        prev6 = trend[-12:-6] if len(trend) >= 12 else trend[:min(6, len(trend))]

        # 매매 변동률
        recent_avg = sum(t[1] for t in recent6) / len(recent6)
        prev_avg = sum(t[1] for t in prev6) / len(prev6)
        price_chg = ((recent_avg - prev_avg) / prev_avg * 100) if prev_avg > 0 else 0

        # 전세가 변동률 (매매평단가 × 전세가율로 전세가 추정)
        # Match by month key when trend/jeonse_trend have different lengths
        jeonse_chg = 0
        if j_trend and len(j_trend) >= 6:
            j_map = {t[0]: t[1] for t in j_trend}
            r_jeonse_vals = []
            for t in recent6:
                jr = j_map.get(t[0])
                if jr is not None:
                    r_jeonse_vals.append(t[1] * jr / 100)
            p_jeonse_vals = []
            for t in prev6:
                jr = j_map.get(t[0])
                if jr is not None:
                    p_jeonse_vals.append(t[1] * jr / 100)
            if r_jeonse_vals and p_jeonse_vals:
                r_jeonse = sum(r_jeonse_vals) / len(r_jeonse_vals)
                p_jeonse = sum(p_jeonse_vals) / len(p_jeonse_vals)
                jeonse_chg = ((r_jeonse - p_jeonse) / p_jeonse * 100) if p_jeonse > 0 else 0

        vol = sum(t[2] for t in trend[-3:] if len(t) > 2)

        # Phase
        if jeonse_chg >= 0 and price_chg >= 0:
            phase = '상승기'
        elif jeonse_chg < 0 and price_chg >= 0:
            phase = '회복초기'
        elif jeonse_chg < 0 and price_chg < 0:
            phase = '침체기'
        else:
            phase = '전세강세'

        result.append({
            'name': gu_name,
            'jeonse_chg': round(jeonse_chg, 1),
            'price_chg': round(price_chg, 1),
            'volume': vol,
            'phase': phase,
        })

    return result


def format_threads_text(sido, data, updated_at):
    """Format Threads posts — hook형 대화체, 나열 3개 이내, 개방형 질문 마무리."""
    phase_counts = {}
    for d in data:
        phase_counts[d['phase']] = phase_counts.get(d['phase'], 0) + 1
    total = len(data)

    sorted_data = sorted(data, key=lambda x: x['price_chg'], reverse=True)
    top_rise = [d for d in sorted_data if d['price_chg'] > 0][:3]
    top_fall = sorted([d for d in sorted_data if d['price_chg'] < 0], key=lambda x: x['price_chg'])[:3]

    rise_pct = round(phase_counts.get('상승기', 0) / total * 100) if total else 0
    recover_pct = round(phase_counts.get('회복초기', 0) / total * 100) if total else 0
    stag_pct = round(phase_counts.get('침체기', 0) / total * 100) if total else 0
    jeonse_pct = round(phase_counts.get('전세강세', 0) / total * 100) if total else 0

    parts = []

    # Part 1: Hook + 핵심 인사이트
    p1 = ""
    if rise_pct + recover_pct > 60:
        p1 += f"{sido} {total}개 구 중 {rise_pct + recover_pct}%가 같은 방향으로 움직이고 있어\n\n"
    elif stag_pct > 50:
        p1 += f"{sido} 절반 넘는 구가 매매·전세 동반 하락 중이야\n\n"
    else:
        p1 += f"{sido}, 옆 동네는 오르는데 우리 동네만 빠졌어\n\n"

    p1 += f"{updated_at} 실거래가 기반으로\n"
    p1 += "매매가 변동률 × 전세가 변동률로 시장 국면을 나눠봤어\n\n"

    # 가장 특징적인 국면 강조 (나열 아닌 서술)
    dominant = max(phase_counts, key=phase_counts.get)
    dom_cnt = phase_counts[dominant]
    dom_pct = round(dom_cnt / total * 100)
    p1 += f"결과: {dominant} {dom_cnt}곳({dom_pct}%)으로 압도적이야\n"
    if phase_counts.get('침체기', 0) > 0 and dominant != '침체기':
        p1 += f"근데 침체기도 {phase_counts['침체기']}곳 — 양극화 신호인 거지"
    elif phase_counts.get('전세강세', 0) > 0 and dominant != '전세강세':
        p1 += f"전세강세 {phase_counts['전세강세']}곳은 실수요만 움직이는 중이야"

    parts.append(p1.strip())

    # Part 2: 상승 TOP3 + 하락 TOP3
    p2 = "가장 뜨거운 곳 vs 차가운 곳\n\n"
    p2 += "📈 상승 TOP 3\n"
    for d in top_rise:
        p2 += f"· {d['name']} 매매{d['price_chg']:+.1f}% 전세{d['jeonse_chg']:+.1f}%\n"

    if top_fall:
        p2 += f"\n📉 하락 TOP {len(top_fall)}\n"
        for d in top_fall:
            p2 += f"· {d['name']} 매매{d['price_chg']:+.1f}% 전세{d['jeonse_chg']:+.1f}%\n"

    p2 += f"\n6개월 전 대비 변동률 기준이야"

    parts.append(p2.strip())

    # Part 3: 해석 + CTA
    p3 = "차트 읽는 법 알려줄게\n\n"
    p3 += "→ 매매↑전세↑ = 상승기 (동반 상승)\n"
    p3 += "→ 매매↑전세↓ = 회복초기 (투자 선행)\n"
    p3 += "→ 매매↓전세↓ = 침체기\n"
    p3 += "→ 매매↓전세↑ = 전세강세 (실수요만 버팀)\n\n"

    p3 += "너네 동네는 어떤 국면이야?\n"
    p3 += "aptmine.com 에서 확인해봐"

    parts.append(p3.strip())

    # Trim + part tags
    for i in range(len(parts)):
        tag = f"\n[{i+1}/{len(parts)}]"
        if len(parts[i]) + len(tag) > 500:
            parts[i] = parts[i][:500 - len(tag)]
        parts[i] += tag

    return parts


def create_notion_page(api_key, sido, parts, data, updated_at):
    """Create Notion page with Threads text and detailed data."""
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
    }

    # Phase counts
    phase_counts = {}
    for d in data:
        phase_counts[d['phase']] = phase_counts.get(d['phase'], 0) + 1
    total = len(data)

    sorted_data = sorted(data, key=lambda x: x['price_chg'], reverse=True)

    children = []

    # Heading: Threads 게시용
    children.append({
        "object": "block",
        "type": "heading_1",
        "heading_1": {"rich_text": [{"type": "text", "text": {"content": "Threads 게시용"}}]}
    })

    # Code blocks for each part
    for i, part in enumerate(parts):
        children.append({
            "object": "block",
            "type": "code",
            "code": {
                "rich_text": [{"type": "text", "text": {"content": part}}],
                "language": "plain text"
            }
        })

    # Divider
    children.append({"object": "block", "type": "divider", "divider": {}})

    # Heading: 상세 데이터
    children.append({
        "object": "block",
        "type": "heading_1",
        "heading_1": {"rich_text": [{"type": "text", "text": {"content": "상세 데이터"}}]}
    })

    # Summary callout
    summary_text = f"총 {total}개 구/군 · "
    for phase_name in ['상승기', '회복초기', '침체기', '전세강세']:
        cnt = phase_counts.get(phase_name, 0)
        pct = round(cnt / total * 100) if total else 0
        summary_text += f"{phase_name} {cnt}({pct}%) "
    children.append({
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": [{"type": "text", "text": {"content": summary_text.strip()}}],
            "icon": {"type": "emoji", "emoji": "📊"}
        }
    })

    # Table: district data
    children.append({
        "object": "block",
        "type": "heading_2",
        "heading_2": {"rich_text": [{"type": "text", "text": {"content": "구/군별 매매·전세 변동률"}}]}
    })

    # Table block
    table_rows = []
    # Header row
    header_cells = [
        [{"type": "text", "text": {"content": "구/군"}}],
        [{"type": "text", "text": {"content": "전세 변동률"}}],
        [{"type": "text", "text": {"content": "매매 변동률"}}],
        [{"type": "text", "text": {"content": "거래량"}}],
        [{"type": "text", "text": {"content": "국면"}}],
    ]
    table_rows.append({
        "type": "table_row",
        "table_row": {"cells": header_cells}
    })

    for d in sorted_data:
        sign_j = '+' if d['jeonse_chg'] >= 0 else ''
        sign_p = '+' if d['price_chg'] >= 0 else ''
        row_cells = [
            [{"type": "text", "text": {"content": d['name']}}],
            [{"type": "text", "text": {"content": f"{sign_j}{d['jeonse_chg']}%"}}],
            [{"type": "text", "text": {"content": f"{sign_p}{d['price_chg']}%"}}],
            [{"type": "text", "text": {"content": f"{d['volume']:,}건"}}],
            [{"type": "text", "text": {"content": d['phase']}}],
        ]
        table_rows.append({
            "type": "table_row",
            "table_row": {"cells": row_cells}
        })

    children.append({
        "object": "block",
        "type": "table",
        "table": {
            "table_width": 5,
            "has_column_header": True,
            "has_row_header": False,
            "children": table_rows
        }
    })

    # Phase-by-phase breakdown
    for phase_name in ['상승기', '회복초기', '침체기', '전세강세']:
        phase_data = [d for d in sorted_data if d['phase'] == phase_name]
        if not phase_data:
            continue
        emoji = {'상승기': '🔴', '회복초기': '🟢', '침체기': '🔵', '전세강세': '🟡'}[phase_name]
        children.append({
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": f"{emoji} {phase_name} ({len(phase_data)}개)"}}]}
        })
        for d in phase_data:
            children.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": [{"type": "text", "text": {"content":
                        f"{d['name']} · 매매 {d['price_chg']:+.1f}% · 전세 {d['jeonse_chg']:+.1f}% · {d['volume']:,}건"
                    }}]
                }
            })

    title = f"{sido} 매매x전세 포지셔닝 — {updated_at}"

    payload = {
        "parent": {"page_id": NOTION_PARENT_ID},
        "properties": {
            "title": {"title": [{"type": "text", "text": {"content": title}}]}
        },
        "children": children
    }

    resp = requests.post('https://api.notion.com/v1/pages', headers=headers, json=payload)
    if resp.status_code == 200:
        page = resp.json()
        print(f"[{sido}] Notion page created: {page['url']}")
        return page['url']
    else:
        print(f"[{sido}] Notion error {resp.status_code}: {resp.text}")
        return None


def main():
    env = load_env()
    api_key = env.get('NOTION_API_KEY')
    if not api_key:
        print("NOTION_API_KEY not found in .env")
        return

    summary = load_summary()
    updated_at = summary.get('current_month', TODAY)

    # Format date nicely
    if updated_at and len(updated_at) == 6:
        display_date = f"{updated_at[:4]}년 {int(updated_at[4:])}월"
    else:
        display_date = updated_at

    for sido in ['서울', '경기']:
        print(f"\n=== {sido} ===")
        data = compute_positioning(summary, sido)
        if not data:
            print(f"  No data for {sido}")
            continue

        parts = format_threads_text(sido, data, display_date)

        print(f"\n--- Threads 텍스트 ---")
        for i, p in enumerate(parts):
            print(f"\n[Part {i+1}] ({len(p)}자)")
            print(p)

        url = create_notion_page(api_key, sido, parts, data, display_date)
        if url:
            print(f"  → {url}")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Undervalued apartment analysis for Threads posting."""

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta

BASE = os.path.join(os.path.dirname(__file__), '..', 'docs', 'data', 'apt_trade')
TODAY = datetime.strptime('2026-02-22', '%Y-%m-%d')
CUTOFF_90 = TODAY - timedelta(days=90)


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def get_3m_avg(apt_id):
    """Get average price of transactions in last 90 days."""
    path = os.path.join(BASE, 'by_apt', f'{apt_id}.json')
    if not os.path.exists(path):
        return None
    trades = load_json(path)
    recent = [t[1] for t in trades if datetime.strptime(t[0], '%Y-%m-%d') >= CUTOFF_90]
    if not recent:
        return None
    return sum(recent) / len(recent)


def get_recent_trades(apt_id, n=5):
    """Get last N trades."""
    path = os.path.join(BASE, 'by_apt', f'{apt_id}.json')
    if not os.path.exists(path):
        return []
    trades = load_json(path)
    return trades[-n:]


def analyze(sido):
    val_path = os.path.join(BASE, 'valuation', f'{sido}.json')
    data = load_json(val_path)
    items = data['items']

    geo = load_json(os.path.join(BASE, 'valuation_geo.json'))
    meta = load_json(os.path.join(BASE, 'apt_meta.json'))

    results = []
    seen_names = set()

    for item in items:
        name = item['apt_name']
        if name in seen_names:
            continue

        # 3년 차이
        avg36 = item.get('avg_36', 0)
        comp_avg36 = item.get('compare_avg_36', 0)
        if not comp_avg36 or not avg36:
            continue

        diff_3y = (avg36 / comp_avg36 - 1) * 100

        # 3개월 평균 - 본인
        my_3m = get_3m_avg(item['id'])
        if my_3m is None:
            continue

        # 3개월 평균 - 비교단지
        comp_list = item.get('compare', [])
        if not comp_list:
            continue

        comp_3m_vals = []
        for c in comp_list:
            c_3m = get_3m_avg(c['id'])
            if c_3m is not None:
                comp_3m_vals.append(c_3m)

        if not comp_3m_vals:
            continue

        comp_3m_avg = sum(comp_3m_vals) / len(comp_3m_vals)
        diff_3m = (my_3m / comp_3m_avg - 1) * 100
        gap = diff_3m - diff_3y

        seen_names.add(name)

        # Geo info
        g = geo.get(item['id'], {})
        m = meta.get(item['id'])

        recent = get_recent_trades(item['id'])

        results.append({
            'id': item['id'],
            'apt_name': name,
            'sigungu': item['sigungu'],
            'dong': item['dong_name'],
            'area': int(item['area_m2']),
            'current_price': item['current_price'],
            'avg_36': avg36,
            'comp_avg_36': comp_avg36,
            'my_3m': my_3m,
            'comp_3m_avg': comp_3m_avg,
            'diff_3y': round(diff_3y, 1),
            'diff_3m': round(diff_3m, 1),
            'gap': round(gap, 1),
            'compare_names': [c['apt_name'] for c in comp_list[:3]],
            'compare_ids': [c['id'] for c in comp_list[:3]],
            'subway': g.get('subway', ''),
            'subway_line': g.get('subway_line', ''),
            'subway_walk_min': g.get('subway_walk_min', 0),
            'commute_gangnam': g.get('commute', {}).get('gangnam', 0),
            'households': g.get('households', 0),
            'built_year': m if m else '',
            'recent_trades': recent,
            'trade_count': item.get('trade_count', 0),
        })

    # Sort by gap ascending (most negative = most undervalued)
    results.sort(key=lambda x: x['gap'])
    return results[:10]


def fetch_naver_prices(items):
    """네이버 호가 최저가를 각 항목에 naver_price로 추가."""
    script = os.path.join(os.path.dirname(__file__), "fetch_naver_listings.py")
    if not os.path.exists(script) or not items:
        return
    args = [sys.executable, script]
    for a in items:
        args.append(f"{a['apt_name']}|{a['sigungu']}|{a['dong']}|{a['area']}")
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=600)
        if result.returncode == 0 and result.stdout.strip():
            listings = json.loads(result.stdout.strip())
            for a, lr in zip(items, listings):
                if lr and lr.get("min"):
                    a["naver_price"] = lr["min"]
    except Exception as e:
        print(f"네이버 호가 조회 실패: {e}", file=sys.stderr)


if __name__ == '__main__':
    sido = sys.argv[1] if len(sys.argv) > 1 else '서울'
    top10 = analyze(sido)

    if "--naver" in sys.argv:
        fetch_naver_prices(top10)

    print(json.dumps(top10, ensure_ascii=False, indent=2))

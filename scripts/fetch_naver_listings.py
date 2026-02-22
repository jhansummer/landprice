#!/usr/bin/env python3
"""네이버 부동산 매물 호가 조회 (독립 실행) — DOM 스크래핑 방식

사용: python scripts/fetch_naver_listings.py '아파트명|시군구|동|면적' ...
출력: JSON [{min, max, count}, null, ...] (stdout)
"""
import json
import re
import sys
import time

import browser_cookie3
import requests as req_lib
from playwright.sync_api import sync_playwright


def log(msg):
    print(msg, file=sys.stderr)


def parse_price_text(text):
    """가격 텍스트 → 만원 단위 정수. 예: '34억' → 340000, '29억 8,000' → 298000"""
    text = text.strip()
    eok_match = re.search(r'(\d+)억', text)
    eok = int(eok_match.group(1)) * 10000 if eok_match else 0
    man = 0
    after_eok = re.search(r'억\s*([\d,]+)', text)
    if after_eok:
        man = int(after_eok.group(1).replace(',', ''))
    elif not eok_match and re.match(r'^[\d,]+$', text.strip()):
        man = int(text.strip().replace(',', ''))
    return eok + man if (eok or man) else None


def search_complex_id(apt_name, sigungu, dong_name):
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
    # 괄호/숫자 접미사 제거한 이름도 시도
    clean_name = re.sub(r'\s*\(.*?\)\s*$', '', apt_name).strip()
    queries = [f"{apt_name} {sigungu} {dong_name} 네이버부동산", f"{apt_name} 네이버부동산"]
    if clean_name != apt_name:
        queries.insert(1, f"{clean_name} {sigungu} {dong_name} 네이버부동산")
        queries.append(f"{clean_name} 네이버부동산")
    for query in queries:
        for attempt in range(2):
            try:
                r = req_lib.get(
                    f"https://search.naver.com/search.naver?query={query}",
                    headers=headers, timeout=10,
                )
                matches = re.findall(r'fin\.land\.naver\.com/complexes/(\d+)', r.text)
                if matches:
                    log(f"  [호가] {apt_name} → complex_id={matches[0]}")
                    return matches[0]
            except Exception as e:
                log(f"  [호가] 검색 에러 ({query}): {e}")
            time.sleep(3)
    log(f"  [호가] {apt_name} → complex_id 못 찾음")
    return None


def scrape_listings(page, area_m2):
    """페이지 DOM에서 매매 매물 가격 추출 → {min, max, count} 또는 None"""
    cards = page.evaluate("""() => {
        var items = document.querySelectorAll('li[class*=ArticleCard]');
        return Array.from(items).map(function(li) {
            var priceEl = li.querySelector('[class*=price]');
            return {
                price: priceEl ? priceEl.innerText : '',
                text: li.innerText.substring(0, 300)
            };
        });
    }""")

    prices = []
    for card in cards:
        pt = card["price"]
        if not pt.startswith("매매"):
            continue
        # 면적 추출
        area_match = re.search(r'전용(\d+)', card["text"])
        area_val = float(area_match.group(1)) if area_match else 0
        # 면적 필터 (15% 이내)
        if area_m2 and area_val > 0 and abs(area_val - area_m2) / area_m2 > 0.15:
            continue
        # 가격 파싱 (범위인 경우 첫 번째 값)
        pt_clean = pt.replace("매매 ", "").split("~")[0].strip()
        # '변동', '하락내역 보기' 등 부가 텍스트 제거 (억/만 은 유지)
        pt_clean = re.sub(r'변동.*', '', pt_clean).strip()
        p = parse_price_text(pt_clean)
        if p:
            prices.append(p)

    # 면적 매칭 없으면 전체 매매에서 추출
    if not prices:
        for card in cards:
            pt = card["price"]
            if not pt.startswith("매매"):
                continue
            pt_clean = pt.replace("매매 ", "").split("~")[0].strip()
            pt_clean = re.sub(r'변동.*', '', pt_clean).strip()
            p = parse_price_text(pt_clean)
            if p:
                prices.append(p)

    if prices:
        return {"min": min(prices), "max": max(prices), "count": len(prices)}
    return None


def main():
    if len(sys.argv) < 2:
        print("[]")
        return

    apartments = []
    for arg in sys.argv[1:]:
        parts = arg.split("|")
        if len(parts) >= 4:
            apartments.append((parts[0], parts[1], parts[2], float(parts[3])))

    if not apartments:
        print("[]")
        return

    # 단지 ID 검색
    complex_ids = {}
    for apt_name, sigungu, dong_name, _ in apartments:
        cid = search_complex_id(apt_name, sigungu, dong_name)
        complex_ids[apt_name] = cid
        time.sleep(1)

    # Chrome 쿠키
    try:
        cj = browser_cookie3.chrome(domain_name=".naver.com")
    except Exception as e:
        log(f"  [호가] 쿠키 로드 실패: {e}")
        print(json.dumps([None] * len(apartments)))
        return

    cookies = [{"name": c.name, "value": c.value, "domain": c.domain, "path": c.path,
                **({"expires": c.expires} if c.expires else {})} for c in cj]

    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
            locale="ko-KR",
            extra_http_headers={
                "sec-ch-ua": '"Chromium";v="145", "Google Chrome";v="145", "Not:A-Brand";v="99"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"macOS"',
            },
        )
        context.add_cookies(cookies)
        context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")

        for apt_name, sigungu, dong_name, area_m2 in apartments:
            cid = complex_ids.get(apt_name)
            if not cid:
                results.append(None)
                continue

            page = context.new_page()
            try:
                page.goto(
                    f"https://fin.land.naver.com/complexes/{cid}?tab=article&tradeTypes=A1",
                    wait_until="networkidle", timeout=30000,
                )
                time.sleep(3)
                log(f"  [호가] {apt_name}: 페이지 로드 완료 (title={page.title()})")

                result = scrape_listings(page, area_m2)
                if result:
                    r_min = result['min'] / 10000
                    r_max = result['max'] / 10000
                    log(f"  [호가] {apt_name}: {r_min:.1f}~{r_max:.1f}억 ({result['count']}건)")
                else:
                    log(f"  [호가] {apt_name}: 매물 없음")
                results.append(result)
            except Exception as e:
                log(f"  [호가] {apt_name}: 에러={e}")
                results.append(None)
            finally:
                page.close()
                time.sleep(2)

        browser.close()

    print(json.dumps(results))


if __name__ == "__main__":
    main()

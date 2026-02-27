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
    # 숫자만 있는 접미사도 제거 (예: "목동신시가지1" → "목동신시가지")
    base_name = re.sub(r'\d+$', '', clean_name).strip()
    # 시군구에서 구/시 이름 추출 (성남시분당구 → 분당구, 분당)
    gu_match = re.search(r'(\w+[구군])', sigungu)
    gu_short = gu_match.group(1) if gu_match else sigungu
    gu_prefix = gu_short.replace("구", "").replace("군", "")  # 분당, 강남 등
    # 괄호 → 공백 변환 (상록마을(보성) → 상록마을 보성)
    spaced_name = re.sub(r'[()]', ' ', apt_name).strip()
    spaced_name = re.sub(r'\s+', ' ', spaced_name)
    queries = [
        f"{spaced_name} {gu_short} {dong_name} 아파트",
        f"{gu_prefix} {spaced_name} 아파트",
        f"{apt_name} {sigungu} {dong_name} 네이버부동산",
    ]
    if clean_name != apt_name:
        queries.append(f"{gu_prefix} {clean_name} 아파트")
        queries.append(f"{clean_name} {sigungu} {dong_name} 네이버부동산")
    queries.append(f"{apt_name} 네이버부동산")
    if clean_name != apt_name:
        queries.append(f"{clean_name} 네이버부동산")
    for query in queries:
        for attempt in range(2):
            try:
                r = req_lib.get(
                    f"https://search.naver.com/search.naver?query={query}",
                    headers=headers, timeout=10,
                )
                matches = re.findall(r'(?:fin\.)?land\.naver\.com/complexes/(\d+)', r.text)
                if matches:
                    log(f"  [호가] {apt_name} → complex_id={matches[0]}")
                    return matches[0]
            except Exception as e:
                log(f"  [호가] 검색 에러 ({query}): {e}")
            time.sleep(3)
    log(f"  [호가] {apt_name} → complex_id 못 찾음")
    return None


def verify_complex(page, apt_name, sigungu, dong_name):
    """페이지의 주소가 입력 시군구/동과 매칭되는지 검증."""
    try:
        # 헤더에 표시된 주소 텍스트 추출 (예: "강동구 둔촌동")
        addr = page.evaluate("""() => {
            var el = document.querySelector('[class*=HeaderName] [class*=address], [class*=header] [class*=address], [class*=Header] a[href*=complexes]');
            if (el) return el.innerText;
            // fallback: 헤더 영역에서 '구 ' 또는 '시 '가 포함된 텍스트
            var header = document.querySelector('header');
            return header ? header.innerText.substring(0, 200) : '';
        }""")
        title = page.title().strip()

        # 1. 시군구 확인 (예: "강동구", "용인시수지구")
        # 시군구에서 핵심 구/시 이름 추출
        gu_match = re.search(r'(\w+[구시군])', sigungu)
        gu_name = gu_match.group(1) if gu_match else sigungu
        addr_text = addr + " " + title

        if gu_name not in addr_text and dong_name not in addr_text:
            log(f"    주소 불일치: '{apt_name}' ({sigungu} {dong_name}) vs 페이지 '{addr.strip()[:50]}' / '{title}'")
            return False

        return True
    except Exception:
        return True  # 검증 실패 시 통과시킴


def apply_area_filter(page, area_m2):
    """네이버 페이지에서 면적 필터 체크박스를 클릭하여 해당 면적만 선택."""
    if not area_m2:
        return False
    try:
        # 1. '전체면적' 버튼 클릭 → 모달 열기
        btn = page.query_selector('button:has-text("전체면적")')
        if not btn:
            return False
        btn.click()
        time.sleep(1)

        # 2. 체크박스 항목 가져오기
        items = page.query_selector_all('[class*=CheckboxModal] li')
        if not items:
            return False

        # 3. '전체면적' (첫 항목) 클릭 → 전체 해제
        items[0].click()
        time.sleep(0.3)

        # 4. 대상 면적과 ±5% 이내인 항목 선택
        selected = 0
        for item in items[1:]:
            text = item.inner_text()
            m = re.search(r'\((\d+\.?\d*)', text)
            if m and abs(float(m.group(1)) - area_m2) / area_m2 < 0.05:
                item.click()
                selected += 1
                time.sleep(0.2)

        if not selected:
            # 매칭 없으면 전체 다시 선택
            items[0].click()
            time.sleep(0.3)
            page.query_selector('button:has-text("적용")').click()
            time.sleep(1)
            return False

        # 5. 적용 클릭
        page.query_selector('button:has-text("적용")').click()
        time.sleep(2)
        log(f"    면적 필터 적용: {selected}개 타입 선택")
        return True
    except Exception as e:
        log(f"    면적 필터 에러: {e}")
        return False


def scrape_listings(page):
    """페이지 DOM에서 매매 매물 가격 추출 → {min, max, count} 또는 None"""
    cards = page.evaluate("""() => {
        var items = document.querySelectorAll('li[class*=ArticleCard]');
        return Array.from(items).map(function(li) {
            var priceEl = li.querySelector('[class*=price]');
            return {
                price: priceEl ? priceEl.innerText : ''
            };
        });
    }""")

    prices = []
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

    # Chrome 쿠키 (선택적 — 없어도 동작)
    cookies = []
    try:
        cj = browser_cookie3.chrome(domain_name=".naver.com")
        cookies = [{"name": c.name, "value": c.value, "domain": c.domain, "path": c.path,
                    **({"expires": c.expires} if c.expires else {})} for c in cj]
        log(f"  [호가] 쿠키 {len(cookies)}개 로드")
    except Exception as e:
        log(f"  [호가] 쿠키 없이 진행: {e}")

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
        if cookies:
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

                # 주소 검증
                if not verify_complex(page, apt_name, sigungu, dong_name):
                    results.append(None)
                    continue

                # 면적 필터 적용
                filtered = apply_area_filter(page, area_m2)
                result = scrape_listings(page)

                # 면적 필터 실패 시 결과 검증 (호가가 실거래가와 너무 동떨어지면 폐기)
                if not filtered and result and area_m2:
                    # 면적 필터 없이 전체 매물 → 다른 평형 섞일 수 있음
                    log(f"    면적 필터 미적용 — 전체 매물 결과 사용")
                    result = scrape_listings(page)
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

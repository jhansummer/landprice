#!/usr/bin/env python3
"""Generate static SEO pages for each apartment complex.

Reads docs/data/apt_trade/apt_lookup/*.json (9 files, keyed by sido)
and generates:
  - docs/apt/{id}.html  (~92K lightweight HTML files)
  - docs/sitemap-apt-1.xml, sitemap-apt-2.xml  (split at 45K URLs)
  - docs/sitemap-pages.xml  (existing pages, migrated from sitemap.xml)
  - docs/sitemap.xml  (sitemap index referencing the above)
"""

import json
import os
import html as html_mod
from datetime import date
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
LOOKUP_DIR = DOCS / "data" / "apt_trade" / "apt_lookup"
APT_DIR = DOCS / "apt"
SITEMAP_INDEX = DOCS / "sitemap.xml"
SITEMAP_PAGES = DOCS / "sitemap-pages.xml"

BASE_URL = "https://aptmine.com"
URLS_PER_SITEMAP = 45000

# ── HTML template (minimised) ──────────────────────────────────────────────

HTML_TEMPLATE = """\
<!doctype html><html lang="ko"><head>\
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\
<meta name="naver-site-verification" content="395bc4f52e3a4764f98077727fe6466f57ed40c0">\
<title>{title_esc}</title>\
<meta name="description" content="{desc_esc}">\
<link rel="canonical" href="{canonical}">\
<meta property="og:title" content="{og_title_esc}">\
<meta property="og:description" content="{desc_esc}">\
<meta property="og:url" content="{canonical}">\
<meta property="og:type" content="website"><meta property="og:site_name" content="APT Mine">\
<meta property="og:locale" content="ko_KR">\
<meta property="og:image" content="https://aptmine.com/og-image.png">\
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">\
<meta name="twitter:card" content="summary_large_image">\
<meta name="twitter:title" content="{og_title_esc}">\
<meta name="twitter:description" content="{desc_esc}">\
<meta name="twitter:image" content="https://aptmine.com/og-image.png">\
<link rel="icon" href="/favicon.ico"><link rel="icon" type="image/png" href="/favicon.png">\
<link rel="stylesheet" href="/style.css?v=13">\
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">\
<script type="application/ld+json">{jsonld}</script>\
<script>window.APT_PARAMS={{id:"{apt_id}",sido:"{sido}"}};</script>\
<script async src="https://www.googletagmanager.com/gtag/js?id=G-H9MBJYB0DQ"></script>\
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-H9MBJYB0DQ');</script>\
</head><body>\
<header class="site-header">\
<div class="header-inner"><div class="logo-h1"><a href="/" class="logo">APT Mine</a></div>\
<span class="tagline">실거래가 기반 아파트 시세 분석</span></div>\
<nav class="nav-bar" aria-label="메인 내비게이션">\
<a class="nav-link" href="/">메인</a>\
<a class="nav-link" href="/regional.html">시세</a>\
<a class="nav-link" href="/undervalued.html">분석</a>\
<a class="nav-link" href="/watchlist.html">관심<span id="wl-badge" class="wl-badge"></span></a>\
</nav></header>\
<main><div id="apt-content" style="max-width:720px;margin:0 auto;padding:0 16px">\
<h1 class="page-title">{h1_esc}</h1>\
<p class="page-desc">{location_esc}</p>\
<div id="status" class="status"><span class="spinner"></span>상세 데이터 로딩 중...</div>\
</div></main>\
<footer class="site-footer">\
<nav class="footer-links" aria-label="사이트맵">\
<a href="/">메인</a><span class="footer-sep">|</span>\
<a href="/regional.html">지역시세</a>\
<a href="/search.html">비교검색</a>\
<a href="/newhigh.html">신고가검색</a>\
<span class="footer-sep">|</span>\
<a href="/undervalued.html">저평가 TOP3</a>\
<a href="/valuation.html">단지분석</a>\
<a href="/bottom.html">바닥찾기</a>\
<a href="/backtest.html">백테스트</a>\
<span class="footer-sep">|</span>\
<a href="/watchlist.html">관심목록</a>\
</nav>\
<div class="footer-info">\
<a href="/privacy.html">개인정보처리방침</a>\
<span style="margin:0 6px;">·</span>\
<span>데이터 출처: 국토교통부 실거래가 공공데이터</span>\
</div></footer>\
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1002744323242293" crossorigin="anonymous"></script>\
<script src="/chart-utils.js?v=10"></script>\
<script src="/watchlist.js?v=2"></script>\
<script src="/common.js?v=1"></script>\
<script src="/share.js?v=1"></script>\
<script src="/apt.js?v=3"></script>\
<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{"token":"qp1Cd4GifaZxLn05eGgQ5U4hcTAi06HuYCx_CZIL"}}'></script>\
</body></html>"""

# ── JSON-LD template ───────────────────────────────────────────────────────

JSONLD_TEMPLATE = """{{"@context":"https://schema.org","@type":"Apartment","name":"{name}","floorSize":{{"@type":"QuantitativeValue","value":{area},"unitCode":"MTK"}},"address":{{"@type":"PostalAddress","addressRegion":"{sido}","addressLocality":"{sigungu}","streetAddress":"{dong}"}},"dateBuilt":"{year}"}}"""


def esc(s):
    """HTML-escape a string."""
    return html_mod.escape(str(s), quote=True)


def generate_pages():
    APT_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()

    all_urls = []  # (apt_id,) for sitemap
    total = 0

    # Read all lookup files
    lookup_files = sorted(LOOKUP_DIR.glob("*.json"))
    if not lookup_files:
        print("No lookup files found in", LOOKUP_DIR)
        return

    for lf in lookup_files:
        sido = lf.stem  # e.g. "서울"
        print(f"Processing {sido}...")
        with open(lf, encoding="utf-8") as f:
            data = json.load(f)

        for apt_id, info in data.items():
            # info: [name, sigungu, dong, area, year]
            name, sigungu, dong, area, year = info

            title = f"{name} {area}m² 실거래가 시세 - APT Mine"
            desc = f"{sido} {sigungu} {dong} {name} {area}m² 아파트 실거래가 시세 분석. 매매가 추이, 고점 대비 현재가 정보."
            og_title = f"{name} {area}m² 실거래가 - APT Mine"
            h1 = f"{name} {area}m² 실거래가 시세"
            location = f"{sido} {sigungu} {dong} · {area}m² · {year}년"
            canonical = f"{BASE_URL}/apt/{apt_id}.html"

            jsonld = JSONLD_TEMPLATE.format(
                name=esc(name),
                area=area,
                sido=esc(sido),
                sigungu=esc(sigungu),
                dong=esc(dong),
                year=year,
            )

            page = HTML_TEMPLATE.format(
                title_esc=esc(title),
                desc_esc=esc(desc),
                og_title_esc=esc(og_title),
                canonical=canonical,
                h1_esc=esc(h1),
                location_esc=esc(location),
                jsonld=jsonld,
                apt_id=apt_id,
                sido=esc(sido),
            )

            out_path = APT_DIR / f"{apt_id}.html"
            out_path.write_text(page, encoding="utf-8")
            all_urls.append(apt_id)
            total += 1

        print(f"  {sido}: {len(data)} pages")

    print(f"\nTotal pages generated: {total}")

    # ── Generate apt sitemaps (split at URLS_PER_SITEMAP) ─────────────────
    sitemap_files = []
    for chunk_idx in range(0, len(all_urls), URLS_PER_SITEMAP):
        chunk = all_urls[chunk_idx : chunk_idx + URLS_PER_SITEMAP]
        sitemap_num = chunk_idx // URLS_PER_SITEMAP + 1
        sitemap_name = f"sitemap-apt-{sitemap_num}.xml"
        sitemap_path = DOCS / sitemap_name

        lines = ['<?xml version="1.0" encoding="UTF-8"?>']
        lines.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
        for apt_id in chunk:
            lines.append(
                f"<url><loc>{BASE_URL}/apt/{apt_id}.html</loc>"
                f"<lastmod>{today}</lastmod>"
                f"<changefreq>weekly</changefreq>"
                f"<priority>0.6</priority></url>"
            )
        lines.append("</urlset>")

        sitemap_path.write_text("\n".join(lines), encoding="utf-8")
        sitemap_files.append(sitemap_name)
        print(f"Generated {sitemap_name} ({len(chunk)} URLs)")

    # ── Migrate existing sitemap.xml → sitemap-pages.xml ─────────────────
    # Read existing sitemap.xml if it's a urlset (not already an index)
    existing_sitemap = SITEMAP_INDEX.read_text(encoding="utf-8")
    if "<urlset" in existing_sitemap:
        SITEMAP_PAGES.write_text(existing_sitemap, encoding="utf-8")
        print("Migrated existing sitemap.xml → sitemap-pages.xml")

    # ── Generate sitemap index ────────────────────────────────────────────
    idx_lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    idx_lines.append(
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    )
    # pages sitemap
    idx_lines.append(
        f"<sitemap><loc>{BASE_URL}/sitemap-pages.xml</loc>"
        f"<lastmod>{today}</lastmod></sitemap>"
    )
    # apt sitemaps
    for sm_name in sitemap_files:
        idx_lines.append(
            f"<sitemap><loc>{BASE_URL}/{sm_name}</loc>"
            f"<lastmod>{today}</lastmod></sitemap>"
        )
    idx_lines.append("</sitemapindex>")

    SITEMAP_INDEX.write_text("\n".join(idx_lines), encoding="utf-8")
    print(f"Generated sitemap.xml (index with {1 + len(sitemap_files)} sitemaps)")


if __name__ == "__main__":
    generate_pages()

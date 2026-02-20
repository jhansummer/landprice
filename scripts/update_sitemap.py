#!/usr/bin/env python3
"""Update sitemap.xml lastmod dates for data-driven pages."""

import re
from datetime import date
from pathlib import Path

SITEMAP_PAGES = Path(__file__).resolve().parent.parent / "docs" / "sitemap-pages.xml"
# Fallback: if sitemap-pages.xml doesn't exist yet, use sitemap.xml
SITEMAP = SITEMAP_PAGES if SITEMAP_PAGES.exists() else Path(__file__).resolve().parent.parent / "docs" / "sitemap.xml"

# Pages whose lastmod should track data refresh
DATA_PAGES = {
    "https://aptmine.com/",
    "https://aptmine.com/search.html",
    "https://aptmine.com/regional.html",
    "https://aptmine.com/undervalued.html",
    "https://aptmine.com/valuation.html",
    "https://aptmine.com/bottom.html",
    "https://aptmine.com/backtest.html",
}

URL_BLOCK = re.compile(
    r"(<url>\s*<loc>)(.*?)(</loc>\s*<lastmod>)\d{4}-\d{2}-\d{2}(</lastmod>)",
    re.DOTALL,
)


def main():
    today = date.today().isoformat()
    target = SITEMAP_PAGES if SITEMAP_PAGES.exists() else SITEMAP
    xml = target.read_text(encoding="utf-8")

    def replace_lastmod(m):
        loc = m.group(2).strip()
        if loc in DATA_PAGES:
            return f"{m.group(1)}{m.group(2)}{m.group(3)}{today}{m.group(4)}"
        return m.group(0)

    updated = URL_BLOCK.sub(replace_lastmod, xml)
    target.write_text(updated, encoding="utf-8")
    print(f"{target.name} lastmod updated to {today}")


if __name__ == "__main__":
    main()

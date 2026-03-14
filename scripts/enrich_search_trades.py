#!/usr/bin/env python3
"""search/{sido}.json에 total_trades 필드 추가 (by_apt 파일에서 거래수 집계)"""
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "docs" / "data" / "apt_trade"
SEARCH_DIR = DATA_DIR / "search"
BY_APT_DIR = DATA_DIR / "by_apt"

def count_trades(apt_id: str) -> int:
    path = BY_APT_DIR / f"{apt_id}.json"
    if not path.exists():
        return 0
    try:
        data = json.loads(path.read_text())
        if isinstance(data, list):
            return len(data)
        elif isinstance(data, dict) and "trades" in data:
            return len(data["trades"])
    except Exception:
        pass
    return 0

def main():
    for sido_file in sorted(SEARCH_DIR.glob("*.json")):
        sido = sido_file.stem
        data = json.loads(sido_file.read_text(encoding="utf-8"))
        items = data.get("items", [])
        updated = 0
        for item in items:
            apt_id = item.get("id", "")
            if apt_id:
                item["total_trades"] = count_trades(apt_id)
                updated += 1
        sido_file.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{sido}: {updated} items updated")

if __name__ == "__main__":
    main()

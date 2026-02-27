#!/usr/bin/env python3
"""매매x전세 포지셔닝 차트 스크린샷 → 노션 페이지에 추가"""

import json
import os
import sys
import time
import uuid
import requests
from playwright.sync_api import sync_playwright

SCREENSHOTS_DIR = '/tmp/positioning_screenshots'
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '.env')


def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env


def capture_chart(sido):
    """Capture positioning chart screenshot for a sido."""
    url = f'https://aptmine.com/regional.html#{sido}'
    uid = uuid.uuid4().hex[:8]
    screenshot_path = os.path.join(SCREENSHOTS_DIR, f'{sido}_positioning_{uid}.png')

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1200, 'height': 900}, device_scale_factor=2)
        page.goto(url, wait_until='networkidle')
        time.sleep(4)

        grid = page.query_selector('#grid')
        if not grid:
            print(f'[{sido}] #grid not found', file=sys.stderr)
            browser.close()
            return None

        grid.screenshot(path=screenshot_path)
        print(f'[{sido}] Screenshot saved: {screenshot_path}', file=sys.stderr)

        browser.close()
        return screenshot_path


def upload_to_catbox(file_path):
    """Upload image to catbox.moe."""
    with open(file_path, 'rb') as f:
        resp = requests.post(
            'https://catbox.moe/user/api.php',
            data={'reqtype': 'fileupload'},
            files={'fileToUpload': (os.path.basename(file_path), f, 'image/png')}
        )
    if resp.status_code == 200 and resp.text.startswith('http'):
        return resp.text.strip()
    print(f'Upload failed: {resp.status_code} {resp.text}', file=sys.stderr)
    return None


def append_image_to_notion(api_key, page_id, image_url, caption):
    """Append an image block to an existing Notion page."""
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
    }

    resp = requests.get(
        f'https://api.notion.com/v1/blocks/{page_id}/children?page_size=10',
        headers=headers
    )
    blocks = resp.json().get('results', [])

    after_id = None
    for b in blocks:
        if b.get('type') == 'heading_1':
            after_id = b['id']
            break

    image_block = {
        "object": "block",
        "type": "image",
        "image": {
            "type": "external",
            "external": {"url": image_url},
            "caption": [{"type": "text", "text": {"content": caption}}]
        }
    }

    payload = {"children": [image_block]}
    if after_id:
        payload["after"] = after_id

    resp = requests.patch(
        f'https://api.notion.com/v1/blocks/{page_id}/children',
        headers=headers,
        json=payload
    )

    if resp.status_code == 200:
        print(f'Image added to Notion page', file=sys.stderr)
        return True
    else:
        print(f'Notion error: {resp.status_code} {resp.text}', file=sys.stderr)
        return False


def main():
    env = load_env()
    api_key = env.get('NOTION_API_KEY')

    page_ids = {}
    if len(sys.argv) >= 3:
        for arg in sys.argv[1:]:
            sido, pid = arg.split('=', 1)
            page_ids[sido] = pid
    else:
        print("Usage: script.py 서울=page_id 경기=page_id", file=sys.stderr)
        return

    for sido, page_id in page_ids.items():
        print(f'\n=== {sido} ===', file=sys.stderr)

        path = capture_chart(sido)
        if not path:
            continue

        print(f'Uploading...', file=sys.stderr)
        url = upload_to_catbox(path)
        if not url:
            continue
        print(f'Uploaded: {url}', file=sys.stderr)

        append_image_to_notion(api_key, page_id, url, f'{sido} 매매x전세 포지셔닝 차트')
        print(f'Done: {sido}')


if __name__ == '__main__':
    main()

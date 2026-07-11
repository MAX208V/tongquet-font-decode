#!/usr/bin/env python3
"""每6小时运行：从铜雀台获取当前字体→解析cmap→更新Cloudflare Worker映射"""
import urllib.request, re, json, sys, os, io, base64

# 配置（通过环境变量注入）
CHAPTER_URL = os.environ.get('CHAPTER_URL', 'https://tongquet.com/book/bjZ12/luo-bing-yin-chuan/2Ro1j')
CF_API_TOKEN = os.environ.get('CF_API_TOKEN', '')
CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '5d7d0fcdc929a2bd1491c8924d0a587a')
WORKER_NAME = 'tongquet-font-decoder'

UA = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

def http_get(url, ref=''):
    h = {'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9'}
    if ref: h['Referer'] = ref
    return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30).read()

# Step 1: 获取章节页
print(f"[1] Fetching chapter: {CHAPTER_URL}")
html = http_get(CHAPTER_URL).decode('utf-8')

# Step 2: 提取CSS
css_match = re.search(r'href="([^"]*AntiScraping/css/[^"]*\.css)"', html)
if not css_match: 
    css_match = re.search(r"href='([^']*AntiScraping/css/[^']*\.css)'", html)
if not css_match:
    print("ERROR: CSS not found"); sys.exit(1)
css_url = "https://tongquet.com" + css_match.group(1)
print(f"[2] CSS: {css_url}")

# Step 3: 获取CSS
css = http_get(css_url, CHAPTER_URL).decode('utf-8')

# Step 4: 提取字体URL
font_match = re.search(r"url\('([^']*\.woff2)'\)", css)
if not font_match:
    font_match = re.search(r'url\("([^"]*\.woff2)"\)', css)
if not font_match:
    print(f"ERROR: Font URL not found in CSS: {css[:200]}"); sys.exit(1)
font_url = "https://tongquet.com" + font_match.group(1)
print(f"[3] Font: {font_url}")

# Step 5: 下载字体
font_data = http_get(font_url, css_url)
print(f"[4] Downloaded: {len(font_data)} bytes")

# Step 6: 解析cmap
try:
    from fontTools.ttLib import TTFont
    font = TTFont(io.BytesIO(font_data))
    cmap = font.getBestCmap()
    mapping = {}
    for k, v in cmap.items():
        if isinstance(v, str) and v.startswith('uni'):
            mapping[k] = int(v[3:], 16)
        elif isinstance(v, int):
            mapping[k] = v
    print(f"[5] Parsed: {len(mapping)} mappings")
    font.close()
except Exception as e:
    print(f"ERROR parsing font: {e}")
    sys.exit(1)

# Step 7: 生成Worker新代码
mapping_json = json.dumps(mapping)
worker_code = f"""export default {{
  async fetch(request) {{
    const corsHeaders = {{
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=30',
    }};
    if (request.method === 'OPTIONS') return new Response(null, {{ headers: corsHeaders }});
    const mapping = {mapping_json};
    return new Response(JSON.stringify({{ mapping, count: {len(mapping)} }}), {{
      headers: {{ 'Content-Type': 'application/json', ...corsHeaders }}
    }});
  }}
}};
"""

# Step 8: 上传到Cloudflare Worker
print("[6] Updating Cloudflare Worker...")
boundary = f"----{int(__import__('time').time())}"
metadata = json.dumps({
    "main_module": "index.js",
    "compatibility_date": "2026-07-01",
    "compatibility_flags": ["nodejs_compat"],
    "bindings": []
})

body_parts = [
    f'--{boundary}',
    'Content-Disposition: form-data; name="metadata"',
    'Content-Type: application/json',
    '',
    metadata,
    f'--{boundary}',
    'Content-Disposition: form-data; name="files"; filename="index.js"',
    'Content-Type: application/javascript+module',
    '',
    worker_code,
    f'--{boundary}--'
]
body = '\r\n'.join(body_parts)

req = urllib.request.Request(
    f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/scripts/{WORKER_NAME}',
    data=body.encode('utf-8'),
    headers={
        'Authorization': f'Bearer {CF_API_TOKEN}',
        'Content-Type': f'multipart/form-data; boundary={boundary}',
    },
    method='PUT'
)

try:
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read().decode())
    if result.get('success'):
        print(f"[7] Worker updated successfully!")
        print(f"    Mapping: {len(mapping)} entries")
    else:
        print(f"ERROR: {result.get('errors')}")
        sys.exit(1)
except Exception as e:
    print(f"ERROR uploading: {e}")
    sys.exit(1)

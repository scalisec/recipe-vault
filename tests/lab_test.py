"""Offline test of lab.html with mocked Meta responses: python3 tests/lab_test.py"""
import http.server, socketserver, threading, os, sys, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass

srv = socketserver.TCPServer(('127.0.0.1', 0), H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/lab.html'

fails = []
def check(name, cond, detail=''):
    print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f'  -> {detail}'))
    if not cond: fails.append(name)

CAPTION_HTML = (
    '<blockquote class="instagram-media"><div style="padding:16px;"><a href="https://www.instagram.com/reel/AAA/">'
    '<div>View this post on Instagram</div></a>'
    '<p style="margin:8px 0"><a href="https://www.instagram.com/reel/AAA/">Garlic Butter Chicken Thighs<br>Serves 4 | 35 min<br><br>'
    'Ingredients:<br>- 1.5 lb chicken thighs<br>- 4 tbsp butter<br>- 6 garlic cloves<br><br>Method:<br>1. Season the thighs with salt and pepper.<br>'
    '2. Sear skin side down for 7 minutes until golden brown.</a></p>'
    '<p>A post shared by Some Creator (@creator)</p></div></blockquote>'
)

def handler(route):
    u = route.request.url
    cors = {'access-control-allow-origin': '*', 'content-type': 'application/json'}
    if 'graph.facebook.com/instagram_oembed' in u and 'reel%2FAAA' in u:
        route.fulfill(status=200, headers=cors, body=json.dumps({'version': '1.0', 'author_name': 'creator', 'html': CAPTION_HTML, 'type': 'rich'}))
    elif 'graph.facebook.com/v23.0/instagram_oembed' in u:
        route.fulfill(status=400, headers=cors, body=json.dumps({'error': {'message': 'Unsupported get request', 'code': 100}}))
    elif 'graph.facebook.com/instagram_oembed' in u:
        route.fulfill(status=200, headers=cors, body=json.dumps({'version': '1.0', 'html': '<blockquote><p>A post shared by X</p></blockquote>'}))
    else:
        route.abort()  # simulates a browser cross-origin block

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.route('**/*', lambda r: r.continue_() if r.request.url.startswith(f'http://127.0.0.1:{port}') else handler(r))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)

    check('default links prefilled', page.input_value('#links').count('\n') == 4)
    check('tracking params stripped', page.evaluate("window.__lab.cleanUrl('https://www.instagram.com/reel/AAA/?igsh=zzz')") == 'https://www.instagram.com/reel/AAA/')
    cap = page.evaluate("window.__lab.captionFromHtml(" + json.dumps(CAPTION_HTML) + ")")
    check('caption extracted with line breaks', cap.startswith('Garlic Butter Chicken Thighs\nServes 4') and 'A post shared by' not in cap, cap[:80])

    page.fill('#links', 'https://www.instagram.com/reel/AAA/?igsh=1\nhttps://www.instagram.com/reel/BBB/\nhttps://www.facebook.com/share/r/XYZ/\nhttps://example.com/x')
    page.click('#run')
    page.wait_for_function("document.querySelector('#run').textContent === 'Run test again'", timeout=30000)
    txt = page.inner_text('#out')
    check('caption found card', 'Caption found' in txt)
    check('parser result shown', 'Garlic Butter Chicken Thighs' in txt and '3 ingredients' in txt and '2 steps' in txt, txt[:400])
    check('empty caption flagged', 'Reply received but no usable caption' in txt)
    check('http error shown', 'Unsupported get request' in txt)
    check('browser block shown', 'Blocked by the browser' in txt)
    check('non-social link skipped', 'Not an Instagram or Facebook link' in txt)
    rep = page.input_value('#report')
    check('report lists links and verdicts', 'reel/AAA/' in rep and 'Caption found' in rep and 'parser: 3 ingredients, 2 steps' in rep, rep[:300])
    check('copy enabled', page.is_enabled('#copy'))
    page.screenshot(path='/tmp/rv-shots/12-lab.png', full_page=True)
    check('no page errors', not errors, errors)
    b.close()

print('\n' + (f'{len(fails)} failed' if fails else 'all passed'))
sys.exit(1 if fails else 0)

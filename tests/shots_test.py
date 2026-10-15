"""Screenshot import: Share-target POST, OCR stitching, review form.  python3 tests/shots_test.py
The text reader (Tesseract.js, loaded from a CDN) is replaced by a stub that returns real `tesseract` output for the fixtures."""
import http.server, socketserver, threading, os, sys, json, base64
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures')

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass

srv = socketserver.TCPServer(('127.0.0.1', 0), H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{port}/index.html'

fails = []
def check(name, cond, detail=''):
    print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f'  -> {detail}'))
    if not cond: fails.append(name)

def txt(n): return open(os.path.join(FIX, n + '.txt')).read()
def png_b64(n): return base64.b64encode(open(os.path.join(FIX, n + '.png'), 'rb').read()).decode()

STUB = """
window.Tesseract = { createWorker: async function (lang, oem, opts) {
  return {
    recognize: async function (img) {
      if (opts && opts.logger) opts.logger({ status: 'recognizing text', progress: 1 });
      var n = window.__calls = (window.__calls || 0) + 1;
      var px = img.getContext('2d').getImageData(5, 300, 1, 1).data;
      (window.__bg = window.__bg || []).push(px[0]);
      return { data: { text: window.__OCR[n - 1] || '' } };
    },
    terminate: async function () { window.__terminated = true; }
  };
} };
"""

POST_JS = """
async (args) => {
  const dt = new DataTransfer();
  for (const f of args.files) {
    const bin = atob(f.b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    dt.items.add(new File([buf], f.name, { type: 'image/png' }));
  }
  const form = document.createElement('form');
  form.method = 'POST'; form.action = './share-target'; form.enctype = 'multipart/form-data';
  if (dt.files.length) { const inp = document.createElement('input'); inp.type = 'file'; inp.name = 'shots'; inp.multiple = true; inp.files = dt.files; form.appendChild(inp); }
  for (const k of Object.keys(args.fields || {})) { const h = document.createElement('input'); h.type = 'hidden'; h.name = k; h.value = args.fields[k]; form.appendChild(h); }
  document.body.appendChild(form); form.submit();
}
"""

def new_page(b, ocr_texts):
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    def route(r):
        u = r.request.url
        if u.startswith(f'http://127.0.0.1:{port}'): r.continue_()
        elif 'tesseract' in u: r.fulfill(status=200, content_type='application/javascript', body=STUB)
        else: r.abort()
    ctx.route('**/*', route)
    ctx.add_init_script("window.__OCR = " + json.dumps(ocr_texts))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_selector('#lib-results')
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=10000)
    return ctx, page, errors

with sync_playwright() as p:
    b = p.chromium.launch()

    man = json.load(open(os.path.join(ROOT, 'manifest.webmanifest')))
    st = man['share_target']
    check('manifest posts files to the service worker', st['method'] == 'POST' and st['enctype'] == 'multipart/form-data' and st['params']['files'][0]['accept'] == ['image/*'], st)

    # 1. light screenshots shared together (in reverse order, to check sorting by name)
    ctx, page, errors = new_page(b, [txt('s1'), txt('s2')])
    page.evaluate(POST_JS, {'files': [
        {'name': 'Screenshot_20261015-180912.png', 'b64': png_b64('s2')},
        {'name': 'Screenshot_20261015-180900.png', 'b64': png_b64('s1')}], 'fields': {}})
    page.wait_for_selector('#d-title', timeout=20000)
    check('shared screenshots become a recipe', page.input_value('#d-title') == 'Garlic Butter Chicken Thighs', page.input_value('#d-title'))
    ing = page.input_value('#d-ing') if page.locator('#d-ing').count() else page.inner_text('#view')
    check('ingredients from both screenshots, no duplicates', 'chicken stock' in ing and ing.count('Salt and pepper') == 1 and '1.5 lb chicken thighs' in ing, ing[:300])
    view = page.inner_text('#view')
    steps = page.input_value('#d-steps')
    check('later screenshot contributes the method', 'Rest 5 minutes' in steps and 'Season the thighs' in steps, steps[:200])
    check('servings and time read', page.input_value('#d-serv') == '4' and page.input_value('#d-time') == '35', (page.input_value('#d-serv'), page.input_value('#d-time')))
    check('review note mentions 2 screenshots', 'Read from 2 screenshots' in view)
    check('add-more button offered', page.locator('[data-act=moreShots]').count() == 1)
    check('status bar and comment junk removed', 'LTE' not in view and 'likes' not in view and 'Add a comment' not in view)
    check('address bar clean', '?' not in page.url.split('#')[0], page.url)
    left = page.evaluate("caches.open('rv-share').then(c => c.keys()).then(k => k.length)")
    check('shared images removed from the cache', left == 0, left)
    check('text reader shut down', page.evaluate("window.__terminated === true"))
    check('no page errors', not errors, errors)
    ctx.close()

    # 2. dark-mode screenshots are flipped before reading
    ctx, page, errors = new_page(b, [txt('d1'), txt('d2')])
    page.evaluate(POST_JS, {'files': [
        {'name': 'Screenshot_20261015-181000.png', 'b64': png_b64('d1')},
        {'name': 'Screenshot_20261015-181010.png', 'b64': png_b64('d2')}], 'fields': {}})
    page.wait_for_selector('#d-title', timeout=20000)
    bg = page.evaluate("window.__bg")
    check('dark screenshots inverted to dark-on-light', bg and all(v > 240 for v in bg), bg)
    check('dark pair parsed', page.input_value('#d-title') == 'Garlic Butter Chicken Thighs')
    ctx.close()

    # 3. a plain link share (no images) still works through the POST target
    ctx, page, errors = new_page(b, [])
    page.evaluate(POST_JS, {'files': [], 'fields': {'url': 'https://www.instagram.com/reel/ZZZ999/?igsh=abc', 'text': 'Check out this reel'}})
    page.wait_for_selector('#add-url', timeout=15000)
    check('link share still prefilled', page.input_value('#add-url') == 'https://www.instagram.com/reel/ZZZ999/', page.input_value('#add-url'))
    check('link note shown', 'Link received' in page.inner_text('#view'))
    check('no screenshot reading started', page.evaluate("window.__calls || 0") == 0)
    ctx.close()

    # 4. choosing screenshots by hand on the Screenshot tab
    ctx, page, errors = new_page(b, [txt('s1'), txt('s2')])
    page.goto(BASE + '#/add')
    page.wait_for_selector('[data-act=addMode]')
    page.click('[data-act=addMode][data-v=shot]')
    page.set_input_files('input[type=file][multiple]', [os.path.join(FIX, 's1.png'), os.path.join(FIX, 's2.png')])
    page.wait_for_selector('[data-act=runOCR]')
    check('button counts the screenshots', 'Read 2 screenshots' in page.inner_text('[data-act=runOCR]'))
    page.click('[data-act=runOCR]')
    page.wait_for_selector('#d-title', timeout=20000)
    check('manual choice also creates the recipe', page.input_value('#d-title') == 'Garlic Butter Chicken Thighs')
    page.screenshot(path='/tmp/rv-shots/14-shots-review.png', full_page=True)
    ctx.close()
    b.close()

print('\n' + (f'{len(fails)} failed' if fails else 'all passed'))
sys.exit(1 if fails else 0)

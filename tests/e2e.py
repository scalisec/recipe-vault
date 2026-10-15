"""End-to-end smoke test: run with  python3 tests/e2e.py  (starts its own local server)."""
import http.server, socketserver, threading, os, sys, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get('SHOTS', '/tmp/rv-shots')
os.makedirs(SHOTS, exist_ok=True)

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

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True)
    ctx.route('**/*', lambda r: r.continue_() if r.request.url.startswith(f'http://127.0.0.1:{port}') else r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text else None)
    page.on('dialog', lambda d: d.accept('Date night') if d.type == 'prompt' else d.accept())

    page.goto(BASE)
    page.wait_for_selector('#lib-results')
    check('empty state shown', 'library is empty' in page.inner_text('#lib-results').lower())
    page.screenshot(path=f'{SHOTS}/1-empty.png')

    # add flow
    page.goto(BASE + '#/add')
    page.click('[data-act=useSample]')
    page.fill('#add-url', 'https://www.instagram.com/reel/abc123/')
    page.screenshot(path=f'{SHOTS}/2-add.png')
    page.click('[data-act=parseText]')
    page.wait_for_selector('#d-title')
    check('title parsed', page.input_value('#d-title') == 'Garlic Butter Chicken Thighs', page.input_value('#d-title'))
    check('source detected', page.input_value('#d-src') == 'Instagram')
    check('servings parsed', page.input_value('#d-serv') == '4')
    check('time parsed', page.input_value('#d-time') == '35')
    check('ingredient count', page.inner_text('#ing-count').startswith('7 ingredients · 7'), page.inner_text('#ing-count'))
    check('chicken tag auto-selected', page.locator('#d-tags .chip.on', has_text='Chicken').count() == 1)
    check('dinner tag auto-selected', page.locator('#d-tags .chip.on', has_text='Dinner').count() == 1)
    page.screenshot(path=f'{SHOTS}/3-review.png', full_page=True)
    # custom tag via prompt
    page.locator('[data-act=dnewtag][data-g="Cuisine"]').click()
    check('custom option added to draft', page.locator('#d-tags .chip.on', has_text='Date night').count() == 1)
    page.click('[data-act=saveDraft]')
    page.wait_for_url('**#/recipe/*')
    page.wait_for_selector('ul.list li')

    # recipe page
    check('recipe title', 'Garlic Butter Chicken Thighs' in page.inner_text('h1.display'))
    check('7 ingredient rows', page.locator('ul.list li').count() == 7)
    first = lambda: page.locator('ul.list li').first.inner_text().replace('\n', ' ')
    check('4 servings first row', '1 ½ lb' in first(), first())
    page.click('[data-act=serv][data-v="1"]')
    check('5 servings first row scales', '2 lb' in first(), first())
    page.click('[data-act=serv][data-v="-1"]'); page.click('[data-act=serv][data-v="-1"]')
    check('3 servings rounds to a quarter pound', '1 ¼ lb' in first(), first())
    page.click('[data-act=servReset]')
    page.click('[data-act=sys][data-v=metric]')
    check('metric conversion', '680 g' in first(), first())
    check('temp converted in steps', '205°C' in page.inner_text('ol.steps'), page.inner_text('ol.steps'))
    page.click('[data-act=sys][data-v=us]')
    page.click('[data-act=rate][data-v="4"]')
    page.click('[data-act=cooked]')
    check('cooked count', 'Cooked 1×' in page.inner_text('#view'))
    page.click('[data-act=fav]')
    page.screenshot(path=f'{SHOTS}/4-recipe.png', full_page=True)

    # export sheet
    page.click('[data-act=openExport]')
    with page.expect_download() as dl:
        page.click('[data-act=exTxt]')
    txt = open(dl.value.path()).read()
    check('export txt has ingredients', 'INGREDIENTS' in txt and 'bone-in chicken thighs' in txt)

    # plan
    page.click('[data-act=openAddPlan]')
    page.click('[data-act=confirmAddPlan]')
    page.goto(BASE + '#/plan')
    check('plan entry present', 'Garlic Butter Chicken Thighs' in page.inner_text('#view'))
    page.screenshot(path=f'{SHOTS}/5-plan.png', full_page=True)
    page.click('a:has-text("Build grocery list")')
    page.wait_for_selector('.gro-item')
    check('grocery items', page.locator('.gro-item').count() == 7, page.locator('.gro-item').count())
    page.locator('.gro-item input').first.check()
    check('check persists visually', page.locator('.gro-item.done').count() == 1)
    page.screenshot(path=f'{SHOTS}/6-groceries.png', full_page=True)

    # second recipe by manual entry, library filter + search
    page.goto(BASE + '#/add')
    page.click('[data-act=blankDraft]')
    page.fill('#d-title', 'Miso Chocolate Cookies')
    page.fill('#d-ing', '1 cup flour\n1/2 cup butter\n1 cup chocolate chips')
    page.fill('#d-steps', 'Mix and bake at 350°F until golden.')
    page.click('[data-act=retag]')
    page.click('[data-act=saveDraft]')
    page.wait_for_url('**#/recipe/*')
    page.goto(BASE + '#/')
    page.wait_for_selector('.rcard')
    check('two recipes in library', page.locator('.rcard').count() == 2)
    page.fill('#lib-search', 'chocolate')
    check('search by ingredient', page.locator('.rcard').count() == 1 and 'Miso' in page.inner_text('#lib-results'))
    page.fill('#lib-search', '')
    page.click('[data-act=quick][data-o=Dessert]')
    check('quick chip filter', page.locator('.rcard').count() == 1, page.locator('.rcard').count())
    page.screenshot(path=f'{SHOTS}/7-library.png', full_page=True)
    page.click('[data-act=quick][data-o=""]')
    page.click('[data-act=openFilters]')
    page.click('[data-act=filterOpt][data-g=Protein][data-o=Chicken]')
    page.click('[data-act=closeSheet]')
    check('filter sheet filters', page.locator('.rcard').count() == 1 and 'Garlic' in page.inner_text('#lib-results'))
    page.click('[data-act=openFilters]')
    page.click('[data-act=clearFilters]')
    check('clear all filters', page.locator('.rcard').count() == 2)

    # settings
    page.goto(BASE + '#/settings')
    page.click('[data-act=addOpt][data-g="Meal type"]')
    check('category added', 'Date night' in page.inner_text('#view'))
    page.screenshot(path=f'{SHOTS}/8-settings.png', full_page=True)
    with page.expect_download() as dl2:
        page.click('[data-act=exportBackup]')
    data = json.load(open(dl2.value.path()))
    check('backup has recipes', len(data['recipes']) == 2)

    # persistence
    page.wait_for_timeout(500)
    page.goto(BASE + '#/')
    page.reload()
    page.wait_for_selector('.rcard')
    check('persists after reload', page.locator('.rcard').count() == 2)

    # --- install, share target, clipboard paste, cook mode ---
    origin = f'http://127.0.0.1:{port}'
    mf = page.request.get(origin + '/manifest.webmanifest').json()
    check('manifest has share target', mf.get('share_target', {}).get('params', {}).get('url') == 'url')
    check('manifest icons load', all(page.request.get(origin + '/' + i['src']).ok for i in mf['icons']))
    page.goto(BASE)
    page.wait_for_selector('.rcard')
    sw_ready = page.evaluate("navigator.serviceWorker.ready.then(function (r) { return !!r.active; })")
    check('service worker active', sw_ready)

    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=origin)
    CAPTION = ("Lemon Herb Salmon\nServes 2 | 20 min\n\nIngredients:\n- 2 salmon fillets\n- 1 lemon\n- 2 tbsp olive oil\n\n"
               "Method:\n1. Season the salmon with salt and pepper and a squeeze of lemon.\n2. Bake at 400°F for 12 minutes.")

    page.goto(BASE + '#/add')
    page.evaluate("navigator.clipboard.writeText('https://www.instagram.com/reel/XYZ789/?igsh=abc')")
    page.click('[data-act=pasteClip]')
    page.wait_for_function("document.querySelector('#add-url') && document.querySelector('#add-url').value.indexOf('XYZ789') !== -1")
    check('link on clipboard fills the link box', page.input_value('#add-url') == 'https://www.instagram.com/reel/XYZ789/', page.input_value('#add-url'))
    check('still on the add screen after a link paste', page.locator('#d-title').count() == 0)

    page.evaluate("navigator.clipboard.writeText(" + json.dumps(CAPTION) + ")")
    page.click('[data-act=pasteClip]')
    page.wait_for_selector('#d-title')
    check('paste caption creates recipe', page.input_value('#d-title') == 'Lemon Herb Salmon', page.input_value('#d-title'))
    check('pasted link kept as source', page.input_value('#d-url') == 'https://www.instagram.com/reel/XYZ789/', page.input_value('#d-url'))
    check('pasted recipe ingredient count', page.inner_text('#ing-count').startswith('3 ingredients'), page.inner_text('#ing-count'))
    page.click('[data-act=saveDraft]')
    page.wait_for_url('**#/recipe/*')
    page.wait_for_selector('ul.list li')

    page.click('[data-act=cook]')
    page.wait_for_selector('.cook')
    check('cook mode shows steps', page.locator('.cstep').count() == 2, page.locator('.cstep').count())
    page.locator('.cstep').first.click()
    check('cook step can be checked off', page.locator('.cstep.done').count() == 1)
    page.screenshot(path=f'{SHOTS}/10-cook.png')
    page.keyboard.press('Escape')
    check('cook mode closes', page.locator('.cook').count() == 0)

    page.goto(BASE + '?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FABC123%2F%3Figsh%3Dxyz&text=Check+out+this+reel')
    page.wait_for_selector('#add-url')
    check('shared link prefilled, tracking removed', page.input_value('#add-url') == 'https://www.instagram.com/reel/ABC123/', page.input_value('#add-url'))
    check('shared link note shown', 'Link received' in page.inner_text('#view'))
    check('open post link present', page.locator('a:has-text("Open post")').count() == 1)
    check('share params cleared from address bar', '?' not in page.url.split('#')[0], page.url)
    page.screenshot(path=f'{SHOTS}/11-shared.png', full_page=True)

    page.goto(BASE + '?text=' + 'Look+at+this+https%3A%2F%2Fwww.facebook.com%2Fshare%2Fr%2Fabc%2F')
    page.wait_for_selector('#add-url')
    check('link found inside shared text', page.input_value('#add-url') == 'https://www.facebook.com/share/r/abc/', page.input_value('#add-url'))

    page.goto(BASE + '#/settings')
    check('install card in settings', 'install on your phone' in page.inner_text('#view').lower())
    page.goto(BASE + '#/')

    # print css
    page.goto(BASE + '#/recipe/' + data['recipes'][0]['id'])
    page.emulate_media(media='print')
    check('tabbar hidden in print', not page.locator('#tabbar').is_visible())
    page.emulate_media(media='screen')

    # desktop layout
    page.set_viewport_size({'width': 1280, 'height': 800})
    page.goto(BASE + '#/')
    page.wait_for_selector('.rcard')
    page.screenshot(path=f'{SHOTS}/9-desktop.png')

    check('no console/page errors', not errors, errors)
    b.close()

print('\n' + (f'{len(fails)} failed' if fails else 'all passed'))
sys.exit(1 if fails else 0)

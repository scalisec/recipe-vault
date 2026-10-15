/* Recipe Vault: UI, storage and routing. Plain JavaScript, no build step. */
(function () {
  'use strict';

  /* ---------- tiny helpers ---------- */
  var RV = window.RV;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var uid = function () { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); };
  var now = function () { return Date.now(); };
  var safeUrl = function (u) { return /^https?:\/\//i.test(u || '') ? u : ''; };

  var DEFAULT_CATS = [
    { name: 'Meal type', options: ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Dessert', 'Drinks'] },
    { name: 'Cuisine', options: ['Italian', 'Mexican', 'Asian', 'Indian', 'Mediterranean', 'American'] },
    { name: 'Protein', options: ['Chicken', 'Beef', 'Pork', 'Seafood', 'Vegetarian'] },
    { name: 'Effort', options: ['Easy', 'Medium', 'Project'] }
  ];

  var SAMPLE_CAPTION = '🔥 Garlic Butter Chicken Thighs 🔥\nCrispy skin, juicy inside. Serves 4 | 35 min\n\nIngredients:\n🍗 1.5 lb bone-in chicken thighs\n- 4 tbsp butter\n- 6 garlic cloves, minced\n- 2 tbsp honey\n- 1 lemon, juiced\n- 1 tsp smoked paprika\n- 1/2 tsp salt\n\nMethod:\n1. Pat the thighs dry and season with paprika and salt.\n2. Sear skin-side down for 6-7 minutes until golden.\n3. Add butter, garlic and honey, then baste.\n4. Roast at 400°F for 25 minutes.\n\n#chicken #dinner #easyrecipes';

  /* ---------- state ---------- */
  var S = freshState();
  var ui = {
    shared: false,
    clip: { status: 'idle', text: '', ignored: '', busy: false, stats: '' },
    installEvt: null,
    cookDone: {},
    search: '',
    f: { groups: {}, maxTime: 0, fav: false, notCooked: false, sort: 'newest' },
    add: { mode: 'paste', url: '', text: '', photo: null, file: null, ocr: '' },
    draft: null,
    rs: { id: null, servings: 4, system: 'us' },
    week: mondayOf(new Date()),
    driveMsg: ''
  };

  function freshState() {
    return {
      v: 1, recipes: [], deleted: {},
      categories: JSON.parse(JSON.stringify(DEFAULT_CATS)),
      plan: {}, checks: {}, settings: { units: 'us', autoTag: true },
      meta: { categories: 0, plan: 0, checks: 0, settings: 0 }
    };
  }

  function snapshot() {
    return { v: 1, recipes: S.recipes, deleted: S.deleted, categories: S.categories, plan: S.plan, checks: S.checks, settings: S.settings, meta: S.meta };
  }

  function applyState(o) {
    var base = freshState();
    S.recipes = o.recipes || [];
    S.deleted = o.deleted || {};
    S.categories = (o.categories && o.categories.length) ? o.categories : base.categories;
    S.plan = o.plan || {};
    S.checks = o.checks || {};
    S.settings = Object.assign(base.settings, o.settings || {});
    S.meta = Object.assign(base.meta, o.meta || {});
  }

  /* ---------- storage (IndexedDB with localStorage fallback) ---------- */
  var Store = {
    db: null,
    open: function () {
      var self = this;
      return new Promise(function (resolve) {
        try {
          var req = indexedDB.open('recipe-vault', 1);
          req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
          req.onsuccess = function () { self.db = req.result; resolve(); };
          req.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    },
    get: function (k) {
      var self = this;
      return new Promise(function (resolve) {
        if (!self.db) { try { resolve(JSON.parse(localStorage.getItem('rv.' + k))); } catch (e) { resolve(null); } return; }
        var r = self.db.transaction('kv').objectStore('kv').get(k);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      });
    },
    set: function (k, v) {
      var self = this;
      return new Promise(function (resolve) {
        if (!self.db) { try { localStorage.setItem('rv.' + k, JSON.stringify(v)); } catch (e) { toast('Storage is full. Export a backup.'); } resolve(); return; }
        var tx = self.db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { toast('Could not save. Export a backup.'); resolve(); };
      });
    }
  };

  var saveTimer = null, syncTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { Store.set('state', snapshot()); }, 200);
    scheduleSync();
  }
  function touch(key) { S.meta[key] = now(); }

  /* ---------- drive sync glue ---------- */
  function clientId() { try { return localStorage.getItem('rv.clientId') || ''; } catch (e) { return ''; } }
  function driveOn() { try { return localStorage.getItem('rv.driveOn') === '1'; } catch (e) { return false; } }
  function setLS(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function scheduleSync() {
    if (!driveOn() || !window.Drive || !Drive.hasToken()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow(false); }, 4000);
  }

  function syncNow(interactive) {
    var id = clientId();
    if (!id) { toast('Add a Google client ID in Settings first'); return Promise.resolve(); }
    var ready = Drive.hasToken() ? Promise.resolve() : Drive.signIn(id, interactive);
    ui.driveMsg = 'Syncing…';
    if (currentRoute() === 'settings') render();
    return ready.then(function () {
      return Drive.sync(snapshot(), RV.mergeStates);
    }).then(function (merged) {
      applyState(merged);
      setLS('rv.driveOn', '1');
      setLS('rv.lastSync', String(now()));
      ui.driveMsg = 'Synced just now';
      Store.set('state', snapshot());
      render();
    }).catch(function (err) {
      ui.driveMsg = 'Sync problem: ' + err.message;
      toast(ui.driveMsg);
      render();
    });
  }

  /* ---------- dates ---------- */
  function iso(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function parseISO(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function mondayOf(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - dow);
    return iso(x);
  }
  function addDays(isoStr, n) { var d = parseISO(isoStr); d.setDate(d.getDate() + n); return iso(d); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function shortDate(isoStr) { var d = parseISO(isoStr); return MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function weekLabel(mon) {
    var a = parseISO(mon), b = parseISO(addDays(mon, 6));
    return a.getMonth() === b.getMonth() ? MONTHS[a.getMonth()] + ' ' + a.getDate() + ' – ' + b.getDate()
      : MONTHS[a.getMonth()] + ' ' + a.getDate() + ' – ' + MONTHS[b.getMonth()] + ' ' + b.getDate();
  }

  /* ---------- small view helpers ---------- */
  var TINTS = ['#E6D9C3', '#D5E3D3', '#EBCFC4', '#D3DDE6', '#E9E1B8', '#DDD0E3'];
  function tintFor(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return TINTS[h % TINTS.length]; }
  function thumbStyle(r) { return r.thumb ? "background-image:url('" + r.thumb + "')" : 'background:' + tintFor(r.title || ''); }
  function getR(id) { for (var i = 0; i < S.recipes.length; i++) if (S.recipes[i].id === id) return S.recipes[i]; return null; }

  function svg(name, cls) {
    var p = {
      back: '<path d="M15 5l-7 7 7 7"/>', next: '<path d="M9 5l7 7-7 7"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
      plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>'
    };
    return '<svg ' + (cls ? 'class="' + cls + '" ' : '') + 'aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + p[name] + '</svg>';
  }
  function star(filled, cls) {
    return '<svg ' + (cls ? 'class="' + cls + '" ' : '') + 'aria-hidden="true" viewBox="0 0 24 24" fill="' + (filled ? '#E0A21B' : 'none') + '" stroke="#1B1F1D" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.8 6.7 19.6l1.1-5.8L3.5 9.7l5.9-.8z"/></svg>';
  }
  function tagGroup(re) { for (var i = 0; i < S.categories.length; i++) if (re.test(S.categories[i].name)) return S.categories[i].name; return null; }
  function allTags(r) { var out = []; Object.keys(r.tags || {}).forEach(function (g) { out = out.concat(r.tags[g]); }); return out; }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function downloadFile(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Copy failed'); }
    ta.remove();
  }

  /* ---------- links, sharing, wake lock ---------- */
  function cleanUrl(u) {
    u = (u || '').trim();
    try {
      var x = new URL(u);
      ['igsh', 'igshid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid', 'mibextid'].forEach(function (k) { x.searchParams.delete(k); });
      var s = x.toString();
      return s.replace(/\?$/, '');
    } catch (e) { return u; }
  }

  function firstUrl(s) {
    var m = String(s || '').match(/https?:\/\/[^\s]+/);
    return m ? m[0].replace(/[)\].,;!]+$/, '') : '';
  }

  // Android sends a shared post to index.html?url=...&text=...&title=...
  function handleShare() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return false; }
    if (!(q.has('url') || q.has('text') || q.has('title'))) return false;
    var text = q.get('text') || '', url = q.get('url') || '';
    var link = firstUrl(url) || firstUrl(text);
    var rest = text.replace(/https?:\/\/[^\s]+/g, '').trim();
    ui.add.url = link ? cleanUrl(link) : '';
    if (rest.length > 40) ui.add.text = rest; // a caption, not just "Check out this reel"
    ui.add.mode = 'paste';
    ui.shared = true;
    try { history.replaceState(null, '', location.pathname + '#/add'); } catch (e) { location.hash = '#/add'; }
    return true;
  }

  // One-tap paste: when a recipe-looking caption is on the clipboard, offer to use it.
  function looksLikeRecipe(t) {
    if (!t || t.length < 40 || /^https?:\/\/\S+$/.test(t)) return false;
    var p = RV.parseCaption(t);
    return p.ingredients.length >= 2 || (/\bingredients?\b/i.test(t) && t.length > 80);
  }

  function checkClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    if (ui.clip.status === 'denied' || ui.clip.busy) return;
    ui.clip.busy = true;
    navigator.clipboard.readText().then(function (raw) {
      var t = (raw || '').trim();
      var ignored = ui.clip.ignored;
      if (t && t !== ignored && looksLikeRecipe(t)) {
        var p = RV.parseCaption(t);
        ui.clip = {
          status: 'ready', text: t, ignored: ignored, busy: false,
          stats: (p.title ? p.title + ' · ' : '') + p.ingredients.length + ' ingredients · ' + p.steps.length + ' steps'
        };
      } else {
        ui.clip = { status: 'none', text: '', ignored: ignored, busy: false, stats: '' };
      }
      if (currentRoute() === 'add' && !ui.draft) render();
    }, function () {
      ui.clip.busy = false; ui.clip.status = 'denied';
      if (currentRoute() === 'add' && !ui.draft) render();
    });
  }

  function onReturn() {
    if (document.visibilityState === 'hidden') return;
    if (currentRoute() === 'add' && !ui.draft && ui.add.mode === 'paste' && !ui.add.text.trim()) checkClipboard();
  }
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('focus', onReturn);

  function isStandalone() {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; }
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    ui.installEvt = e;
    if (currentRoute() === 'settings') render();
  });

  var wake = null, cookOpen = false;
  function acquireWake() {
    if (!('wakeLock' in navigator)) { toast('This browser cannot keep the screen on'); return; }
    navigator.wakeLock.request('screen').then(function (l) {
      wake = l;
      l.addEventListener('release', function () { if (wake === l) wake = null; });
    }).catch(function () { /* denied (for example battery saver); cooking still works */ });
  }
  function releaseWake() {
    if (wake) { try { wake.release(); } catch (e) { /* ignore */ } wake = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && cookOpen && !wake) acquireWake();
  });

  /* ---------- images ---------- */
  function resizeImage(file, max, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  var ocrPromise = null;
  function loadOCR() {
    if (window.Tesseract) return Promise.resolve();
    if (ocrPromise) return ocrPromise;
    ocrPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { ocrPromise = null; reject(new Error('Could not load the text reader. Check your connection.')); };
      document.head.appendChild(s);
    });
    return ocrPromise;
  }

  /* ---------- routing ---------- */
  function currentRoute() {
    var h = location.hash.replace(/^#/, '') || '/';
    return h.split('/').filter(Boolean)[0] || 'library';
  }

  function render() {
    var h = location.hash.replace(/^#/, '') || '/';
    var parts = h.split('/').filter(Boolean);
    var name = parts[0] || 'library';
    var view = $('#view');
    var html;
    switch (name) {
      case 'add': html = viewAdd(); break;
      case 'edit': html = viewEdit(parts[1]); break;
      case 'recipe': html = viewRecipe(parts[1]); break;
      case 'plan': html = viewPlan(); break;
      case 'groceries': html = viewGroceries(); break;
      case 'settings': html = viewSettings(); break;
      default: name = 'library'; html = viewLibrary();
    }
    view.innerHTML = html;
    var tab = name === 'groceries' ? 'plan' : (name === 'recipe' || name === 'edit') ? 'library' : name;
    document.querySelectorAll('#tabbar a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-tab') === tab); });
    if (name === 'library') renderLibResults();
  }

  /* ================================================================
     LIBRARY
     ================================================================ */
  function activeFilterCount() {
    var f = ui.f, n = 0;
    Object.keys(f.groups).forEach(function (g) { n += (f.groups[g] || []).length; });
    if (f.maxTime) n++;
    if (f.fav) n++;
    if (f.notCooked) n++;
    return n;
  }

  function viewLibrary() {
    var first = S.categories[0];
    var sel = first && ui.f.groups[first.name] && ui.f.groups[first.name].length === 1 ? ui.f.groups[first.name][0] : null;
    var chips = '';
    if (first) {
      chips = '<div class="chip-row" style="margin-top:12px">' +
        '<button class="chip' + (sel ? '' : ' on') + '" data-act="quick" data-o="">All</button>' +
        first.options.map(function (o) { return '<button class="chip' + (sel === o ? ' on' : '') + '" data-act="quick" data-o="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') +
        '</div>';
    }
    var nf = activeFilterCount();
    var banner = (driveOn() && window.Drive && !Drive.hasToken())
      ? '<a class="notice warn" style="display:block;margin-top:12px;text-decoration:none" href="#/settings">Drive sync is paused. Tap to reconnect.</a>' : '';
    return '<div class="page-head"><h1 class="display">Recipe Vault</h1><span class="muted small" id="lib-count">' + S.recipes.length + ' recipes</span></div>' +
      '<label class="search">' + svg('search') + '<input type="search" id="lib-search" placeholder="Search recipes or ingredients" aria-label="Search recipes or ingredients" data-bind="search" value="' + esc(ui.search) + '" autocomplete="off"></label>' +
      banner + chips +
      '<div class="chip-row" style="margin-top:8px">' +
      '<button class="chip" style="border-radius:10px;border-color:var(--ink);font-weight:500" data-act="openFilters">Filters' + (nf ? ' (' + nf + ')' : '') + '</button>' +
      '<button class="chip' + (ui.f.fav ? ' on' : '') + '" style="border-radius:10px" data-act="togFav">Favourites</button>' +
      '<button class="chip' + (ui.f.maxTime === 30 ? ' on' : '') + '" style="border-radius:10px" data-act="togQuick">Under 30 min</button>' +
      '<button class="chip' + (ui.f.notCooked ? ' on' : '') + '" style="border-radius:10px" data-act="togNotCooked">Not cooked yet</button>' +
      '</div>' +
      '<div id="lib-results" style="margin-top:14px"></div>';
  }

  function filteredRecipes() {
    var f = ui.f;
    var tokens = ui.search.toLowerCase().split(/\s+/).filter(Boolean);
    var list = S.recipes.filter(function (r) {
      if (tokens.length) {
        var hay = (r.title + ' ' + (r.ingredients || []).map(function (i) { return i.name; }).join(' ') + ' ' + allTags(r).join(' ') + ' ' + (r.notes || '')).toLowerCase();
        for (var i = 0; i < tokens.length; i++) if (hay.indexOf(tokens[i]) === -1) return false;
      }
      var ok = true;
      Object.keys(f.groups).forEach(function (g) {
        var sel = f.groups[g] || [];
        if (!sel.length) return;
        var have = (r.tags && r.tags[g]) || [];
        if (!sel.some(function (o) { return have.indexOf(o) !== -1; })) ok = false;
      });
      if (!ok) return false;
      if (f.maxTime && !(r.time && r.time <= f.maxTime)) return false;
      if (f.fav && !r.favorite) return false;
      if (f.notCooked && r.cookedCount > 0) return false;
      return true;
    });
    var by = {
      newest: function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); },
      az: function (a, b) { return a.title.localeCompare(b.title); },
      rating: function (a, b) { return (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title); },
      cooked: function (a, b) { return (b.lastCooked || 0) - (a.lastCooked || 0); },
      time: function (a, b) { return (a.time || 9999) - (b.time || 9999); }
    };
    list.sort(by[f.sort] || by.newest);
    return list;
  }

  function renderLibResults() {
    var box = $('#lib-results');
    if (!box) return;
    var list = filteredRecipes();
    var effort = tagGroup(/effort|difficulty/i);
    if (!S.recipes.length) {
      box.innerHTML = '<div class="empty"><h2 class="display">Your library is empty</h2><p>Save your first recipe by pasting a caption from Instagram or Facebook.</p><a class="btn primary" href="#/add">Add a recipe</a></div>';
    } else if (!list.length) {
      box.innerHTML = '<div class="empty"><h2 class="display">No matches</h2><p>Try fewer filters or a different search.</p><button class="btn" data-act="clearFilters">Clear filters</button></div>';
    } else {
      box.innerHTML = '<div class="grid">' + list.map(function (r) {
        var meta = [r.time ? r.time + ' min' : null, effort && r.tags && r.tags[effort] ? r.tags[effort][0] : null].filter(Boolean).join(' · ');
        return '<a class="rcard" href="#/recipe/' + r.id + '">' +
          '<div class="rthumb" style="' + thumbStyle(r) + '"><span class="src">' + esc(r.source || 'Other') + '</span>' + star(r.favorite, 'fav') + '</div>' +
          '<div class="rbody"><div class="rtitle">' + esc(r.title) + '</div><div class="rmeta">' + esc(meta || ' ') + '</div></div></a>';
      }).join('') + '</div>';
    }
    var c = $('#lib-count');
    if (c) c.textContent = (list.length === S.recipes.length ? S.recipes.length : list.length + ' of ' + S.recipes.length) + ' recipes';
  }

  function sheetFilters() {
    var f = ui.f;
    var groups = S.categories.map(function (g) {
      var sel = f.groups[g.name] || [];
      return '<div style="margin-bottom:14px"><div class="label">' + esc(g.name) + '</div><div class="opt-row">' +
        g.options.map(function (o) { return '<button class="chip opt' + (sel.indexOf(o) !== -1 ? ' on' : '') + '" data-act="filterOpt" data-g="' + esc(g.name) + '" data-o="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') +
        '</div></div>';
    }).join('');
    var times = [[0, 'Any time'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '60 min']].map(function (t) {
      return '<button class="chip opt' + (f.maxTime === t[0] ? ' on' : '') + '" data-act="filterTime" data-v="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
    var sorts = [['newest', 'Newest'], ['az', 'A to Z'], ['rating', 'Top rated'], ['cooked', 'Recently cooked'], ['time', 'Quickest']].map(function (s) {
      return '<button class="chip opt' + (f.sort === s[0] ? ' on' : '') + '" data-act="filterSort" data-v="' + s[0] + '">' + s[1] + '</button>';
    }).join('');
    return '<h2 class="display">Filters</h2>' + groups +
      '<div style="margin-bottom:14px"><div class="label">Max total time</div><div class="opt-row">' + times + '</div></div>' +
      '<div style="margin-bottom:18px"><div class="label">Sort by</div><div class="opt-row">' + sorts + '</div></div>' +
      '<div class="row"><button class="btn grow" data-act="clearFilters">Clear all</button><button class="btn primary grow" data-act="closeSheet">Show recipes</button></div>';
  }

  /* ================================================================
     ADD (paste / screenshot) and EDIT form
     ================================================================ */
  function viewAdd() {
    if (ui.draft && !ui.draft.fromAdd) ui.draft = null;
    if (ui.draft) return viewDraftForm('Review recipe', false);
    var a = ui.add;
    var postUrl = safeUrl(a.url);
    var linkNote = (ui.shared && postUrl && !a.text.trim())
      ? '<div class="notice"><b>Link received.</b> Instagram and Facebook only share the link, not the recipe. Tap Open post and copy the caption. When you come back, the app offers to use it.</div>'
      : '<div class="notice">Copy the caption from the Instagram or Facebook post (or the recipe from the comments), then tap Paste caption and create.</div>';
    var c = ui.clip, clipCard = '';
    if (c.status === 'ready') {
      clipCard = '<div class="card pad stack" style="border-color:var(--accent)">' +
        '<div><b>Caption found on your clipboard</b><div class="small muted">' + esc(c.stats) + '</div></div>' +
        '<pre class="clip-preview">' + esc(c.text.slice(0, 220)) + (c.text.length > 220 ? '…' : '') + '</pre>' +
        '<div class="row"><button class="btn primary grow" style="min-height:52px" data-act="useClip">Create recipe from this</button>' +
        '<button class="btn" style="min-height:52px" data-act="dismissClip">Not this</button></div></div>';
    }
    var helper = a.mode === 'paste'
      ? clipCard + (c.status === 'ready' ? '' : linkNote) + '<div class="row wrap">' +
        '<button class="btn primary grow" style="min-height:52px" data-act="pasteClip">Paste caption and create</button>' +
        (postUrl ? '<a class="btn grow" style="min-height:52px" href="' + esc(postUrl) + '" target="_blank" rel="noopener">Open post</a>' : '') + '</div>'
      :'<div class="card pad stack">' +
        '<div class="small muted">Choose a screenshot of the recipe. The text is read on your device and dropped into the box below for you to check.</div>' +
        '<div class="row wrap"><label class="btn" style="cursor:pointer">Choose image<input type="file" accept="image/*" data-change="addPhoto" hidden></label>' +
        (a.file ? '<button class="btn primary" data-act="runOCR" id="ocr-btn">Read text from image</button>' : '') + '</div>' +
        (a.photo ? '<img alt="Selected image preview" src="' + a.photo + '" style="max-width:100%;max-height:180px;border-radius:12px;object-fit:cover">' : '') +
        '<div class="small muted" id="ocr-status">' + esc(a.ocr) + '</div></div>';
    return '<div class="page-head"><h1 class="display">Add recipe</h1><a class="icon-btn" href="#/" aria-label="Close">' + svg('x') + '</a></div>' +
      '<div class="seg"><button class="' + (a.mode === 'paste' ? 'on' : '') + '" data-act="addMode" data-v="paste">Paste text</button><button class="' + (a.mode === 'shot' ? 'on' : '') + '" data-act="addMode" data-v="shot">Screenshot</button></div>' +
      '<div class="stack" style="margin-top:14px">' + helper +
      '<div class="field"><label for="add-url">Link to the post (optional)</label><input class="input" id="add-url" type="url" inputmode="url" placeholder="https://www.instagram.com/reel/…" data-bind="add.url" value="' + esc(a.url) + '"></div>' +
      '<div class="field"><label for="add-text">Recipe text</label><textarea class="textarea" id="add-text" style="min-height:200px" placeholder="Paste the caption here. Headings like Ingredients and Method help." data-bind="add.text">' + esc(a.text) + '</textarea>' +
      '<button class="btn small" style="align-self:flex-start" data-act="useSample">Paste an example</button></div>' +
      '<div class="small muted">The app reads the text you paste. The link is saved with the recipe so you can always reopen the original post.</div>' +
      '<div class="row"><button class="btn primary grow" data-act="parseText">Create recipe</button><button class="btn" data-act="blankDraft">Start blank</button></div></div>';
  }

  function newDraft(p) {
    return {
      id: null, fromAdd: true, title: p.title || '', source: p.source || 'Other', url: p.url || '', thumb: p.thumb || null,
      baseServings: p.baseServings || 4, time: p.time || '', ingText: p.ingText || '', stepText: p.stepText || '',
      tags: p.tags || {}, notes: p.notes || '', warn: p.warn || ''
    };
  }

  function draftFromRecipe(r) {
    return {
      id: r.id, fromAdd: false, title: r.title, source: r.source || 'Other', url: r.url || '', thumb: r.thumb || null,
      baseServings: r.baseServings, time: r.time || '', ingText: (r.ingredients || []).map(function (i) { return i.raw; }).join('\n'),
      stepText: (r.steps || []).join('\n'), tags: JSON.parse(JSON.stringify(r.tags || {})), notes: r.notes || '', warn: ''
    };
  }

  function viewEdit(id) {
    var r = getR(id);
    if (!r) return notFound();
    if (!ui.draft || ui.draft.id !== id) ui.draft = draftFromRecipe(r);
    return viewDraftForm('Edit recipe', true);
  }

  function ingStats(text) {
    var lines = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var withQty = lines.filter(function (l) { return RV.parseIngredientLine(l).qty != null; }).length;
    return lines.length + ' ingredients · ' + withQty + ' with amounts';
  }

  function draftTagsHTML() {
    var d = ui.draft;
    return S.categories.map(function (g) {
      var sel = d.tags[g.name] || [];
      return '<div style="margin-bottom:12px"><div class="label">' + esc(g.name) + '</div><div class="opt-row">' +
        g.options.map(function (o) { return '<button type="button" class="chip opt' + (sel.indexOf(o) !== -1 ? ' on' : '') + '" data-act="dtag" data-g="' + esc(g.name) + '" data-o="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') +
        '<button type="button" class="chip opt dashed" data-act="dnewtag" data-g="' + esc(g.name) + '">+ Add</button></div></div>';
    }).join('');
  }

  function viewDraftForm(title, editing) {
    var d = ui.draft;
    var warn = d.warn ? '<div class="notice warn">' + esc(d.warn) + '</div>' : '';
    return '<div class="page-head"><h1 class="display">' + esc(title) + '</h1><button class="icon-btn" aria-label="Cancel" data-act="cancelDraft">' + svg('x') + '</button></div>' +
      '<div class="stack">' + warn +
      '<div class="card pad stack">' +
      '<div class="field"><label for="d-title">Title</label><input class="input" id="d-title" data-bind="draft.title" value="' + esc(d.title) + '"></div>' +
      '<div class="row wrap"><div class="field grow" style="min-width:110px"><label for="d-serv">Serves</label><input class="input" id="d-serv" type="number" min="1" max="48" inputmode="numeric" data-bind="draft.baseServings" value="' + esc(d.baseServings) + '"></div>' +
      '<div class="field grow" style="min-width:110px"><label for="d-time">Total minutes</label><input class="input" id="d-time" type="number" min="0" inputmode="numeric" data-bind="draft.time" value="' + esc(d.time) + '"></div>' +
      '<div class="field grow" style="min-width:130px"><label for="d-src">Source</label><select class="select" id="d-src" data-bind="draft.source">' +
      ['Instagram', 'Facebook', 'Other'].map(function (s) { return '<option' + (d.source === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label for="d-url">Link to original post</label><input class="input" id="d-url" type="url" inputmode="url" data-bind="draft.url" value="' + esc(d.url) + '"></div>' +
      '<div class="row">' + (d.thumb ? '<div style="width:64px;height:64px;border-radius:10px;background-size:cover;background-position:center;' + thumbStyle({ thumb: d.thumb }) + '"></div>' : '') +
      '<label class="btn small" style="cursor:pointer">' + (d.thumb ? 'Change photo' : 'Add photo') + '<input type="file" accept="image/*" data-change="draftPhoto" hidden></label>' +
      (d.thumb ? '<button class="btn small" data-act="removePhoto">Remove</button>' : '') + '</div>' +
      '</div>' +
      '<div class="field"><label for="d-ing">Ingredients (one per line)</label><textarea class="textarea" id="d-ing" style="min-height:160px" data-bind="draft.ingText">' + esc(d.ingText) + '</textarea><div class="small muted" id="ing-count">' + esc(ingStats(d.ingText)) + '</div></div>' +
      '<div class="field"><label for="d-steps">Steps (one per line)</label><textarea class="textarea" id="d-steps" style="min-height:160px" data-bind="draft.stepText">' + esc(d.stepText) + '</textarea></div>' +
      '<div><div class="row between" style="margin-bottom:8px"><h2 style="font-size:15px">Categories</h2><button class="btn small" data-act="retag">Auto-tag again</button></div><div id="d-tags">' + draftTagsHTML() + '</div></div>' +
      '<div class="field"><label for="d-notes">Notes</label><textarea class="textarea" id="d-notes" style="min-height:80px" data-bind="draft.notes">' + esc(d.notes) + '</textarea></div>' +
      '<button class="btn primary block" style="min-height:52px;font-size:16px" data-act="saveDraft">' + (editing ? 'Save changes' : 'Save to library') + '</button>' +
      '</div>';
  }

  function saveDraft() {
    var d = ui.draft;
    if (!d.title.trim()) { toast('Add a title first'); return; }
    var ings = d.ingText.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).map(RV.parseIngredientLine);
    var steps = d.stepText.split('\n').map(function (s) { return s.trim().replace(/^(?:step\s*)?\d+\s*[.):\-]\s*/i, ''); }).filter(Boolean);
    var r = d.id ? getR(d.id) : null;
    if (!r) {
      r = { id: uid(), rating: 0, cookedCount: 0, lastCooked: null, favorite: false, createdAt: now() };
      S.recipes.push(r);
    }
    r.title = d.title.trim();
    r.source = d.source;
    r.url = safeUrl(d.url.trim());
    r.thumb = d.thumb;
    r.baseServings = Math.max(1, parseInt(d.baseServings, 10) || 4);
    r.time = d.time ? parseInt(d.time, 10) : null;
    r.ingredients = ings;
    r.steps = steps;
    r.tags = d.tags;
    r.notes = d.notes;
    r.updatedAt = now();
    delete S.deleted[r.id];
    ui.draft = null;
    ui.add = { mode: 'paste', url: '', text: '', photo: null, file: null, ocr: '' };
    save();
    toast('Saved');
    location.hash = '#/recipe/' + r.id;
  }

  /* ================================================================
     RECIPE DETAIL
     ================================================================ */
  function notFound() {
    return '<div class="empty"><h2 class="display">Recipe not found</h2><a class="btn" href="#/">Back to library</a></div>';
  }

  function viewRecipe(id) {
    var r = getR(id);
    if (!r) return notFound();
    if (ui.rs.id !== id) ui.rs = { id: id, servings: r.baseServings, system: S.settings.units };
    var s = ui.rs.servings, sys = ui.rs.system;
    var factor = s / r.baseServings;
    var url = safeUrl(r.url);
    var pill = url
      ? '<a class="srcpill no-print" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(r.source) + ' · Open original post</a>'
      : '<span class="srcpill no-print">' + esc(r.source || 'Other') + '</span>';
    var meta = [r.time ? r.time + ' min' : null, 'Saved ' + shortDate(iso(new Date(r.createdAt || now())))].filter(Boolean).join(' · ');
    var stars = [1, 2, 3, 4, 5].map(function (n) {
      return '<button aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '" class="' + (n <= (r.rating || 0) ? 'on' : '') + '" data-act="rate" data-v="' + n + '">★</button>';
    }).join('');
    var tags = allTags(r).map(function (t) { return '<span class="chip tag">' + esc(t) + '</span>'; }).join('');
    var ings = (r.ingredients || []).map(function (i) {
      var x = RV.scaleIngredient(i, factor, sys);
      return '<li><span>' + esc(x.name) + '</span><span class="ing-amt">' + esc(x.amount) + '</span></li>';
    }).join('');
    var steps = (r.steps || []).map(function (st) { return '<li>' + esc(RV.convertTemps(st, sys)) + '</li>'; }).join('');
    var cooked = r.cookedCount ? 'Cooked ' + r.cookedCount + '×' : 'Not cooked yet';

    return '<div class="hero" style="' + thumbStyle(r) + '">' +
      '<a class="icon-btn back no-print" href="#/" aria-label="Back to library">' + svg('back') + '</a>' +
      '<button class="icon-btn fav-btn no-print" aria-label="' + (r.favorite ? 'Remove from favourites' : 'Add to favourites') + '" data-act="fav">' + star(r.favorite) + '</button>' + pill + '</div>' +
      '<h1 class="display" style="font-size:28px;line-height:1.15;margin-top:16px">' + esc(r.title) + '</h1>' +
      '<div class="muted small" style="margin-top:6px">' + esc(meta) + '</div>' +
      '<div class="row between no-print" style="margin-top:8px"><div class="row"><div class="stars" role="group" aria-label="Rating">' + stars + '</div><span class="muted small">' + cooked + '</span></div>' +
      '<button class="btn small outline" data-act="cooked">Mark cooked</button></div>' +
      (tags ? '<div class="row wrap" style="margin-top:10px;gap:6px">' + tags + '</div>' : '') +
      '<div class="card pad row between wrap" style="margin-top:14px">' +
      '<div class="stepper"><button data-act="serv" data-v="-1" aria-label="Fewer servings">−</button><div class="val"><b>' + s + '</b><span>servings</span></div><button data-act="serv" data-v="1" aria-label="More servings">+</button></div>' +
      '<div class="seg sm no-print"><button class="' + (sys === 'us' ? 'on' : '') + '" data-act="sys" data-v="us">US</button><button class="' + (sys === 'metric' ? 'on' : '') + '" data-act="sys" data-v="metric">Metric</button></div></div>' +
      (s !== r.baseServings ? '<div class="small muted no-print" style="margin-top:6px">Original recipe serves ' + r.baseServings + '. <button class="btn small" style="min-height:28px;padding:0 8px" data-act="servReset">Reset</button></div>' : '') +
      '<h2 style="font-size:16px;margin:18px 0 8px">Ingredients</h2>' +
      (ings ? '<ul class="list">' + ings + '</ul>' : '<div class="muted small">No ingredients saved. Tap Edit to add them.</div>') +
      '<h2 style="font-size:16px;margin:18px 0 8px">Steps</h2>' +
      (steps ? '<ol class="steps">' + steps + '</ol>' : '<div class="muted small">No steps saved.</div>') +
      '<div class="field no-print" style="margin-top:18px"><label for="r-notes">Notes</label><textarea class="textarea" id="r-notes" style="min-height:80px" placeholder="Tweaks, what worked, what to change next time" data-change="notes">' + esc(r.notes || '') + '</textarea></div>' +
      (r.notes ? '<div class="print-only" style="margin-top:14px"><b>Notes:</b> ' + esc(r.notes) + '</div>' : '') +
      '<button class="btn primary block no-print" style="margin-top:18px;min-height:52px;font-size:16px" data-act="cook">Cook mode</button>' +
      '<div class="row wrap no-print" style="margin-top:8px">' +
      '<button class="btn grow" data-act="print">Print</button><button class="btn grow" data-act="openExport">Export</button>' +
      '<button class="btn primary grow" data-act="openAddPlan">Add to plan</button></div>' +
      '<div class="row wrap no-print" style="margin-top:8px"><a class="btn grow" href="#/edit/' + r.id + '">Edit</a><button class="btn danger grow" data-act="deleteRecipe">Delete</button></div>';
  }

  function recipeText(r, servings, sys) {
    var f = servings / r.baseServings;
    var lines = [r.title, ''];
    lines.push('Serves ' + servings + (r.time ? ' · ' + r.time + ' min' : ''));
    if (safeUrl(r.url)) lines.push(r.url);
    lines.push('', 'INGREDIENTS');
    (r.ingredients || []).forEach(function (i) { lines.push('- ' + RV.scaleIngredient(i, f, sys).text); });
    lines.push('', 'STEPS');
    (r.steps || []).forEach(function (s, n) { lines.push((n + 1) + '. ' + RV.convertTemps(s, sys)); });
    if (r.notes) lines.push('', 'NOTES', r.notes);
    return lines.join('\n');
  }

  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recipe'; }

  /* ================================================================
     PLAN and GROCERIES
     ================================================================ */
  function weekTabs(active) {
    return '<div class="seg"><a class="' + (active === 'week' ? 'on' : '') + '" href="#/plan">Week</a><a class="' + (active === 'groc' ? 'on' : '') + '" href="#/groceries">Groceries</a></div>' +
      '<div class="row between" style="padding:10px 0 6px"><button class="icon-btn" style="border:0;background:transparent" aria-label="Previous week" data-act="weekPrev">' + svg('back') + '</button>' +
      '<div class="row" style="gap:10px"><b>' + weekLabel(ui.week) + '</b>' + (ui.week !== mondayOf(new Date()) ? '<button class="btn small" data-act="weekToday">This week</button>' : '') + '</div>' +
      '<button class="icon-btn" style="border:0;background:transparent" aria-label="Next week" data-act="weekNext">' + svg('next') + '</button></div>';
  }

  function weekEntries() {
    var out = [];
    for (var i = 0; i < 7; i++) {
      var day = addDays(ui.week, i);
      (S.plan[day] || []).forEach(function (e) {
        var r = getR(e.recipeId);
        if (r) out.push({ recipe: r, servings: e.servings });
      });
    }
    return out;
  }

  function viewPlan() {
    var today = iso(new Date());
    var days = '';
    for (var i = 0; i < 7; i++) {
      var day = addDays(ui.week, i), d = parseISO(day);
      var es = (S.plan[day] || []).filter(function (e) { return getR(e.recipeId); });
      days += '<div class="day"><div class="daylabel' + (day === today ? ' today' : '') + '"><div class="d">' + DOW[d.getDay()] + '</div><div class="n">' + d.getDate() + '</div></div><div class="entries">' +
        es.map(function (e) {
          var r = getR(e.recipeId);
          return '<div class="entry"><div class="thumb" style="' + thumbStyle(r) + '"></div><div class="grow"><a class="t" href="#/recipe/' + r.id + '">' + esc(r.title) + '</a>' +
            '<div class="sv"><button aria-label="Fewer servings" data-act="planServ" data-d="' + day + '" data-id="' + e.id + '" data-v="-1">−</button>' + e.servings + ' servings<button aria-label="More servings" data-act="planServ" data-d="' + day + '" data-id="' + e.id + '" data-v="1">+</button></div></div>' +
            '<button class="icon-btn" style="width:36px;height:36px;border:0;background:transparent" aria-label="Remove from plan" data-act="planRemove" data-d="' + day + '" data-id="' + e.id + '">' + svg('x') + '</button></div>';
        }).join('') +
        '<button class="add-entry' + (es.length ? ' compact' : '') + '" data-act="openPick" data-d="' + day + '">' + svg('plus').replace('<svg ', '<svg width="16" height="16" ') + (es.length ? 'Add another' : 'Add a recipe') + '</button></div></div>';
    }
    var n = weekEntries().length;
    return '<div class="page-head"><h1 class="display">Meal plan</h1></div>' + weekTabs('week') + '<div style="margin-top:6px">' + days + '</div>' +
      '<a class="btn primary block" style="min-height:52px;margin-top:8px" href="#/groceries">' + n + ' planned · Build grocery list →</a>';
  }

  function groceryItems() { return RV.buildGroceryList(weekEntries(), S.settings.units); }

  function viewGroceries() {
    var items = groceryItems();
    var checks = S.checks[ui.week] || {};
    var head = '<div class="page-head"><h1 class="display">Meal plan</h1></div>' + weekTabs('groc');
    if (!items.length) {
      return head + '<div class="empty"><h2 class="display">Nothing to buy yet</h2><p>Add recipes to this week and the combined list appears here.</p><a class="btn primary" href="#/plan">Plan the week</a></div>';
    }
    var html = '', last = '';
    items.forEach(function (it) {
      if (it.aisle !== last) { html += '<h2 class="aisle">' + esc(it.aisle) + '</h2>'; last = it.aisle; }
      var done = !!checks[it.id];
      html += '<label class="gro-item' + (done ? ' done' : '') + '"><input type="checkbox" data-change="gcheck" data-id="' + esc(it.id) + '"' + (done ? ' checked' : '') + '>' +
        '<span class="nm">' + esc(it.name) + (it.from > 1 ? ' <span class="muted small">' + it.from + ' recipes</span>' : '') + '</span><span class="q">' + esc(it.amount) + '</span></label>';
    });
    return head + '<div class="small muted" style="padding:2px 0 4px">' + weekEntries().length + (weekEntries().length === 1 ? ' recipe' : ' recipes') + ' combined, amounts already added up.</div>' + html +
      '<div class="row no-print" style="margin-top:18px"><button class="btn grow" data-act="copyGroceries">Copy list</button><button class="btn grow" data-act="print">Print</button><button class="btn primary grow" data-act="shareGroceries">Share</button></div>' +
      '<button class="btn block no-print" style="margin-top:8px" data-act="clearChecks">Uncheck everything</button>';
  }

  function groceryText() {
    var items = groceryItems(), last = '', out = ['Groceries · ' + weekLabel(ui.week)];
    items.forEach(function (it) {
      if (it.aisle !== last) { out.push('', it.aisle.toUpperCase()); last = it.aisle; }
      out.push('- ' + (it.amount ? it.amount + ' ' : '') + it.name);
    });
    return out.join('\n');
  }

  function sheetPick(day, q) {
    var tokens = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
    var list = S.recipes.filter(function (r) {
      var hay = (r.title + ' ' + allTags(r).join(' ')).toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
    }).sort(function (a, b) { return a.title.localeCompare(b.title); });
    var rows = list.map(function (r) {
      return '<button class="pick" data-act="planAdd" data-d="' + day + '" data-id="' + r.id + '"><div class="thumb" style="' + thumbStyle(r) + '"></div><div class="grow"><b style="font-size:14px">' + esc(r.title) + '</b><div class="muted small">' + (r.time ? r.time + ' min · ' : '') + 'serves ' + r.baseServings + '</div></div></button>';
    }).join('');
    return '<h2 class="display">Add to ' + DOW[parseISO(day).getDay()] + ' ' + shortDate(day) + '</h2>' +
      '<label class="search" style="margin-bottom:12px">' + svg('search') + '<input type="search" id="pick-q" placeholder="Search your recipes" aria-label="Search your recipes" data-input="pickSearch" data-d="' + day + '" value="' + esc(q || '') + '" autocomplete="off"></label>' +
      '<div id="pick-list">' + (rows || '<div class="muted" style="padding:16px 0">No recipes match.</div>') + '</div>';
  }

  /* ================================================================
     SETTINGS
     ================================================================ */
  function viewSettings() {
    var id = clientId();
    var connected = window.Drive && Drive.hasToken();
    var last = parseInt((function () { try { return localStorage.getItem('rv.lastSync'); } catch (e) { return null; } })(), 10);
    var status = ui.driveMsg || (connected ? 'Connected' : driveOn() ? 'Sign in again to keep syncing' : 'Not connected');
    var groups = S.categories.map(function (g) {
      return '<div style="margin-bottom:14px"><div class="row between"><div class="label">' + esc(g.name) + '</div><button class="btn small" data-act="delGroup" data-g="' + esc(g.name) + '" aria-label="Delete group ' + esc(g.name) + '">Delete group</button></div><div class="opt-row">' +
        g.options.map(function (o) { return '<span class="chip opt">' + esc(o) + '<button aria-label="Remove ' + esc(o) + '" data-act="delOpt" data-g="' + esc(g.name) + '" data-o="' + esc(o) + '" style="border:0;background:transparent;margin-left:6px;padding:0 2px;font-size:16px;line-height:1">×</button></span>'; }).join('') +
        '<button class="chip opt dashed" data-act="addOpt" data-g="' + esc(g.name) + '">+ Add</button></div></div>';
    }).join('');
    return '<div class="page-head"><h1 class="display">Settings</h1></div>' +
      '<h2 class="eyebrow">Install on your phone</h2><div class="card pad stack">' +
      (isStandalone()
        ? '<div class="notice">Installed. In Instagram or Facebook, tap Share on a post and choose <b>Recipe Vault</b> to start adding it.</div>'
        : '<div class="small muted">Install it so it opens like an app, works offline, and appears in your phone’s Share menu.</div>' +
          '<button class="btn primary block" data-act="install">' + (ui.installEvt ? 'Install Recipe Vault' : 'How to install') + '</button>' +
          '<ol class="small muted" style="margin:0;padding-left:18px;line-height:1.6"><li>In Chrome, tap the ⋮ menu.</li><li>Choose <b>Install app</b> (or Add to Home screen).</li><li>Open Recipe Vault from your home screen.</li><li>In Instagram, tap Share on a recipe post and pick <b>Recipe Vault</b>.</li></ol>') +
      '</div>' +
      '<h2 class="eyebrow">Storage and sync</h2><div class="card pad stack">' +
      '<div class="row between"><div><b>Google Drive</b><div class="muted small">File “' + Drive.FILE_NAME + '” in My Drive</div></div><span class="chip tag">' + esc(status) + '</span></div>' +
      (last ? '<div class="small muted">Last synced ' + new Date(last).toLocaleString() + '</div>' : '') +
      '<div class="field"><label for="client-id">Google client ID</label><input class="input" id="client-id" placeholder="123456-abc.apps.googleusercontent.com" value="' + esc(id) + '" data-bind="clientId" autocomplete="off"></div>' +
      '<div class="row wrap"><button class="btn primary grow" data-act="driveConnect">' + (connected ? 'Sync now' : 'Connect and sync') + '</button>' + (driveOn() ? '<button class="btn grow" data-act="driveOff">Disconnect</button>' : '') + '</div>' +
      '<details><summary class="small" style="cursor:pointer;font-weight:700">How to get a client ID (one-time, about 10 minutes)</summary><ol class="small muted" style="padding-left:18px;line-height:1.6">' +
      '<li>Go to console.cloud.google.com and create a project.</li><li>Enable the Google Drive API for it.</li>' +
      '<li>OAuth consent screen: choose External, then add your email and your wife’s as test users.</li>' +
      '<li>Credentials, Create credentials, OAuth client ID, Web application. Under Authorized JavaScript origins add the address this app is served from.</li>' +
      '<li>Paste the client ID above and tap Connect. Google will warn the app is unverified; that is expected for a personal app, so choose Continue.</li>' +
      '<li>Your wife does the same sign-in on her device. Both of you then sync the same file.</li></ol></details>' +
      '<div class="muted small">Without Drive, everything is stored privately in this browser only.</div>' +
      '<div class="row wrap"><button class="btn grow" data-act="exportBackup">Export backup</button><label class="btn grow" style="cursor:pointer">Import<input type="file" accept="application/json,.json" data-change="importBackup" hidden></label></div>' +
      '</div>' +
      '<h2 class="eyebrow">Categories</h2><div class="card pad">' + groups + '<button class="btn outline block" data-act="addGroup">+ New category group</button></div>' +
      '<h2 class="eyebrow">Preferences</h2><div class="list">' +
      '<li style="align-items:center"><span>Auto-tag new recipes</span><button class="toggle" role="switch" aria-checked="' + (S.settings.autoTag ? 'true' : 'false') + '" aria-label="Auto-tag new recipes" data-act="togAuto"></button></li>' +
      '<li style="align-items:center"><span>Default units</span><div class="seg sm"><button class="' + (S.settings.units === 'us' ? 'on' : '') + '" data-act="units" data-v="us">US</button><button class="' + (S.settings.units === 'metric' ? 'on' : '') + '" data-act="units" data-v="metric">Metric</button></div></li></div>' +
      '<h2 class="eyebrow">About</h2><div class="card pad small muted">Recipe Vault reads text you paste or a screenshot and turns it into a recipe with rule-based parsing, so check the amounts before saving. Automatic link fetching can be added later with a small backend.</div>';
  }

  /* ================================================================
     SHEETS
     ================================================================ */
  function openSheet(html) {
    var root = $('#overlay-root');
    root.innerHTML = '<div class="overlay" data-overlay="1"><div class="sheet" role="dialog" aria-modal="true">' + html + '</div></div>';
    var first = root.querySelector('input, button');
    if (first && first.tagName === 'INPUT') first.focus();
  }
  function closeSheet() {
    $('#overlay-root').innerHTML = '';
    if (cookOpen) { cookOpen = false; releaseWake(); }
  }

  function cookHTML() {
    var r = getR(ui.rs.id);
    var f = ui.rs.servings / r.baseServings, sys = ui.rs.system;
    var done = ui.cookDone[r.id] || {};
    var ings = (r.ingredients || []).map(function (i) {
      var x = RV.scaleIngredient(i, f, sys);
      return '<li><span>' + esc(x.name) + '</span><span class="ing-amt">' + esc(x.amount) + '</span></li>';
    }).join('');
    var steps = (r.steps || []).map(function (s, n) {
      return '<button class="cstep' + (done[n] ? ' done' : '') + '" data-act="cookStep" data-i="' + n + '" aria-pressed="' + (done[n] ? 'true' : 'false') + '">' +
        '<span class="num">' + (n + 1) + '</span><span>' + esc(RV.convertTemps(s, sys)) + '</span></button>';
    }).join('');
    return '<div class="cook" role="dialog" aria-modal="true" aria-label="Cook mode">' +
      '<div class="cook-head"><div class="grow"><div class="display" style="font-size:20px;font-weight:700;line-height:1.2">' + esc(r.title) + '</div>' +
      '<div class="small muted">Serves ' + ui.rs.servings + ' · screen stays on</div></div>' +
      '<button class="btn" data-act="closeSheet">Done</button></div>' +
      '<details class="cook-ing"' + (steps ? '' : ' open') + '><summary>Ingredients (' + (r.ingredients || []).length + ')</summary><ul class="list" style="margin-top:8px">' + ings + '</ul></details>' +
      '<div class="cook-steps">' + (steps || '<div class="muted">No steps saved for this recipe.</div>') + '</div></div>';
  }

  function openCook() {
    $('#overlay-root').innerHTML = cookHTML();
    cookOpen = true;
    acquireWake();
    window.scrollTo(0, 0);
  }

  function sheetExport(r) {
    return '<h2 class="display">Export</h2><div class="stack">' +
      '<button class="btn block" data-act="exCopy">Copy as text</button>' +
      '<button class="btn block" data-act="exTxt">Download .txt</button>' +
      '<button class="btn block" data-act="exJson">Download recipe file (.json)</button>' +
      '<button class="btn block" data-act="exPrint">Print or save as PDF</button>' +
      '<button class="btn block" data-act="closeSheet">Close</button></div>';
  }

  function sheetAddPlan(r) {
    return '<h2 class="display">Add to plan</h2><div class="stack">' +
      '<div class="field"><label for="ap-date">Day</label><input class="input" id="ap-date" type="date" value="' + iso(new Date()) + '"></div>' +
      '<div class="field"><label for="ap-serv">Servings</label><input class="input" id="ap-serv" type="number" min="1" max="48" value="' + ui.rs.servings + '"></div>' +
      '<button class="btn primary block" data-act="confirmAddPlan">Add to plan</button><button class="btn block" data-act="closeSheet">Cancel</button></div>';
  }

  /* ================================================================
     ACTIONS
     ================================================================ */
  function setPath(path, value) {
    var parts = path.split('.');
    var obj = ui;
    for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
  }

  function planAdd(day, recipeId, servings) {
    (S.plan[day] = S.plan[day] || []).push({ id: uid(), recipeId: recipeId, servings: servings });
    touch('plan'); save();
  }

  function removeRecipeEverywhere(id) {
    Object.keys(S.plan).forEach(function (d) { S.plan[d] = S.plan[d].filter(function (e) { return e.recipeId !== id; }); });
    S.recipes = S.recipes.filter(function (r) { return r.id !== id; });
    S.deleted[id] = now();
    touch('plan');
  }

  function stripCategoryFromRecipes(group, option) {
    S.recipes.forEach(function (r) {
      if (!r.tags || !r.tags[group]) return;
      if (option == null) delete r.tags[group];
      else r.tags[group] = r.tags[group].filter(function (o) { return o !== option; });
      r.updatedAt = now();
    });
  }

  var actions = {
    quick: function (el) {
      var g = S.categories[0]; if (!g) return;
      var o = el.getAttribute('data-o');
      if (o) ui.f.groups[g.name] = [o]; else delete ui.f.groups[g.name];
      render();
    },
    togFav: function () { ui.f.fav = !ui.f.fav; render(); },
    togQuick: function () { ui.f.maxTime = ui.f.maxTime === 30 ? 0 : 30; render(); },
    togNotCooked: function () { ui.f.notCooked = !ui.f.notCooked; render(); },
    openFilters: function () { openSheet(sheetFilters()); },
    filterOpt: function (el) {
      var g = el.getAttribute('data-g'), o = el.getAttribute('data-o');
      var sel = ui.f.groups[g] || [];
      var i = sel.indexOf(o);
      if (i === -1) sel.push(o); else sel.splice(i, 1);
      ui.f.groups[g] = sel;
      openSheet(sheetFilters()); render();
    },
    filterTime: function (el) { ui.f.maxTime = parseInt(el.getAttribute('data-v'), 10); openSheet(sheetFilters()); render(); },
    filterSort: function (el) { ui.f.sort = el.getAttribute('data-v'); openSheet(sheetFilters()); render(); },
    clearFilters: function () { ui.f = { groups: {}, maxTime: 0, fav: false, notCooked: false, sort: 'newest' }; ui.search = ''; closeSheet(); render(); },
    closeSheet: function () { closeSheet(); },

    addMode: function (el) { ui.add.mode = el.getAttribute('data-v'); render(); },
    useSample: function () { ui.add.text = SAMPLE_CAPTION; render(); },
    useClip: function () {
      ui.add.text = ui.clip.text;
      ui.clip.ignored = ui.clip.text; ui.clip.status = 'none';
      actions.parseText();
    },
    dismissClip: function () {
      ui.clip.ignored = ui.clip.text; ui.clip.status = 'none'; ui.clip.text = '';
      render();
    },
    pasteClip: function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) { toast('Long-press the box below and choose Paste'); return; }
      navigator.clipboard.readText().then(function (raw) {
        var t = (raw || '').trim();
        if (!t) { toast('Nothing copied yet. Copy the caption first.'); return; }
        if (/^https?:\/\/\S+$/.test(t)) {
          ui.add.url = cleanUrl(t); render();
          toast('Link pasted. Now copy the caption and tap again.');
          return;
        }
        ui.add.text = t;
        actions.parseText();
      }, function () { toast('Could not read the clipboard. Long-press the box below and choose Paste.'); });
    },
    blankDraft: function () { ui.draft = newDraft({ source: RV.detectSource(ui.add.url), url: ui.add.url, thumb: ui.add.photo }); render(); },
    parseText: function () {
      var a = ui.add;
      if (!a.text.trim()) { toast('Paste the recipe text first'); return; }
      var p = RV.parseCaption(a.text);
      var tags = S.settings.autoTag ? RV.suggestTags({ title: p.title, ingredients: p.ingredients, steps: p.steps, time: p.time }, S.categories) : {};
      var warn = '';
      if (!p.ingredients.length && !p.steps.length) warn = 'We could not find ingredients or steps. Paste them into the boxes below, one per line.';
      else if (!p.ingredients.length) warn = 'No ingredients found. Add them below, one per line.';
      else if (!p.steps.length) warn = 'No steps found. Add them below if the post has them.';
      ui.draft = newDraft({
        title: p.title, source: RV.detectSource(a.url), url: a.url.trim(), thumb: a.photo, baseServings: p.servings || 4, time: p.time || '',
        ingText: p.ingredients.map(function (i) { return i.raw; }).join('\n'), stepText: p.steps.join('\n'), tags: tags, notes: p.description || '', warn: warn
      });
      render(); window.scrollTo(0, 0);
    },
    runOCR: function () {
      var a = ui.add;
      if (!a.file) return;
      var st = $('#ocr-status'), btn = $('#ocr-btn');
      if (btn) btn.disabled = true;
      st.textContent = 'Loading the text reader…';
      loadOCR().then(function () {
        return window.Tesseract.recognize(a.file, 'eng', {
          logger: function (m) { if (m.status === 'recognizing text') st.textContent = 'Reading… ' + Math.round(m.progress * 100) + '%'; }
        });
      }).then(function (res) {
        var text = (res.data.text || '').trim();
        a.text = text; a.ocr = text ? 'Done. Check the text below for mistakes.' : 'No text found in that image.';
        ui.add.mode = 'paste'; render();
      }).catch(function (e) {
        a.ocr = e.message; if (btn) btn.disabled = false; st.textContent = e.message;
      });
    },
    cancelDraft: function () {
      var wasEdit = ui.draft && ui.draft.id;
      ui.draft = null;
      location.hash = wasEdit ? '#/recipe/' + wasEdit : '#/';
      if (!wasEdit) render();
    },
    dtag: function (el) {
      var g = el.getAttribute('data-g'), o = el.getAttribute('data-o');
      var sel = ui.draft.tags[g] || [];
      var i = sel.indexOf(o);
      if (i === -1) sel.push(o); else sel.splice(i, 1);
      if (sel.length) ui.draft.tags[g] = sel; else delete ui.draft.tags[g];
      $('#d-tags').innerHTML = draftTagsHTML();
    },
    dnewtag: function (el) {
      var g = el.getAttribute('data-g');
      var name = (window.prompt('New option for ' + g + ':') || '').trim();
      if (!name) return;
      var grp = S.categories.filter(function (c) { return c.name === g; })[0];
      if (grp.options.indexOf(name) === -1) { grp.options.push(name); touch('categories'); }
      var sel = ui.draft.tags[g] || [];
      if (sel.indexOf(name) === -1) sel.push(name);
      ui.draft.tags[g] = sel; save();
      $('#d-tags').innerHTML = draftTagsHTML();
    },
    retag: function () {
      var d = ui.draft;
      var ings = d.ingText.split('\n').filter(function (s) { return s.trim(); }).map(RV.parseIngredientLine);
      var steps = d.stepText.split('\n').filter(function (s) { return s.trim(); });
      d.tags = RV.suggestTags({ title: d.title, ingredients: ings, steps: steps, time: d.time ? parseInt(d.time, 10) : null }, S.categories);
      $('#d-tags').innerHTML = draftTagsHTML();
      toast('Categories updated');
    },
    removePhoto: function () { ui.draft.thumb = null; render(); },
    saveDraft: saveDraft,

    fav: function () { var r = getR(ui.rs.id); r.favorite = !r.favorite; r.updatedAt = now(); save(); render(); },
    rate: function (el) { var r = getR(ui.rs.id), v = parseInt(el.getAttribute('data-v'), 10); r.rating = r.rating === v ? 0 : v; r.updatedAt = now(); save(); render(); },
    cooked: function () { var r = getR(ui.rs.id); r.cookedCount = (r.cookedCount || 0) + 1; r.lastCooked = now(); r.updatedAt = now(); save(); render(); toast('Logged. Cooked ' + r.cookedCount + '×'); },
    serv: function (el) { ui.rs.servings = Math.min(48, Math.max(1, ui.rs.servings + parseInt(el.getAttribute('data-v'), 10))); render(); },
    servReset: function () { ui.rs.servings = getR(ui.rs.id).baseServings; render(); },
    sys: function (el) { ui.rs.system = el.getAttribute('data-v'); render(); },
    print: function () { window.print(); },
    cook: function () { ui.cookDone[ui.rs.id] = {}; openCook(); },
    cookStep: function (el) {
      var d = ui.cookDone[ui.rs.id] = ui.cookDone[ui.rs.id] || {};
      var i = el.getAttribute('data-i');
      if (d[i]) delete d[i]; else d[i] = true;
      var keep = document.querySelector('.cook') ? document.querySelector('.cook').scrollTop : 0;
      $('#overlay-root').innerHTML = cookHTML();
      var c = document.querySelector('.cook'); if (c) c.scrollTop = keep;
    },
    install: function () {
      var e = ui.installEvt;
      if (!e) { toast('Use the browser menu: Install app'); return; }
      e.prompt();
      e.userChoice.then(function () { ui.installEvt = null; render(); });
    },
    openExport: function () { openSheet(sheetExport(getR(ui.rs.id))); },
    exCopy: function () { var r = getR(ui.rs.id); copyText(recipeText(r, ui.rs.servings, ui.rs.system)); closeSheet(); },
    exTxt: function () { var r = getR(ui.rs.id); downloadFile(slug(r.title) + '.txt', recipeText(r, ui.rs.servings, ui.rs.system)); closeSheet(); },
    exJson: function () { var r = getR(ui.rs.id); downloadFile(slug(r.title) + '.json', JSON.stringify(r, null, 2), 'application/json'); closeSheet(); },
    exPrint: function () { closeSheet(); setTimeout(function () { window.print(); }, 100); },
    openAddPlan: function () { openSheet(sheetAddPlan(getR(ui.rs.id))); },
    confirmAddPlan: function () {
      var day = $('#ap-date').value, sv = parseInt($('#ap-serv').value, 10) || ui.rs.servings;
      if (!day) { toast('Pick a day'); return; }
      planAdd(day, ui.rs.id, sv);
      ui.week = mondayOf(parseISO(day));
      closeSheet(); toast('Added to ' + shortDate(day));
    },
    deleteRecipe: function () {
      var r = getR(ui.rs.id);
      if (!window.confirm('Delete “' + r.title + '”? This cannot be undone.')) return;
      removeRecipeEverywhere(r.id); save(); toast('Deleted'); location.hash = '#/';
    },

    weekPrev: function () { ui.week = addDays(ui.week, -7); render(); },
    weekNext: function () { ui.week = addDays(ui.week, 7); render(); },
    weekToday: function () { ui.week = mondayOf(new Date()); render(); },
    openPick: function (el) {
      if (!S.recipes.length) { toast('Save a recipe first'); return; }
      openSheet(sheetPick(el.getAttribute('data-d'), ''));
    },
    planAdd: function (el) {
      var r = getR(el.getAttribute('data-id'));
      planAdd(el.getAttribute('data-d'), r.id, r.baseServings);
      closeSheet(); render(); toast('Added');
    },
    planRemove: function (el) {
      var d = el.getAttribute('data-d'), id = el.getAttribute('data-id');
      S.plan[d] = (S.plan[d] || []).filter(function (e) { return e.id !== id; });
      touch('plan'); save(); render();
    },
    planServ: function (el) {
      var d = el.getAttribute('data-d'), id = el.getAttribute('data-id'), v = parseInt(el.getAttribute('data-v'), 10);
      (S.plan[d] || []).forEach(function (e) { if (e.id === id) e.servings = Math.min(48, Math.max(1, e.servings + v)); });
      touch('plan'); save(); render();
    },
    copyGroceries: function () { copyText(groceryText()); },
    shareGroceries: function () {
      var text = groceryText();
      if (navigator.share) navigator.share({ title: 'Groceries', text: text }).catch(function () { /* cancelled */ });
      else copyText(text);
    },
    clearChecks: function () { delete S.checks[ui.week]; touch('checks'); save(); render(); },

    togAuto: function () { S.settings.autoTag = !S.settings.autoTag; touch('settings'); save(); render(); },
    units: function (el) { S.settings.units = el.getAttribute('data-v'); touch('settings'); save(); render(); },
    addOpt: function (el) {
      var g = el.getAttribute('data-g');
      var name = (window.prompt('New option for ' + g + ':') || '').trim();
      if (!name) return;
      var grp = S.categories.filter(function (c) { return c.name === g; })[0];
      if (grp.options.indexOf(name) !== -1) { toast('Already there'); return; }
      grp.options.push(name); touch('categories'); save(); render();
    },
    delOpt: function (el) {
      var g = el.getAttribute('data-g'), o = el.getAttribute('data-o');
      if (!window.confirm('Remove “' + o + '” from ' + g + '? It is also removed from recipes that use it.')) return;
      var grp = S.categories.filter(function (c) { return c.name === g; })[0];
      grp.options = grp.options.filter(function (x) { return x !== o; });
      stripCategoryFromRecipes(g, o); touch('categories'); save(); render();
    },
    addGroup: function () {
      var name = (window.prompt('Name of the new category group (for example Occasion):') || '').trim();
      if (!name) return;
      if (S.categories.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) { toast('That group exists'); return; }
      S.categories.push({ name: name, options: [] }); touch('categories'); save(); render();
    },
    delGroup: function (el) {
      var g = el.getAttribute('data-g');
      if (!window.confirm('Delete the whole “' + g + '” group and remove it from recipes?')) return;
      S.categories = S.categories.filter(function (c) { return c.name !== g; });
      stripCategoryFromRecipes(g, null); touch('categories'); save(); render();
    },
    exportBackup: function () { downloadFile('recipe-vault-backup-' + iso(new Date()) + '.json', JSON.stringify(snapshot()), 'application/json'); },
    driveConnect: function () {
      var input = $('#client-id');
      if (input) setLS('rv.clientId', input.value.trim());
      syncNow(true);
    },
    driveOff: function () {
      if (window.Drive) Drive.signOut();
      setLS('rv.driveOn', null); ui.driveMsg = ''; render(); toast('Disconnected. Your data stays on this device.');
    }
  };

  var changes = {
    addPhoto: function (el) {
      var f = el.files && el.files[0]; if (!f) return;
      ui.add.file = f;
      resizeImage(f, 640, 0.72).then(function (d) { ui.add.photo = d; render(); }, function (e) { toast(e.message); });
    },
    draftPhoto: function (el) {
      var f = el.files && el.files[0]; if (!f) return;
      resizeImage(f, 640, 0.72).then(function (d) { ui.draft.thumb = d; render(); }, function (e) { toast(e.message); });
    },
    notes: function (el) { var r = getR(ui.rs.id); r.notes = el.value; r.updatedAt = now(); save(); toast('Note saved'); },
    gcheck: function (el) {
      var id = el.getAttribute('data-id');
      var c = S.checks[ui.week] = S.checks[ui.week] || {};
      if (el.checked) c[id] = true; else delete c[id];
      touch('checks'); save(); render();
    },
    importBackup: function (el) {
      var f = el.files && el.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var data = JSON.parse(rd.result);
          if (!data || !Array.isArray(data.recipes)) throw new Error('not a backup');
          var merged = RV.mergeStates(snapshot(), data);
          applyState(merged); save(); render(); toast('Imported ' + data.recipes.length + ' recipes');
        } catch (e) { toast('That file is not a Recipe Vault backup'); }
      };
      rd.readAsText(f);
    }
  };

  var inputs = {
    pickSearch: function (el) {
      var box = $('#pick-list');
      var tmp = document.createElement('div');
      tmp.innerHTML = sheetPick(el.getAttribute('data-d'), el.value);
      box.innerHTML = tmp.querySelector('#pick-list').innerHTML;
    }
  };

  /* ---------- event wiring ---------- */
  document.addEventListener('click', function (e) {
    var ov = e.target.closest('[data-overlay]');
    if (ov && e.target === ov) { closeSheet(); return; }
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var fn = actions[el.getAttribute('data-act')];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-change]');
    if (el && changes[el.getAttribute('data-change')]) changes[el.getAttribute('data-change')](el, e);
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    var dn = t.getAttribute && t.getAttribute('data-input');
    if (dn && inputs[dn]) { inputs[dn](t); return; }
    var path = t.getAttribute && t.getAttribute('data-bind');
    if (!path) return;
    if (path === 'clientId') return;
    setPath(path, t.value);
    if (path === 'search') renderLibResults();
    if (path === 'draft.ingText') { var c = $('#ing-count'); if (c) c.textContent = ingStats(t.value); }
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('hashchange', function () { closeSheet(); render(); window.scrollTo(0, 0); });

  /* ---------- boot ---------- */
  Store.open().then(function () { return Store.get('state'); }).then(function (saved) {
    if (saved) applyState(saved);
    var shared = handleShare();
    if (!shared && (location.hash === '' || location.hash === '#')) location.hash = '#/';
    render();
    if (shared) { toast('Link received'); checkClipboard(); }
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* offline mode is optional */ }); });
  }
})();

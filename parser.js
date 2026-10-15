/* Recipe Vault: parsing, scaling, tagging and grocery logic.
   Pure functions, no DOM. Works in the browser (window.RV) and in Node (module.exports). */
(function (root) {
  'use strict';

  /* ---------- fractions and quantities ---------- */

  var UNI_FRAC = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };

  function normalizeFractions(s) {
    return s.replace(/(\d)\s*([½¼¾⅓⅔⅛⅜⅝⅞])/g, function (m, d, f) { return d + ' ' + UNI_FRAC[f]; })
            .replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, function (f) { return UNI_FRAC[f]; });
  }

  function num(s) {
    s = s.trim();
    var m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10);
    m = s.match(/^(\d+)\/(\d+)$/);
    if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
    return parseFloat(s);
  }

  var FRACS = [[0, ''], [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'], [0.5, '½'], [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞'], [1, '']];

  function fmtQty(n) {
    if (n == null || isNaN(n)) return '';
    if (n >= 10) return String(Math.round(n));
    var whole = Math.floor(n);
    var frac = n - whole;
    var best = FRACS[0];
    for (var i = 0; i < FRACS.length; i++) {
      var eighth = FRACS[i][0] === 0.125 || FRACS[i][0] === 0.375 || FRACS[i][0] === 0.625 || FRACS[i][0] === 0.875;
      if (eighth && n >= 1) continue; // keep larger amounts to halves, thirds and quarters
      if (Math.abs(FRACS[i][0] - frac) < Math.abs(best[0] - frac)) best = FRACS[i];
    }
    if (best[0] === 1) { whole += 1; best = FRACS[0]; }
    var sym = best[1];
    if (whole === 0 && !sym) return '⅛';
    if (whole > 0 && sym) return whole + ' ' + sym;
    return whole > 0 ? String(whole) : sym;
  }

  /* ---------- units ---------- */

  var UNIT_ALIASES = {
    tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
    tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
    cup: 'cup', cups: 'cup',
    oz: 'oz', ounce: 'oz', ounces: 'oz',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
    g: 'g', gram: 'g', grams: 'g', gr: 'g',
    kg: 'kg', kilogram: 'kg', kilograms: 'kg',
    ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
    l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
    pinch: 'pinch', pinches: 'pinch', dash: 'dash', dashes: 'dash',
    clove: 'clove', cloves: 'clove',
    can: 'can', cans: 'can',
    slice: 'slice', slices: 'slice',
    stick: 'stick', sticks: 'stick',
    bunch: 'bunch', bunches: 'bunch',
    head: 'head', heads: 'head',
    sprig: 'sprig', sprigs: 'sprig',
    piece: 'piece', pieces: 'piece',
    package: 'package', packages: 'package', pkg: 'package',
    handful: 'handful', handfuls: 'handful',
    jar: 'jar', jars: 'jar',
    bottle: 'bottle', bottles: 'bottle'
  };

  var VOL_ML = { tsp: 5, tbsp: 15, cup: 240, floz: 30, ml: 1, l: 1000 };
  var WT_G = { oz: 28.35, lb: 454, g: 1, kg: 1000 };
  var COUNT_UNITS = { pinch: 1, dash: 1, clove: 1, can: 1, slice: 1, stick: 1, bunch: 1, head: 1, sprig: 1, piece: 1, package: 1, handful: 1, jar: 1, bottle: 1 };

  function unitFamily(u) {
    if (VOL_ML[u]) return 'vol';
    if (WT_G[u]) return 'wt';
    return 'count';
  }

  /* ---------- ingredient parsing ---------- */

  var NUM = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*\\.\\d+|\\d+)';
  var QTY_RE = new RegExp('^' + NUM + '(?:\\s*(?:-|–|—|to)\\s*' + NUM + ')?');

  function stripBullet(s) {
    return s.replace(/^[\s\-–—•*·▢☐☑✔✅👉▪️◦►>]+/u, '').trim();
  }

  function parseIngredientLine(line) {
    var raw = stripBullet(stripEmoji(line)).trim();
    var s = normalizeFractions(raw);
    var out = { raw: raw, qty: null, qtyMax: null, unit: '', name: s };
    if (!s) return out;

    // attached unit: 200g, 250ml, 1.5kg
    var att = s.match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|oz|lb|lbs)\b\.?\s*(?:of\s+)?(.*)$/i);
    if (att) {
      out.qty = parseFloat(att[1]);
      out.unit = UNIT_ALIASES[att[2].toLowerCase()] || att[2].toLowerCase();
      out.name = att[3].trim();
      return finish(out);
    }

    var m = s.match(QTY_RE);
    if (!m) return finish(out);
    out.qty = num(m[1]);
    if (m[2]) out.qtyMax = num(m[2]);
    var rest = s.slice(m[0].length).trim();

    // "fl oz"
    var fl = rest.match(/^fl\.?\s*oz\.?\s*(?:of\s+)?(.*)$/i);
    if (fl) {
      out.unit = 'floz';
      out.name = fl[1].trim();
      return finish(out);
    }
    var tok = rest.match(/^([A-Za-z]+)\.?\s*(.*)$/);
    if (tok && UNIT_ALIASES[tok[1].toLowerCase()]) {
      out.unit = UNIT_ALIASES[tok[1].toLowerCase()];
      out.name = tok[2].replace(/^of\s+/i, '').trim();
    } else {
      out.name = rest.replace(/^of\s+/i, '').trim();
    }
    return finish(out);
  }

  function finish(o) {
    o.name = o.name.replace(/^[,;:\-\s]+|[,;:\s]+$/g, '');
    if (!o.name && o.unit) { o.name = o.unit; o.unit = ''; }
    if (!o.name) o.name = o.raw;
    return o;
  }

  /* ---------- caption parsing ---------- */

  var EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
  function stripEmoji(s) { return s.replace(EMOJI_RE, ''); }

  var ING_HEADER = /^(?:the\s+)?(?:ingredients?|what you(?:'|’)?ll need|you(?:'|’)?ll need|shopping list|grocery list)\s*[:\-]*\s*(.*)$/i;
  var STEP_HEADER = /^(?:method|directions?|instructions?|steps?|how to make(?: it)?|preparation|procedure|to make)\s*[:\-]*\s*(.*)$/i;
  var SUB_HEADER = /^(?:for the|for)\s+[\w\s&']+:?$/i;

  function cleanLine(l) {
    return l.replace(/#[\wÀ-ɏ]+/g, '').replace(/@[\w.]+/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  }

  function isNumberedStep(l) { return /^(?:step\s*)?\d+\s*[.):\-]\s*\S/i.test(l); }
  function stripStepNumber(l) { return l.replace(/^(?:step\s*)?\d+\s*[.):\-]\s*/i, '').replace(/^[\-•*·▪️]\s*/, '').trim(); }

  function looksLikeIngredient(l) {
    var s = normalizeFractions(stripBullet(stripEmoji(l)));
    if (!s) return false;
    if (isNumberedStep(l) && !/^\d+\s*(?:g|kg|ml|oz|lb|cup|tbsp|tsp)/i.test(s)) return false;
    if (QTY_RE.test(s)) return s.length < 90;
    var words = s.split(/\s+/).length;
    var bullet = /^[\s\-–—•*·▢☐☑✔✅👉▪️◦]/u.test(l);
    return bullet && words <= 8 && !/[.!?]$/.test(s);
  }

  function looksLikeStep(l) {
    var s = stripEmoji(l).trim();
    if (isNumberedStep(s)) return true;
    var words = s.split(/\s+/).length;
    return words >= 7 && /[.!?]$/.test(s);
  }

  function parseServings(text) {
    var m = text.match(/(?:serves|servings?|makes|yields?|feeds)\s*:?\s*(?:about\s*)?(\d{1,2})\b/i) ||
            text.match(/\b(\d{1,2})\s*servings?\b/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function parseTime(text) {
    var lines = text.split(/\n/);
    var total = null, sum = 0, any = null;
    lines.forEach(function (l) {
      var re = /(\d+)\s*(?:-\s*\d+\s*)?(hours?|hrs?|h|minutes?|mins?|m)\b/gi, m, mins = 0, found = false;
      while ((m = re.exec(l))) {
        found = true;
        var v = parseInt(m[1], 10);
        mins += /^h/i.test(m[2]) ? v * 60 : v;
      }
      if (!found) return;
      if (/total|ready in/i.test(l)) total = total == null ? mins : total;
      else if (/prep|cook|bake|marinate|rest/i.test(l)) sum += mins;
      else if (any == null) any = mins;
    });
    if (total != null) return total;
    if (sum > 0) return sum;
    return any != null && any <= 480 ? any : null;
  }

  function detectSource(url) {
    if (!url) return 'Other';
    if (/instagram\.com|instagr\.am/i.test(url)) return 'Instagram';
    if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return 'Facebook';
    return 'Other';
  }

  function parseCaption(text) {
    var rawLines = String(text || '').replace(/\r/g, '').split('\n');
    var lines = [];
    rawLines.forEach(function (l) {
      var c = cleanLine(l);
      if (c) lines.push(c);
    });

    var servings = parseServings(text || '');
    var time = parseTime(text || '');

    var mode = null; // null | 'ing' | 'step'
    var title = '';
    var ings = [], steps = [], notes = [];
    var sawIngHeader = false, sawStepHeader = false;

    lines.forEach(function (line) {
      var plain = stripEmoji(line).trim();
      var h;
      if ((h = plain.match(ING_HEADER)) && plain.length < 60 && !QTY_RE.test(plain)) {
        mode = 'ing'; sawIngHeader = true;
        if (h[1] && looksLikeIngredient(h[1])) ings.push(h[1]);
        return;
      }
      if ((h = plain.match(STEP_HEADER)) && plain.length < 60) {
        mode = 'step'; sawStepHeader = true;
        if (h[1] && h[1].length > 6) steps.push(stripStepNumber(h[1]));
        return;
      }
      if (SUB_HEADER.test(plain) && mode === 'ing') return; // "For the sauce:"
      if (/^(?:serves|servings?|makes|yields?|prep|cook|total|time)\b/i.test(plain) && plain.length < 40) return;

      if (mode === 'ing') {
        if (looksLikeIngredient(line)) { ings.push(line); return; }
        if (sawIngHeader && !sawStepHeader && looksLikeStep(line)) { mode = 'step'; steps.push(stripStepNumber(plain)); return; }
        if (plain.length < 40 && !/[.!?]$/.test(plain)) { ings.push(line); return; }
        steps.push(stripStepNumber(plain));
        mode = 'step';
        return;
      }
      if (mode === 'step') {
        if (sawStepHeader || looksLikeStep(line) || plain.length > 25) steps.push(stripStepNumber(plain));
        else notes.push(plain);
        return;
      }

      // no section yet
      if (!sawIngHeader && looksLikeIngredient(line) && (QTY_RE.test(normalizeFractions(stripBullet(plain))))) { ings.push(line); return; }
      if (looksLikeStep(line)) { steps.push(stripStepNumber(plain)); return; }
      if (!title && plain.length > 2 && plain.length <= 100) { title = plain; return; }
      notes.push(plain);
    });

    title = (title || '').replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, '');
    if (!title && notes.length) title = notes.shift();
    var description = notes.join(' ')
      .replace(/\b(?:serves|servings?|makes|yields?|feeds)\s*:?\s*\d{1,2}\b/gi, '')
      .replace(/\b\d+\s*(?:minutes?|mins?|hours?|hrs?)\b/gi, '')
      .replace(/\s*[|·•]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?])/g, '$1')
      .trim()
      .slice(0, 400);
    if (description.replace(/[^a-z]/gi, '').length < 4) description = '';

    return {
      title: title || 'Untitled recipe',
      servings: servings,
      time: time,
      ingredients: ings.map(parseIngredientLine),
      steps: steps,
      description: description
    };
  }

  /* ---------- auto tagging ---------- */

  var KEYWORDS = {
    breakfast: ['pancake', 'waffle', 'oatmeal', 'oats', 'omelet', 'omelette', 'french toast', 'granola', 'scramble', 'breakfast', 'bagel', 'muffin'],
    lunch: ['sandwich', 'wrap', 'salad', 'soup', 'lunch', 'panini'],
    dinner: ['dinner', 'casserole', 'roast', 'steak', 'pasta', 'curry', 'stir fry', 'stir-fry', 'lasagna', 'skillet', 'sheet pan', 'thighs', 'tacos'],
    snacks: ['snack', 'dip', 'hummus', 'bites', 'popcorn', 'chips', 'energy balls', 'trail mix'],
    snack: ['snack', 'dip', 'hummus', 'bites', 'popcorn', 'chips', 'energy balls', 'trail mix'],
    dessert: ['cookie', 'cake', 'brownie', 'ice cream', 'pie', 'cheesecake', 'pudding', 'dessert', 'cupcake', 'frosting', 'fudge', 'mousse', 'tart'],
    drinks: ['smoothie', 'cocktail', 'latte', 'juice', 'lemonade', 'drink', 'margarita', 'mocktail', 'iced tea'],
    drink: ['smoothie', 'cocktail', 'latte', 'juice', 'lemonade', 'drink', 'margarita', 'mocktail', 'iced tea'],
    italian: ['pasta', 'parmesan', 'risotto', 'pesto', 'lasagna', 'marinara', 'gnocchi', 'mozzarella', 'bruschetta', 'tiramisu', 'italian'],
    mexican: ['taco', 'tortilla', 'salsa', 'enchilada', 'burrito', 'quesadilla', 'jalapeno', 'jalapeño', 'guacamole', 'fajita', 'chipotle', 'mexican'],
    asian: ['soy sauce', 'ginger', 'sesame', 'teriyaki', 'stir fry', 'stir-fry', 'miso', 'noodle', 'sriracha', 'hoisin', 'ramen', 'sushi', 'kimchi', 'gochujang', 'thai', 'korean', 'japanese', 'chinese'],
    indian: ['curry', 'masala', 'paneer', 'naan', 'garam', 'tikka', 'tandoori', 'turmeric', 'biryani', 'indian'],
    mediterranean: ['feta', 'olives', 'tzatziki', 'pita', 'mediterranean', 'greek', 'falafel', 'halloumi', 'hummus'],
    american: ['burger', 'bbq', 'barbecue', 'mac and cheese', 'buffalo', 'meatloaf', 'ranch', 'cornbread', 'fried chicken'],
    chicken: ['chicken', 'drumstick', 'wing'],
    beef: ['beef', 'steak', 'brisket', 'burger', 'meatball', 'ground beef'],
    pork: ['pork', 'bacon', 'sausage', 'ham', 'ribs', 'pulled pork', 'prosciutto'],
    seafood: ['salmon', 'shrimp', 'tuna', 'fish', 'cod', 'tilapia', 'prawn', 'crab', 'lobster', 'scallop', 'seafood'],
    'fish & seafood': ['salmon', 'shrimp', 'tuna', 'fish', 'cod', 'tilapia', 'prawn', 'crab', 'lobster', 'scallop', 'seafood'],
    fish: ['salmon', 'shrimp', 'tuna', 'fish', 'cod', 'tilapia', 'prawn', 'crab', 'lobster', 'scallop', 'seafood']
  };

  var MEAT_KEYS = ['chicken', 'beef', 'pork', 'seafood'];

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function hasKeyword(text, kw) {
    return new RegExp('(^|[^a-z])' + esc(kw) + '(es|s)?([^a-z]|$)').test(text);
  }

  function matchesOption(text, label) {
    var key = label.toLowerCase();
    var kws = (KEYWORDS[key] || []).concat([key]);
    for (var i = 0; i < kws.length; i++) if (hasKeyword(text, kws[i])) return true;
    return false;
  }

  function suggestTags(recipe, categories) {
    var parts = [recipe.title || ''];
    (recipe.ingredients || []).forEach(function (i) { parts.push(i.name || ''); });
    (recipe.steps || []).forEach(function (s) { parts.push(s); });
    var text = parts.join(' \n ').toLowerCase();
    var titleText = (recipe.title || '').toLowerCase();
    var meatFound = MEAT_KEYS.some(function (k) { return matchesOption(text, k); });
    var tags = {};

    categories.forEach(function (g) {
      var gname = g.name.toLowerCase();
      var picked = [];
      if (/effort|difficulty/.test(gname)) {
        var n = (recipe.ingredients || []).length, st = (recipe.steps || []).length, t = recipe.time;
        var label = 'Medium';
        if ((t != null && t > 90) || n > 15 || st > 12) label = 'Project';
        else if ((t == null || t <= 35) && n <= 9 && st <= 6) label = 'Easy';
        g.options.forEach(function (o) { if (o.toLowerCase() === label.toLowerCase()) picked.push(o); });
      } else {
        g.options.forEach(function (o) {
          var key = o.toLowerCase();
          if (key === 'vegetarian' || key === 'vegan') return;
          var target = /meal|course|type/.test(gname) ? titleText + ' ' + text : text;
          if (matchesOption(target, o)) picked.push(o);
        });
        if (/protein/.test(gname)) {
          g.options.forEach(function (o) {
            if (o.toLowerCase() === 'vegetarian' && !meatFound && (recipe.ingredients || []).length >= 3) picked.push(o);
          });
        }
        if (/meal|course|type/.test(gname) && !picked.length && (recipe.ingredients || []).length) {
          g.options.forEach(function (o) { if (o.toLowerCase() === 'dinner') picked.push(o); });
        }
        if (/meal|course|type/.test(gname) && picked.length > 2) picked = picked.slice(0, 2);
      }
      if (picked.length) tags[g.name] = picked;
    });
    return tags;
  }

  /* ---------- scaling and conversion ---------- */

  function roundMetric(q, unit) {
    if (unit === 'g') {
      if (q < 10) return Math.max(1, Math.round(q));
      if (q < 100) return Math.round(q / 5) * 5;
      return Math.round(q / 10) * 10;
    }
    if (unit === 'ml') {
      if (q < 10) return Math.round(q * 2) / 2;
      if (q < 100) return Math.round(q / 5) * 5;
      return Math.round(q / 10) * 10;
    }
    if (unit === 'kg' || unit === 'l') return Math.round(q * 100) / 100;
    return q;
  }

  function fmtMetric(q, unit) {
    var r = roundMetric(q, unit);
    var s = (Math.round(r * 100) / 100).toString();
    return s;
  }

  // Convert any quantity+unit into a display {text, unit} for the chosen system.
  function present(q, unit, system) {
    if (q == null) return { qty: '', unit: unit ? unitLabel(unit) : '' };
    var fam = unit ? unitFamily(unit) : 'count';
    if (!unit || fam === 'count') return { qty: fmtQty(q), unit: unit ? unitLabel(unit, q) : '' };

    if (system === 'metric') {
      if (fam === 'vol') {
        var ml = q * VOL_ML[unit === 'floz' ? 'floz' : unit];
        if (ml >= 1000) return { qty: fmtMetric(ml / 1000, 'l'), unit: 'l' };
        return { qty: fmtMetric(ml, 'ml'), unit: 'ml' };
      }
      var g = q * WT_G[unit];
      if (g >= 1000) return { qty: fmtMetric(g / 1000, 'kg'), unit: 'kg' };
      return { qty: fmtMetric(g, 'g'), unit: 'g' };
    }

    // US
    if (fam === 'vol') {
      var m = q * VOL_ML[unit === 'floz' ? 'floz' : unit];
      return usVolume(m);
    }
    var gr = q * WT_G[unit];
    if (gr >= 400 || (unit === 'lb' && gr >= 110)) return { qty: fmtQty(Math.round(gr / 454 * 4) / 4), unit: 'lb' };
    return { qty: fmtQty(Math.round(gr / 28.35 * 2) / 2 || 0.5), unit: 'oz' };
  }

  function usVolume(ml) {
    if (ml >= 59) return { qty: fmtQty(ml / 240), unit: 'cup' + (ml / 240 > 1.05 ? 's' : '') };
    if (ml >= 14) return { qty: fmtQty(ml / 15), unit: 'tbsp' };
    return { qty: fmtQty(ml / 5), unit: 'tsp' };
  }

  function unitLabel(u, q) {
    if (u === 'floz') return 'fl oz';
    if (u === 'cup') return q != null && q > 1 ? 'cups' : 'cup';
    return u;
  }

  function scaleIngredient(ing, factor, system) {
    if (ing.qty == null) return { amount: '', name: ing.name, text: ing.name };
    var q = ing.qty * factor;
    var p = present(q, ing.unit, system);
    var amount = p.qty;
    if (ing.qtyMax != null) {
      var p2 = present(ing.qtyMax * factor, ing.unit, system);
      amount = p.qty + '–' + p2.qty;
    }
    amount = (amount + ' ' + (p.unit || '')).trim();
    return { amount: amount, name: ing.name, text: (amount + ' ' + ing.name).trim() };
  }

  function convertTemps(text, system) {
    if (system === 'metric') {
      return text.replace(/(\d{2,3})\s*°\s*F\b/g, function (m, f) {
        var c = Math.round((parseInt(f, 10) - 32) * 5 / 9 / 5) * 5;
        return c + '°C';
      });
    }
    return text.replace(/(\d{2,3})\s*°\s*C\b/g, function (m, c) {
      var f = Math.round((parseInt(c, 10) * 9 / 5 + 32) / 5) * 5;
      return f + '°F';
    });
  }

  /* ---------- grocery aggregation ---------- */

  var DROP_WORDS = /\b(fresh|freshly|chopped|minced|diced|sliced|large|medium|small|boneless|skinless|finely|roughly|thinly|ground|crushed|grated|shredded|melted|softened|cold|warm|optional|about|big|ripe|extra|virgin|cloves?|bone-in|skin-on|halved|quartered|peeled|juiced|zested)\b/g;

  function nameKey(name) {
    var s = name.toLowerCase().replace(/\(.*?\)/g, '').split(',')[0].replace(/\bto taste\b/g, '');
    s = s.replace(DROP_WORDS, ' ').replace(/[^a-z\s&'-]/g, ' ').replace(/\s+/g, ' ').trim();
    var words = s.split(' ').map(function (w) {
      if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
      if (/oes$/.test(w)) return w.slice(0, -2);
      if (/[^s]s$/.test(w) && w.length > 3) return w.slice(0, -1);
      return w;
    });
    return words.join(' ').trim() || name.toLowerCase();
  }

  var AISLES = [
    ['Meat & fish', ['chicken', 'beef', 'pork', 'bacon', 'sausage', 'salmon', 'shrimp', 'fish', 'turkey', 'steak', 'ham', 'tuna', 'cod', 'lamb']],
    ['Dairy & eggs', ['milk', 'butter', 'cheese', 'feta', 'parmesan', 'yogurt', 'cream', 'egg', 'mozzarella', 'cheddar', 'ricotta']],
    ['Produce', ['garlic', 'onion', 'tomato', 'lemon', 'lime', 'pepper', 'cilantro', 'parsley', 'basil', 'spinach', 'lettuce', 'carrot', 'potato', 'avocado', 'cucumber', 'broccoli', 'mushroom', 'ginger', 'apple', 'banana', 'berry', 'zucchini', 'celery', 'scallion', 'herb', 'cabbage', 'kale', 'corn', 'orange', 'mint', 'dill', 'thyme', 'rosemary', 'jalapeno']]
  ];

  function aisleFor(key) {
    for (var i = 0; i < AISLES.length; i++) {
      var words = AISLES[i][1];
      for (var j = 0; j < words.length; j++) if (hasKeyword(key, words[j])) return AISLES[i][0];
    }
    return 'Pantry';
  }

  // entries: [{recipe, servings}]  ->  [{aisle, name, amount, from}]
  function buildGroceryList(entries, system) {
    var map = {};
    entries.forEach(function (e) {
      var r = e.recipe;
      var factor = (e.servings || r.baseServings || 4) / (r.baseServings || 4);
      (r.ingredients || []).forEach(function (ing) {
        var key = nameKey(ing.name);
        if (!key) return;
        var fam = ing.qty == null ? 'none' : (ing.unit ? unitFamily(ing.unit) : 'count');
        var mk = key + '|' + fam + (fam === 'count' && ing.unit && ing.unit !== 'clove' ? '|' + ing.unit : '');
        var item = map[mk];
        if (!item) {
          item = map[mk] = { key: key, id: mk, fam: fam, unit: ing.unit, total: 0, recipes: {}, display: ing.name, hasQty: false };
        }
        if (ing.qty != null) {
          var q = ((ing.qty + (ing.qtyMax != null ? ing.qtyMax : ing.qty)) / 2) * factor;
          if (fam === 'vol') q *= VOL_ML[ing.unit];
          else if (fam === 'wt') q *= WT_G[ing.unit];
          item.total += q;
          item.hasQty = true;
        }
        var cleaned = ing.name.replace(/\(.*?\)/g, '').split(',')[0].trim();
        if (cleaned && cleaned.length < item.display.length) item.display = cleaned;
        item.recipes[r.id || r.title] = 1;
      });
    });

    var out = Object.keys(map).map(function (k) {
      var it = map[k];
      var amount = '';
      if (it.hasQty) {
        if (it.fam === 'vol') { var p = present(it.total, 'ml', system); amount = (p.qty + ' ' + p.unit).trim(); }
        else if (it.fam === 'wt') { var p2 = present(it.total, 'g', system); amount = (p2.qty + ' ' + p2.unit).trim(); }
        else { amount = (fmtQty(it.total) + (it.unit && it.unit !== 'clove' ? ' ' + unitLabel(it.unit, it.total) : '')).trim(); }
      }
      var disp = it.display.replace(/^[a-z]/, function (c) { return c.toUpperCase(); });
      disp = disp.replace(/,.*$/, '').replace(/\(.*?\)/g, '').trim();
      return { id: it.id, aisle: aisleFor(it.key), name: disp, amount: amount, from: Object.keys(it.recipes).length };
    });

    var order = ['Produce', 'Meat & fish', 'Dairy & eggs', 'Pantry'];
    out.sort(function (a, b) {
      var d = order.indexOf(a.aisle) - order.indexOf(b.aisle);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    return out;
  }

  /* ---------- sync merge ---------- */

  function mergeStates(a, b) {
    var out = { recipes: [], deleted: {}, categories: null, plan: null, checks: null, settings: null, meta: {} };
    var map = {};
    [a, b].forEach(function (s) {
      (s.recipes || []).forEach(function (r) {
        if (!map[r.id] || (r.updatedAt || 0) > (map[r.id].updatedAt || 0)) map[r.id] = r;
      });
      Object.keys(s.deleted || {}).forEach(function (id) {
        if ((s.deleted[id] || 0) > (out.deleted[id] || 0)) out.deleted[id] = s.deleted[id];
      });
    });
    Object.keys(map).forEach(function (id) {
      if (out.deleted[id] && out.deleted[id] >= (map[id].updatedAt || 0)) return;
      out.recipes.push(map[id]);
    });
    ['categories', 'plan', 'checks', 'settings'].forEach(function (k) {
      var ta = (a.meta && a.meta[k]) || 0, tb = (b.meta && b.meta[k]) || 0;
      var src = tb > ta ? b : a;
      out[k] = src[k];
      out.meta[k] = Math.max(ta, tb);
    });
    return out;
  }

  var RV = {
    parseCaption: parseCaption,
    parseIngredientLine: parseIngredientLine,
    suggestTags: suggestTags,
    detectSource: detectSource,
    scaleIngredient: scaleIngredient,
    convertTemps: convertTemps,
    fmtQty: fmtQty,
    buildGroceryList: buildGroceryList,
    mergeStates: mergeStates,
    nameKey: nameKey
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RV;
  root.RV = RV;
})(typeof window !== 'undefined' ? window : globalThis);

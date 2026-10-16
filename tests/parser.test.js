const assert = require('assert');
const RV = require('../parser.js');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

const DEFAULT_CATS = [
  { name: 'Meal type', options: ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Dessert', 'Drinks'] },
  { name: 'Cuisine', options: ['Italian', 'Mexican', 'Asian', 'Indian', 'Mediterranean', 'American'] },
  { name: 'Protein', options: ['Chicken', 'Beef', 'Pork', 'Seafood', 'Vegetarian'] },
  { name: 'Effort', options: ['Easy', 'Medium', 'Project'] }
];

const CAPTION1 = `🔥 Garlic Butter Chicken Thighs 🔥
Crispy skin, juicy inside. Serves 4 | 35 min

Ingredients:
🍗 1.5 lb bone-in chicken thighs
- 4 tbsp butter
- 6 garlic cloves, minced
- 2 tbsp honey
- 1 lemon, juiced
- 1 tsp smoked paprika
- 1/2 tsp salt

Method:
1. Pat the thighs dry and season with paprika and salt.
2. Sear skin-side down for 6-7 minutes until golden.
3. Add butter, garlic and honey, then baste.
4. Roast at 400°F for 25 minutes.

#chicken #dinner #easyrecipes @creator`;

t('parses title, servings, time', () => {
  const r = RV.parseCaption(CAPTION1);
  assert.strictEqual(r.title, 'Garlic Butter Chicken Thighs');
  assert.strictEqual(r.servings, 4);
  assert.strictEqual(r.time, 35);
});

t('parses 7 ingredients and 4 steps', () => {
  const r = RV.parseCaption(CAPTION1);
  assert.strictEqual(r.ingredients.length, 7, JSON.stringify(r.ingredients.map(i => i.raw)));
  assert.strictEqual(r.steps.length, 4, JSON.stringify(r.steps));
  assert.ok(!/^\d\./.test(r.steps[0]));
});

t('ingredient fields', () => {
  const r = RV.parseCaption(CAPTION1);
  const chicken = r.ingredients[0];
  assert.strictEqual(chicken.qty, 1.5);
  assert.strictEqual(chicken.unit, 'lb');
  assert.strictEqual(chicken.name, 'bone-in chicken thighs');
  const salt = r.ingredients[6];
  assert.strictEqual(salt.qty, 0.5);
  assert.strictEqual(salt.unit, 'tsp');
  const garlic = r.ingredients[2];
  assert.strictEqual(garlic.qty, 6);
  assert.strictEqual(garlic.unit, '');
});

t('unicode fractions, ranges, attached units, no qty', () => {
  let i = RV.parseIngredientLine('1½ cups flour');
  assert.strictEqual(i.qty, 1.5); assert.strictEqual(i.unit, 'cup'); assert.strictEqual(i.name, 'flour');
  i = RV.parseIngredientLine('½ tsp salt');
  assert.strictEqual(i.qty, 0.5);
  i = RV.parseIngredientLine('2-3 tbsp olive oil');
  assert.strictEqual(i.qty, 2); assert.strictEqual(i.qtyMax, 3);
  i = RV.parseIngredientLine('200g pasta');
  assert.strictEqual(i.qty, 200); assert.strictEqual(i.unit, 'g'); assert.strictEqual(i.name, 'pasta');
  i = RV.parseIngredientLine('Salt and pepper to taste');
  assert.strictEqual(i.qty, null);
  i = RV.parseIngredientLine('2 cloves garlic');
  assert.strictEqual(i.unit, 'clove'); assert.strictEqual(i.name, 'garlic');
  i = RV.parseIngredientLine('1 1/2 cups milk');
  assert.strictEqual(i.qty, 1.5);
});

t('caption without headers', () => {
  const r = RV.parseCaption(`Baked Feta Pasta
8 oz block feta
1 pint cherry tomatoes
12 oz pasta
Bake everything at 400F for 35 minutes until the tomatoes burst, then stir in the cooked pasta.`);
  assert.strictEqual(r.title, 'Baked Feta Pasta');
  assert.strictEqual(r.ingredients.length, 3, JSON.stringify(r.ingredients));
  assert.strictEqual(r.steps.length, 1);
});

t('fmtQty rounds to cooking fractions', () => {
  assert.strictEqual(RV.fmtQty(0.47), '½');
  assert.strictEqual(RV.fmtQty(1.34), '1 ⅓');
  assert.strictEqual(RV.fmtQty(2.9), '3');
  assert.strictEqual(RV.fmtQty(12.4), '12');
  assert.strictEqual(RV.fmtQty(0.05), '⅛');
});

t('scaling US', () => {
  const r = RV.parseCaption(CAPTION1);
  const half = r.ingredients.map(i => RV.scaleIngredient(i, 0.5, 'us').text);
  assert.strictEqual(half[0], '¾ lb bone-in chicken thighs');
  assert.strictEqual(half[1], '2 tbsp butter');
  assert.strictEqual(half[6], '¼ tsp salt');
  const dbl = r.ingredients.map(i => RV.scaleIngredient(i, 2, 'us').text);
  assert.strictEqual(dbl[0], '3 lb bone-in chicken thighs');
  assert.strictEqual(dbl[1], '½ cup butter', dbl[1]);
});

t('metric conversion', () => {
  const r = RV.parseCaption(CAPTION1);
  const m = r.ingredients.map(i => RV.scaleIngredient(i, 1, 'metric').text);
  assert.strictEqual(m[0], '680 g bone-in chicken thighs');
  assert.strictEqual(m[1], '60 ml butter', m[1]);
  assert.strictEqual(m[6], '2.5 ml salt', m[6]);
});

t('metric to US', () => {
  const i = RV.parseIngredientLine('500 g flour');
  assert.strictEqual(RV.scaleIngredient(i, 1, 'us').text, '1 lb flour');
  const j = RV.parseIngredientLine('250 ml milk');
  assert.strictEqual(RV.scaleIngredient(j, 1, 'us').text, '1 cup milk');
});

t('temperature conversion', () => {
  assert.strictEqual(RV.convertTemps('Roast at 400°F for 25 min', 'metric'), 'Roast at 205°C for 25 min');
  assert.strictEqual(RV.convertTemps('Bake at 180°C', 'us'), 'Bake at 355°F');
});

t('auto tags', () => {
  const r = RV.parseCaption(CAPTION1);
  const tags = RV.suggestTags(r, DEFAULT_CATS);
  assert.deepStrictEqual(tags['Protein'], ['Chicken']);
  assert.ok(tags['Meal type'].includes('Dinner'));
  assert.deepStrictEqual(tags['Effort'], ['Easy']);
});

t('auto tags: dessert and vegetarian', () => {
  const r = RV.parseCaption(`Miso Chocolate Cookies\n1 cup flour\n1/2 cup butter\n1 cup chocolate chips\n1 tbsp miso\nMix everything together and bake until the edges turn golden brown.`);
  const tags = RV.suggestTags(r, DEFAULT_CATS);
  assert.ok(tags['Meal type'].includes('Dessert'), JSON.stringify(tags));
  assert.deepStrictEqual(tags['Protein'], ['Vegetarian']);
});

t('custom category option matches by its own name', () => {
  const cats = DEFAULT_CATS.concat([{ name: 'Occasion', options: ['Date night', 'Barbecue'] }]);
  const r = RV.parseCaption(`Great Date Night Steak\n2 ribeye steaks\n1 tbsp butter\n2 cloves garlic\nSear the steaks in a hot pan for four minutes per side, then rest.`);
  const tags = RV.suggestTags(r, cats);
  assert.ok(tags['Occasion'] && tags['Occasion'].includes('Date night'), JSON.stringify(tags));
});

t('grocery aggregation combines units and recipes', () => {
  const a = RV.parseCaption(CAPTION1); a.id = 'a'; a.baseServings = 4;
  const b = RV.parseCaption(`Honey Salmon\n1 lb salmon fillet\n3 cloves garlic\n2 tbsp honey\n1 tbsp butter\nBake the salmon at 400°F until it flakes easily with a fork.`);
  b.id = 'b'; b.baseServings = 4;
  const list = RV.buildGroceryList([{ recipe: a, servings: 4 }, { recipe: b, servings: 4 }], 'us');
  const by = n => list.find(x => x.name.toLowerCase() === n || x.name.toLowerCase().startsWith(n));
  assert.strictEqual(by('garlic').amount, '9', JSON.stringify(list));
  assert.strictEqual(by('garlic').from, 2);
  assert.strictEqual(by('honey').amount, '¼ cup', by('honey').amount);
  assert.strictEqual(by('butter').amount, '⅓ cup', by('butter').amount);
  assert.strictEqual(by('garlic').aisle, 'Produce');
  assert.strictEqual(by('salmon fillet').aisle, 'Meat & fish');
});

t('grocery scales by planned servings', () => {
  const a = RV.parseCaption(CAPTION1); a.id = 'a'; a.baseServings = 4;
  const list = RV.buildGroceryList([{ recipe: a, servings: 8 }], 'us');
  const garlic = list.find(x => x.name.toLowerCase().startsWith('garlic'));
  assert.strictEqual(garlic.amount, '12');
});

t('mergeStates: newest recipe wins, tombstone removes', () => {
  const a = { recipes: [{ id: '1', title: 'old', updatedAt: 1 }, { id: '2', title: 'x', updatedAt: 5 }], deleted: {}, categories: [1], plan: {}, checks: {}, settings: {}, meta: { categories: 1, plan: 1, checks: 1, settings: 1 } };
  const b = { recipes: [{ id: '1', title: 'new', updatedAt: 2 }], deleted: { '2': 9 }, categories: [2], plan: { d: 1 }, checks: {}, settings: {}, meta: { categories: 5, plan: 0, checks: 1, settings: 1 } };
  const m = RV.mergeStates(a, b);
  assert.strictEqual(m.recipes.length, 1);
  assert.strictEqual(m.recipes[0].title, 'new');
  assert.deepStrictEqual(m.categories, [2]);
  assert.deepStrictEqual(m.plan, {});
});

t('cleanOcr removes phone and Instagram chrome, keeps the recipe', () => {
  const raw = '6:09 LTE 87%\nReels\ncreator_name Follow\ncreator_name Garlic Pasta ... more\n1.5 Ib spaghetti\n12,345 likes\nView all 214 comments\nAdd a comment...\n2d\nLiked by someone and others';
  const c = RV.cleanOcr(raw);
  assert.strictEqual(c, 'Garlic Pasta\n1.5 lb spaghetti');
});

t('1.5 lb is an ingredient, not step 1', () => {
  const p = RV.parseCaption('Chicken\nIngredients\n1.5 lb chicken thighs\n2.5 cups rice\nMethod\n1. Cook it all.');
  assert.strictEqual(p.ingredients.length, 2);
  assert.strictEqual(p.steps.length, 1);
});

t('time comes from the header line, not from step durations', () => {
  const p = RV.parseCaption('Chicken\nServes 4 | 35 min\nIngredients\n1 lb chicken\nMethod\n1. Bake 20 minutes.\n2. Rest 5 minutes and spoon the sauce over.');
  assert.strictEqual(p.time, 35);
  assert.strictEqual(RV.parseCaption('Prep time: 10 min | Cook time: 20 min\nIngredients\n1 egg').time, 30);
});

t('joinOcr drops lines repeated where screenshots overlap', () => {
  const a = 'Title\nIngredients\n1 cup rice\n2 tbsp oil\nSalt and pepper';
  const b = '2 tbsp oil\nSalt and pepper\nMethod\n1. Boil the rice for 10 minutes.';
  const j = RV.joinOcr([a, b]);
  assert.strictEqual(j.split('\n').filter(l => l === 'Salt and pepper').length, 1);
  assert.ok(j.indexOf('Method') > j.indexOf('Salt and pepper'));
  assert.strictEqual(RV.joinOcr([a, 'Method\n1. Boil.']).split('\n').length, 8); // no overlap: kept whole, blank line between
});

t('real-engine dark screenshot text: bullets, username, wrapped steps', () => {
  const raw = require('fs').readFileSync(__dirname + '/fixtures/r1.txt', 'utf8');
  const p = RV.parseCaption(RV.joinOcr([RV.cleanOcr(raw)]));
  assert.strictEqual(p.title, 'High Protein Chicken Burrito Bowls');
  assert.strictEqual(p.servings, 4);
  assert.strictEqual(p.ingredients.length, 6);
  assert.strictEqual(p.ingredients[0].raw, '2 lbs chicken breast');
  assert.strictEqual(p.ingredients[5].raw, 'Shredded cheese, to serve');
  assert.strictEqual(p.steps.length, 3);
  assert.ok(/^Season the chicken .* until golden\.$/.test(p.steps[0]), p.steps[0]);
});

t('"Serves 2" on the title line is not part of the title', () => {
  assert.strictEqual(RV.parseCaption('Creamy Tuscan Salmon Serves 2\nIngredients\n2 salmon fillets').title, 'Creamy Tuscan Salmon');
  assert.strictEqual(RV.parseCaption('Creamy Tuscan Salmon | Serves 2').servings, 2);
});

t('Instagram caption sheet: keycap numbers, ** headings, comments below the date', () => {
  const raw = require('fs').readFileSync(__dirname + '/fixtures/u1.txt', 'utf8');
  const p = RV.parseCaption(RV.joinOcr([RV.cleanOcr(raw)]));
  assert.strictEqual(p.title, 'Untitled recipe'); // the title had scrolled out of view
  const ing = p.ingredients.map(i => i.raw);
  assert.strictEqual(ing.length, 9, ing.join(' / '));
  assert.strictEqual(ing[0], '1 lb ground beef');
  assert.ok(ing.indexOf('1 tsp sesame oil') !== -1 && !ing.some(x => /sauce\s*$/i.test(x) && /CREAMY/.test(x)));
  assert.strictEqual(p.steps.length, 4, JSON.stringify(p.steps));
  assert.strictEqual(p.steps[0], 'Brown the ground beef in a skillet until cooked through.');
  assert.ok(!p.steps.join(' ').match(/Follow|SAVE|ground beef\s*$|think of this/), p.steps.join(' | '));
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);

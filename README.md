# Recipe Vault

A small personal app for saving Instagram and Facebook recipes in one place, with categories, search, a servings scaler, a weekly meal plan and a combined grocery list. It is a static site: plain HTML, CSS and JavaScript with no build step.

## Run it

- **Quick try:** open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit `http://localhost:8000`.
- **On your phone (GitHub Pages):** push this folder to a GitHub repository, then Settings, Pages, deploy from the `main` branch root. Open the Pages address on both phones and use "Add to Home Screen".

Your library is stored in the browser on each device (IndexedDB). Use Settings, Export backup now and then, or connect Google Drive (below).

## Install on Android and share posts to the app

1. Open the app in Chrome, tap the ⋮ menu, choose **Install app** (or Add to Home screen). Settings in the app also has an install card.
2. In Instagram or Facebook, tap **Share** on a recipe post and choose **Recipe Vault**. If it is not in the list yet, remove the home-screen icon and install again, so Android registers the share option.
3. The app opens on the Add screen with the post link filled in (tracking junk removed).
4. Tap **Open post** and copy the caption (long-press it in Instagram). When you switch back, the app notices a recipe on your clipboard and shows **Create recipe from this**. One tap and you get the review form. The first time, Chrome asks to allow clipboard access; choose Allow.
5. Faster still: copy the caption *before* sharing. When the app opens from the Share menu it checks the clipboard straight away.

If the offer does not appear (permission blocked, or the copied text does not look like a recipe), tap **Paste caption and create** instead. The app only looks at the clipboard on the Add screen and shows you what it found before using it.

Instagram and Facebook share only the link, not the recipe text, which is why the caption step is still manual. Installing also makes the app work offline.

## Adding a recipe (any browser)

1. On Instagram or Facebook, copy the caption (or the recipe from the comments).
2. In the app: Add, then **Paste caption and create** (or paste into the box and tap Create recipe).
3. Check the parsed title, amounts, steps and auto-tagged categories, then Save.

## Cook mode

Open a recipe and tap **Cook mode**: large steps you tick off with a tap, ingredients scaled to the servings you chose, and the screen stays on until you tap Done.

## Recipes from screenshots

When the caption can't be copied, screenshot it instead:

1. In Instagram or Facebook, open the full caption (tap more) and take a screenshot. If the recipe continues, scroll and take another. A few overlapping screenshots are fine.
2. On the screenshot preview that appears, tap **Share**, then **Recipe Vault**. You can select several screenshots in the Gallery and share them together. Nothing is saved to your Gallery, so there is nothing to delete afterwards.
3. The app reads the text on your phone, drops the phone and Instagram interface text (clock, Follow, likes, comments), joins the screenshots in order without repeating the lines where they overlap, and opens the review form.
4. Tap **Add more screenshots** in the review form if you missed a part. It rebuilds the form from the combined text.

Dark mode screenshots work too. The text reader is Tesseract.js, downloaded from a CDN the first time, so the first run needs a connection. Expect a few seconds per screenshot. Always check amounts and spelling in the review form.

If the Share menu doesn't list the app, use the in-app route: Add, then the Screenshot tab. The photo picker opens at once; pick your newest screenshots and they are read straight away. This route uses screenshots saved in the Gallery.

After this update, remove the home-screen icon and install the app again so Android registers the new Share option for images.

Parsing is rule-based. It works best when the post has an "Ingredients" heading and one ingredient per line. Anything it misses you can fix in the review form.

## Features

- Search by title, ingredient, category or notes; filter by category, time, favourites, not cooked yet; sort.
- Starter categories: Meal type, Cuisine, Protein, Effort. Add your own options or whole groups in Settings.
- Servings scaler with cooking fractions, US/Metric toggle, and oven temperature conversion in the steps.
- Favourites, star ratings, "cooked it" counter, notes.
- Weekly meal plan; grocery list combines the week's recipes (adds up amounts, groups by aisle, tick items off).
- Print or save as PDF, copy as text, download a recipe as .txt or .json, full JSON backup and import.
- Prints cleanly (navigation hidden).

## Google Drive sync (optional)

The whole library is kept in one file, `recipe-vault.json`, in Google Drive. You and your wife each sign in with your own Google account and the app merges changes (newest edit wins per recipe).

One-time setup:

1. Go to console.cloud.google.com and create a project.
2. Enable the Google Drive API.
3. OAuth consent screen: External. Add both of your Google accounts as test users.
4. Credentials, Create credentials, OAuth client ID, Web application. Under Authorized JavaScript origins add the address the app is served from (for example `https://YOURNAME.github.io`).
5. In the app: Settings, paste the client ID, Connect and sync. Google shows an "unverified app" warning because it is your personal app; choose Continue.
6. Share the file: after the first sync, open `recipe-vault.json` in Google Drive and share it with your wife (Editor). When she connects, the app finds the shared file by name.

The app asks for Drive access so it can find the shared file by name. It only reads and writes `recipe-vault.json`. Sign-in lasts about an hour; tap Sync now when the app says it is paused.

## Not built yet

- **Automatic fetching of the caption from a link.** Instagram and Facebook block browsers from reading posts. Ideas to try next, all free: a bookmarklet or on-phone shortcut that reads the caption in your own logged-in session, or a small serverless function. AI parsing needs an API key that cannot live safely in a static page. `parseCaption` in `parser.js` is the function any of these would improve or replace.

## Tests

```
node tests/parser.test.js     # parsing, scaling, conversions, grocery maths, sync merge
python3 tests/e2e.py          # browser smoke test (needs Playwright with Chromium)
```

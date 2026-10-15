# Recipe Vault

A small personal app for saving Instagram and Facebook recipes in one place, with categories, search, a servings scaler, a weekly meal plan and a combined grocery list. It is a static site: plain HTML, CSS and JavaScript with no build step.

## Run it

- **Quick try:** open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit `http://localhost:8000`.
- **On your phone (GitHub Pages):** push this folder to a GitHub repository, then Settings, Pages, deploy from the `main` branch root. Open the Pages address on both phones and use "Add to Home Screen".

Your library is stored in the browser on each device (IndexedDB). Use Settings, Export backup now and then, or connect Google Drive (below).

## Adding a recipe

1. On Instagram or Facebook, copy the caption (or the recipe from the comments).
2. In the app: Add, paste the text, optionally paste the post link, tap Create recipe.
3. Check the parsed title, amounts, steps and auto-tagged categories, then Save.

Screenshots work too: Add, Screenshot, choose the image, Read text from image (done on your device with Tesseract.js, loaded from a CDN the first time). Always check OCR text for mistakes.

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

- **Automatic fetching from a link.** Instagram and Facebook block browsers from reading posts, and AI parsing needs an API key that cannot live safely in a static page. A small serverless function can add this later; `parseCaption` in `parser.js` is the function it would improve or replace.

## Tests

```
node tests/parser.test.js     # parsing, scaling, conversions, grocery maths, sync merge
python3 tests/e2e.py          # browser smoke test (needs Playwright with Chromium)
```

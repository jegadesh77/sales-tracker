# Sales Tracker

A simple mobile web app (installable on your Android home screen) for logging daily
sales, cost and profit across TikTok, Shopee, Shopee SG, Lazada, PG Mall, Webstore
and Walk-in — with every save committed to a private GitHub repo, so you get a full
version history of your numbers for free.

It's a static site: no server, no build step, no npm install. Just HTML/CSS/JS.

## How it works

- **App code** (this folder) is hosted for free on **GitHub Pages** from a **public**
  repo — that's fine, it's just code, no business data in it.
- **Your data** lives in `data/records.json` inside a **separate, private** repo.
  The app talks to it directly from your phone's browser using the GitHub API and a
  personal access token you generate once. The token never leaves your phone (it's
  stored in the browser's local storage) and is never committed to any repo.
- Every time you tap "Save entry", the app makes one commit to your private data
  repo. Open the repo's commit history any time to see exactly what changed and when.

## One-time setup

### 1. Create two GitHub repos

1. **Code repo** (public) — e.g. `sales-tracker`. This is what you'll push the files
   in this folder to.
2. **Data repo** (private) — e.g. `sales-data`. Leave it empty; the app creates
   `data/records.json` automatically on your first save.

### 2. Push the app code

From this folder:

```bash
cd sales-tracker
git init
git add .
git commit -m "Initial sales tracker app"
git branch -M main
git remote add origin https://github.com/<your-username>/sales-tracker.git
git push -u origin main
```

### 3. Turn on GitHub Pages

In the **code repo** → Settings → Pages → Source: "Deploy from a branch" → Branch:
`main`, folder `/ (root)` → Save. GitHub gives you a URL like:

```
https://<your-username>.github.io/sales-tracker/
```

Open that on your Android phone in Chrome.

### 4. Install it like an app

In Chrome on your phone, open the URL above → tap the **⋮** menu → **Add to Home
screen**. It'll launch full-screen with its own icon, like a native app.

### 5. Generate a personal access token for the data repo

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** →
Generate new token:
- **Resource owner**: your account
- **Repository access**: Only select repositories → choose your **data repo**
  (`sales-data`), not the code repo
- **Permissions**: Repository → **Contents** → Read and write
- Set an expiry you're comfortable with (you can always generate a new one later)

Copy the token (starts with `github_pat_...`) — GitHub only shows it once.

### 6. Configure the app

Open the app on your phone → **Settings** tab → fill in:
- GitHub username: `<your-username>`
- Repo name: `sales-data`
- Branch: `main`
- File path: `data/records.json` (default, no need to change)
- Personal access token: paste it

Tap **Save & test connection**. It should say "Connected."

## Daily use

- **Entry** tab: pick the date (defaults to today), key in Sales/Cost/Profit for
  each channel. Profit auto-fills as Sales − Cost but you can overwrite it if your
  real net profit differs (e.g. after platform fees).
- **Save entry**: commits that day to your private GitHub repo. If you're offline,
  it saves locally and syncs automatically next time you're online (or tap "Sync
  now" in Settings).
- **History** tab: every day you've logged, most recent first. Tap a day to edit it.
- **Monthly** tab: pick a month, see totals per channel and grand total.

## Notes & limits

- This is a **web app (PWA)**, not a native Play Store app — that needs Android
  Studio and a signing/build pipeline this environment can't produce. The installed
  home-screen version looks and behaves like an app (full screen, own icon, offline
  shell caching) but updates instantly whenever you push new code, no app store
  review needed.
- If two devices save the same day at nearly the same moment, the second save will
  detect the conflict, re-pull the latest data, and retry automatically — no data
  loss, but the two saves aren't merged field-by-field, so the later save wins for
  that day.
- The GitHub token is a secret. If you lose your phone or think it's compromised,
  revoke the token from GitHub → Settings → Developer settings immediately.

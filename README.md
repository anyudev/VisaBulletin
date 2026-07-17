# Visa Bulletin Scraper

Scrapes monthly US Visa Bulletin data from [travel.state.gov](https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html) and stores it as static JSON files, served via GitHub raw URLs.

## What it does

- Parses Employment-Based (EB-1 through EB-5) and Family-Based (F1–F4) priority dates
- Extracts both **Final Action Dates** (Chart A) and **Dates for Filing** (Chart B)
- Covers all tracked countries: China, India, Mexico, Philippines, and All Other
- Stores structured JSON in `data/` directory, committed to the repo
- Generates aggregated `latest.json` (2 most recent) and `trend.json` (12 most recent) for client consumption

## Architecture

```
GitHub Actions (monthly cron)
  ↓ scrape travel.state.gov
  ↓ generate JSON files
  ↓ git commit + push
GitHub raw URL (CDN)
  ↓ static JSON
```

## Data URLs

```
https://raw.githubusercontent.com/aiyurealestateagent/VisaBulletin/main/data/latest.json
https://raw.githubusercontent.com/aiyurealestateagent/VisaBulletin/main/data/trend.json
```

## File Structure

```
data/
├── latest.json          ← most recent 2 bulletins
├── trend.json           ← most recent 12 bulletins
└── bulletins/           ← individual monthly archives
    ├── 2026-03.json
    ├── 2026-02.json
    └── ...
```

## Tech Stack

- **TypeScript** + **tsx** runtime
- **Cheerio** for HTML parsing
- **GitHub Actions** for scheduled scraping
- **GitHub raw URLs** for static hosting (zero cost)

## Setup

```bash
npm install
```

## Usage

**Scrape the latest bulletin (local, real browser — recommended):**

```bash
npm run scrape:local
```

travel.state.gov is behind Cloudflare bot protection, so the plain-HTTP
`npm run scrape` gets a 403 and no longer works (including from CI). `scrape:local`
drives a real Chrome (via Playwright, `channel: "chrome"`) using a dedicated
profile at `~/.cache/visa-bulletin-chrome` to pass the challenge:

- Requires Google Chrome installed.
- A Chrome window opens. The **first** run may show a "Verify you are human"
  checkbox — click it once; the clearance cookie is saved to the profile, so
  later runs usually pass automatically.
- Once a month's bulletin is saved, re-running skips it before any network
  request — safe to run repeatedly during the publish window.
- After a successful scrape, commit and push the changes under `data/`.

Set `SCRAPE_CHALLENGE_TIMEOUT_MS` (default `120000`) to allow more time to click
the checkbox on the first run.

**Backfill the last 36 months:**

```bash
npm run backfill
```

## Data Shape

Each bulletin is stored as JSON with this structure:

```json
{
  "id": "2026-03",
  "bulletin_date": "2026-03",
  "published_date": "2026-03-12",
  "data": {
    "employmentBased": {
      "finalActionDates": {
        "EB-1": { "allOther": "C", "china": "2022-12-01", "india": "2021-06-01", "mexico": "C", "philippines": "C" }
      },
      "datesForFiling": { ... }
    },
    "familyBased": {
      "finalActionDates": { ... },
      "datesForFiling": { ... }
    }
  },
  "created_at": "2026-03-12T12:00:00.000Z"
}
```

Date values are `YYYY-MM-DD`, `C` (Current), or `U` (Unavailable).

## Automation

GitHub Actions **cannot** be used: travel.state.gov is behind Cloudflare bot
protection, which blocks automated scraping from any datacenter IP (including
GitHub runners) and even from headless/automated browsers. The only thing that
reliably passes is a real, headed Chrome. So scraping runs **locally on a Mac**,
driven by a `launchd` agent.

**What it does:** `scripts/auto-scrape.sh` runs on days 10–20 (twice daily),
scrapes via `scrape:local`, and if a new bulletin appears it commits to a branch,
opens a PR with `gh`, and auto-merges it. Most days the bulletin isn't published
yet, so the run exits quietly; once it's saved, later runs skip before any
network request. Failures send a Slack message (Cloudflare failures are called
out specifically, since they usually mean the clearance cookie expired and you
need to run `npm run scrape:local` once by hand to re-solve the checkbox).

### One-time setup

1. **Authenticate `gh`** (separate from your git/SSH login — required to open PRs):
   ```bash
   gh auth login
   ```
2. **Slack notifications** (optional): create an [Incoming Webhook](https://api.slack.com/messaging/webhooks)
   for your channel and save the URL (git-ignored):
   ```bash
   echo 'https://hooks.slack.com/services/XXX/YYY/ZZZ' > local/slack-webhook.txt
   ```
3. **Install the launchd agent:**
   ```bash
   cp scripts/com.visabulletin.autoscrape.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.visabulletin.autoscrape.plist
   ```
   Test it immediately with `launchctl start com.visabulletin.autoscrape`, then
   check `local/auto-scrape.log`.

Logs and the Slack webhook live under `local/` (git-ignored). To stop the
automation: `launchctl unload ~/Library/LaunchAgents/com.visabulletin.autoscrape.plist`.

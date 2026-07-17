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

The scheduled GitHub Actions cron has been **removed**: travel.state.gov's
Cloudflare protection blocks automated scraping from GitHub's datacenter IPs, so
the scheduled runs only failed. Bulletins are now scraped locally with a real
browser — run `npm run scrape:local` on your own machine during the publish
window (typically the 10th–20th), then commit the new files under `data/`.

The `.github/workflows/scrape.yml` workflow is kept for manual `workflow_dispatch`
runs only, but note those also hit the Cloudflare wall.

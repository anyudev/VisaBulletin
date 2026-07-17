# Visa Bulletin Data

Machine-readable US Visa Bulletin data (Employment-Based EB-1…EB-5 and
Family-Based F1…F4 priority dates), updated monthly.

This repository is **data-only** and public so clients can read it over GitHub
raw URLs. The scraper that produces it lives in a separate private repo.

## Files

```
data/
├── latest.json          ← most recent 2 bulletins
├── trend.json           ← most recent 12 bulletins
└── bulletins/           ← individual monthly archives (YYYY-MM.json)
```

## Consuming the data

```
https://raw.githubusercontent.com/aiyurealestateagent/VisaBulletin/main/data/latest.json
https://raw.githubusercontent.com/aiyurealestateagent/VisaBulletin/main/data/trend.json
```

Each bulletin is JSON; date values are `YYYY-MM-DD`, `C` (Current), or `U`
(Unavailable).

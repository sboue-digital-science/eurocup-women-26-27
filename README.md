# EuroCup Women 2026-27 player explorer

Interactive D3 dashboard of FIBA EuroCup Women 2026-27 players and teams.

| File | What it is |
|---|---|
| `index.html` | the dashboard (HTML, CSS and script; loads D3 from cdnjs) |
| `data.json` | players, teams, league countries and team cities |
| `europe.json` | basemap (Natural Earth via world-atlas) |
| `flags.json` | small flag images (flag-icons) |
| `refresh-fiba.mjs` | rebuilds `data.json` from FIBA's pages |
| `.github/workflows/refresh-fiba.yml` | runs the refresh every Friday morning |

## Data refresh

`refresh-fiba.mjs` rebuilds `data.json` from FIBA's public EuroCup Women 2026-27 pages
(team list, each team page, each player page). The dashboard reads `data.json`, so the
headline counts, charts and the "last updated" date all follow automatically.

## Run it on your computer
1. Install Node.js 18 or newer (nodejs.org).
2. In the folder with `data.json`, run:  `node refresh-fiba.mjs data.json`
3. It takes about 3–5 minutes (~780 pages, fetched slowly on purpose) and prints a summary.

To try it on two teams first:
`FIBA_ONLY=bcf-elfic-fribourg,saarlouis-royals node refresh-fiba.mjs test.json`
(on Windows PowerShell: `$env:FIBA_ONLY="bcf-elfic-fribourg,saarlouis-royals"; node refresh-fiba.mjs test.json`)

## Run it automatically every week (GitHub)
1. Put the dashboard files (`index.html`, `data.json`, `europe.json`, `flags.json`,
   `refresh-fiba.mjs`) in a GitHub repository, plus `.github/workflows/refresh-fiba.yml`.
2. In the repository: Settings → Actions → General → Workflow permissions → "Read and write".
3. The job runs every Friday at 04:23 UTC (05:23 in Switzerland in winter), after the Thursday games; the Actions tab has a "Run workflow" button to run it now.

## What the refresh keeps and adds
- **Nothing is ever dropped.** Teams that FIBA stops listing, and players who disappear
  from a team page, keep their last known data (such players are marked † in the dashboard).
- **Competition stage** per team (`"stage"`: 1 qualifiers only, 2 main stage, 3 play-offs),
  read from FIBA's standings: teams flagged "Qualified for Play-Off Round 1" or listed in the
  play-off standings count as play-offs. A team's stage never goes down.

## What needs a human
- **Cities**: FIBA doesn't publish them. They are kept from the existing `data.json`.
  When new teams join (the four 4th-placed EuroLeague Women teams enter at Play-Off Round 1),
  the script lists them; add `["City", lat, lon]` for each in `"city"` (same position as
  the team in `"teams"`). Until then they are simply left off the map.
- **New citizenship codes**: listed at the end of a run; add a country name in `"cn"`.
  A new code with no flag shows as a small text tag in the dashboard.
- **Next season**: set `FIBA_EVENT` (e.g. `eurocup-women-27-28`) and refresh cities.

If FIBA changes its site structure, the script stops with an error instead of
overwriting `data.json` with empty data.

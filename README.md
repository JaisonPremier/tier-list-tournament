# Tier List Tournament

A 2–4 player draft-and-battle web game built from the Naruto and One Piece
tier-list spreadsheets in this repo. Pick a universe, draft a 3-character
team, and see a fully transparent, reproducible score decide the winner.

## Play locally

```bash
python3 webapp/serve.py
```

Then open http://127.0.0.1:8743 in a browser. (Any static file server works —
this repo has no build step.)

## Deploy to GitHub Pages

Push this `webapp/` folder's contents to a repo (or a `docs/` folder / `gh-pages`
branch) and enable Pages on it. `index.html` is the entry point; everything it
needs (`style.css`, `app.js`, `data/characters.json`) is static.

## Regenerating character data

`data/characters.json` is generated from the spreadsheets in `sources/` by
`generate_data.py`:

```bash
pip install openpyxl
python3 generate_data.py
```

It's deterministic: character stats are derived from each character's
position in its franchise tier list, plus a name-seeded pseudo-random spread
for the secondary stats (Speed, Durability, Hax, Battle IQ). Re-running the
script against unchanged spreadsheets reproduces the same `characters.json`
byte-for-byte.

## How scoring works

Every number shown on the results screen is derived, never hidden:

1. **Character stats** — from tier-list rank (Character Power) and a
   name-seeded deterministic spread (Speed, Durability, Hax, Battle IQ).
2. **Team averages** — each stat averaged across the team's 3 members
   (team-size normalization).
3. **Core Score** — weighted sum of the five team averages (weights shown
   in-app: Power 30%, Speed 20%, Durability 20%, Hax 15%, Battle IQ 15%).
4. **Teamwork** — `100 − 2 × stddev(member Power)`; tighter power levels
   across the roster score higher.
5. **Weighted Base** — `Core × 0.85 + Teamwork × 0.15`.
6. **Synergy** — `(Core − 70) × 0.08`; stronger rosters execute better.
7. **Randomness** — a small ±1.5 swing seeded from a per-match seed (shown
   on screen) so it's replayable, not hidden.

Click "HOW WAS THIS SCORE CALCULATED?" on any team's card in the results
screen to see every one of these numbers for that specific match.

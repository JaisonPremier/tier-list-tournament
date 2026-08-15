# Tier List Tournament

A 2–4 player auction-draft battle game built from the Naruto and One Piece
tier-list spreadsheets in this repo. Pick a universe, then bid CHF against
the other players for characters the game draws at random — you never pick
a character directly, only how much you're willing to pay for the one it
shows you. See a fully transparent, reproducible score decide the winner.

## How the draft works

The game — not the player — chooses each character:

1. The game randomly draws one character not yet auctioned.
2. Every player privately locks in a CHF bid (hot-seat: pass the device
   between players, or read bids aloud for a live/on-stream session).
3. Bids are revealed. Highest bid wins and pays that amount; ties trigger
   a re-bid among just the tied players.
4. The winner's remaining budget drops by what they paid, and the
   character joins their team.
5. Repeat until `players × 3` characters have been auctioned off in total.

Because every round has exactly one winner, team sizes aren't fixed slots —
a player who bids aggressively (or goes all-in early) can end up with more
or fewer characters than everyone else. Scoring accounts for this: every
average is computed over however many members a team actually has.

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
2. **Team averages** — each stat averaged across however many characters
   that team actually won (team-size normalization; auction-won rosters
   aren't fixed-size).
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

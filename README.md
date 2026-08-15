# Manga Draft Arena

A 2–4 player auction-draft battle game built from the Naruto and One Piece
tier-list spreadsheets in this repo. Pick a universe, pick a player avatar,
then fight the other players over yen (¥) for characters the game draws at
random — you never pick a character directly, only how much you're willing
to pay for the one it shows you, and only its name is revealed (no stats)
while you're bidding. See a fully transparent, reproducible score decide
the winner.

## Player identity: avatars, not colors

Players are told apart by a chosen avatar portrait, not a color label. The
four avatar images live in `avatars/` (`avatar-01.png` … `avatar-04.png`,
sourced from `../image exemple/image perso/`) and are declared in
`app.js`'s `AVATARS` array — `{ id, image, accent }`, where `accent` is a
single decorative color pulled from that portrait's palette, used sparingly
(a thin ring, a highlight) rather than as the player's primary identity. To
add or swap avatars: drop a new image in `avatars/`, add an entry to
`AVATARS`, no other code changes needed. Two players can never pick the
same avatar in one game.

## How the draft works

The game — not the player — chooses each character, and players fight over
the price in a live, alternating (English-style) auction, not a blind
simultaneous bid:

1. The game randomly draws one character not yet auctioned and reveals
   only its name — no power, tier, or rank, so bids are never stat-informed.
2. Who opens the bidding rotates every round (randomized at game start),
   skipping anyone who's out of yen. The opener must bid at least ¥1.
3. Turn passes to the next player, who either **RAISEs** the standing bid
   or **WITHDRAWs** from this auction only (they stay in the game — there's
   no "take at this price" shortcut). Play continues until everyone else
   has withdrawn and the last bidder standing wins at their own bid.
4. The winner's budget drops by what they paid, and the character joins
   their team.
5. Repeat until every player has exactly 3 characters.

Reaching ¥0 doesn't eliminate a player — they just can't outbid anyone.
If every remaining opponent in a round is also broke, the character is
handed out for free via turn order; if exactly one player still has money,
that player gets a simplified choice (take it free, or hand it to whoever's
next) instead of bidding against nobody.

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
   (team-size normalization). Stats stay hidden during the draft itself —
   they only come into play here, for the final calculation.
3. **Core Score** — weighted sum of the five team averages (weights shown
   in-app: Power 30%, Speed 20%, Durability 20%, Hax 15%, Battle IQ 15%).
4. **Teamwork** — `100 − 2 × stddev(member Power)`; tighter power levels
   across the roster score higher.
5. **Weighted Base** — `Core × 0.85 + Teamwork × 0.15`.
6. **Synergy** — `(Core − 70) × 0.08`; stronger rosters execute better.
7. **Randomness** — a small ±1.5 swing seeded from a per-match seed (shown
   on screen) so it's replayable, not hidden.

Click "How was this score calculated?" on any team's card in the results
screen to see every one of these numbers for that specific match.

## A note on character artwork

There's no portrait artwork for the ~166 individual Naruto/One Piece
characters that get auctioned — only the 4 player avatars are real assets.
Rather than fake or scrape character art, the reveal/acquire screens use
large-scale typography (the character's name, huge) as the visual centerpiece
instead, with a deterministic per-character accent color (hashed from the
character's id, see `characterAccent()` in `app.js`) standing in for
"artwork reacting to the character." If real character art is added later,
`renderCharacterCard()` is the single place to swap the name-only treatment
for an image.

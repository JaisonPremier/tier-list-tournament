"use strict";

/* ---------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------- */

// Each auction round draws and sells exactly ONE character to exactly ONE
// player, so the number of rounds is NOT the per-player team size — it's
// the total number of characters that will be sold across the whole game.
// To keep teams comparably sized (matching the "3 characters per team"
// examples), total rounds scale with player count: playerCount x TEAM_SIZE.
const TEAM_SIZE = 3; // target characters per player, on average
const STARTING_BUDGET = 20; // CHF
const QUICK_BID_AMOUNTS = [1, 2, 3, 5, 10];
const DRAW_ANIMATION_MS = 800;

const COLORS = [
  { id: "red", label: "Red", emoji: "\u{1F534}", hex: "#ef4444" },
  { id: "blue", label: "Blue", emoji: "\u{1F535}", hex: "#3b82f6" },
  { id: "green", label: "Green", emoji: "\u{1F7E2}", hex: "#22c55e" },
  { id: "purple", label: "Purple", emoji: "\u{1F7E3}", hex: "#a855f7" },
];

const MEDALS = ["\u{1F947}", "\u{1F948}", "\u{1F949}", "4\u{FE0F}\u{20E3}"];

const STAT_WEIGHTS = {
  power: 0.30,
  speed: 0.20,
  durability: 0.20,
  hax: 0.15,
  battleIQ: 0.15,
};

const STAT_LABELS = {
  power: "Character Power",
  speed: "Speed",
  durability: "Durability",
  hax: "Hax",
  battleIQ: "Battle IQ",
};

/* ---------------------------------------------------------------------
 * Deterministic seeded RNG (mirrors generate_data.py's seeded_unit)
 * ------------------------------------------------------------------- */

function seededUnit(seedStr) {
  let h1 = 0xdeadbeef ^ seedStr.length;
  let h2 = 0x41c6ce57 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    const ch = seedStr.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = (h1 >>> 0) * 4294967296 + (h2 >>> 0);
  return (combined % 1e9) / 1e9;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/* ---------------------------------------------------------------------
 * Game state
 * ------------------------------------------------------------------- */

const state = {
  screen: "loading",
  db: null,
  franchise: null,
  playerCount: null,
  colorAssign: [], // index = playerNumber-1, value = color id
  colorStep: 0,
  draftPicks: [], // array of arrays of {..character, paid}, index = playerNumber-1
  budgets: [], // index = playerNumber-1, CHF remaining
  round: 0, // 1-indexed, up to totalRounds
  totalRounds: 0, // playerCount x TEAM_SIZE, total characters sold this game
  draftedIds: new Set(), // character ids already auctioned off this game
  currentCharacter: null, // character object drawn for the active round
  phase: null, // "drawing" | "bidding" | "reveal" | "winner"
  activeBidders: [], // player numbers participating in the current auction (full field, or tied subset during a tiebreak)
  pendingBidders: [], // subset of activeBidders still to submit a bid
  bids: {}, // playerNum -> CHF amount, for the current auction
  isTiebreak: false,
  roundWinner: null, // { playerNum, amount } once resolved
  matchSeed: null,
  results: null, // computed on entering results
  modalTeam: null, // player number whose "how calculated" modal is open
};

function resetGame() {
  state.franchise = null;
  state.playerCount = null;
  state.colorAssign = [];
  state.colorStep = 0;
  state.draftPicks = [];
  state.budgets = [];
  state.round = 0;
  state.totalRounds = 0;
  state.draftedIds = new Set();
  state.currentCharacter = null;
  state.phase = null;
  state.activeBidders = [];
  state.pendingBidders = [];
  state.bids = {};
  state.isTiebreak = false;
  state.roundWinner = null;
  state.matchSeed = null;
  state.results = null;
  state.modalTeam = null;
}

/* ---------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------- */

fetch("data/characters.json")
  .then((r) => r.json())
  .then((db) => {
    state.db = db;
    state.screen = "franchise";
    render();
  })
  .catch((err) => {
    document.getElementById("app").innerHTML =
      `<div class="screen center"><p>Failed to load character data: ${err}</p></div>`;
  });

/* ---------------------------------------------------------------------
 * Rendering dispatcher
 * ------------------------------------------------------------------- */

function render() {
  const app = document.getElementById("app");
  switch (state.screen) {
    case "loading":
      app.innerHTML = `<div class="screen center"><p>Loading rosters...</p></div>`;
      break;
    case "franchise":
      app.innerHTML = renderFranchiseScreen();
      break;
    case "playerCount":
      app.innerHTML = renderPlayerCountScreen();
      break;
    case "color":
      app.innerHTML = renderColorScreen();
      break;
    case "draft":
      app.innerHTML = renderDraftScreen();
      break;
    case "vs":
      app.innerHTML = renderVsScreen();
      break;
    case "results":
      app.innerHTML = renderResultsScreen();
      break;
  }
  bindEvents();
}

/* ---------------------------------------------------------------------
 * Screen: franchise select
 * ------------------------------------------------------------------- */

function renderFranchiseScreen() {
  const cards = state.db.franchises
    .map(
      (fr) => `
      <div class="big-choice" data-action="pickFranchise" data-value="${fr.id}">
        <span class="emoji">${fr.id === "naruto" ? "\u{1F32A}\u{FE0F}" : "\u{1F3F4}\u{200D}\u{2620}\u{FE0F}"}</span>
        ${fr.label.toUpperCase()}
        <div style="font-weight:400;font-size:0.8rem;color:var(--text-dim);margin-top:6px;">${fr.count} characters</div>
      </div>`
    )
    .join("");

  return `
    <div class="screen">
      <div class="title">TIER LIST TOURNAMENT</div>
      <div class="subtitle">Draft a team, simulate the battle, crown a champion.</div>
      <div class="section-label">Choose Universe</div>
      <div class="card-grid">${cards}</div>
    </div>`;
}

/* ---------------------------------------------------------------------
 * Screen: player count
 * ------------------------------------------------------------------- */

function renderPlayerCountScreen() {
  const options = [2, 3, 4]
    .map(
      (n) => `
      <div class="big-choice" data-action="pickCount" data-value="${n}">
        [ ${n} PLAYERS ]
        <div style="font-weight:400;font-size:0.8rem;color:var(--text-dim);margin-top:8px;">
          ${Array.from({ length: n }, (_, i) => `Player ${i + 1}`).join(" &middot; ")}
        </div>
      </div>`
    )
    .join("");

  return `
    <div class="screen">
      <div class="title">NUMBER OF PLAYERS</div>
      <div class="subtitle">Universe: ${franchiseLabel()}</div>
      <div class="card-grid">${options}</div>
      <div class="btn-row"><button class="btn secondary" data-action="back-franchise">Back</button></div>
    </div>`;
}

/* ---------------------------------------------------------------------
 * Screen: color select (sequential per player)
 * ------------------------------------------------------------------- */

function renderColorScreen() {
  const playerNum = state.colorStep + 1;
  const taken = new Set(state.colorAssign);

  const swatches = COLORS.map((c) => {
    const isTaken = taken.has(c.id);
    return `
      <div class="color-choice ${isTaken ? "taken" : ""}" ${isTaken ? "" : `data-action="pickColor" data-value="${c.id}"`}>
        <span class="swatch" style="background:${c.hex}"></span>
        ${c.emoji} ${c.label}
      </div>`;
  }).join("");

  const track = Array.from({ length: state.playerCount }, (_, i) => {
    const num = i + 1;
    const cls = i < state.colorStep ? "done" : i === state.colorStep ? "active" : "";
    const assigned = state.colorAssign[i];
    const label = assigned ? colorMeta(assigned).label : "?";
    return `<div class="player-pill ${cls}">P${num}: ${label}</div>`;
  }).join("");

  return `
    <div class="screen">
      <div class="title">PLAYER ${playerNum}</div>
      <div class="subtitle">Choose color</div>
      <div class="player-track">${track}</div>
      <div class="color-grid">${swatches}</div>
    </div>`;
}

/* ---------------------------------------------------------------------
 * Screen: draft (random-draw blind auction)
 *
 * THE GAME CHOOSES THE CHARACTER. THE PLAYERS CHOOSE THE BID.
 * Players never pick from a roster — each round the game draws one random
 * character from those not yet auctioned, then every player secretly locks
 * in a CHF bid. Highest bid wins the character and pays their bid amount.
 * ------------------------------------------------------------------- */

function renderDraftScreen() {
  switch (state.phase) {
    case "drawing":
      return renderDrawingPhase();
    case "bidding":
      return renderBiddingPhase();
    case "reveal":
      return renderRevealPhase();
    case "winner":
      return renderWinnerPhase();
    default:
      return `<div class="screen center"><p>...</p></div>`;
  }
}

function renderTeamsSidebar(highlightPlayer) {
  return Array.from({ length: state.playerCount }, (_, i) => {
    const num = i + 1;
    const m = colorMeta(state.colorAssign[i]);
    const picks = state.draftPicks[i] || [];
    const isCurrent = num === highlightPlayer;
    // Auctions can leave a player with more (or fewer) than the target
    // TEAM_SIZE, since roster size is driven by who wins each round, not
    // a fixed per-player slot count — so render at least `picks.length` rows.
    const rows = Array.from({ length: Math.max(TEAM_SIZE, picks.length) }, (_, slot) => {
      const c = picks[slot];
      return `<li class="${c ? "filled" : ""}">${c ? `${escapeHtml(c.displayName)} &mdash; ${c.paid} CHF` : "— empty —"}</li>`;
    }).join("");
    return `
      <div class="team-box ${isCurrent ? "current" : ""}">
        <h4><span class="dot" style="background:${m.hex}"></span>Player ${num} &mdash; ${m.label.toUpperCase()} &middot; ${state.budgets[i]} CHF</h4>
        <ul>${rows}</ul>
      </div>`;
  }).join("");
}

function renderDrawingPhase() {
  return `
    <div class="screen">
      <div class="section-label">ROUND ${state.round} / ${state.totalRounds}</div>
      <div class="draw-card drawing">
        <div class="draw-card-mark">?</div>
        <div class="draw-card-label">DRAWING CHARACTER<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
      </div>
      <div class="draft-layout">
        <div></div>
        <div class="teams-panel">${renderTeamsSidebar(null)}</div>
      </div>
    </div>`;
}

function renderBiddingPhase() {
  const c = state.currentCharacter;
  const currentBidder = state.pendingBidders[0];
  const meta = colorMeta(state.colorAssign[currentBidder - 1]);
  const remaining = state.budgets[currentBidder - 1];

  const tieBanner = state.isTiebreak
    ? `<div class="tiebreak-banner">TIEBREAKER &mdash; ${state.activeBidders.map((p) => colorMeta(state.colorAssign[p - 1]).label.toUpperCase()).join(" vs ")} must re-bid</div>`
    : "";

  const track = state.activeBidders
    .map((p) => {
      const m = colorMeta(state.colorAssign[p - 1]);
      const locked = Object.prototype.hasOwnProperty.call(state.bids, p);
      const cls = locked ? "done" : p === currentBidder ? "active" : "";
      return `<div class="player-pill ${cls}">${m.emoji} P${p}: ${locked ? "LOCKED ✓" : "BIDDING..."}</div>`;
    })
    .join("");

  const quickButtons = QUICK_BID_AMOUNTS.map((amt) => {
    const disabled = amt > remaining;
    return `<button class="btn bid-btn" ${disabled ? "disabled" : `data-action="lockBid" data-value="${amt}"`}>${amt}</button>`;
  }).join("");

  return `
    <div class="screen">
      <div class="section-label">ROUND ${state.round} / ${state.totalRounds}</div>
      ${tieBanner}
      <div class="draw-card">
        <div class="draw-card-name">${escapeHtml(c.displayName)}</div>
        <div class="draw-card-tier">${escapeHtml(c.tierLabel)}</div>
        <div class="draw-card-power">PWR ${c.stats.power}</div>
      </div>

      <div class="player-track">${track}</div>

      <div class="bidder-panel">
        <div class="player-chip" style="border-color:${meta.hex}">
          <span class="dot" style="background:${meta.hex}"></span>
          PLAYER ${currentBidder} &mdash; ${meta.label.toUpperCase()}, PLACE YOUR BID &middot; ${remaining} CHF remaining
        </div>
        <div class="bid-quick-row">
          ${quickButtons}
          <button class="btn bid-btn all-in" data-action="lockBid" data-value="${remaining}">ALL IN</button>
        </div>
        <div class="bid-custom-row">
          <input type="number" id="customBidInput" min="0" max="${remaining}" step="1" placeholder="Custom amount" />
          <button class="btn secondary" data-action="lockCustomBid">Lock Bid</button>
        </div>
      </div>

      <div class="draft-layout mt-24">
        <div></div>
        <div class="teams-panel">${renderTeamsSidebar(currentBidder)}</div>
      </div>
    </div>`;
}

function renderRevealPhase() {
  const c = state.currentCharacter;
  const rows = state.activeBidders
    .map((p) => {
      const m = colorMeta(state.colorAssign[p - 1]);
      return `
      <div class="vs-card" style="border-color:${m.hex}">
        <div class="name">${m.emoji} PLAYER ${p}</div>
        <div class="score" style="color:${m.hex}">${state.bids[p]} CHF</div>
      </div>`;
    })
    .join("");

  return `
    <div class="screen">
      <div class="section-label">ROUND ${state.round} / ${state.totalRounds}</div>
      <div class="draw-card">
        <div class="draw-card-name">${escapeHtml(c.displayName)}</div>
        <div class="draw-card-tier">${escapeHtml(c.tierLabel)}</div>
        <div class="draw-card-power">PWR ${c.stats.power}</div>
      </div>
      <div class="vs-row">${rows}</div>
      <div class="btn-row"><button class="btn" data-action="continueReveal">Reveal Bids</button></div>
    </div>`;
}

function renderWinnerPhase() {
  const c = state.currentCharacter;
  const { playerNum, amount } = state.roundWinner;
  const m = colorMeta(state.colorAssign[playerNum - 1]);
  const isLastRound = state.round >= state.totalRounds;

  return `
    <div class="screen">
      <div class="section-label">ROUND ${state.round} / ${state.totalRounds}</div>
      <div class="winner-banner" style="color:${m.hex}">${m.emoji} ${m.label.toUpperCase()} WINS!</div>
      <div class="center" style="margin-bottom:20px;">
        <strong>${escapeHtml(c.displayName)}</strong> joined ${m.label.toUpperCase()} for ${amount} CHF
      </div>
      <div class="draft-layout">
        <div></div>
        <div class="teams-panel">${renderTeamsSidebar(playerNum)}</div>
      </div>
      <div class="btn-row">
        <button class="btn" data-action="nextCharacter">${isLastRound ? "See Final Battle" : "Next Character →"}</button>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------------
 * Draft / auction logic
 * ------------------------------------------------------------------- */

function startRound() {
  const franchiseData = state.db.franchises.find((f) => f.id === state.franchise);
  const pool = franchiseData.characters.filter((c) => !state.draftedIds.has(c.id));
  const randomIndex = Math.floor(Math.random() * pool.length);
  state.currentCharacter = pool[randomIndex];

  state.phase = "drawing";
  state.isTiebreak = false;
  state.activeBidders = Array.from({ length: state.playerCount }, (_, i) => i + 1);
  state.pendingBidders = [...state.activeBidders];
  state.bids = {};
  state.roundWinner = null;
  render();

  setTimeout(() => {
    if (state.phase === "drawing") {
      state.phase = "bidding";
      render();
    }
  }, DRAW_ANIMATION_MS);
}

function lockBid(playerNum, rawAmount) {
  const remaining = state.budgets[playerNum - 1];
  const amount = clamp(Math.round(rawAmount) || 0, 0, remaining);
  state.bids[playerNum] = amount;
  state.pendingBidders = state.pendingBidders.filter((p) => p !== playerNum);
  if (state.pendingBidders.length === 0) {
    state.phase = "reveal";
  }
  render();
}

function resolveWinner() {
  const amounts = state.activeBidders.map((p) => ({ p, amt: state.bids[p] }));
  const max = Math.max(...amounts.map((a) => a.amt));
  const winners = amounts.filter((a) => a.amt === max).map((a) => a.p);

  if (winners.length === 1) {
    finalizeWinner(winners[0], max);
    return;
  }

  // Tie: if none of the tied players could possibly raise their bid
  // (already at their full remaining budget), further tiebreak rounds
  // can't resolve it — pick randomly among them instead of looping forever.
  const canAnyoneRaise = winners.some((p) => state.budgets[p - 1] > max);
  if (!canAnyoneRaise) {
    const randomWinner = winners[Math.floor(Math.random() * winners.length)];
    finalizeWinner(randomWinner, max);
    return;
  }

  state.isTiebreak = true;
  state.activeBidders = winners;
  state.pendingBidders = [...winners];
  state.bids = {};
  state.phase = "bidding";
  render();
}

function finalizeWinner(playerNum, amount) {
  state.budgets[playerNum - 1] -= amount;
  state.draftPicks[playerNum - 1].push({ ...state.currentCharacter, paid: amount });
  state.draftedIds.add(state.currentCharacter.id);
  state.roundWinner = { playerNum, amount };
  state.phase = "winner";
  render();
}

function advanceRound() {
  state.round++;
  if (state.round > state.totalRounds) {
    state.screen = "vs";
    state.matchSeed = Math.floor(seededUnit(draftSeedKey()) * 1e9);
    computeResults();
    render();
  } else {
    startRound();
  }
}

/* ---------------------------------------------------------------------
 * Screen: VS (pre-reveal, all teams' final scores hidden as "?" then
 * revealed one calculation step at a time via a Calculate button)
 * ------------------------------------------------------------------- */

function renderVsScreen() {
  const revealed = state.results.revealed;
  const cards = state.results.teams
    .map((t, i) => {
      const m = colorMeta(t.color);
      const scoreHtml = revealed
        ? `<div class="score" data-score="${t.finalScore}" style="color:${m.hex}">${t.finalScore.toFixed(1)}</div>`
        : `<div class="score" data-score="${t.finalScore}" style="color:var(--text-dim)">?</div>`;
      const sep = i < state.results.teams.length - 1 ? `<div class="vs-sep">VS</div>` : "";
      return `
        <div class="vs-card" style="border-color:${m.hex}">
          <div class="name">${m.emoji} PLAYER ${t.playerNum}</div>
          ${scoreHtml}
        </div>${sep}`;
    })
    .join("");

  const button = revealed
    ? `<div class="btn-row"><button class="btn" data-action="showResults">See Final Ranking</button></div>`
    : `<div class="btn-row"><button class="btn" data-action="calculate">Calculate Scores</button></div>`;

  return `
    <div class="screen">
      <div class="title">FINAL BATTLE</div>
      <div class="subtitle">${franchiseLabel()} &middot; ${state.playerCount} Players</div>
      <div class="vs-row">${cards}</div>
      ${button}
    </div>`;
}

/* ---------------------------------------------------------------------
 * Screen: results
 * ------------------------------------------------------------------- */

function renderResultsScreen() {
  const ranked = [...state.results.teams].sort((a, b) => b.finalScore - a.finalScore);

  const rankingHtml = ranked
    .map((t, i) => {
      const m = colorMeta(t.color);
      const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
      return `
        <div class="rank-row ${rankClass}">
          <div class="rank-medal">${MEDALS[i]}</div>
          <div class="rank-name">${m.emoji} ${m.label.toUpperCase()} &mdash; PLAYER ${t.playerNum}</div>
          <div class="rank-score">${t.finalScore.toFixed(1)}</div>
        </div>`;
    })
    .join("");

  const winner = ranked[0];
  const winnerMeta = colorMeta(winner.color);

  const detailCards = ranked
    .map((t) => {
      const m = colorMeta(t.color);
      const memberRows = t.members
        .map((c) => `<div class="member-row"><span>${escapeHtml(c.displayName)} <span style="color:var(--text-dim);">(${c.paid} CHF)</span></span><span>${c.stats.power}</span></div>`)
        .join("");
      return `
        <div class="team-detail-card" style="border-color:${m.hex}">
          <h3><span class="dot" style="background:${m.hex}"></span>PLAYER ${t.playerNum} &mdash; ${m.label.toUpperCase()}</h3>
          ${memberRows}
          <div class="team-score-line"><span>TEAM SCORE</span><span>${t.finalScore.toFixed(1)}</span></div>
          <button class="breakdown-link" data-action="openBreakdown" data-value="${t.playerNum}">HOW WAS THIS SCORE CALCULATED?</button>
        </div>`;
    })
    .join("");

  const modal = state.modalTeam ? renderBreakdownModal(state.modalTeam) : "";

  return `
    <div class="screen">
      <div class="title">FINAL RESULTS</div>
      <div class="subtitle">${franchiseLabel()} &middot; ${state.playerCount} Players</div>

      <div class="ranking-list">${rankingHtml}</div>

      <div class="winner-banner">\u{1F3C6} ${winnerMeta.label.toUpperCase()} WINS</div>

      <div class="section-label" style="margin-top:36px;">Team Comparison</div>
      <div class="teams-detail">${detailCards}</div>

      <div class="btn-row">
        <button class="btn secondary" data-action="restart">Play Again</button>
      </div>
      ${modal}
    </div>`;
}

function renderBreakdownModal(playerNum) {
  const t = state.results.teams.find((x) => x.playerNum === playerNum);
  const m = colorMeta(t.color);
  const w = STAT_WEIGHTS;

  const statRows = Object.keys(STAT_LABELS)
    .map((k) => `<div class="calc-row"><span>${STAT_LABELS[k]} (avg, weight ${(w[k] * 100).toFixed(0)}%)</span><span>${t.avg[k].toFixed(1)}</span></div>`)
    .join("");

  return `
    <div class="modal-overlay" data-action="closeBreakdown">
      <div class="modal" data-action="stop">
        <button class="modal-close" data-action="closeBreakdown">&times;</button>
        <h3>${m.emoji} ${m.label.toUpperCase()} &mdash; Score Breakdown</h3>

        <div class="calc-note">Team: ${t.members.map((c) => c.displayName).join(", ")} (${t.members.length} members)</div>

        ${statRows}
        <div class="calc-row"><span>Core Score = &Sigma;(stat &times; weight)</span><span>${t.coreScore.toFixed(1)}</span></div>
        <div class="calc-row"><span>Team Size Normalization (&divide; ${t.members.length} members, applied to each average above)</span><span>done</span></div>
        <div class="calc-row"><span>Teamwork = 100 &minus; (2 &times; stddev of member Power)</span><span>${t.teamwork.toFixed(1)}</span></div>
        <div class="calc-row"><span>Weighted Base = Core&times;0.85 + Teamwork&times;0.15</span><span>${t.weightedBase.toFixed(1)}</span></div>
        <div class="calc-row"><span>Synergy = (Core &minus; 70) &times; 0.08</span><span>${t.synergy >= 0 ? "+" : ""}${t.synergy.toFixed(1)}</span></div>
        <div class="calc-row"><span>Randomness = seededRandom(seed ${state.matchSeed}, ${t.color}) &times; 3 &minus; 1.5</span><span>${t.randomness >= 0 ? "+" : ""}${t.randomness.toFixed(1)}</span></div>

        <div class="calc-final"><span>FINAL SCORE</span><span>${t.finalScore.toFixed(1)}</span></div>

        <div class="calc-note">
          Every stat above is derived from this team's drafted characters and the match seed &mdash; nothing is hidden.
          Character sub-stats come from each character's tier-list rank, seeded deterministically per character name,
          so the same roster always yields the same stats. Only the Randomness term uses the match seed, and that
          seed is shown above so the result is fully reproducible.
        </div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------------
 * Score computation
 * ------------------------------------------------------------------- */

function draftSeedKey() {
  return (
    state.franchise +
    "|" +
    state.draftPicks.map((team) => team.map((c) => c.id).join(",")).join("|")
  );
}

function computeResults() {
  const teams = state.draftPicks.map((members, idx) => {
    const playerNum = idx + 1;
    const color = state.colorAssign[idx];

    // A team can end an auction with zero characters (every round can be won
    // by someone else) — guard the averages instead of dividing by zero.
    const hasMembers = members.length > 0;

    // Every intermediate value is rounded to 1 decimal before it feeds the
    // next step, so the numbers shown in the breakdown modal always sum
    // exactly to the displayed Final Score (no silent full-precision drift).
    const avg = {};
    for (const key of Object.keys(STAT_LABELS)) {
      avg[key] = hasMembers
        ? round1(members.reduce((s, c) => s + c.stats[key], 0) / members.length)
        : 0;
    }

    const coreScore = round1(
      Object.keys(STAT_WEIGHTS).reduce((s, key) => s + avg[key] * STAT_WEIGHTS[key], 0)
    );

    let teamwork = 0;
    if (hasMembers) {
      const powerVals = members.map((c) => c.stats.power);
      const meanPower = powerVals.reduce((s, v) => s + v, 0) / powerVals.length;
      const variance =
        powerVals.reduce((s, v) => s + (v - meanPower) ** 2, 0) / powerVals.length;
      const stddev = Math.sqrt(variance);
      teamwork = round1(clamp(100 - stddev * 2, 0, 100));
    }

    const weightedBase = round1(coreScore * 0.85 + teamwork * 0.15);
    const synergy = round1((coreScore - 70) * 0.08);
    const randomness = round1(seededUnit(`${state.matchSeed}::${color}`) * 3 - 1.5);

    const finalScore = round1(weightedBase + synergy + randomness);

    return {
      playerNum,
      color,
      members,
      avg,
      coreScore,
      teamwork,
      weightedBase,
      synergy,
      randomness,
      finalScore,
    };
  });

  // Keep player order (1..N) for the pre-reveal VS screen; ranking is derived
  // separately so the display order doesn't leak the outcome before reveal.
  state.results = { teams, revealed: false };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/* ---------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------- */

function franchiseLabel() {
  const fr = state.db.franchises.find((f) => f.id === state.franchise);
  return fr ? fr.label : "";
}

function colorMeta(id) {
  return COLORS.find((c) => c.id === id) || { label: "?", hex: "#888", emoji: "" };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function animateReveal() {
  const scoreEls = Array.from(document.querySelectorAll(".vs-card .score"));
  const btnRow = document.querySelector(".btn-row button");
  if (btnRow) btnRow.disabled = true;

  const targets = scoreEls.map((el) => parseFloat(el.dataset.score));
  const colors = state.results.teams.map((t) => colorMeta(t.color).hex);
  const duration = 1000;
  const start = performance.now();

  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    scoreEls.forEach((el, i) => {
      el.style.color = colors[i];
      el.textContent = (targets[i] * eased).toFixed(1);
    });
    if (p < 1) {
      requestAnimationFrame(tick);
    } else {
      state.results.revealed = true;
      render();
    }
  }
  requestAnimationFrame(tick);
}

/* ---------------------------------------------------------------------
 * Event handling
 * ------------------------------------------------------------------- */

function bindEvents() {
  const app = document.getElementById("app");
  app.onclick = (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    const value = el.dataset.value;

    switch (action) {
      case "pickFranchise":
        state.franchise = value;
        state.screen = "playerCount";
        render();
        break;

      case "back-franchise":
        state.screen = "franchise";
        render();
        break;

      case "pickCount":
        state.playerCount = parseInt(value, 10);
        state.colorAssign = [];
        state.colorStep = 0;
        state.draftPicks = Array.from({ length: state.playerCount }, () => []);
        state.screen = "color";
        render();
        break;

      case "pickColor":
        state.colorAssign[state.colorStep] = value;
        state.colorStep++;
        if (state.colorStep >= state.playerCount) {
          state.budgets = Array.from({ length: state.playerCount }, () => STARTING_BUDGET);
          state.draftedIds = new Set();
          state.totalRounds = state.playerCount * TEAM_SIZE;
          state.round = 1;
          state.screen = "draft";
          startRound();
          return;
        }
        render();
        break;

      case "lockBid": {
        const currentBidder = state.pendingBidders[0];
        lockBid(currentBidder, parseInt(value, 10));
        break;
      }

      case "lockCustomBid": {
        const currentBidder = state.pendingBidders[0];
        const input = document.getElementById("customBidInput");
        const amount = input ? parseInt(input.value, 10) : NaN;
        if (Number.isNaN(amount)) break;
        lockBid(currentBidder, amount);
        break;
      }

      case "continueReveal":
        resolveWinner();
        break;

      case "nextCharacter":
        advanceRound();
        break;

      case "calculate":
        animateReveal();
        break;

      case "showResults":
        state.screen = "results";
        render();
        break;

      case "openBreakdown":
        state.modalTeam = parseInt(value, 10);
        render();
        break;

      case "closeBreakdown":
        state.modalTeam = null;
        render();
        break;

      case "stop":
        e.stopPropagation();
        break;

      case "restart":
        resetGame();
        state.screen = "franchise";
        render();
        break;
    }
  };
}

"use strict";

/* ---------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------- */

// Every player finishes with EXACTLY this many characters. Draft rounds are
// NOT a fixed count — the game keeps drawing characters and running
// alternating (English-style) auctions until every player has TEAM_SIZE.
const TEAM_SIZE = 3;
const STARTING_BUDGET = 20; // yen (¥)
const QUICK_RAISE_STEPS = [1, 2, 3, 5, 10]; // offsets above the current minimum bid
const DRAW_ANIMATION_MS = 800;

const COLORS = [
  { id: "red", label: "Red", emoji: "\u{1F534}", hex: "#ff3b5c" },
  { id: "blue", label: "Blue", emoji: "\u{1F535}", hex: "#3aa8ff" },
  { id: "green", label: "Green", emoji: "\u{1F7E2}", hex: "#33e08a" },
  { id: "purple", label: "Purple", emoji: "\u{1F7E3}", hex: "#c162ff" },
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
  budgets: [], // index = playerNumber-1, yen (¥) remaining
  round: 0, // 1-indexed, up to totalRounds (display only — see TEAM_SIZE note above)
  totalRounds: 0, // playerCount x TEAM_SIZE, total characters sold this game
  draftedIds: new Set(), // character ids already auctioned off this game
  currentCharacter: null, // character object drawn for the active round
  phase: null, // "drawing" | "opening" | "bidding" | "freeChoice" | "winner"
  starterPointer: 0, // 0-indexed into 1..playerCount — who opens the next auction
  pointerAdvanceRef: null, // playerNum the starterPointer should advance past once this round resolves
  auctionOrder: [], // player numbers still live in the current alternating auction, in turn order
  turnIndex: 0, // index into auctionOrder for whose turn it is to respond
  currentBid: 0,
  currentBidder: null, // playerNum who placed currentBid
  freeChoicePlayer: null, // the sole monied player, when everyone else in the auction is broke
  freeChoiceGiveTarget: null, // who they can hand the character to for free instead
  roundWinner: null, // { playerNum, amount } once resolved
  matchSeed: null,
  results: null, // computed on entering results
  modalTeam: null, // player number whose "how calculated" modal is open
  showRestartConfirm: false,
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
  state.starterPointer = 0;
  state.pointerAdvanceRef = null;
  state.auctionOrder = [];
  state.turnIndex = 0;
  state.currentBid = 0;
  state.currentBidder = null;
  state.freeChoicePlayer = null;
  state.freeChoiceGiveTarget = null;
  state.roundWinner = null;
  state.matchSeed = null;
  state.results = null;
  state.modalTeam = null;
  state.showRestartConfirm = false;
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
      <div class="battle-tag" style="margin-top:0;">⚡ FIGHT FOR THE ROSTER ⚡</div>
      <div class="subtitle">Bid, battle, and crown a champion.</div>
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
 * Screen: draft (alternating open-outcry auction)
 *
 * THE GAME CHOOSES THE CHARACTER. THE PLAYERS FIGHT OVER THE PRICE.
 * Each round the game draws one random character and reveals ONLY its
 * name — no power, tier, or rank, so bids are never stat-informed. A
 * rotating opener must bid at least ¥1; each other player in turn either
 * RAISEs the standing bid or WITHDRAWs from this auction only (there is
 * no "take at this price" shortcut — the price only stops climbing once
 * everyone but one player has withdrawn). Reaching ¥0 doesn't eliminate
 * a player — every player must finish with exactly TEAM_SIZE characters,
 * so broke players still receive characters (for free) once nobody else
 * is left to bid against them.
 * ------------------------------------------------------------------- */

function renderDraftScreen() {
  let phaseHtml;
  switch (state.phase) {
    case "drawing":
      phaseHtml = renderDrawingPhase();
      break;
    case "opening":
      phaseHtml = renderOpeningPhase();
      break;
    case "bidding":
      phaseHtml = renderBiddingPhase();
      break;
    case "freeChoice":
      phaseHtml = renderFreeChoicePhase();
      break;
    case "winner":
      phaseHtml = renderWinnerPhase();
      break;
    default:
      phaseHtml = `<div class="screen center"><p>...</p></div>`;
  }
  return `
    ${phaseHtml}
    <div class="restart-footer">
      <button class="btn secondary" data-action="requestRestart">&#8634; Restart Game</button>
    </div>
    ${state.showRestartConfirm ? renderRestartConfirm() : ""}`;
}

function renderRestartConfirm() {
  return `
    <div class="modal-overlay" data-action="cancelRestart">
      <div class="modal" data-action="stop" style="max-width:420px;text-align:center;">
        <h3>Restart Game?</h3>
        <p class="calc-note" style="font-size:0.9rem;">This game's progress will be lost and you'll go back to universe select.</p>
        <div class="btn-row">
          <button class="btn" data-action="confirmRestartYes">Yes, Start Over</button>
          <button class="btn secondary" data-action="cancelRestart">No, Continue</button>
        </div>
      </div>
    </div>`;
}

function renderTeamsSidebar(highlightPlayer) {
  return Array.from({ length: state.playerCount }, (_, i) => {
    const num = i + 1;
    const m = colorMeta(state.colorAssign[i]);
    const picks = state.draftPicks[i] || [];
    const isCurrent = num === highlightPlayer;
    const rows = Array.from({ length: TEAM_SIZE }, (_, slot) => {
      const c = picks[slot];
      return `<li class="${c ? "filled" : ""}">${c ? `&#9679; ${escapeHtml(c.displayName)} &mdash; &yen;${c.paid}` : "&#9675; empty"}</li>`;
    }).join("");
    return `
      <div class="team-box ${isCurrent ? "current" : ""}" style="--glow-color:${m.hex}">
        <h4><span class="dot" style="background:${m.hex}"></span>Player ${num} &mdash; ${m.label.toUpperCase()} &middot; &yen;${state.budgets[i]}</h4>
        <ul>${rows}</ul>
      </div>`;
  }).join("");
}

function renderRoundBanner(tag) {
  const num = String(state.round).padStart(2, "0");
  const total = String(state.totalRounds).padStart(2, "0");
  return `
    <div class="round-banner">
      <span class="round-banner-tag">ROUND</span>
      <span class="round-banner-num">${num}</span>
      <span class="round-banner-total">/ ${total}</span>
    </div>
    ${tag ? `<div class="battle-tag">${tag}</div>` : ""}`;
}

// The character card intentionally shows NAME ONLY (plus an optional
// version note like "(Prime)" already folded into displayName) — never
// tier, rank, or power. Those exist purely for the final calculation.
function renderCharacterCard() {
  const c = state.currentCharacter;
  return `
    <div class="draw-card">
      <span class="draw-card-tab">CHARACTER</span>
      <div class="draw-card-name">${escapeHtml(c.displayName)}</div>
    </div>`;
}

function renderTurnBanner(playerNum, label) {
  const m = colorMeta(state.colorAssign[playerNum - 1]);
  return `
    <div class="turn-banner" style="--glow-color:${m.hex}">
      <span class="dot" style="--glow-color:${m.hex}"></span>
      PLAYER ${playerNum} &mdash; ${m.label.toUpperCase()} ${label}
    </div>`;
}

function renderDrawingPhase() {
  return `
    <div class="screen">
      ${renderRoundBanner()}
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

function quickBidAmounts(minBid, budget) {
  return QUICK_RAISE_STEPS.map((step) => minBid - 1 + step).filter(
    (amt, idx, arr) => amt <= budget && arr.indexOf(amt) === idx
  );
}

function renderOpeningPhase() {
  const opener = state.auctionOrder[0];
  const remaining = state.budgets[opener - 1];
  const amounts = quickBidAmounts(1, remaining);

  const quickButtons = amounts
    .map((amt) => `<button class="btn bid-btn" data-action="fillBidAmount" data-value="${amt}">&yen;${amt}</button>`)
    .join("");

  return `
    <div class="screen">
      ${renderRoundBanner("⚔ BATTLE FOR THE BID!")}
      ${renderCharacterCard()}

      <div class="bidder-panel">
        ${renderTurnBanner(opener, `&mdash; OPENING BID &middot; &yen;${remaining}`)}
        <p class="calc-note center">Must bid at least &yen;1 to open the auction. Pick an amount, then confirm.</p>
        <div class="bid-quick-row">
          ${quickButtons}
          <button class="btn bid-btn all-in" data-action="fillBidAmount" data-value="${remaining}">ALL IN</button>
        </div>
        <div class="bid-custom-row">
          <input type="number" id="customBidInput" min="1" max="${remaining}" step="1" placeholder="Amount" />
          <button class="btn" data-action="placeOpeningBidCustom">Confirm Bid</button>
        </div>
      </div>

      <div class="draft-layout mt-24">
        <div></div>
        <div class="teams-panel">${renderTeamsSidebar(opener)}</div>
      </div>
    </div>`;
}

function renderBiddingPhase() {
  const turnPlayer = state.auctionOrder[state.turnIndex];
  const bidderMeta = colorMeta(state.colorAssign[state.currentBidder - 1]);
  const remaining = state.budgets[turnPlayer - 1];
  const minRaise = state.currentBid + 1;
  const canRaise = remaining >= minRaise;
  const amounts = canRaise ? quickBidAmounts(minRaise, remaining) : [];

  const quickButtons = amounts
    .map((amt) => `<button class="btn bid-btn" data-action="fillBidAmount" data-value="${amt}">&yen;${amt}</button>`)
    .join("");

  // TAKE (instant-win at the standing price) doesn't exist — a player either
  // raises the bid or withdraws and lets it go to whoever's still in. Picking
  // an amount only fills it in; RAISE confirms.
  const raiseControls = canRaise
    ? `
      <div class="bid-quick-row">
        ${quickButtons}
        <button class="btn bid-btn all-in" data-action="fillBidAmount" data-value="${remaining}">ALL IN</button>
      </div>
      <div class="bid-custom-row">
        <input type="number" id="customBidInput" min="${minRaise}" max="${remaining}" step="1" placeholder="Amount" />
        <button class="btn" data-action="raiseBidCustom">Raise</button>
      </div>`
    : `<p class="calc-note center">Not enough &yen; left to raise.</p>`;

  return `
    <div class="screen">
      ${renderRoundBanner()}
      ${renderCharacterCard()}

      <div class="bid-hero">
        <div class="bid-hero-label">CURRENT BID</div>
        <div class="bid-hero-amount" style="color:${bidderMeta.hex};background:rgba(0,0,0,0.35);">&yen;${state.currentBid}</div>
      </div>

      <div class="bidder-panel">
        ${renderTurnBanner(turnPlayer, `&mdash; YOUR TURN &middot; &yen;${remaining}`)}
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn secondary" data-action="withdrawBid">WITHDRAW &mdash; let them have it</button>
        </div>
        ${raiseControls}
      </div>

      <div class="draft-layout mt-24">
        <div></div>
        <div class="teams-panel">${renderTeamsSidebar(turnPlayer)}</div>
      </div>
    </div>`;
}

function renderFreeChoicePhase() {
  const giveMeta = colorMeta(state.colorAssign[state.freeChoiceGiveTarget - 1]);

  return `
    <div class="screen">
      ${renderRoundBanner()}
      ${renderCharacterCard()}
      <p class="calc-note center" style="margin-bottom:16px;">Nobody else in this auction has any &yen; left — no one to bid against.</p>
      <div class="bidder-panel">
        ${renderTurnBanner(state.freeChoicePlayer, "&mdash; YOUR CHOICE")}
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn" data-action="freeChoiceTake">TAKE FOR &yen;0</button>
          <button class="btn secondary" data-action="freeChoiceGive">GIVE TO ${giveMeta.label.toUpperCase()}</button>
        </div>
      </div>
      <div class="draft-layout mt-24">
        <div></div>
        <div class="teams-panel">${renderTeamsSidebar(state.freeChoicePlayer)}</div>
      </div>
    </div>`;
}

function renderWinnerPhase() {
  const c = state.currentCharacter;
  const { playerNum, amount } = state.roundWinner;
  const m = colorMeta(state.colorAssign[playerNum - 1]);
  const needing = playersNeedingCharacters();
  const isLastRound = needing.length === 0;

  return `
    <div class="screen">
      ${renderRoundBanner()}
      <div class="winner-banner" style="color:${m.hex}">${m.emoji} ${m.label.toUpperCase()} WINS!</div>
      <div class="center" style="margin-bottom:20px;">
        <strong>${escapeHtml(c.displayName)}</strong> joined ${m.label.toUpperCase()} for &yen;${amount}
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

function playersNeedingCharacters() {
  return Array.from({ length: state.playerCount }, (_, i) => i + 1).filter(
    (p) => state.draftPicks[p - 1].length < TEAM_SIZE
  );
}

// Rotate the full 1..N player list so it starts right after starterPointer,
// then keep only players who still need a character.
function rotatedNeedingOrder(needing) {
  const n = state.playerCount;
  const ordered = [];
  for (let i = 0; i < n; i++) {
    ordered.push(((state.starterPointer + i) % n) + 1);
  }
  return ordered.filter((p) => needing.includes(p));
}

function startRound() {
  const franchiseData = state.db.franchises.find((f) => f.id === state.franchise);
  const pool = franchiseData.characters.filter((c) => !state.draftedIds.has(c.id));
  const randomIndex = Math.floor(Math.random() * pool.length);
  state.currentCharacter = pool[randomIndex];
  state.phase = "drawing";
  state.roundWinner = null;
  render();

  setTimeout(() => {
    if (state.phase === "drawing") {
      beginAuction();
    }
  }, DRAW_ANIMATION_MS);
}

function beginAuction() {
  const needing = playersNeedingCharacters();
  const ordered = rotatedNeedingOrder(needing);
  state.pointerAdvanceRef = ordered[0];

  if (ordered.length === 1) {
    // Only one player still needs a character — nobody to bid against.
    resolveRoundWinner(ordered[0], 0);
    return;
  }

  const monied = ordered.filter((p) => state.budgets[p - 1] > 0);

  if (monied.length === 0) {
    // Everyone still in the running is broke — hand it over via turn order.
    resolveRoundWinner(ordered[0], 0);
    return;
  }

  if (monied.length === 1) {
    state.phase = "freeChoice";
    state.freeChoicePlayer = monied[0];
    state.freeChoiceGiveTarget = ordered.find((p) => p !== monied[0]);
    render();
    return;
  }

  state.auctionOrder = monied;
  state.turnIndex = 0;
  state.currentBid = 0;
  state.currentBidder = null;
  state.phase = "opening";
  render();
}

function placeOpeningBid(rawAmount) {
  const opener = state.auctionOrder[0];
  const budget = state.budgets[opener - 1];
  const amount = clamp(Math.round(rawAmount) || 0, 1, budget);
  state.currentBid = amount;
  state.currentBidder = opener;
  state.turnIndex = state.auctionOrder.length > 1 ? 1 : 0;
  advanceToValidTurnOrResolve();
}

function raiseBid(rawAmount) {
  const player = state.auctionOrder[state.turnIndex];
  const budget = state.budgets[player - 1];
  const amount = clamp(Math.round(rawAmount) || 0, state.currentBid + 1, budget);
  state.currentBid = amount;
  state.currentBidder = player;
  state.turnIndex = (state.turnIndex + 1) % state.auctionOrder.length;
  advanceToValidTurnOrResolve();
}

function withdrawBid() {
  state.auctionOrder.splice(state.turnIndex, 1);
  if (state.auctionOrder.length === 1) {
    resolveRoundWinner(state.auctionOrder[0], state.currentBid);
    return;
  }
  state.turnIndex = state.turnIndex % state.auctionOrder.length;
  advanceToValidTurnOrResolve();
}

// After a raise or withdrawal, step forward until we land on a player who
// can actually afford the current bid, or resolve if only one is left.
function advanceToValidTurnOrResolve() {
  if (state.auctionOrder.length === 1) {
    resolveRoundWinner(state.auctionOrder[0], state.currentBid);
    return;
  }
  const player = state.auctionOrder[state.turnIndex];
  if (state.budgets[player - 1] < state.currentBid) {
    state.auctionOrder.splice(state.turnIndex, 1);
    state.turnIndex = state.turnIndex % state.auctionOrder.length;
    advanceToValidTurnOrResolve();
    return;
  }
  state.phase = "bidding";
  render();
}

function resolveRoundWinner(playerNum, amount) {
  state.budgets[playerNum - 1] -= amount;
  state.draftPicks[playerNum - 1].push({ ...state.currentCharacter, paid: amount });
  state.draftedIds.add(state.currentCharacter.id);

  const refIdx = state.pointerAdvanceRef - 1;
  state.starterPointer = (refIdx + 1) % state.playerCount;

  state.roundWinner = { playerNum, amount };
  state.phase = "winner";
  render();
}

function advanceRound() {
  const needing = playersNeedingCharacters();
  if (needing.length === 0) {
    state.screen = "vs";
    state.matchSeed = Math.floor(seededUnit(draftSeedKey()) * 1e9);
    computeResults();
    render();
    return;
  }
  state.round++;
  startRound();
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
  const losers = ranked.slice(1).map((t) => colorMeta(t.color).label.toUpperCase());
  const losersJoined =
    losers.length <= 1
      ? losers.join("")
      : `${losers.slice(0, -1).join(", ")} & ${losers[losers.length - 1]}`;
  const slainVerb = losers.length === 1 ? "WAS" : "WERE";

  const detailCards = ranked
    .map((t) => {
      const m = colorMeta(t.color);
      const memberRows = t.members
        .map((c) => `<div class="member-row"><span>${escapeHtml(c.displayName)} <span style="color:var(--text-dim);">(&yen;${c.paid})</span></span><span>${c.stats.power}</span></div>`)
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

      <div class="winner-banner" style="color:${winnerMeta.hex}">\u{1F3C6} ${losersJoined} ${slainVerb} SLAIN BY ${winnerMeta.label.toUpperCase()}</div>

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
          state.starterPointer = Math.floor(Math.random() * state.playerCount);
          state.screen = "draft";
          startRound();
          return;
        }
        render();
        break;

      case "fillBidAmount": {
        const input = document.getElementById("customBidInput");
        if (input) input.value = value;
        document.querySelectorAll(".bid-btn").forEach((b) => b.classList.remove("selected"));
        el.classList.add("selected");
        break;
      }

      case "placeOpeningBidCustom": {
        const input = document.getElementById("customBidInput");
        const amount = input ? parseInt(input.value, 10) : NaN;
        if (Number.isNaN(amount)) break;
        placeOpeningBid(amount);
        break;
      }

      case "raiseBidCustom": {
        const input = document.getElementById("customBidInput");
        const amount = input ? parseInt(input.value, 10) : NaN;
        if (Number.isNaN(amount)) break;
        raiseBid(amount);
        break;
      }

      case "withdrawBid":
        withdrawBid();
        break;

      case "freeChoiceTake":
        resolveRoundWinner(state.freeChoicePlayer, 0);
        break;

      case "freeChoiceGive":
        resolveRoundWinner(state.freeChoiceGiveTarget, 0);
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

      case "requestRestart":
        state.showRestartConfirm = true;
        render();
        break;

      case "confirmRestartYes":
        resetGame();
        state.screen = "franchise";
        render();
        break;

      case "cancelRestart":
        state.showRestartConfirm = false;
        render();
        break;
    }
  };
}

const NAME_KEY = "crypticPlayer";
const PROGRESS_KEY_PREFIX = "crypticProgress_";

const KEYBOARD_ROWS = [
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L"],
  ["ENTER","Z","X","C","V","B","N","M","BACK"],
];

let state = {
  playerName: localStorage.getItem(NAME_KEY) || "",
  daily: null,
  attempt: 1,          // 1-based index of the player's current real guess
  currentLetters: [],
  gameOver: false,
  submitting: false,   // true while a guess is in flight — blocks re-entrant submits
  letterStates: {},    // letter -> 'correct' | 'present' | 'absent'
  history: [],         // completed real guesses: { letters, feedback }
};

const el = (id) => document.getElementById(id);

function init() {
  if (state.playerName) {
    el("pilot-name").textContent = state.playerName;
    el("name-overlay").classList.add("hidden");
    el("app").classList.remove("hidden");
    startGame();
  } else {
    el("name-overlay").classList.remove("hidden");
  }

  el("name-submit").addEventListener("click", submitName);
  el("name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitName();
  });

  el("tab-play").addEventListener("click", () => showView("play"));
  el("tab-leaderboard").addEventListener("click", () => showView("leaderboard"));
  el("scope-today").addEventListener("click", () => loadLeaderboard("today"));
  el("scope-alltime").addEventListener("click", () => loadLeaderboard("alltime"));

  el("result-close").addEventListener("click", () => el("result-modal").classList.add("hidden"));
  el("result-leaderboard").addEventListener("click", () => {
    el("result-modal").classList.add("hidden");
    showView("leaderboard");
  });

  document.addEventListener("keydown", handlePhysicalKey);
  buildKeyboard();
}

function submitName() {
  const value = el("name-input").value.trim().toUpperCase().slice(0, 20);
  if (!value) return;
  state.playerName = value;
  localStorage.setItem(NAME_KEY, value);
  el("pilot-name").textContent = value;
  el("name-overlay").classList.add("hidden");
  el("app").classList.remove("hidden");
  startGame();
}

function showView(view) {
  el("tab-play").classList.toggle("active", view === "play");
  el("tab-leaderboard").classList.toggle("active", view === "leaderboard");
  el("play-view").classList.toggle("hidden", view !== "play");
  el("leaderboard-view").classList.toggle("hidden", view !== "leaderboard");
  if (view === "leaderboard") loadLeaderboard("today");
}

function progressKey() {
  return PROGRESS_KEY_PREFIX + (state.daily ? state.daily.date : "");
}

async function startGame() {
  setMessage("");
  el("status-line").textContent = "ESTABLISHING LINK…";

  const res = await fetch(`/api/daily?name=${encodeURIComponent(state.playerName)}`);
  const daily = await res.json();
  state.daily = daily;

  const saved = JSON.parse(localStorage.getItem(progressKey()) || "null");
  if (saved) {
    state.gameOver = Boolean(saved.gameOver);
    state.attempt = saved.attempt || 1;
    state.letterStates = saved.letterStates || {};
    state.history = saved.history || [];
  } else if (daily.alreadyPlayed) {
    // No local record (different browser/device, or cleared storage), but the
    // server already has a result for this callsign today — honor that lock.
    state.gameOver = true;
    state.attempt = daily.existingEntry ? daily.existingEntry.guessesUsed : daily.maxPlayerGuesses;
    state.letterStates = {};
    state.history = [];
  } else {
    state.gameOver = false;
    state.attempt = 1;
    state.letterStates = {};
    state.history = [];
  }
  state.currentLetters = [];

  renderStatusLine();
  buildBoard();
  buildKeyboard();

  if (state.gameOver) {
    const won = saved ? saved.won : Boolean(daily.existingEntry && daily.existingEntry.won);
    setMessage(won ? "LINK ALREADY SOLVED TODAY." : "LINK ALREADY CLOSED FOR TODAY.");
  }
}

function renderStatusLine() {
  const { date, usingFallback } = state.daily;
  let text = `SOL DATE ${date} · DAILY STARTING TRANSMISSION LOADED`;
  el("status-line").innerHTML = usingFallback
    ? `${text} <span class="warn">(offline fallback word in use)</span>`
    : text;
}

function buildBoard() {
  const board = el("board");
  board.innerHTML = "";

  const totalRows = 1 + state.daily.maxPlayerGuesses;
  for (let r = 0; r < totalRows; r++) {
    const row = document.createElement("div");
    row.className = "board-row" + (r === 0 ? " starting-row" : "");
    row.id = `row-${r}`;
    for (let c = 0; c < 5; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.id = `tile-${r}-${c}`;
      row.appendChild(tile);
    }
    board.appendChild(row);
  }

  revealStartingRow();

  state.history.forEach((entry, idx) => {
    const r = idx + 1;
    entry.letters.forEach((letter, c) => {
      const tile = el(`tile-${r}-${c}`);
      tile.textContent = letter;
      tile.classList.add("filled", entry.feedback[c]);
    });
  });
}

function revealStartingRow() {
  const { startingWord, startingFeedback } = state.daily;
  startingWord.split("").forEach((letter, c) => {
    setTimeout(() => {
      const tile = el(`tile-0-${c}`);
      tile.textContent = letter;
      tile.classList.add("filled", startingFeedback[c]);
      updateLetterState(letter, startingFeedback[c]);
    }, c * 150);
  });
  setTimeout(renderKeyboardColors, 5 * 150 + 100);
}

function buildKeyboard() {
  const kb = el("keyboard");
  kb.innerHTML = "";
  KEYBOARD_ROWS.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "keyboard-row";
    row.forEach((key) => {
      const btn = document.createElement("button");
      btn.className = "key" + (key === "ENTER" || key === "BACK" ? " wide" : "");
      btn.textContent = key === "BACK" ? "⌫" : key;
      btn.dataset.key = key;
      btn.addEventListener("click", () => handleKey(key));
      rowEl.appendChild(btn);
    });
    kb.appendChild(rowEl);
  });
  renderKeyboardColors();
}

function renderKeyboardColors() {
  document.querySelectorAll(".key").forEach((btn) => {
    const letter = btn.dataset.key;
    const stateClass = state.letterStates[letter];
    btn.classList.remove("correct", "present", "absent");
    if (stateClass) btn.classList.add(stateClass);
  });
}

function updateLetterState(letter, feedback) {
  const rank = { absent: 0, present: 1, correct: 2 };
  const current = state.letterStates[letter];
  if (!current || rank[feedback] > rank[current]) {
    state.letterStates[letter] = feedback;
  }
}

function handlePhysicalKey(e) {
  if (state.gameOver || !state.daily) return;
  const key = e.key.toUpperCase();
  if (key === "ENTER") handleKey("ENTER");
  else if (key === "BACKSPACE") handleKey("BACK");
  else if (/^[A-Z]$/.test(key)) handleKey(key);
}

function handleKey(key) {
  if (state.gameOver || state.submitting) return;

  if (key === "BACK") {
    state.currentLetters.pop();
  } else if (key === "ENTER") {
    submitGuess();
    return;
  } else if (state.currentLetters.length < 5) {
    state.currentLetters.push(key);
  }

  renderCurrentRow();
}

function renderCurrentRow() {
  for (let c = 0; c < 5; c++) {
    const tile = el(`tile-${state.attempt}-${c}`);
    const letter = state.currentLetters[c];
    tile.textContent = letter || "";
    tile.classList.toggle("filled", Boolean(letter));
  }
}

function setMessage(text) {
  el("message").textContent = text;
}

function shakeRow() {
  const row = el(`row-${state.attempt}`);
  row.style.transform = "translateX(-4px)";
  setTimeout(() => (row.style.transform = "translateX(4px)"), 60);
  setTimeout(() => (row.style.transform = "translateX(0)"), 120);
}

async function submitGuess() {
  if (state.submitting || state.gameOver) return;

  if (state.currentLetters.length < 5) {
    setMessage("NOT ENOUGH LETTERS.");
    shakeRow();
    return;
  }

  state.submitting = true;
  try {
    const guess = state.currentLetters.join("");
    const lettersSnapshot = [...state.currentLetters];
    setMessage("");

    const res = await fetch("/api/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guess, attemptNumber: state.attempt, name: state.playerName }),
    });
    const data = await res.json();

    if (res.status === 403) {
      // Another tab/session for this callsign already finished today's game.
      state.gameOver = true;
      saveProgress(false, true);
      setMessage(data.error || "ALREADY PLAYED TODAY.");
      return;
    }

    if (!res.ok) {
      setMessage(data.error || "TRANSMISSION ERROR.");
      shakeRow();
      return;
    }

    state.history.push({ letters: lettersSnapshot, feedback: data.feedback });
    applyFeedback(state.attempt, lettersSnapshot, data.feedback);

    const won = data.correct;
    const outOfGuesses = state.attempt >= state.daily.maxPlayerGuesses;

    if (won || outOfGuesses) {
      state.gameOver = true;
      saveProgress(won, true);
      await submitScore(won, state.attempt);
      setTimeout(() => showResult(won, data.answer), 600);
    } else {
      saveProgress(false, false);
      state.attempt += 1;
      state.currentLetters = [];
    }
  } finally {
    state.submitting = false;
  }
}

function applyFeedback(rowIndex, letters, feedback) {
  letters.forEach((letter, c) => {
    setTimeout(() => {
      const tile = el(`tile-${rowIndex}-${c}`);
      tile.classList.add("filled", feedback[c]);
      updateLetterState(letter, feedback[c]);
      renderKeyboardColors();
    }, c * 150);
  });
}

function saveProgress(won, gameOverOverride) {
  const gameOver = gameOverOverride === undefined ? state.gameOver : gameOverOverride;
  localStorage.setItem(progressKey(), JSON.stringify({
    history: state.history,
    attempt: state.attempt,
    gameOver,
    won: Boolean(won),
    letterStates: state.letterStates,
  }));
}

async function submitScore(won, guessesUsed) {
  await fetch("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: state.playerName, won, guessesUsed }),
  });
}

function showResult(won, answer) {
  el("result-title").textContent = won ? "SIGNAL DECODED" : "LINK LOST";
  el("result-answer").textContent = won
    ? `You cracked today's NYT word in ${state.attempt} guess${state.attempt === 1 ? "" : "es"}.`
    : `The word was ${answer || "—"}.`;
  const max = state.daily.maxPlayerGuesses;
  const score = won ? (max + 1 - Math.min(state.attempt, max)) * 100 + 100 : 0;
  el("result-score").textContent = `SCORE: ${score}`;
  el("result-modal").classList.remove("hidden");
}

async function loadLeaderboard(scope) {
  el("scope-today").classList.toggle("active", scope === "today");
  el("scope-alltime").classList.toggle("active", scope === "alltime");

  const res = await fetch(`/api/leaderboard?scope=${scope}`);
  const data = await res.json();

  const head = el("leaderboard-head");
  head.innerHTML = scope === "alltime"
    ? "<tr><th>#</th><th>CALLSIGN</th><th>AVG SCORE</th><th>AVG GUESSES</th><th>GAMES</th></tr>"
    : "<tr><th>#</th><th>CALLSIGN</th><th>SCORE</th><th>GUESSES</th><th>DATE</th></tr>";

  const body = el("leaderboard-body");
  body.innerHTML = "";
  data.entries.forEach((entry, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = scope === "alltime"
      ? `
        <td>${i + 1}</td>
        <td>${entry.name}</td>
        <td>${entry.avgScore}</td>
        <td>${entry.avgGuesses}</td>
        <td>${entry.gamesPlayed}</td>
      `
      : `
        <td>${i + 1}</td>
        <td>${entry.name}</td>
        <td>${entry.score}</td>
        <td>${entry.won ? entry.guessesUsed : "—"}</td>
        <td>${entry.date}</td>
      `;
    body.appendChild(tr);
  });

  if (!data.entries.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="color:var(--text-dim)">No transmissions logged yet.</td>`;
    body.appendChild(tr);
  }
}

init();

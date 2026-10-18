const express = require("express");
const fs = require("fs");
const path = require("path");
const rawWords = require("an-array-of-english-words");

const PORT = process.env.PORT || 3000;
const LEADERBOARD_PATH = path.join(__dirname, "data", "leaderboard.json");
const MAX_PLAYER_GUESSES = 5;

const WORD_LIST = [...new Set(
  rawWords.filter((w) => /^[a-z]{5}$/.test(w)).map((w) => w.toUpperCase())
)].sort();
const WORD_SET = new Set(WORD_LIST);

const FALLBACK_WORDS = ["CRANE", "PLANT", "SOLAR", "TRACE", "GLINT", "VIVID", "QUARK", "NOVAE"];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function dateKey() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function pickDeterministicWord(seed, exclude) {
  const list = WORD_LIST.length ? WORD_LIST : FALLBACK_WORDS;
  let index = hashString(seed) % list.length;
  while (list[index] === exclude) {
    index = (index + 1) % list.length;
  }
  return list[index];
}

const nytCache = new Map();

async function getAnswerForDate(date) {
  if (nytCache.has(date)) return nytCache.get(date);

  let answer;
  let fallback = false;
  try {
    const res = await fetch(`https://www.nytimes.com/svc/wordle/v2/${date}.json`);
    if (!res.ok) throw new Error(`NYT responded ${res.status}`);
    const json = await res.json();
    if (!json.solution || !/^[a-zA-Z]{5}$/.test(json.solution)) {
      throw new Error("Unexpected NYT payload");
    }
    answer = json.solution.toUpperCase();
  } catch (err) {
    fallback = true;
    const idx = hashString(date) % FALLBACK_WORDS.length;
    answer = FALLBACK_WORDS[idx];
    console.warn(`[wordle] Falling back to local word for ${date}: ${err.message}`);
  }

  const result = { answer, fallback };
  nytCache.set(date, result);
  return result;
}

function scoreGuess(guess, answer) {
  const feedback = new Array(5).fill("absent");
  const remaining = {};

  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) {
      feedback[i] = "correct";
    } else {
      remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (feedback[i] === "correct") continue;
    const letter = guess[i];
    if (remaining[letter] > 0) {
      feedback[i] = "present";
      remaining[letter]--;
    }
  }

  return feedback;
}

function computeScore(won, guessesUsed) {
  if (!won) return 0;
  const clamped = Math.min(Math.max(guessesUsed, 1), MAX_PLAYER_GUESSES);
  return (MAX_PLAYER_GUESSES + 1 - clamped) * 100 + 100;
}

function readLeaderboard() {
  try {
    const raw = fs.readFileSync(LEADERBOARD_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeLeaderboard(entries) {
  fs.writeFileSync(LEADERBOARD_PATH, JSON.stringify(entries, null, 2));
}

function cleanName(name) {
  return (typeof name === "string" ? name.trim() : "").slice(0, 20).toUpperCase() || "ANONYMOUS";
}

function findTodayEntry(name) {
  if (!name) return null;
  const date = dateKey();
  const target = cleanName(name);
  return readLeaderboard().find((e) => e.date === date && e.name === target) || null;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/daily", async (req, res) => {
  const date = dateKey();
  const { answer, fallback } = await getAnswerForDate(date);
  const startingWord = pickDeterministicWord(`${date}-start`, answer);
  const startingFeedback = scoreGuess(startingWord, answer);
  const existingEntry = findTodayEntry(req.query.name);

  res.json({
    date,
    startingWord,
    startingFeedback,
    maxPlayerGuesses: MAX_PLAYER_GUESSES,
    usingFallback: fallback,
    alreadyPlayed: Boolean(existingEntry),
    existingEntry,
  });
});

app.post("/api/guess", async (req, res) => {
  const { guess, attemptNumber, name } = req.body || {};

  if (findTodayEntry(name)) {
    return res.status(403).json({ error: "You've already played today's transmission." });
  }

  if (typeof guess !== "string" || !/^[A-Za-z]{5}$/.test(guess)) {
    return res.status(400).json({ error: "Guess must be exactly 5 letters." });
  }

  const upperGuess = guess.toUpperCase();
  if (!WORD_SET.has(upperGuess)) {
    return res.status(400).json({ error: "Not a recognized word." });
  }

  const date = dateKey();
  const { answer } = await getAnswerForDate(date);
  const feedback = scoreGuess(upperGuess, answer);
  const correct = upperGuess === answer;

  const response = { feedback, correct };
  if (!correct && Number(attemptNumber) >= MAX_PLAYER_GUESSES) {
    response.answer = answer;
  }

  res.json(response);
});

app.post("/api/score", (req, res) => {
  const { name, won, guessesUsed } = req.body || {};

  const existing = findTodayEntry(name);
  if (existing) {
    return res.json({ entry: existing, duplicate: true });
  }

  const cleanGuesses = Math.min(Math.max(Number(guessesUsed) || 0, 0), MAX_PLAYER_GUESSES);
  const cleanWon = Boolean(won);

  const entry = {
    name: cleanName(name),
    date: dateKey(),
    won: cleanWon,
    guessesUsed: cleanGuesses,
    score: computeScore(cleanWon, cleanGuesses),
    ts: Date.now(),
  };

  const entries = readLeaderboard();
  entries.push(entry);
  writeLeaderboard(entries);

  res.json({ entry });
});

app.get("/api/leaderboard", (req, res) => {
  const scope = req.query.scope === "today" ? "today" : "alltime";
  const date = dateKey();
  let entries = readLeaderboard();

  if (scope === "today") {
    entries = entries.filter((e) => e.date === date);
  }

  entries = entries
    .slice()
    .sort((a, b) => b.score - a.score || a.guessesUsed - b.guessesUsed || a.ts - b.ts)
    .slice(0, 50);

  res.json({ scope, date, entries });
});

app.listen(PORT, () => {
  console.log(`Cryptic running at http://localhost:${PORT}`);
  console.log(`Loaded ${WORD_LIST.length} valid 5-letter words.`);
});

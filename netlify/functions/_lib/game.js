const rawWords = require("an-array-of-english-words");

const MAX_PLAYER_GUESSES = 5;
const FALLBACK_WORDS = ["CRANE", "PLANT", "SOLAR", "TRACE", "GLINT", "VIVID", "QUARK", "NOVAE"];

// Computed once per warm function instance, reused across invocations.
const WORD_LIST = [...new Set(
  rawWords.filter((w) => /^[a-z]{5}$/.test(w)).map((w) => w.toUpperCase())
)].sort();
const WORD_SET = new Set(WORD_LIST);

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const RESET_HOUR_MS = 5 * 60 * 60 * 1000;

// The app's "today" (daily word, leaderboard date, one-play-per-day lock)
// flips at 5am Brisbane time, not midnight anywhere. Shift the instant back
// by the reset hour before reading Brisbane's calendar date, so anything
// before 5am still counts as the previous day.
function dateKey() {
  const shifted = new Date(Date.now() - RESET_HOUR_MS);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(shifted);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function pickDeterministicWord(seed, exclude) {
  const list = WORD_LIST.length ? WORD_LIST : FALLBACK_WORDS;
  let index = hashString(seed) % list.length;
  while (list[index] === exclude) {
    index = (index + 1) % list.length;
  }
  return list[index];
}

// In-memory cache, scoped to a single warm Lambda instance. Cheap enough that a
// cold-start cache miss just means one extra fetch to NYT, not a problem.
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
    console.warn(`[cryptic] Falling back to local word for ${date}: ${err.message}`);
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

function cleanName(name) {
  return (typeof name === "string" ? name.trim() : "").slice(0, 20).toUpperCase() || "ANONYMOUS";
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

module.exports = {
  MAX_PLAYER_GUESSES,
  WORD_LIST,
  WORD_SET,
  dateKey,
  pickDeterministicWord,
  getAnswerForDate,
  scoreGuess,
  computeScore,
  cleanName,
  jsonResponse,
};

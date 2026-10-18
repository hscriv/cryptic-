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

// NYT's daily word flips at midnight US Eastern time, not UTC midnight, so the
// "today" used to key the puzzle has to follow that same clock.
function dateKeyET() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
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
  dateKeyET,
  pickDeterministicWord,
  getAnswerForDate,
  scoreGuess,
  computeScore,
  cleanName,
  jsonResponse,
};

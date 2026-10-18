const { dateKeyET, pickDeterministicWord, getAnswerForDate, scoreGuess, MAX_PLAYER_GUESSES, cleanName, jsonResponse } = require("./_lib/game");
const { findTodayEntry } = require("./_lib/supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const rawName = event.queryStringParameters && event.queryStringParameters.name;
  const day = dateKeyET();
  const { answer, fallback } = await getAnswerForDate(day);
  const startingWord = pickDeterministicWord(`${day}-start`, answer);
  const startingFeedback = scoreGuess(startingWord, answer);

  let existingEntry = null;
  if (rawName) {
    existingEntry = await findTodayEntry(cleanName(rawName), day);
  }

  return jsonResponse(200, {
    date: day,
    startingWord,
    startingFeedback,
    maxPlayerGuesses: MAX_PLAYER_GUESSES,
    usingFallback: fallback,
    alreadyPlayed: Boolean(existingEntry),
    existingEntry,
  });
};

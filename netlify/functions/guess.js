const { dateKey, getAnswerForDate, scoreGuess, WORD_SET, MAX_PLAYER_GUESSES, cleanName, jsonResponse } = require("./_lib/game");
const { findTodayEntry } = require("./_lib/supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const { guess, attemptNumber, name } = body;
  const day = dateKey();

  if (name) {
    try {
      const existing = await findTodayEntry(cleanName(name), day);
      if (existing) {
        return jsonResponse(403, { error: "You've already played today's transmission." });
      }
    } catch (err) {
      console.error("[cryptic] already-played check failed", err);
      return jsonResponse(500, { error: "Could not verify play status." });
    }
  }

  if (typeof guess !== "string" || !/^[A-Za-z]{5}$/.test(guess)) {
    return jsonResponse(400, { error: "Guess must be exactly 5 letters." });
  }

  const upperGuess = guess.toUpperCase();
  if (!WORD_SET.has(upperGuess)) {
    return jsonResponse(400, { error: "Not a recognized word." });
  }

  const { answer } = await getAnswerForDate(day);
  const feedback = scoreGuess(upperGuess, answer);
  const correct = upperGuess === answer;

  const response = { feedback, correct };
  if (!correct && Number(attemptNumber) >= MAX_PLAYER_GUESSES) {
    response.answer = answer;
  }

  return jsonResponse(200, response);
};

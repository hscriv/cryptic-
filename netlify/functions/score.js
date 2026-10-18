const { dateKeyET, computeScore, MAX_PLAYER_GUESSES, cleanName, jsonResponse } = require("./_lib/game");
const { getSupabase, findTodayEntry, toEntry } = require("./_lib/supabase");

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

  const day = dateKeyET();
  const name = cleanName(body.name);
  const won = Boolean(body.won);
  const guessesUsed = Math.min(Math.max(Number(body.guessesUsed) || 0, 0), MAX_PLAYER_GUESSES);

  const existing = await findTodayEntry(name, day);
  if (existing) {
    return jsonResponse(200, { entry: existing, duplicate: true });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("leaderboard")
    .insert({
      name,
      play_date: day,
      won,
      guesses_used: guessesUsed,
      score: computeScore(won, guessesUsed),
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation: a concurrent request beat us to it. Not a
    // real error from the player's point of view — just hand back that row.
    if (error.code === "23505") {
      const racedEntry = await findTodayEntry(name, day);
      return jsonResponse(200, { entry: racedEntry, duplicate: true });
    }
    console.error("[cryptic] score insert failed", error);
    return jsonResponse(500, { error: "Could not save score." });
  }

  return jsonResponse(200, { entry: toEntry(data) });
};

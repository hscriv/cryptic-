const { dateKey, jsonResponse } = require("./_lib/game");
const { getSupabase, toEntry } = require("./_lib/supabase");

// All-time is capped at this many rows to aggregate over — generous for a
// casual leaderboard, cheap enough for Supabase's free tier.
const ALLTIME_ROW_LIMIT = 5000;

function aggregateByPlayer(rows) {
  const byName = new Map();

  for (const row of rows) {
    const existing = byName.get(row.name) || { name: row.name, totalScore: 0, totalGuesses: 0, gamesPlayed: 0 };
    existing.totalScore += row.score;
    existing.totalGuesses += row.guesses_used;
    existing.gamesPlayed += 1;
    byName.set(row.name, existing);
  }

  return [...byName.values()].map((p) => ({
    name: p.name,
    gamesPlayed: p.gamesPlayed,
    avgScore: Math.round(p.totalScore / p.gamesPlayed),
    avgGuesses: Math.round((p.totalGuesses / p.gamesPlayed) * 10) / 10,
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const scope = event.queryStringParameters && event.queryStringParameters.scope === "today" ? "today" : "alltime";
  const day = dateKey();
  const supabase = getSupabase();

  if (scope === "today") {
    const { data, error } = await supabase
      .from("leaderboard")
      .select("*")
      .eq("play_date", day)
      .order("score", { ascending: false })
      .order("guesses_used", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) {
      console.error("[cryptic] leaderboard query failed", error);
      return jsonResponse(500, { error: "Could not load leaderboard." });
    }

    return jsonResponse(200, { scope, date: day, entries: (data || []).map(toEntry) });
  }

  // All-time: one row per player per day in the table, averaged here into
  // one row per player (Supabase's free-tier REST API doesn't support
  // GROUP BY aggregates, so this is done in the function instead).
  const { data, error } = await supabase
    .from("leaderboard")
    .select("name, score, guesses_used")
    .limit(ALLTIME_ROW_LIMIT);

  if (error) {
    console.error("[cryptic] leaderboard query failed", error);
    return jsonResponse(500, { error: "Could not load leaderboard." });
  }

  const entries = aggregateByPlayer(data || [])
    .sort((a, b) => b.avgScore - a.avgScore || a.avgGuesses - b.avgGuesses || b.gamesPlayed - a.gamesPlayed)
    .slice(0, 50);

  return jsonResponse(200, { scope, date: day, entries });
};

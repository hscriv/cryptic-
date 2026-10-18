const { dateKeyET, jsonResponse } = require("./_lib/game");
const { getSupabase, toEntry } = require("./_lib/supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const scope = event.queryStringParameters && event.queryStringParameters.scope === "today" ? "today" : "alltime";
  const day = dateKeyET();
  const supabase = getSupabase();

  let query = supabase
    .from("leaderboard")
    .select("*")
    .order("score", { ascending: false })
    .order("guesses_used", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(50);

  if (scope === "today") {
    query = query.eq("play_date", day);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[cryptic] leaderboard query failed", error);
    // TODO: revert to a generic message once the Supabase connection is confirmed working.
    return jsonResponse(500, { error: "Could not load leaderboard.", debug: error.message, code: error.code });
  }

  return jsonResponse(200, { scope, date: day, entries: (data || []).map(toEntry) });
};

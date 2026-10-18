const { createClient } = require("@supabase/supabase-js");

let client = null;

// Service-role key only — this file is never bundled into the browser, only
// into server-side Netlify Functions, so it's safe to use the privileged key
// here and skip Row Level Security policies entirely.
function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }

  client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  return client;
}

// Normalizes a Supabase row (snake_case) into the camelCase shape the
// frontend already expects, so nothing in public/app.js has to change.
function toEntry(row) {
  if (!row) return null;
  return {
    name: row.name,
    date: row.play_date,
    won: row.won,
    guessesUsed: row.guesses_used,
    score: row.score,
    ts: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

async function findTodayEntry(name, playDate) {
  if (!name) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("leaderboard")
    .select("*")
    .eq("name", name)
    .eq("play_date", playDate)
    .maybeSingle();

  if (error) throw error;
  return toEntry(data);
}

module.exports = { getSupabase, findTodayEntry, toEntry };

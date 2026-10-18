const { jsonResponse } = require("./_lib/game");

// Temporary diagnostic endpoint — reports presence (never values) of the
// variables we depend on, plus a couple of Netlify-provided ones as a
// control group. Safe to leave deployed briefly; delete once the Supabase
// env var issue is resolved.
exports.handler = async () => {
  const keys = Object.keys(process.env);
  return jsonResponse(200, {
    totalEnvVarCount: keys.length,
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    // Netlify-provided control vars, to check env vars reach functions at all
    netlifyContext: process.env.CONTEXT || null,
    netlifySiteName: process.env.SITE_NAME || null,
    netlifyDeployId: process.env.DEPLOY_ID || null,
    // keys that look like ours or Supabase-related, in case of a typo
    supabaseLikeKeys: keys.filter((k) => /supabase/i.test(k)),
  });
};

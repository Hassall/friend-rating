const ACTIVITY_DAY_MS = 86_400_000;
const ACTIVITY_WINDOW_MS = 30 * ACTIVITY_DAY_MS;
const ACTIVITY_TREND_DAYS = 14;
const ADMIN_HEADERS = { "X-Robots-Tag": "noindex, nofollow" };

function requestCountry(request) {
  const country = request.cf?.country ?? request.headers.get("CF-IPCountry");
  return /^[A-Z]{2}$/.test(country ?? "") && country !== "XX" ? country : null;
}

async function readSiteActivity(db, now) {
  const since = now - ACTIVITY_WINDOW_MS;
  const trendStart = (Math.floor(now / ACTIVITY_DAY_MS) - ACTIVITY_TREND_DAYS + 1) * ACTIVITY_DAY_MS;
  const [counts, daily, countries, durations, gameGroups] = await Promise.all([
    db.prepare(
      "SELECT kind, COUNT(*) AS total, SUM(occurred_at >= ?) AS today " +
      "FROM site_activity WHERE occurred_at >= ? AND occurred_at <= ? GROUP BY kind",
    ).bind(now - ACTIVITY_DAY_MS, since, now).all(),
    db.prepare(
      "SELECT CAST(occurred_at / ? AS INTEGER) AS day, kind, COUNT(*) AS count " +
      "FROM site_activity WHERE occurred_at >= ? AND occurred_at <= ? GROUP BY day, kind",
    ).bind(ACTIVITY_DAY_MS, trendStart, now).all(),
    db.prepare(
      "SELECT country, COUNT(*) AS count FROM site_activity WHERE kind = 'player_joined' " +
      "AND occurred_at >= ? AND occurred_at <= ? GROUP BY country ORDER BY count DESC, country",
    ).bind(since, now).all(),
    db.prepare(`
      WITH lengths AS (
        SELECT COALESCE(completed.duration_ms, completed.occurred_at - started.occurred_at) AS duration
        FROM site_activity AS completed
        LEFT JOIN site_activity AS started ON started.room_id = completed.room_id AND started.kind = 'game_started'
        WHERE completed.kind = 'game_completed' AND completed.occurred_at BETWEEN ? AND ?
      )
      SELECT CASE
        WHEN duration < 300000 THEN 'under_5'
        WHEN duration < 600000 THEN '5_to_10'
        WHEN duration < 1200000 THEN '10_to_20'
        WHEN duration < 2400000 THEN '20_to_40'
        ELSE '40_plus'
      END AS bucket, COUNT(*) AS count, SUM(duration) AS totalMs
      FROM lengths WHERE duration >= 0 GROUP BY bucket
    `).bind(since, now).all(),
    db.prepare(`
      WITH games AS (
        SELECT started.player_count, started.game_mode, completed.room_id IS NOT NULL AS finished
        FROM site_activity AS started
        LEFT JOIN site_activity AS completed
          ON completed.room_id = started.room_id AND completed.kind = 'game_completed' AND completed.occurred_at <= ?
        WHERE started.kind = 'game_started' AND started.occurred_at BETWEEN ? AND ?
      )
      SELECT 'size' AS category, CASE
        WHEN player_count IS NULL THEN 'unknown'
        WHEN player_count <= 2 THEN '2'
        WHEN player_count <= 5 THEN '3_to_5'
        WHEN player_count <= 10 THEN '6_to_10'
        ELSE '11_plus'
      END AS bucket, COUNT(*) AS count, SUM(finished) AS finished
      FROM games GROUP BY bucket
      UNION ALL
      SELECT 'mode', COALESCE(game_mode, 'unknown'), COUNT(*), SUM(finished)
      FROM games GROUP BY game_mode
    `).bind(now, since, now).all(),
  ]);
  return {
    counts: counts.results, daily: daily.results, trendDays: ACTIVITY_TREND_DAYS,
    countries: countries.results, durations: durations.results, gameGroups: gameGroups.results, now,
  };
}

async function handleAdmin(request, pathname, db, clock, ownerEmail) {
  const api = pathname.startsWith("/api/");
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  const owner = ownerEmail?.trim().toLowerCase();
  const headers = { ...HEADERS, ...ADMIN_HEADERS };
  if (request.method !== "GET") return new Response(null, { status: 405, headers });

  if (!owner || !userId || !email || email !== owner) {
    const signedIn = Boolean(userId && email);
    const status = !owner ? 503 : signedIn ? 403 : 401;
    const message = !owner ? "The dashboard is unavailable." : signedIn
      ? "This dashboard is only available to the site owner." : "Sign in to view site activity.";
    if (api) return Response.json({ error: message }, { status, headers });
    const signIn = '<a class="button primary" href="/signin-with-chatgpt?return_to=%2Fadmin">Sign in with ChatGPT</a>';
    const switchAccount = '<a class="button secondary" href="/signout-with-chatgpt?return_to=%2Fadmin">Switch account</a>';
    const page = APP_ASSETS["/admin.html"].body
      .replace(/<script[^>]*src="\/admin\.js"><\/script>\s*/, "")
      .replace(/<main[\s\S]*?<\/main>/, '<main class="site-main"><section class="panel centered admin-access">' +
        '<h1>Site activity</h1><p>' + message + '</p>' + (!owner ? "" : signedIn ? switchAccount : signIn) + '</section></main>');
    return new Response(page, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  }

  if (api) {
    try {
      return Response.json(await readSiteActivity(db, clock()), { headers });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "Site activity is temporarily unavailable." }, { status: 503, headers });
    }
  }
  const file = pathname === "/admin.js" ? "/admin.js" : "/admin.html";
  const asset = APP_ASSETS[file];
  return new Response(asset.body, { headers: { ...headers, "Content-Type": asset.type } });
}

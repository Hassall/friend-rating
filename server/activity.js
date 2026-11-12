const ACTIVITY_DAY_MS = 86_400_000;
const ACTIVITY_WINDOW_MS = 30 * ACTIVITY_DAY_MS;
const RECENT_PLAYER_LIMIT = 50;
const ADMIN_HEADERS = { "X-Robots-Tag": "noindex, nofollow" };

async function readSiteActivity(db, now) {
  const since = now - ACTIVITY_WINDOW_MS;
  const [counts, players] = await Promise.all([
    db.prepare(
      "SELECT kind, COUNT(*) AS total, SUM(occurred_at >= ?) AS today " +
      "FROM site_activity WHERE occurred_at >= ? AND occurred_at <= ? GROUP BY kind",
    ).bind(now - ACTIVITY_DAY_MS, since, now).all(),
    db.prepare(
      "SELECT display_name AS name, is_host AS host, occurred_at AS joinedAt " +
      "FROM site_activity WHERE kind = 'player_joined' AND occurred_at >= ? AND occurred_at <= ? " +
      "ORDER BY occurred_at DESC, rowid DESC LIMIT ?",
    ).bind(since, now, RECENT_PLAYER_LIMIT).all(),
  ]);
  return { counts: counts.results, players: players.results, now };
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

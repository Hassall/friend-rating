const INVITE_LIMIT = 20;
const ROUND_MS = 30_000;
const PICK_MS = 120_000;
const BREAK_MS = 4_000;
const REVEAL_MS = 5_000;
const TRAIT_COUNT = 10;
const HOUR_MS = 3_600_000;
const LOBBY_HEARTBEAT_MS = 15_000;
const HOST_TIMEOUT_MS = 60_000;
const ROOM_LIMIT = 6;
const LEGACY_EXPIRY = Date.UTC(2026, 10, 13);
const DEFAULT_TRAITS = ["Capper", "Chaotic", "Clutch", "Funny", "Good Listener", "Hype Friend", "Lore Keeper", "Night Owl", "Storyteller", "Yapper"];
const TOKEN = /^[a-f0-9]{32}$/;
const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: HEADERS });
}

function getName(value) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 24) throw new GameError("Enter a name with 1 to 24 characters.");
  return name;
}

function randomId() {
  return crypto.randomUUID().replaceAll("-", "");
}

async function digest(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inviteId() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))
    .replaceAll("+", "-").replaceAll("/", "_");
}

function player(name, pass, now) {
  return { id: randomId(), name, pass, picks: null, seen: now };
}

function topTraits(players) {
  const counts = TRAITS.map(() => 0);
  for (const member of players) {
    for (const trait of member.picks ?? []) counts[trait]++;
  }
  const byName = (a, b) => TRAITS[a][0].localeCompare(TRAITS[b][0], "en");
  return counts.map((_, trait) => trait)
    .sort((a, b) => counts[b] - counts[a] ||
      (!counts[a] && Number(DEFAULT_TRAITS.includes(TRAITS[b][0])) - Number(DEFAULT_TRAITS.includes(TRAITS[a][0]))) ||
      byName(a, b))
    .slice(0, TRAIT_COUNT).sort(byName);
}

function timeline(room, now) {
  if (room.stage) {
    const { revealAt, ...stage } = room.stage;
    if (stage.phase !== "reveal") return stage;
    const ranking = Math.floor((now - revealAt) / REVEAL_MS);
    return ranking < TRAIT_COUNT
      ? { phase: "reveal", ranking, deadline: revealAt + (ranking + 1) * REVEAL_MS }
      : { phase: "results" };
  }
  // Rooms started before this version keep their original round schedule.
  if (!room.started) return { phase: "lobby" };
  if (!room.ratingAt) return { phase: "traits" };
  if (now < room.ratingAt) return { phase: "starting", deadline: room.ratingAt };

  const round = Math.floor((now - room.ratingAt) / ROUND_MS);
  if (round < room.players.length) {
    return { phase: "rating", round, deadline: room.ratingAt + (round + 1) * ROUND_MS };
  }

  const revealAt = room.ratingAt + room.players.length * ROUND_MS;
  const ranking = Math.floor((now - revealAt) / REVEAL_MS);
  if (ranking < TRAIT_COUNT) return { phase: "reveal", ranking, deadline: revealAt + (ranking + 1) * REVEAL_MS };
  return { phase: "results" };
}

function activePlayers(room) {
  return room.players.filter((member) => !member.left);
}

function currentHost(room) {
  return room.host ?? activePlayers(room)[0]?.id;
}

function advance(room, now) {
  if (!room.stage) return false;
  const active = activePlayers(room);
  let changed = false;
  while (true) {
    const { phase, deadline, round, next } = room.stage;
    if (phase === "traits" && (active.length < 2 || now >= deadline || active.every((member) => member.picks))) {
      room.players = active;
      room.traits = topTraits(active);
      room.stage = { phase: "starting", deadline: Math.min(now, deadline) + BREAK_MS, next: 0 };
    } else if ((phase === "starting" || phase === "break") && now >= deadline) {
      const target = room.players.findIndex((member, index) => index >= next && !member.left);
      room.stage = target < 0 || active.length < 2
        ? { phase: "reveal", revealAt: deadline }
        : { phase: "rating", round: target, deadline: deadline + ROUND_MS };
    } else if (phase === "rating") {
      const eligible = active.filter((member) => member !== room.players[round]);
      const locked = eligible.every((member) => Object.hasOwn(room.votes[round] ?? {}, member.id));
      if (now < deadline && !locked && !room.players[round].left) return changed;
      const nextRound = room.players.findIndex((member, index) => index > round && !member.left);
      room.stage = { phase: "break", deadline: Math.min(now, deadline) + BREAK_MS,
        next: nextRound >= 0 && active.length >= 2 ? nextRound : room.players.length };
    } else {
      return changed;
    }
    changed = true;
  }
}

function updateLobbyPresence(room, member, now) {
  if (room.started || now - (member.seen ?? 0) < LOBBY_HEARTBEAT_MS) return false;
  member.seen = now;
  const host = room.players.find(({ id }) => id === currentHost(room));
  if (host && now - (host.seen ?? 0) >= HOST_TIMEOUT_MS) room.host = member.id;
  return true;
}

function summarize(room) {
  return room.players.map((member, round) => {
    const ballots = Object.values(room.votes[round] ?? {});
    const totals = room.traits.map((_, index) => ballots.reduce((sum, vote) => sum + vote[index], 0));
    return { id: member.id, votes: ballots.length, totals };
  });
}

function leadersFor(results, index) {
  const compare = (a, b) => b.totals[index] * a.votes - a.totals[index] * b.votes;
  const leaders = results.filter((result) => result.votes).sort(compare).slice(0, 3);
  let rank = 1;
  return leaders.map((result, i) => {
    if (i > 0 && compare(leaders[i - 1], result) !== 0) rank = i + 1;
    return { id: result.id, rank, average: result.totals[index] / result.votes };
  });
}

function snapshot(room, member, now, revision) {
  const time = timeline(room, now);
  const votes = room.votes[time.round] ?? {};
  const view = {
    ...time,
    now,
    revision,
    id: room.id,
    me: member.id,
    host: currentHost(room),
    traits: room.traits,
    picks: member.picks,
    players: room.players.map(({ id, name, picks, left }) => ({ id, name, ready: Boolean(picks), left: Boolean(left) })),
  };
  if (time.phase === "rating") {
    view.voted = Object.hasOwn(votes, member.id);
    view.ballot = votes[member.id] ?? null;
    view.eligibleCount = activePlayers(room).filter(({ id }) => id !== room.players[time.round].id).length;
    view.voteCount = activePlayers(room).filter(({ id }) => Object.hasOwn(votes, id)).length;
    view.canUnlock = Boolean(room.stage);
  }
  if (time.phase === "reveal") view.leaders = leadersFor(summarize(room), time.ranking);
  if (time.phase === "results") {
    view.results = summarize(room);
    view.rankings = room.traits.map((_, index) => leadersFor(view.results, index));
  }
  return view;
}

function applyAction(room, member, action, data, now) {
  const { phase, round } = timeline(room, now);
  if (action === "leave") {
    if (phase === "lobby" || phase === "traits") room.players = room.players.filter((player) => player !== member);
    else member.left = true;
    if (currentHost(room) === member.id) room.host = activePlayers(room)[0]?.id;
    if (phase === "rating") delete (room.votes[round] ?? {})[member.id];
    return true;
  }
  if (action === "start") {
    if (member.id !== currentHost(room)) throw new GameError("Only the host can start the game.", 403);
    if (phase !== "lobby") return false;
    if (room.players.length < 2) throw new GameError("Invite at least one friend first.");
    room.started = true;
    room.stage = { phase: "traits", deadline: now + PICK_MS };
    room.expiresAt = now + 24 * HOUR_MS;
    return true;
  }

  if (action === "picks" || action === "unlock-picks") {
    if (phase !== "traits") throw new GameError("Trait selection has closed.", 409);
    if (action === "unlock-picks") {
      member.picks = null;
      return true;
    }
    if (member.picks) return false;
    const picks = data.picks;
    if (!Array.isArray(picks) || picks.length !== TRAIT_COUNT || new Set(picks).size !== TRAIT_COUNT ||
        !picks.every((id) => Number.isInteger(id) && id >= 0 && id < TRAITS.length)) {
      throw new GameError("Choose exactly 10 different traits.");
    }
    member.picks = picks;
    if (!room.stage && room.players.every((participant) => participant.picks)) {
      room.traits = topTraits(room.players);
      room.ratingAt = now + REVEAL_MS;
    }
    return true;
  }

  if (action === "vote" || action === "unlock") {
    if (phase !== "rating" || data.round !== round) throw new GameError("That round has ended.", 409);
    if (room.players[round].id === member.id) throw new GameError("It’s your turn in the spotlight.", 403);
    const votes = room.votes[round] ??= {};
    if (action === "unlock") {
      delete votes[member.id];
      return true;
    }
    if (Object.hasOwn(votes, member.id)) return false;
    const points = data.points;
    if (!Array.isArray(points) || points.length !== TRAIT_COUNT ||
        !points.every((point) => Number.isInteger(point) && point >= 0 && point <= 100 && point % POINT_STEP === 0) ||
        points.reduce((sum, point) => sum + point, 0) !== 100) {
      throw new GameError("Give out all 100 points in steps of five.");
    }
    votes[member.id] = points;
    return true;
  }

  throw new GameError("Unknown action.", 404);
}

async function readBody(request) {
  if (!request.body) throw new GameError("Missing game data.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 4096) {
      await reader.cancel();
      throw new GameError("That request is too large.", 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const data = JSON.parse(text + decoder.decode());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new GameError("Invalid game data.");
  }
}

export function createHandler(db, clock = Date.now) {
  return async function handle(request) {
    const { pathname } = new URL(request.url);
    const { method } = request;

    if (method === "GET" && !pathname.startsWith("/api/")) {
      const invite = /^\/(?:r\/[A-Za-z0-9_-]{16}|room\/[a-f0-9]{32})$/.test(pathname);
      const file = pathname === "/" || invite ? "/index.html" : pathname;
      if (!Object.hasOwn(APP_ASSETS, file)) return new Response("Page not found", { status: 404, headers: HEADERS });
      const asset = APP_ASSETS[file];
      return new Response(asset.body, { headers: {
        ...HEADERS, "Content-Type": asset.type, ...(invite ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
      } });
    }

    try {
      const match = pathname.match(/^\/api\/rooms\/([a-f0-9]{32}|[A-Za-z0-9_-]{16})(?:\/(join|start|picks|unlock-picks|vote|unlock|leave))?$/);
      const create = pathname === "/api/rooms" && method === "POST";
      const state = match && !match[2] && method === "GET";
      const mutate = match?.[2] && method === "POST";
      if (!(create || state || mutate)) throw new GameError("Room endpoint not found.", 404);
      const token = request.headers.get("X-Player-Pass");
      if (!TOKEN.test(token ?? "")) throw new GameError("Your player pass is missing. Reopen the invite link.", 401);
      const pass = await digest(token);
      const data = method === "POST" ? await readBody(request) : {};
      if (create) {
        const now = clock();
        const host = player(getName(data.name), pass, now);
        const bucket = Math.floor(now / HOUR_MS);
        const network = await digest(bucket + ":" + (request.headers.get("CF-Connecting-IP") ?? "local"));
        const limit = await db.prepare(
          "INSERT INTO room_limits (network, bucket, count) VALUES (?, ?, 1) " +
          "ON CONFLICT(network) DO UPDATE SET count = count + 1 WHERE count < ?",
        ).bind(network, bucket, ROOM_LIMIT).run();
        if (!limit.meta.changes) throw new GameError("This network has created too many rooms this hour. Try again later.", 429);
        await db.prepare("DELETE FROM room_limits WHERE bucket < ?").bind(bucket).run();
        await db.prepare("DELETE FROM rooms WHERE id IN (SELECT id FROM rooms WHERE json_extract(state, '$.expiresAt') <= ? LIMIT 30)")
          .bind(now).run();
        if (now >= LEGACY_EXPIRY) {
          await db.prepare("DELETE FROM rooms WHERE id IN (SELECT id FROM rooms WHERE json_extract(state, '$.expiresAt') IS NULL LIMIT ?)").bind(30).run();
        }
        const room = { id: inviteId(), players: [host], host: host.id, started: false, traits: [], votes: {},
          stage: { phase: "lobby" }, expiresAt: now + HOUR_MS };
        await db.prepare("INSERT INTO rooms (id, state) VALUES (?, ?)").bind(room.id, JSON.stringify(room)).run();
        return json(snapshot(room, host, now, 0), 201);
      }

      const [, id, action] = match;
      // Concurrent joins, picks, and ballots retry against the committed room revision.
      for (let attempt = 0; attempt < 40; attempt++) {
        const row = await db.prepare("SELECT revision, state FROM rooms WHERE id = ?").bind(id).first();
        if (!row) throw new GameError("This room link doesn’t exist.", 404);
        const room = JSON.parse(row.state);
        const now = clock();
        if (now >= (room.expiresAt ?? LEGACY_EXPIRY)) throw new GameError("This room has expired.", 410);
        let member = room.players.find((participant) => participant.pass === pass && !participant.left);
        if (member && advance(room, now)) {
          const result = await saveRoom(db, room, row.revision);
          if (result.meta.changes && !action) return json(snapshot(room, member, now, row.revision + 1));
          continue;
        }
        let changed = false;
        if (action === "join" && !member) {
          if (room.started) throw new GameError("This game has already started.", 409);
          if (room.players.length > INVITE_LIMIT) throw new GameError("This room is full.", 409);
          const name = getName(data.name);
          if (room.players.some((participant) => participant.name.toLowerCase() === name.toLowerCase())) {
            throw new GameError("That name is taken in this room. Try another.", 409);
          }
          member = player(name, pass, now);
          room.players.push(member);
          changed = true;
        } else if (!member) {
          throw new GameError("Enter your name to join this room.", 401);
        } else if (action && action !== "join") {
          changed = applyAction(room, member, action, data, now);
        } else {
          changed = updateLobbyPresence(room, member, now);
        }

        if (!changed) return json(snapshot(room, member, now, row.revision));
        const leaving = action === "leave";
        if (!leaving || activePlayers(room).length) advance(room, now);
        const result = leaving && !activePlayers(room).length
          ? await db.prepare("DELETE FROM rooms WHERE id = ? AND revision = ?").bind(id, row.revision).run()
          : await saveRoom(db, room, row.revision);
        if (result.meta.changes === 1) {
          return json(leaving ? { left: true } : snapshot(room, member, now, row.revision + 1));
        }
      }

      throw new GameError("The room is busy. Try again.", 503);
    } catch (error) {
      if (error instanceof GameError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "The room couldn’t sync. Try again." }, 500);
    }
  };
}

function saveRoom(db, room, revision) {
  return db.prepare("UPDATE rooms SET state = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
    .bind(JSON.stringify(room), room.id, revision).run();
}

export default {
  fetch(request, env) {
    return createHandler(env.DB)(request);
  },
};

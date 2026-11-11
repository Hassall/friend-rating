const INVITE_LIMIT = 20;
const ROUND_MS = 30_000;
const REVEAL_MS = 5_000;
const TRAIT_COUNT = 10;
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

async function hashToken(value) {
  if (!TOKEN.test(value ?? "")) throw new GameError("Your player pass is missing. Reopen the invite link.", 401);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function player(name, pass) {
  return { id: randomId(), name, pass, picks: null };
}

function topTraits(players) {
  const counts = TRAITS.map(() => 0);
  for (const member of players) {
    for (const trait of member.picks) counts[trait]++;
  }
  return counts.map((count, trait) => ({ count, trait }))
    .sort((a, b) => b.count - a.count || a.trait - b.trait)
    .slice(0, TRAIT_COUNT).map(({ trait }) => trait).sort((a, b) => a - b);
}

function timeline(room, now) {
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
    host: room.players[0].id,
    traits: room.traits,
    picks: member.picks,
    players: room.players.map(({ id, name, picks }) => ({ id, name, ready: Boolean(picks) })),
  };
  if (time.phase === "rating") {
    view.voted = Object.hasOwn(votes, member.id);
    view.voteCount = Object.keys(votes).length;
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
  if (action === "start") {
    if (member !== room.players[0]) throw new GameError("Only the host can start the game.", 403);
    if (phase !== "lobby") return false;
    if (room.players.length < 2) throw new GameError("Invite at least one friend first.");
    room.started = true;
    return true;
  }

  if (action === "picks") {
    if (member.picks) return false;
    if (phase !== "traits") throw new GameError("Trait selection has closed.", 409);
    const picks = data.picks;
    if (!Array.isArray(picks) || picks.length !== TRAIT_COUNT || new Set(picks).size !== TRAIT_COUNT ||
        !picks.every((id) => Number.isInteger(id) && id >= 0 && id < TRAITS.length)) {
      throw new GameError("Choose exactly 10 different traits.");
    }
    member.picks = picks;
    if (room.players.every((participant) => participant.picks)) {
      room.traits = topTraits(room.players);
      room.ratingAt = now + REVEAL_MS;
    }
    return true;
  }

  if (action === "vote") {
    if (phase !== "rating" || data.round !== round) throw new GameError("That round has ended.", 409);
    if (room.players[round].id === member.id) throw new GameError("It’s your turn in the spotlight.", 403);
    const votes = room.votes[round] ??= {};
    if (Object.hasOwn(votes, member.id)) return false;
    const points = data.points;
    if (!Array.isArray(points) || points.length !== TRAIT_COUNT ||
        !points.every((point) => Number.isInteger(point) && point >= 0 && point <= 100) ||
        points.reduce((sum, point) => sum + point, 0) !== 100) {
      throw new GameError("Split exactly 100 points across the ten traits.");
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
      const file = pathname === "/" || /^\/room\/[a-f0-9]{32}$/.test(pathname) ? "/index.html" : pathname;
      if (!Object.hasOwn(APP_ASSETS, file)) return new Response("Page not found", { status: 404, headers: HEADERS });
      const asset = APP_ASSETS[file];
      return new Response(asset.body, { headers: { ...HEADERS, "Content-Type": asset.type } });
    }

    try {
      const match = pathname.match(/^\/api\/rooms\/([a-f0-9]{32})(?:\/(join|start|picks|vote))?$/);
      const create = pathname === "/api/rooms" && method === "POST";
      const state = match && !match[2] && method === "GET";
      const mutate = match?.[2] && method === "POST";
      if (!(create || state || mutate)) throw new GameError("Room endpoint not found.", 404);
      const pass = await hashToken(request.headers.get("X-Player-Pass"));
      const data = method === "POST" ? await readBody(request) : {};
      if (create) {
        const host = player(getName(data.name), pass);
        const room = { id: randomId(), players: [host], started: false, traits: [], votes: {}, ratingAt: null };
        await db.prepare("INSERT INTO rooms (id, state) VALUES (?, ?)").bind(room.id, JSON.stringify(room)).run();
        return json(snapshot(room, host, clock(), 0), 201);
      }

      const [, id, action] = match;
      // Concurrent joins, picks, and ballots retry against the committed room revision.
      for (let attempt = 0; attempt < 40; attempt++) {
        const row = await db.prepare("SELECT revision, state FROM rooms WHERE id = ?").bind(id).first();
        if (!row) throw new GameError("This room link doesn’t exist.", 404);
        const room = JSON.parse(row.state);
        const now = clock();
        let member = room.players.find((participant) => participant.pass === pass);
        let changed = false;
        if (action === "join" && !member) {
          if (room.started) throw new GameError("This game has already started.", 409);
          if (room.players.length > INVITE_LIMIT) throw new GameError("This room is full.", 409);
          const name = getName(data.name);
          if (room.players.some((participant) => participant.name.toLowerCase() === name.toLowerCase())) {
            throw new GameError("That name is taken in this room. Try another.", 409);
          }
          member = player(name, pass);
          room.players.push(member);
          changed = true;
        } else if (!member) {
          throw new GameError("Enter your name to join this room.", 401);
        } else if (action && action !== "join") {
          changed = applyAction(room, member, action, data, now);
        }

        if (!changed) return json(snapshot(room, member, now, row.revision));
        const result = await db.prepare("UPDATE rooms SET state = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
          .bind(JSON.stringify(room), id, row.revision).run();
        if (result.meta.changes === 1) return json(snapshot(room, member, clock(), row.revision + 1));
      }

      throw new GameError("The room is busy. Try again.", 503);
    } catch (error) {
      if (error instanceof GameError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "The room couldn’t sync. Try again." }, 500);
    }
  };
}

export default {
  fetch(request, env) {
    return createHandler(env.DB)(request);
  },
};

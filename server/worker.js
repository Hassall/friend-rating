const INVITE_LIMIT = 20;
const LEGACY_ROUND_MS = 30_000;
const BREAK_MS = 4_000;
const REVEAL_MS = 5_000;
const TRAIT_COUNT = 10;
const QUESTION_COUNT = 10;
const CHOICE_MS = 30_000;
const GUESS_INTRO_MS = 5_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const LOBBY_LIFETIME_MS = 15 * MINUTE_MS;
const GAME_LIFETIME_MS = HOUR_MS;
const RECAP_LIFETIME_MS = 10 * MINUTE_MS;
const LOBBY_HEARTBEAT_MS = 15_000;
const HOST_TIMEOUT_MS = 60_000;
const ROOM_LIMIT = 6;
const LEGACY_EXPIRY = Date.UTC(2026, 10, 13);
const LEGACY_DEFAULT_TRAITS = ["Capper", "Chaotic", "Clutch", "Funny", "Good Listener", "Hype Friend", "Lore Keeper", "Night Owl", "Storyteller", "Yapper"];
const DEFAULT_TRAITS = ["Chill", "Creative", "Dependable", "Funny", "Good Listener", "Honest", "Kind", "Playful", "Storyteller", "Supportive"];
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

async function player(name, pass, now, country, browserId) {
  const browserKey = typeof browserId === "string" && TOKEN.test(browserId)
    ? await digest("activity:" + browserId) : null;
  return { id: randomId(), name, pass, picks: null, seen: now, joinedAt: now, country, browserKey };
}

function traitName(room, id) {
  return id >= CUSTOM_TRAIT_OFFSET ? room.customTraits[id - CUSTOM_TRAIT_OFFSET].name : TRAITS[id][0];
}

function traitKey(name) {
  return name.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function customTraitName(value) {
  const name = typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  if (Array.from(name).length > CUSTOM_TRAIT_LENGTH || !/^[\p{L}\p{N}\p{M} '&’.,!?()\-]+$/u.test(name) || !/\p{L}/u.test(name)) {
    throw new GameError("Use a short trait name with letters and up to 24 characters.");
  }
  return name;
}

function openTraitVoting(room, at) {
  const names = new Set(room.customTraits.map(({ name }) => traitKey(name)));
  room.traitPool = room.customTraits.map((_, i) => CUSTOM_TRAIT_OFFSET + i);
  for (const name of DEFAULT_TRAITS) {
    if (room.traitPool.length >= TRAIT_COUNT) break;
    if (!names.has(traitKey(name))) room.traitPool.push(TRAIT_IDS.find((id) => TRAITS[id][0] === name));
  }
  if (room.suggestLimit && room.traitPool.length === TRAIT_COUNT) {
    room.traits = topTraits(room);
    room.stage = { phase: "starting", deadline: at + BREAK_MS, next: 0 };
  } else {
    room.stage = { phase: "traits", deadline: at + (room.pickSeconds ?? DEFAULT_PICK_SECONDS) * 1000 };
  }
}

function topTraits(room) {
  const pool = room.traitPool ?? LEGACY_TRAIT_IDS;
  const defaults = room.traitPool ? DEFAULT_TRAITS : LEGACY_DEFAULT_TRAITS;
  const counts = new Map(pool.map((id) => [id, 0]));
  for (const member of room.players) {
    for (const trait of member.picks ?? []) counts.set(trait, (counts.get(trait) ?? 0) + 1);
  }
  const byName = (a, b) => traitName(room, a).localeCompare(traitName(room, b), "en");
  return [...pool]
    .sort((a, b) => counts.get(b) - counts.get(a) ||
      (!room.customTraits && !counts.get(a) && Number(defaults.includes(traitName(room, b))) - Number(defaults.includes(traitName(room, a)))) ||
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

  const round = Math.floor((now - room.ratingAt) / LEGACY_ROUND_MS);
  if (round < room.players.length) {
    return { phase: "rating", round, deadline: room.ratingAt + (round + 1) * LEGACY_ROUND_MS };
  }

  const revealAt = room.ratingAt + room.players.length * LEGACY_ROUND_MS;
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

function sampleQuestions(items, count) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

function promptText(prompt) {
  return "Who’s most likely to " + prompt + "?";
}

function promptResults(room) {
  return room.questions.slice(0, room.promptCount ?? 0).map((prompt, round) => {
    const counts = new Map();
    for (const id of Object.values(room.promptVotes[round] ?? {})) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const votes = Math.max(0, ...counts.values());
    const winners = room.players.filter(({ id }) => counts.get(id) === votes).map(({ id }) => id);
    return { question: promptText(prompt), winners, votes };
  });
}

function predictionQuestions(room) {
  const results = summarize(room).filter((result) => result.votes > 0);
  const traits = room.traits.flatMap((id, index) => {
    const compare = compareTrait(index);
    const [best] = [...results].sort(compare);
    if (!best?.totals[index]) return [];
    return [{
      question: "Who was rated highest for " + traitName(room, id) + "?",
      winners: results.filter((result) => compare(best, result) === 0).map(({ id }) => id),
    }];
  });
  const prompts = room.questions ? promptResults(room).filter(({ votes }) => votes) : [];
  const mixed = [...sampleQuestions(traits, QUESTION_COUNT / 2), ...sampleQuestions(prompts, QUESTION_COUNT / 2)];
  const remaining = [...traits, ...prompts].filter((question) => !mixed.includes(question));
  mixed.push(...sampleQuestions(remaining, QUESTION_COUNT - mixed.length));
  return sampleQuestions(mixed, QUESTION_COUNT);
}

function startGuessingOrReveal(room, at, activeCount) {
  if (room.options?.guessing && activeCount >= 2) {
    room.predictions = predictionQuestions(room);
    if (room.predictions.length) {
      room.guessVotes = {};
      room.stage = { phase: "guess-intro", deadline: at + GUESS_INTRO_MS };
      return;
    }
  }
  startReveal(room, at);
}

function startReveal(room, at) {
  room.stage = { phase: "reveal", revealAt: at };
  room.expiresAt = Math.min(room.expiresAt, at + TRAIT_COUNT * REVEAL_MS + RECAP_LIFETIME_MS);
}

function choiceVotes(room, phase) {
  return phase === "most-likely" ? room.promptVotes : room.guessVotes;
}

function advance(room, now) {
  if (!room.stage) return false;
  const active = activePlayers(room);
  let changed = false;
  while (true) {
    const { phase, deadline, round, next } = room.stage;
    if (phase === "suggestions" && (active.length < 2 || now >= deadline || active.every((member) => member.suggestionsReady))) {
      openTraitVoting(room, Math.min(now, deadline));
    } else if (phase === "traits" && (active.length < 2 || now >= deadline || active.every((member) => member.picks))) {
      room.players = active;
      room.traits = topTraits(room);
      room.stage = { phase: "starting", deadline: Math.min(now, deadline) + BREAK_MS, next: 0 };
    } else if ((phase === "starting" || phase === "break") && now >= deadline) {
      const target = room.players.findIndex((member, index) => index >= next && !member.left);
      if (target < 0 || active.length < 2) {
        if (room.options?.mostLikely && active.length >= 2) {
          room.promptCount = 1;
          room.stage = { phase: "most-likely", round: 0, deadline: deadline + CHOICE_MS };
        } else {
          startGuessingOrReveal(room, deadline, active.length);
        }
      } else {
        room.stage = { phase: "rating", round: target, deadline: deadline + (room.roundMs ?? LEGACY_ROUND_MS) };
      }
    } else if (phase === "rating") {
      const eligible = active.filter((member) => member !== room.players[round]);
      const locked = eligible.every((member) => Object.hasOwn(room.votes[round] ?? {}, member.id));
      if (now < deadline && !locked && !room.players[round].left) return changed;
      const nextRound = room.players.findIndex((member, index) => index > round && !member.left);
      room.stage = { phase: "break", deadline: Math.min(now, deadline) + BREAK_MS,
        next: nextRound >= 0 && active.length >= 2 ? nextRound : room.players.length };
    } else if (phase === "guess-intro" && (now >= deadline || active.length < 2)) {
      if (active.length < 2) {
        startReveal(room, Math.min(now, deadline));
      } else {
        room.stage = { phase: "guessing", round: 0, deadline: deadline + CHOICE_MS };
      }
    } else if (phase === "most-likely" || phase === "guessing") {
      const votes = choiceVotes(room, phase)[round] ?? {};
      if (now < deadline && active.length >= 2 && !active.every(({ id }) => Object.hasOwn(votes, id))) {
        return changed;
      }
      const at = Math.min(now, deadline);
      const total = phase === "most-likely" ? room.questions.length : room.predictions.length;
      if (round + 1 < total && active.length >= 2) {
        if (phase === "most-likely") room.promptCount = round + 2;
        room.stage = { phase, round: round + 1, deadline: at + CHOICE_MS };
      } else if (phase === "most-likely") {
        startGuessingOrReveal(room, at, active.length);
      } else {
        startReveal(room, at);
      }
    } else {
      return changed;
    }
    changed = true;
  }
}

function updatePresence(room, member, now) {
  if (now - (member.seen ?? 0) < LOBBY_HEARTBEAT_MS) return false;
  member.seen = now;
  if (!room.started) {
    const host = room.players.find(({ id }) => id === currentHost(room));
    if (host && now - (host.seen ?? 0) >= HOST_TIMEOUT_MS) room.host = member.id;
  }
  return true;
}

function summarize(room) {
  return room.players.map((member, round) => {
    const ballots = Object.values(room.votes[round] ?? {});
    const totals = room.traits.map((_, index) => ballots.reduce((sum, vote) => sum + vote[index], 0));
    return { id: member.id, votes: ballots.length, totals };
  });
}

function compareTrait(index) {
  return (a, b) => b.totals[index] * a.votes - a.totals[index] * b.votes;
}

function leadersFor(results, index) {
  const compare = compareTrait(index);
  const leaders = results.filter((result) => result.votes).sort(compare).slice(0, 3);
  let rank = 1;
  return leaders.map((result, i) => {
    if (i > 0 && compare(leaders[i - 1], result) !== 0) rank = i + 1;
    return { id: result.id, rank, average: result.totals[index] / result.votes };
  });
}

function guessScores(room) {
  const predictions = room.predictions ?? [];
  const scores = new Map();
  predictions.forEach(({ winners }, round) => {
    for (const [id, answer] of Object.entries(room.guessVotes[round] ?? {})) {
      scores.set(id, (scores.get(id) ?? 0) + Number(winners.includes(answer)));
    }
  });
  return room.players.filter(({ id }) => scores.has(id))
    .map(({ id }) => ({ id, score: scores.get(id) }))
    .sort((a, b) => b.score - a.score);
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
    traitPool: room.traitPool ?? LEGACY_TRAIT_IDS,
    roundSeconds: (room.roundMs ?? LEGACY_ROUND_MS) / 1000,
    pickSeconds: room.pickSeconds ?? DEFAULT_PICK_SECONDS,
    suggestSeconds: room.suggestSeconds ?? DEFAULT_SUGGEST_SECONDS,
    suggestLimit: room.suggestLimit ?? (room.customTraits ? null : DEFAULT_SUGGEST_LIMIT),
    options: room.options,
    picks: member.picks,
    players: room.players.map(({ id, name, picks, left }) => ({ id, name, ready: Boolean(picks), left: Boolean(left) })),
  };
  if (room.customTraits) {
    view.customTraits = room.customTraits.map(({ name }) => name);
    if (time.phase === "suggestions") {
      view.mySuggestions = room.customTraits.flatMap(({ author }, i) => author === member.id ? [i] : []);
      view.suggestionsReady = Boolean(member.suggestionsReady);
      view.suggestionsReadyCount = activePlayers(room).filter((player) => player.suggestionsReady).length;
    }
  }
  if (time.phase === "rating") {
    view.voted = Object.hasOwn(votes, member.id);
    view.ballot = votes[member.id] ?? null;
    view.eligibleCount = activePlayers(room).filter(({ id }) => id !== room.players[time.round].id).length;
    view.voteCount = activePlayers(room).filter(({ id }) => Object.hasOwn(votes, id)).length;
    view.canUnlock = Boolean(room.stage);
  }
  if (time.phase === "most-likely" || time.phase === "guessing") {
    const guessing = time.phase === "guessing";
    const ballots = choiceVotes(room, time.phase)[time.round] ?? {};
    const eligible = activePlayers(room);
    view.question = guessing ? room.predictions[time.round].question : promptText(room.questions[time.round]);
    view.questionCount = guessing ? room.predictions.length : room.questions.length;
    view.choiceSeconds = CHOICE_MS / 1000;
    view.choice = ballots[member.id] ?? null;
    view.eligibleCount = eligible.length;
    view.voteCount = eligible.filter(({ id }) => Object.hasOwn(ballots, id)).length;
  }
  if (time.phase === "guess-intro") {
    view.questionCount = room.predictions.length;
    view.choiceSeconds = CHOICE_MS / 1000;
    view.introSeconds = GUESS_INTRO_MS / 1000;
  }
  if (time.phase === "reveal") view.leaders = leadersFor(summarize(room), time.ranking);
  if (time.phase === "results") {
    view.results = summarize(room);
    view.rankings = room.traits.map((_, index) => leadersFor(view.results, index));
    if (room.promptCount) view.mostLikelyResults = promptResults(room);
    if (room.options?.guessing) {
      view.guessScores = guessScores(room);
      view.guessTotal = room.predictions?.length ?? 0;
      view.guessAnswers = room.predictions?.map(({ question, winners }) => ({ question, winners })) ?? [];
    }
  }
  return view;
}

function updateSettings(room, data) {
  if (Object.hasOwn(data, "pickSeconds")) {
    if (!PICK_SECONDS_OPTIONS.includes(data.pickSeconds)) throw new GameError("Choose an available trait selection time.");
    room.pickSeconds = data.pickSeconds;
  }
  if (Object.hasOwn(data, "suggestSeconds")) {
    if (!PICK_SECONDS_OPTIONS.includes(data.suggestSeconds)) throw new GameError("Choose an available suggestion time.");
    room.suggestSeconds = data.suggestSeconds;
  }
  if (Object.hasOwn(data, "suggestLimit")) {
    if (!SUGGEST_LIMIT_OPTIONS.includes(data.suggestLimit)) throw new GameError("Choose an available group suggestion limit.");
    room.suggestLimit = data.suggestLimit;
  }
  room.options ??= { mostLikely: false, guessing: false };
  for (const option of ["mostLikely", "guessing", "custom"]) {
    if (Object.hasOwn(data, option)) {
      if (typeof data[option] !== "boolean") throw new GameError("Choose an available game setting.");
      room.options[option] = data[option];
    }
  }
}

function applyAction(room, member, action, data, now) {
  const { phase, round } = timeline(room, now);
  if (action === "leave") {
    if (phase === "lobby" || phase === "suggestions" || phase === "traits") room.players = room.players.filter((player) => player !== member);
    else member.left = true;
    if (currentHost(room) === member.id) room.host = activePlayers(room)[0]?.id;
    if (phase === "rating") delete (room.votes[round] ?? {})[member.id];
    return true;
  }
  if (action === "start" || action === "settings") {
    if (member.id !== currentHost(room)) {
      throw new GameError(action === "start" ? "Only the host can start the game." : "Only the host can change game settings.", 403);
    }
    if (phase !== "lobby") {
      if (action === "settings") throw new GameError("The game has already started.", 409);
      return false;
    }
    updateSettings(room, data);
    if (action === "settings") return true;
    if (room.players.length < 2) throw new GameError("Invite at least one friend first.");
    room.started = true;
    room.startedAt = now;
    room.roundMs = RATING_SECONDS * 1000;
    room.traitPool = TRAIT_IDS;
    if (room.options.mostLikely) {
      room.questions = sampleQuestions(MOST_LIKELY_PROMPTS, QUESTION_COUNT);
      room.promptVotes = {};
    }
    const suggestionMs = room.options.custom ? (room.suggestSeconds ?? DEFAULT_SUGGEST_SECONDS) * 1000 : 0;
    if (room.options.custom) {
      room.customTraits = [];
      room.suggestLimit ??= DEFAULT_SUGGEST_LIMIT;
    }
    room.stage = suggestionMs ? { phase: "suggestions", deadline: now + suggestionMs }
      : { phase: "traits", deadline: now + (room.pickSeconds ?? DEFAULT_PICK_SECONDS) * 1000 };
    const extraRounds = Number(room.options.mostLikely) + Number(room.options.guessing);
    room.expiresAt = now + GAME_LIFETIME_MS + suggestionMs + extraRounds * QUESTION_COUNT * CHOICE_MS;
    return true;
  }

  if (action === "suggest-trait" || action === "remove-trait" || action === "ready-traits") {
    if (phase !== "suggestions") throw new GameError("Trait suggestions have closed.", 409);
    if (action === "ready-traits") {
      if (typeof data.ready !== "boolean") throw new GameError("Choose whether you’re done adding traits.");
      member.suggestionsReady = data.ready;
      return true;
    }
    if (member.suggestionsReady) throw new GameError("Choose Keep adding to edit your suggestions.");
    if (action === "remove-trait") {
      const index = room.customTraits.findIndex(({ key, author }) => key === traitKey(String(data.name ?? "")) && author === member.id);
      if (index < 0) throw new GameError("You can only remove your own suggestions.", 403);
      room.customTraits.splice(index, 1);
      return true;
    }
    const name = customTraitName(data.name);
    const key = traitKey(name);
    const existing = room.customTraits.find((trait) => trait.key === key);
    if (existing) throw new GameError("“" + existing.name + "” is already on the list.", 409);
    if (room.customTraits.filter(({ author }) => author === member.id).length >= CUSTOM_TRAIT_LIMIT) {
      throw new GameError("You can add up to five traits.");
    }
    if (room.suggestLimit && room.customTraits.length >= room.suggestLimit) {
      throw new GameError("The group list is full. Remove one of your suggestions to make room.", 409);
    }
    room.customTraits.push({ name, key, author: member.id });
    return true;
  }

  if (action === "choose" || action === "unlock-choice") {
    if ((phase !== "most-likely" && phase !== "guessing") || phase !== data.phase || round !== data.round) {
      throw new GameError("That question has ended.", 409);
    }
    const ballots = choiceVotes(room, phase)[round] ??= {};
    if (action === "unlock-choice") {
      delete ballots[member.id];
      return true;
    }
    if (Object.hasOwn(ballots, member.id)) return false;
    const candidates = phase === "most-likely" ? activePlayers(room) : room.players;
    if (!candidates.some(({ id }) => id === data.player)) throw new GameError("Choose a player in this room.");
    ballots[member.id] = data.player;
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
        !picks.every((id) => (room.traitPool ?? LEGACY_TRAIT_IDS).includes(id))) {
      throw new GameError("Choose exactly 10 different traits.");
    }
    member.picks = picks;
    if (!room.stage && room.players.every((participant) => participant.picks)) {
      room.traits = topTraits(room);
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

export function createHandler(db, clock = Date.now, ownerEmail) {
  async function handle(request) {
    const { pathname } = new URL(request.url);
    const { method } = request;

    if (["/admin", "/admin/", "/admin.html", "/admin.js", "/api/admin/activity"].includes(pathname)) {
      return handleAdmin(request, pathname, db, clock, ownerEmail);
    }

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
      const match = pathname.match(/^\/api\/rooms\/([a-f0-9]{32}|[A-Za-z0-9_-]{16})(?:\/(join|settings|start|suggest-trait|remove-trait|ready-traits|picks|unlock-picks|vote|unlock|choose|unlock-choice|leave))?$/);
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
        const host = await player(getName(data.name), pass, now, requestCountry(request), data.browserId);
        const bucket = Math.floor(now / HOUR_MS);
        const network = await digest(bucket + ":" + (request.headers.get("CF-Connecting-IP") ?? "local"));
        const limit = await db.prepare(
          "INSERT INTO room_limits (network, bucket, count) VALUES (?, ?, 1) " +
          "ON CONFLICT(network) DO UPDATE SET count = count + 1 WHERE count < ?",
        ).bind(network, bucket, ROOM_LIMIT).run();
        if (!limit.meta.changes) throw new GameError("This network has created too many rooms this hour. Try again later.", 429);
        await db.prepare("DELETE FROM room_limits WHERE bucket < ?").bind(bucket).run();
        await db.prepare("DELETE FROM site_activity WHERE rowid IN (SELECT rowid FROM site_activity WHERE occurred_at < ? LIMIT 100)")
          .bind(now - ACTIVITY_WINDOW_MS).run();
        await db.prepare("DELETE FROM rooms WHERE id IN (SELECT id FROM rooms WHERE json_extract(state, '$.expiresAt') <= ? LIMIT 30)")
          .bind(now).run();
        if (now >= LEGACY_EXPIRY) {
          await db.prepare("DELETE FROM rooms WHERE id IN (SELECT id FROM rooms WHERE json_extract(state, '$.expiresAt') IS NULL LIMIT ?)").bind(30).run();
        }
        const room = { id: inviteId(), players: [host], host: host.id, createdAt: now, started: false, traits: [], votes: {},
          stage: { phase: "lobby" }, expiresAt: now + LOBBY_LIFETIME_MS };
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
        const presenceChanged = member && !action && updatePresence(room, member, now);
        if (member && advance(room, now)) {
          const result = await saveRoom(db, room, row.revision);
          if (result.meta.changes) {
            if (now >= room.expiresAt) throw new GameError("This room has expired.", 410);
            if (!action) return json(snapshot(room, member, now, row.revision + 1));
          }
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
          member = await player(name, pass, now, requestCountry(request), data.browserId);
          room.players.push(member);
          changed = true;
        } else if (!member) {
          throw new GameError("Enter your name to join this room.", 401);
        } else if (action && action !== "join") {
          changed = applyAction(room, member, action, data, now);
        } else {
          changed = presenceChanged || updatePresence(room, member, now);
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
  }

  return async (request) => {
    const { pathname } = new URL(request.url);
    const roomApi = pathname === "/api/rooms" || pathname.startsWith("/api/rooms/");
    if (!roomApi || request.headers.get("Origin") !== PAGES_ORIGIN) return handle(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": PAGES_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "Content-Type, X-Player-Pass",
          "Access-Control-Max-Age": "600",
          "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
        },
      });
    }

    const response = await handle(request);
    response.headers.set("Access-Control-Allow-Origin", PAGES_ORIGIN);
    response.headers.append("Vary", "Origin");
    return response;
  };
}

function saveRoom(db, room, revision) {
  return db.prepare("UPDATE rooms SET state = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
    .bind(JSON.stringify(room), room.id, revision).run();
}

export default {
  fetch(request, env) {
    return createHandler(env.DB, Date.now, env.FRIEND_RATING_OWNER_EMAIL)(request);
  },
};

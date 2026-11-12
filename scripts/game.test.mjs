import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createHandler } from "../dist/server/index.js";
import * as traitConfig from "../web/traits.js";
import { LIVE_ORIGIN, PAGES_ORIGIN } from "../web/origins.js";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const db = {
    prepare(sql) {
      const query = sqlite.prepare(sql);
      return { bind: (...values) => ({
        first: () => query.get(...values),
        all: () => ({ results: query.all(...values) }),
        run: () => ({ meta: query.run(...values) }),
      }) };
    },
  };
  let now = Date.UTC(2026, 10, 12, 16);
  const handle = createHandler(db, () => now, "owner@example.test");
  const request = (path, token, body, headers = {}) => handle(new Request("https://example.test" + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Player-Pass": token.padStart(32, "0"), ...headers },
    body: body && JSON.stringify(body),
  }));
  const room = async (path, token, body, status = 200) => {
    const response = await request("/api/rooms" + path, token, body);
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  const open = async (...tokens) => {
    const host = await room("", tokens[0], { name: "Host" }, 201);
    const path = "/" + host.id;
    await Promise.all(tokens.slice(1).map((token) => room(path + "/join", token, { name: "Player " + token })));
    return { path, host };
  };
  return { room, open, request, setTime: (time) => { now = time; } };
}

test("concurrent joins, reconnect, host transfer, and closing an empty room", async (t) => {
  const { room, open, setTime } = fixture(t);
  const { path, host } = await open("a", "b", "c");
  const guest = await room(path, "b");
  assert.equal(guest.players.length, 3);
  assert.equal(guest.host, host.me);
  assert.equal((await room(path + "/join", "b", { name: "Repeated join" })).me, guest.me);
  await room(path + "/start", "b", {}, 403);
  setTime(host.now + 61_000);
  assert.equal((await room(path, "b")).host, guest.me);
  await room(path + "/leave", "b", {});
  assert.ok((await room(path, "a")).players.some((player) => player.id === host.me));
  await room(path + "/leave", "a", {});
  await room(path + "/leave", "c", {});
  await room(path, "a", undefined, 404);
});

test("concurrent joins respect the room limit and activity stays private", async (t) => {
  const { room, open, request } = fixture(t);
  const { path } = await open("a");
  const attempts = await Promise.all(Array.from({ length: 25 }, (_, i) =>
    request("/api/rooms" + path + "/join", (i + 32).toString(16), { name: "Friend " + i }, { Origin: PAGES_ORIGIN })));
  assert.equal(attempts.filter(({ status }) => status === 200).length, 20);
  assert.equal(attempts.filter(({ status }) => status === 409).length, 5);
  assert.ok(attempts.every(({ headers }) => headers.get("Access-Control-Allow-Origin") === PAGES_ORIGIN));
  assert.equal((await room(path, "a")).players.length, 21);
  const url = "/api/admin/activity";
  assert.equal((await request(url, "a")).status, 401);
  const auth = (email) => ({ "oai-authenticated-user-id": "verified-id", "oai-authenticated-user-email": email });
  assert.equal((await request(url, "a", undefined, auth("guest@example.test"))).status, 403);
  const response = await request(url, "a", undefined, auth("owner@example.test"));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.live.players, 21);
  assert.equal(data.live.rooms, 1);
  assert.doesNotMatch(JSON.stringify(data), /Friend [0-9]|room_id|player_id/);
});

test("default picks and ballots validate, unlock, and skip a departing player", async (t) => {
  const { room, open, setTime } = fixture(t);
  const { path, host } = await open("a", "b", "c");
  const start = await room(path + "/start", "a", { pickSeconds: 60 });
  assert.equal(start.deadline - start.now, 60_000);
  await room(path + "/picks", "a", { picks: Array(10).fill(start.traitPool[0]) }, 400);
  const picks = start.traitPool.slice(0, 10);
  await room(path + "/picks", "a", { picks });
  assert.deepEqual((await room(path, "a")).picks, picks);
  await room(path + "/unlock-picks", "a", {});
  const states = await Promise.all(["a", "b", "c"].map((id) => room(path + "/picks", id, { picks })));
  const transition = states.find(({ phase }) => phase === "starting");
  assert.ok(transition);
  setTime(transition.deadline);
  const rating = await room(path, "b");
  assert.equal(rating.phase, "rating");
  assert.equal(rating.players[rating.round].id, host.me);
  assert.equal(rating.deadline - rating.now, 120_000);
  const valid = { round: rating.round, points: Array(10).fill(10) };
  await room(path + "/vote", "a", valid, 403);
  await room(path + "/vote", "b", { ...valid, points: [9, 11, ...valid.points.slice(2)] }, 400);
  await room(path + "/vote", "b", valid);
  assert.deepEqual((await room(path, "b")).ballot, valid.points);
  assert.equal((await room(path + "/unlock", "b", valid)).voted, false);
  await room(path + "/leave", "c", {});
  const next = await room(path + "/vote", "b", valid);
  assert.equal(next.phase, "break");
  setTime(next.deadline);
  const second = await room(path, "a");
  assert.equal(second.phase, "rating");
  const finalBreak = await room(path + "/vote", "a", { ...valid, round: second.round });
  setTime(finalBreak.deadline + 50_000);
  const recap = await room(path, "a");
  assert.equal(recap.phase, "results");
  assert.deepEqual(recap.results.map(({ votes }) => votes).sort(), [0, 1, 1]);
});

test("prompt battles avoid avoidable self-pairing, hide authors, and count ties and suggestions", async (t) => {
  const { room, open, setTime } = fixture(t);
  const { path, host } = await open("a", "b", "c");
  const players = ["a", "b", "c"];
  let state = await room(path + "/start", "a", { custom: true, mostLikely: true, customPrompts: true, guessing: true, promptSuggestSeconds: 30 });
  await room(path + "/suggest-trait", "a", { name: "Quiet Hero" });
  for (const player of players) state = await room(path + "/ready-traits", player, { ready: true });
  while (["starting", "rating", "break"].includes(state.phase)) {
    setTime(state.deadline);
    state = await room(path, "a");
  }
  assert.equal(state.phase, "prompt-suggestions");
  assert.equal(state.deadline - state.now, 30_000);
  await room(path + "/suggest-prompt", "b", { name: "Bring snacks" });
  await room(path + "/suggest-prompt", "c", { name: "Who’s most likely to bring-snacks?" }, 409);
  await room(path + "/suggest-prompt", "c", { name: "Get lost" });
  await room(path + "/suggest-prompt", "a", { name: "Stay calm" });
  await room(path + "/suggest-prompt", "a", { name: "Make a playlist" });
  await room(path + "/suggest-prompt", "a", { name: "Start a band" }, 400);
  // Keep the initial order B, C, A, A; drawing B versus C first would force A versus A.
  const random = t.mock.method(Math, "random", () => 0.9999999);
  for (const player of players) state = await room(path + "/ready-prompts", player, { ready: true });
  random.mock.restore();
  assert.equal(state.battleCount, 2);
  assert.ok(state.battleOptions.every((option) => !("author" in option) && !("votes" in option)));
  const [first, second] = state.battleOptions.map(({ id }) => id);
  await room(path + "/battle-vote", "a", { round: 0, prompt: first });
  await room(path + "/battle-vote", "b", { round: 0, prompt: second });
  setTime(state.deadline);
  state = await room(path, "a");
  assert.equal(state.phase, "prompt-battle-reveal");
  assert.equal(new Set(state.battleOptions.map(({ author }) => author)).size, 2);
  assert.equal(state.battleOptions.filter(({ won }) => won).length, 2);
  assert.equal(state.battleScores.reduce((sum, { score }) => sum + score, 0), 2);
  setTime(state.deadline);
  state = await room(path, "a");
  setTime(state.deadline);
  state = await room(path, "a");
  assert.equal(new Set(state.battleOptions.map(({ author }) => author)).size, 2);
  assert.ok(state.battleOptions.every(({ won }) => !won));
  setTime(state.deadline);
  state = await room(path, "a");
  assert.equal(state.phase, "most-likely");
  assert.equal(state.questionCount, 10);
  const prompts = new Set();
  await room(path + "/choose", "a", { phase: state.phase, round: 0, player: host.me });
  while (state.phase === "most-likely") {
    prompts.add(state.question);
    setTime(state.deadline);
    state = await room(path, "a");
  }
  assert.equal(prompts.size, 10);
  for (const prompt of ["bring snacks", "get lost", "stay calm", "make a playlist"]) assert.ok(prompts.has("Who’s most likely to " + prompt + "?"));
  assert.equal(state.phase, "guess-intro");
  setTime(state.deadline);
  state = await room(path, "a");
  assert.equal(state.phase, "guessing");
  assert.equal(state.questionCount, 1);
  await room(path + "/choose", "a", { phase: state.phase, round: 0, player: host.me });
  setTime(state.deadline + 50_000);
  const recap = await room(path, "a");
  assert.equal(recap.phase, "results");
  assert.equal(recap.suggestionScores.find(({ id }) => id === host.me).traits, 1);
  assert.equal(recap.suggestionScores.reduce((sum, { total }) => sum + total, 0), 7);
  assert.deepEqual(recap.guessScores, [{ id: host.me, score: 1 }]);
});

test("room links open with browser storage blocked, and stale room actions return home", async () => {
  const app = {};
  const header = { dataset: {} };
  const location = { origin: PAGES_ORIGIN, pathname: "/r/abcdefghijklmnop", hash: "" };
  const context = {
    ...traitConfig, LIVE_ORIGIN, PAGES_ORIGIN, location, performance, AbortSignal,
    document: {
      querySelector: (selector) => ({
        "#app": app, "#header-status": header, "#entry": { addEventListener() {} },
      })[selector] ?? null,
    },
    window: {
      get localStorage() { throw new DOMException("Storage blocked", "SecurityError"); },
      get sessionStorage() { throw new DOMException("Storage blocked", "SecurityError"); },
    },
    history: { replaceState: (_, __, path) => { location.pathname = path; } },
    fetch: async () => Response.json({ error: "This room has expired." }, { status: 410 }),
    setInterval() {}, clearTimeout() {},
  };
  app.addEventListener = () => {};
  const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  runInNewContext(source.slice(source.indexOf("const app =")), context);
  assert.match(app.innerHTML, /Join room/);
  assert.equal(runInNewContext('draftStore.set("draft", "saved"); draftStore.get("draft")', context), "saved");
  await runInNewContext('pass = "a".repeat(32); room = { phase: "results" }; send("leave", {}, {})', context);
  assert.equal(location.pathname, "/");
  assert.match(app.innerHTML, /Create a room/);
});

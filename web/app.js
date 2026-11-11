import { POINT_STEP, TRAITS } from "./traits.js";

const app = document.querySelector("#app");
const header = document.querySelector("#header-status");
const announcement = document.querySelector("#announcement");
const PALETTE = ["#d7fa77", "#bca4ff", "#ff9bc9", "#9fe8fa", "#ffc98c", "#c9a9c0"];
const ICONS = {
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2m2 6a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M2 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m2-16a3 3 0 0 1 0 6m4 10v-2a5 5 0 0 0-3-4"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  tick: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trophy: '<path d="M7 4h10v7a5 5 0 0 1-10 0V4Zm0 1H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4m-5 5v4m-4 0h8"/>',
};

const LIVE_ORIGIN = "https://friend-rating-after-hours.corkyravioli5.chatgpt.site";
const SHORT_INVITE = "https://is.gd/Fzi0MX";
const roomFragment = location.pathname === "/" && location.hash.match(/^#r=([A-Za-z0-9_-]{16})$/)?.[1];
if (roomFragment) history.replaceState(null, "", invitePath(roomFragment));
const roomPath = location.pathname.match(/^\/(?:r|room)\/([a-f0-9]{32}|[A-Za-z0-9_-]{16})$/);
const sortedTraits = TRAITS.map(([name], index) => ({ name, index }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));
let roomId = roomPath?.[1];
let pass = roomId ? localStorage.getItem("player:" + roomId) : null;
let room = null;
let viewKey = "";
let chosen = new Set();
let points = [];
let resultId = null;
let busy = false;
let offset = 0;
let pollTimer;
let syncFailed = false;

function html(value) {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, (character) => escapes[character]);
}

function icon(name, size = 18) {
  return '<svg aria-hidden="true" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
    ICONS[name] + '</svg>';
}

function say(message) {
  announcement.textContent = message;
}

function notice(message = "") {
  const error = document.querySelector("#error") ?? document.querySelector("#room-error");
  if (error) error.textContent = message;
}

function setStatus() {
  const text = syncFailed ? "Reconnecting…" : "Private room";
  const glyph = syncFailed ? "clock" : "lock";
  const key = roomId ? text + Boolean(room) : "";
  if (header.dataset.status === key) return;
  header.dataset.status = key;
  header.innerHTML = roomId ? '<span class="private-tag">' + icon(glyph, 15) + text + '</span>' +
    (room ? '<button type="button" class="button compact quiet" id="leave">Leave room</button><span class="error" id="room-error" role="alert"></span>' : '') : "";
  document.querySelector("#leave")?.addEventListener("click", (event) => send("leave", {}, event.currentTarget));
}

function invitePath(id) {
  return (id.length === 16 ? "/r/" : "/room/") + id;
}

function avatar(member, size = "") {
  const index = room?.players.indexOf(member) ?? 0;
  const initials = member.name.split(" ").slice(0, 2).map((word) => Array.from(word)[0]).join("").toUpperCase();
  return '<span class="avatar ' + size + '" style="--avatar:' + PALETTE[Math.max(0, index) % PALETTE.length] +
    '" aria-hidden="true">' + html(initials) + '</span>';
}

function stageNav(step) {
  const stages = ["Lobby", "Pick traits", "Rate friends", "Results"];
  return '<nav class="stage-nav" aria-label="Game progress"><ol>' + stages.map((stage, i) =>
    '<li class="' + (i === step ? "current" : i < step ? "past" : "") + '"' +
    (i === step ? ' aria-current="step"' : "") + '><span class="stage-number">' +
    (i < step ? icon("tick", 13) : i + 1) + '</span>' + stage + '</li>'
  ).join("") + '</ol></nav>';
}

function renderWelcome(message = "") {
  setStatus();
  const joining = Boolean(roomId);
  const sample = [3, 9, 11, 13, 18, 22, 23, 24, 1, 2];
  app.innerHTML = '<div class="welcome"><section class="welcome-copy">' +
    '<div class="kicker"><span></span>' + (joining ? "INVITE TO PLAY" : "THE GROUP CHAT PARTY GAME") + '</div>' +
    '<h1>' + (joining ? 'You’re <em>invited.</em>' : 'Rate your<br><em>friends.</em>') + '</h1>' +
    '<p class="welcome-description">' + (joining
      ? "Enter the name your friends know you by to join their room."
      : "Pick 10 traits, rate your friends, and see who comes out on top.") + '</p>' +
    '<form id="entry" class="entry panel"><label for="name">Your display name</label>' +
    '<div class="entry-controls"><input id="name" name="name" maxlength="24" required autocomplete="nickname" placeholder="e.g. Mooncake">' +
    '<button class="button primary" type="submit">' + (joining ? "Join room" : "Create a room") + icon("arrow") + '</button></div>' +
    '<p class="entry-note">' + icon("lock", 15) + (joining ? "This invite is for one private game." : "Private invite link · Up to 20 friends") + '</p>' +
    '<div id="error" role="alert" class="error"></div></form></section>' +
    '<aside class="preview" aria-label="Example results">' +
    '<div class="preview-stars" aria-hidden="true"><span>✧</span><span>✦</span><span>✧</span></div>' +
    '<div class="preview-card"><div class="preview-header">' + avatar({ name: "Jordan" }) +
    '<div><strong>Jordan</strong><span>Example results</span></div><span class="example-trophy">' + icon("trophy", 22) + '</span></div>' +
    radar(sample, [5, 23, 9, 16, 4, 19, 5, 11, 4, 4], 25) + '</div></aside></div>' +
    '<section class="how" aria-label="How to play">' +
    [['people', "Invite your crew", "Share one private link."], ['tick', "Pick 10 traits", "The most popular picks make the cut."],
     ['clock', "Rate each friend", "Give out 100 points in 30 seconds."], ['trophy', "See the rankings", "Reveal the top three for each trait."]]
      .map(([glyph, title, line]) => '<article class="how-step"><div class="how-icon">' + icon(glyph) +
        '</div><div><h2>' + title + '</h2><p>' + line + '</p></div></article>').join("") + '</section>';
  notice(message);
  document.querySelector("#entry").addEventListener("submit", enterRoom);
}

function renderLobby() {
  const isHost = room.me === room.host;
  const directUrl = location.origin + invitePath(room.id);
  const url = location.origin === LIVE_ORIGIN && room.id.length === 16
    ? SHORT_INVITE + "#r=" + room.id : directUrl;
  app.innerHTML = stageNav(0) + '<div class="page-heading"><div><h1>Get the crew in.</h1>' +
    '<p>' + (isHost ? "Share the invite link, then start when everyone’s here." : "You’re in. The host will start when everyone’s here.") + '</p></div></div>' +
    '<div class="lobby-layout"><section class="panel roster"><div class="panel-heading"><h2>In the room</h2><span class="small-pill">' +
    icon("people", 15) + room.players.length + ' / 21</span></div><ul class="roster-list">' +
    room.players.map((member) => '<li>' + avatar(member) + '<span class="player-name">' + html(member.name) + '</span>' +
      (member.id === room.host ? '<span class="host-tag">Host</span>' : "") +
      (member.id === room.me ? '<span class="muted player-you">You</span>' : "") + '</li>').join("") + '</ul></section>' +
    '<section class="panel invite"><span class="panel-icon">' + icon("link", 23) + '</span><h2>Invite your friends</h2>' +
    '<p>Anyone with this invite can join while the lobby is open.</p>' +
    '<label class="sr-only" for="invite-url">Private invite link</label><input id="invite-url" readonly value="' + html(url) + '">' +
    '<button class="button secondary" id="copy">' + icon("link") + 'Copy invite link</button>' +
    (url !== directUrl ? '<button type="button" class="button compact quiet" id="copy-direct">Copy direct link</button>' : '') +
    (isHost ? '<div class="start-area"><button class="button primary" id="start"' + (room.players.length < 2 ? " disabled" : "") +
      '>Start game' + icon("arrow") + '</button><p>' + (room.players.length < 2 ? "Invite at least one friend to start." : "Joining closes when the game starts.") + '</p></div>'
      : '<p class="start-area waiting-line"><span class="dot"></span>Waiting for the host</p>') +
    '<div id="error" role="alert" class="error"></div></section></div>';
  document.querySelector("#copy").addEventListener("click", (event) => copyInvite(url, event.currentTarget));
  document.querySelector("#copy-direct")?.addEventListener("click", (event) => copyInvite(directUrl, event.currentTarget));
  document.querySelector("#start")?.addEventListener("click", (event) => send("start", {}, event.currentTarget));
}

async function copyInvite(url, control) {
  try {
    await navigator.clipboard.writeText(url);
    control.innerHTML = icon("tick") + "Link copied";
    say("Invite link copied.");
  } catch {
    const input = document.querySelector("#invite-url");
    if (!input) return;
    input.value = url;
    input.select();
    say("Invite link selected. Press Control+C or Command+C to copy.");
  }
}

function renderTraits() {
  const locked = Boolean(room.picks);
  if (locked) chosen = new Set(room.picks);
  app.innerHTML = stageNav(1) + '<div class="page-heading"><div><h1>' +
    (locked ? "Your picks are in." : "Pick 10 traits.") + '</h1><p>' +
    (locked ? "Review your picks or unlock them while selection is open." : "Choose the traits you want in the game. The ten most popular make the cut.") +
    '</p></div><span class="small-pill ready-count" id="ready-count"></span></div>' +
    '<section class="panel trait-panel" aria-label="Available traits"><div class="trait-grid">' +
    sortedTraits.map(({ index }) => {
      const [name, description, glyph] = TRAITS[index];
      return (
      '<button class="trait-choice" type="button" data-trait="' + index + '" aria-pressed="' + chosen.has(index) + '"' +
      (locked ? " disabled" : "") + '><span class="trait-glyph" aria-hidden="true">' + glyph +
      '</span><span class="trait-text"><strong>' + name + '</strong><small>' + description +
      '</small></span><span class="pick-check">' + icon("tick", 14) + '</span></button>');
    }).join("") + '</div></section>' +
    '<div class="selection-bar panel"><div class="pick-meter"><strong id="selection-count"></strong><div class="pips" aria-hidden="true">' +
    Array.from({ length: 10 }, () => "<span></span>").join("") + '</div></div>' +
    (room.deadline ? '<span class="small-pill pick-clock">' + icon("clock", 15) + '<span data-clock="120"></span></span>' : "") +
    (locked ? '<button id="unlock-picks" class="button secondary">Unlock picks</button>' :
      '<button id="submit-picks" class="button primary">Submit picks' + icon("arrow") + '</button>') + '</div>' +
    '<div id="error" role="alert" class="error"></div>';
  document.querySelector(".trait-grid").addEventListener("click", (event) => {
    const control = event.target.closest("[data-trait]");
    if (!control || locked || busy || (room.deadline && !timeLeft())) return;
    const index = Number(control.dataset.trait);
    if (chosen.has(index)) chosen.delete(index);
    else if (chosen.size < 10) chosen.add(index);
    updateChoices();
    say(chosen.size + " of 10 traits selected");
  });
  document.querySelector("#submit-picks")?.addEventListener("click", (event) =>
    send("picks", { picks: [...chosen] }, event.currentTarget));
  document.querySelector("#unlock-picks")?.addEventListener("click", (event) =>
    send("unlock-picks", {}, event.currentTarget));
  updateChoices();
}

function updateChoices() {
  const locked = Boolean(room.picks);
  document.querySelectorAll("[data-trait]").forEach((control) => {
    const checked = chosen.has(Number(control.dataset.trait));
    control.setAttribute("aria-pressed", String(checked));
    if (!locked) control.setAttribute("aria-disabled", String(chosen.size >= 10 && !checked));
  });
  document.querySelector("#selection-count").textContent = chosen.size + " / 10 selected";
  document.querySelectorAll(".pips span").forEach((pip, i) => pip.classList.toggle("filled", i < chosen.size));
  const submit = document.querySelector("#submit-picks");
  if (submit) submit.disabled = chosen.size !== 10 || Boolean(room.deadline && !timeLeft());
}

function renderStarting() {
  app.innerHTML = stageNav(2) + '<section class="panel centered transition-panel"><span class="panel-icon">✦</span>' +
    '<h1>The traits are locked.</h1><p>Get ready to rate. Each friend gets 30 seconds in the spotlight.</p>' +
    '<ul class="locked-traits">' + room.traits.map((id) => '<li>' + TRAITS[id][0] + '</li>').join("") +
    '</ul><div class="countdown large" data-clock="4"></div></section>';
}

function renderBreak() {
  const next = room.players.slice(room.next).find((member) => !member.left);
  const moreRounds = next && room.players.filter((member) => !member.left).length >= 2;
  app.innerHTML = stageNav(2) + '<section class="panel centered transition-panel">' +
    '<p class="round-label">Round closed</p><h1>' +
    (moreRounds ? (next.id === room.me ? 'You’re up next.' : 'Up next · ' + html(next.name)) : 'Trait rankings are next.') +
    '</h1><div class="countdown large" data-clock="4"></div></section>';
}

function renderRating() {
  const target = room.players[room.round];
  const ownRound = room.me === target.id;
  const locked = room.voted;
  if (locked && room.ballot) {
    points = [...room.ballot];
    sessionStorage.setItem("draft:" + roomId + ":" + room.round, JSON.stringify(points));
  } else if (!ownRound) {
    try {
      const saved = JSON.parse(sessionStorage.getItem("draft:" + roomId + ":" + room.round));
      points = Array.isArray(saved) && saved.length === 10 &&
        saved.every((value) => Number.isInteger(value) && value >= 0) &&
        saved.reduce((sum, value) => sum + value, 0) <= 100
        ? saved.map((value) => Math.floor(value / POINT_STEP) * POINT_STEP)
        : Array(10).fill(0);
    } catch {
      points = Array(10).fill(0);
    }
  }
  app.innerHTML = stageNav(2) + '<div class="page-heading rating-heading"><div><div class="round-label">Round ' +
    (room.round + 1) + ' of ' + room.players.length + '</div><h1>' +
    (ownRound ? "You’re in the spotlight." : "Rate " + html(target.name) + ".") + '</h1></div></div>' +
    '<div class="rating-layout"><aside class="panel rating-aside">' + avatar(target, "avatar-large") +
    '<strong class="spotlight-name">' + html(target.name) + '</strong><div class="countdown" data-clock="30"></div>' +
    '<p class="muted">Time left</p><span class="small-pill" id="vote-count"></span>' +
    (ownRound || locked ? "" : '<span class="mobile-budget" id="remaining-mobile"></span>') + '</aside>' +
    (ownRound
      ? '<section class="panel centered round-wait"><span class="panel-icon">' + icon("people", 28) +
        '</span><h2>Your friends are voting</h2><p>Sit tight while the group rates you.</p></section>'
      : '<section class="panel point-panel"><div class="point-heading"><div><h2>' + (locked ? "Vote locked in" : "Rate their traits") + '</h2>' +
        (locked ? '<p>' + (room.canUnlock ? "You can unlock while this round is open." : "Waiting for the round to end.") + '</p></div></div>'
          : '<p>Use +5 and −5 to give out all 100 points.</p></div><div class="point-budget"><strong id="remaining">100</strong><span>points left</span></div></div>' +
            '<div class="budget-bar" aria-hidden="true"><span id="budget-fill"></span></div>') +
        '<div class="point-grid' + (locked ? ' locked-ballot' : '') + '">' + room.traits.map((id, index) => {
          const [name, , glyph] = TRAITS[id];
          return '<div class="point-row" data-point-row="' + index + '"><span class="point-trait"><span class="row-glyph" aria-hidden="true">' +
            glyph + '</span>' + name + '</span><div class="stepper">' +
            '<button type="button" data-index="' + index + '" data-step="remove" aria-label="Remove 5 points from ' + name + '"' + (locked ? " disabled" : "") + '>−5</button>' +
            '<span class="point-value" data-point="' + index + '">' + points[index] + '</span>' +
            '<button type="button" data-index="' + index + '" data-step="add" aria-label="Add 5 points to ' + name + '"' + (locked ? " disabled" : "") + '>+5</button>' +
            '</div></div>';
        }).join("") + '</div>' +
        (locked ? (room.canUnlock ? '<div class="point-actions"><button class="button secondary" id="unlock">Unlock vote</button></div>' : '')
          : '<div class="point-actions"><div class="point-shortcuts">' +
        '<button id="even" class="button compact secondary" type="button">Split evenly</button>' +
        '<button id="fill" class="button compact secondary" type="button" title="Split leftover points among the traits you’ve already given points to">Fill remaining</button>' +
        '<button id="reset" class="button compact quiet" type="button">Reset</button></div>' +
        '<button class="button primary" id="vote">Lock in vote' + icon("tick") + '</button></div>') +
        '<div id="error" role="alert" class="error"></div></section>') + '</div>';
  document.querySelector("#unlock")?.addEventListener("click", (event) =>
    send("unlock", { round: room.round }, event.currentTarget));
  if (ownRound || locked) return;
  const grid = document.querySelector(".point-grid");
  grid.addEventListener("click", (event) => {
    const control = event.target.closest("[data-step]");
    if (!control || control.disabled || !timeLeft()) return;
    const i = Number(control.dataset.index);
    points[i] += control.dataset.step === "add" ? POINT_STEP : -POINT_STEP;
    updatePoints();
    say(TRAITS[room.traits[i]][0] + " has " + points[i] + " points. " + remaining() + " points left.");
  });
  document.querySelector("#even").onclick = () => {
    points.fill(10);
    updatePoints();
    say("10 points per trait. Ready to lock in.");
  };
  document.querySelector("#fill").onclick = () => {
    const chunks = remaining() / POINT_STEP;
    const preferred = points.map((point, i) => ({ point, i })).filter(({ point }) => point > 0).map(({ i }) => i);
    const indices = preferred.length ? preferred : points.map((_, i) => i);
    const share = Math.floor(chunks / indices.length);
    indices.forEach((i, position) => {
      points[i] += POINT_STEP * (share + Number(position < chunks % indices.length));
    });
    updatePoints();
    say("All 100 points assigned. Ready to lock in.");
  };
  document.querySelector("#reset").onclick = () => {
    points.fill(0);
    updatePoints();
    say("Points reset.");
  };
  document.querySelector("#vote").onclick = (event) => send("vote", {
    points: [...points], round: room.round,
  }, event.currentTarget);
  updatePoints();
}

function remaining() {
  return 100 - points.reduce((sum, point) => sum + point, 0);
}

function updatePoints() {
  const rest = remaining();
  sessionStorage.setItem("draft:" + roomId + ":" + room.round, JSON.stringify(points));
  document.querySelector("#remaining").textContent = rest;
  document.querySelector("#remaining-mobile").textContent = rest + " points left";
  document.querySelector("#budget-fill").style.width = (100 - rest) + "%";
  document.querySelector("#vote").disabled = Boolean(rest || timeLeft() <= 0);
  document.querySelector("#fill").disabled = !rest;
  document.querySelector("#reset").disabled = rest === 100;
  document.querySelectorAll("[data-point-row]").forEach((row) => {
    const index = Number(row.dataset.pointRow);
    row.querySelector("[data-point]").textContent = points[index];
    row.classList.toggle("has-points", points[index] > 0);
    row.querySelector('[data-step="remove"]').disabled = points[index] === 0;
    row.querySelector('[data-step="add"]').disabled = rest === 0;
  });
}

function renderReveal() {
  const [name, , glyph] = TRAITS[room.traits[room.ranking]];
  app.innerHTML = stageNav(3) + '<section class="panel reveal centered"><div class="confetti" aria-hidden="true">' +
    Array.from({ length: 18 }, (_, i) => '<i style="--piece:' + i + ';--confetti:' + PALETTE[i % PALETTE.length] + '"></i>').join("") +
    '</div><div class="round-label">Trait rankings · ' + (room.ranking + 1) + ' of 10</div>' +
    '<div class="reveal-glyph" aria-hidden="true">' + glyph + '</div><h1>' + name + '</h1>' +
    (room.leaders.length ? '<p>Top three by average points</p>' + rankingList(room.leaders) : '<p>No votes this time.</p>') +
    '<div class="reveal-track" aria-hidden="true"><span id="reveal-fill"></span></div></section>';
}

function rankingList(leaders) {
  return '<ol class="ranking-list">' + leaders.map(({ id, rank, average }) => {
    const member = room.players.find((friend) => friend.id === id);
    return '<li><span class="rank-place" aria-label="Rank ' + rank + '">#' + rank + '</span>' +
      avatar(member) + '<strong class="rank-name">' + html(member.name) + '</strong>' +
      '<span class="rank-average"><strong>' + average.toFixed(1) + '</strong> avg</span></li>';
  }).join("") + '</ol>';
}

function radar(traits, scores, max) {
  const count = traits.length;
  const radius = 118;
  const centerX = 222;
  const centerY = 166;
  const position = (i, r) => {
    const angle = Math.PI * (i * 2 / count - 0.5);
    return [centerX + r * Math.cos(angle), centerY + r * Math.sin(angle)];
  };
  const polygon = (values) => values.map((value, i) => position(i, value).map((n) => n.toFixed(1)).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1].map((scale) =>
    '<polygon class="radar-ring" points="' + polygon(traits.map(() => radius * scale)) + '"/>'
  ).join("");
  const spokes = traits.map((_, i) => {
    const [x, y] = position(i, radius);
    return '<line class="radar-ring" x1="' + centerX + '" y1="' + centerY + '" x2="' + x + '" y2="' + y + '"/>';
  }).join("");
  const labels = traits.map((id, i) => {
    const [x, y] = position(i, radius + 13);
    const alignment = x < centerX - 4 ? "end" : x > centerX + 4 ? "start" : "middle";
    const words = TRAITS[id][0].split(" ");
    return '<text class="radar-label" x="' + x + '" y="' + (y + 4 - (words.length - 1) * 6) + '" text-anchor="' + alignment + '">' +
      words.map((word, line) => '<tspan x="' + x + '" dy="' + (line ? 13 : 0) + '">' + word + '</tspan>').join("") + '</text>';
  }).join("");
  const radii = scores.map((score) => radius * score / max);
  const shape = '<polygon class="radar-fill" points="' + polygon(radii) + '"/>';
  const dots = radii.map((r, i) => {
    const [x, y] = position(i, r);
    return '<circle class="radar-dot" cx="' + x + '" cy="' + y + '" r="3.3"/>';
  }).join("");
  return '<svg aria-hidden="true" class="radar" viewBox="0 18 444 296" xmlns="http://www.w3.org/2000/svg">' +
    rings + spokes + shape + dots + labels + '</svg>';
}

function renderResults() {
  const allScores = room.results.flatMap(({ totals, votes }) => totals.map((total) => total / (votes || 1)));
  const max = Math.max(10, Math.ceil(Math.max(...allScores) / 5) * 5);
  const selected = room.players.find(({ id }) => id === resultId);
  app.innerHTML = stageNav(3) + '<div class="page-heading"><div><h1>The group chat verdict.</h1>' +
    '<p>Explore everyone’s scores and revisit the trait rankings.</p></div>' +
    (selected ? '<button class="button secondary compact" type="button" data-everyone>View everyone</button>' : '') +
    '</div>' + (selected ? playerProfile(selected, max) : allPlayers(max)) +
    '<section class="panel all-rankings"><div class="panel-heading"><h2>' + icon("trophy") + 'Trait rankings</h2>' +
    '<span class="muted ranking-caption">Average points per vote</span></div><div class="ranking-grid">' +
    room.traits.map((id, i) =>
      '<article><h3><span class="row-glyph" aria-hidden="true">' + TRAITS[id][2] + '</span>' + TRAITS[id][0] + '</h3>' +
      (room.rankings[i].length ? rankingList(room.rankings[i]) : '<p class="muted">No votes</p>') + '</article>'
    ).join("") + '</div></section>';
}

function chartScale(max) {
  return '<p class="muted chart-note">Average points per vote · Shared scale 0–' + max + '</p>';
}

function allPlayers(max) {
  return '<section class="everyone-results"><div class="panel-heading"><div><h2>Everyone</h2>' + chartScale(max) +
    '</div><span class="small-pill">' + icon("people", 15) + room.players.length + ' players</span></div>' +
    '<div class="chart-grid">' + room.players.map((member, i) => {
      const result = room.results[i];
      return '<button class="panel chart-card" type="button" data-result="' + member.id + '">' +
        '<span class="chart-card-heading">' + avatar(member) + '<span><strong>' + html(member.name) + '</strong>' +
        '<small>' + voteLabel(result.votes) + (member.id === room.me ? " · You" : "") + '</small></span>' +
        '<span class="chart-arrow">' + icon("arrow", 16) + '</span></span>' +
        (result.votes ? radar(room.traits, result.totals.map((total) => total / result.votes), max)
          : '<span class="empty-chart muted">No votes were submitted.</span>') + '</button>';
    }).join("") + '</div></section>';
}

function voteLabel(count) {
  return count + " / " + (room.players.length - 1) + " votes";
}

function playerProfile(member, max) {
  const result = room.results.find(({ id }) => id === member.id);
  const scores = result.totals.map((total) => total / (result.votes || 1));
  return '<div class="result-layout"><section class="panel results-people"><h2>Players</h2><ul>' + room.players.map((friend) =>
      '<li><button type="button" data-result="' + friend.id + '" aria-pressed="' + (friend.id === resultId) + '">' +
      avatar(friend) + '<span>' + html(friend.name) + '</span>' + (friend.id === room.me ? '<small>You</small>' : '') + '</button></li>').join("") +
    '</ul></section><section class="panel result-profile"><div class="panel-heading">' +
    '<h2>' + html(member.name) + '’s stats</h2><span class="small-pill">' + voteLabel(result.votes) + '</span></div>' +
    (result.votes ? '<div class="result-scores">' + radar(room.traits, scores, max) +
      '<ul aria-label="Average points per trait">' + room.traits.map((id, i) =>
        '<li><span>' + TRAITS[id][0] + '</span><strong>' + Number(scores[i].toFixed(1)) + '</strong></li>').join("") + '</ul></div>' +
      chartScale(max) : '<p class="empty-result">No votes were submitted for this player.</p>') + '</section></div>';
}

app.addEventListener("click", (event) => {
  const control = event.target.closest("[data-result], [data-everyone]");
  if (!control) return;
  const old = resultId;
  resultId = control.dataset.result ?? null;
  if (old === resultId) return;
  renderResults();
  document.querySelector('[data-result="' + (resultId ?? old) + '"]').focus();
});

function timeLeft() {
  return room?.deadline ? Math.max(0, room.deadline - (Date.now() + offset)) : 0;
}

function updateTimer() {
  const ms = timeLeft();
  const clock = document.querySelector("[data-clock]");
  if (clock) {
    const seconds = Math.ceil(ms / 1000);
    const duration = Number(clock.dataset.clock);
    clock.textContent = duration >= 30 ? Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") : seconds;
    clock.setAttribute("aria-label", seconds + " seconds left");
    clock.style.setProperty("--progress", Math.min(100, ms / (duration * 10)) + "%");
    clock.classList.toggle("urgent", seconds <= 5 && clock.dataset.clock === "30");
  }
  const reveal = document.querySelector("#reveal-fill");
  if (reveal) reveal.style.width = (ms / 50) + "%";
  if (room?.deadline && !ms) {
    document.querySelectorAll("#vote, #unlock, #submit-picks, #unlock-picks")
      .forEach((control) => { control.disabled = true; });
  }
}

function renderRoom() {
  setStatus();
  const rosterKey = room.phase === "lobby" || room.phase === "break"
    ? room.players.map(({ id, left }) => id + Number(left)).join(",") : "";
  const key = [room.phase, room.round, room.ranking, room.voted, Boolean(room.picks), room.host, rosterKey].join(":");
  if (viewKey !== key) {
    const [oldPhase, oldRound] = viewKey.split(":");
    viewKey = key;
    const renderers = {
      lobby: renderLobby, traits: renderTraits, starting: renderStarting, rating: renderRating,
      break: renderBreak, reveal: renderReveal, results: renderResults,
    };
    renderers[room.phase]();
    if (room.phase === "reveal") say(app.querySelector("h1").textContent + ". " + app.querySelector(".reveal").innerText);
    else if (oldPhase !== room.phase || (room.phase === "rating" && oldRound !== String(room.round))) {
      say(app.querySelector("h1")?.textContent ?? "");
    }
  }
  const ready = document.querySelector("#ready-count");
  if (ready) ready.textContent = room.players.filter(({ ready }) => ready).length + " / " + room.players.length + " ready";
  const votes = document.querySelector("#vote-count");
  if (votes) votes.textContent = room.voteCount + " / " + room.eligibleCount + " voted";
  updateTimer();
}

async function api(path, data, token = pass) {
  const response = await fetch("/api/rooms" + path, {
    method: data ? "POST" : "GET",
    headers: { "X-Player-Pass": token, ...(data ? { "Content-Type": "application/json" } : {}) },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(6500),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "The room couldn’t sync. Try again.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function accept(next, sentAt) {
  if (!next.phase) throw new Error("The room couldn’t sync. Try again.");
  if (room && (next.revision < room.revision || (next.revision === room.revision && next.now < room.now))) return;
  room = next;
  offset = next.now - (sentAt + Date.now()) / 2;
  syncFailed = false;
  renderRoom();
}

async function enterRoom(event) {
  event.preventDefault();
  if (busy) return;
  const form = event.currentTarget;
  const control = form.querySelector("button");
  const name = new FormData(form).get("name").trim();
  if (!name) return notice("Enter a display name to continue.");
  busy = control.disabled = true;
  notice();
  try {
    const token = pass || Array.from(crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    pass = token;
    const sentAt = Date.now();
    const next = await api(roomId ? "/" + roomId + "/join" : "", { name }, token);
    roomId = next.id;
    localStorage.setItem("player:" + roomId, token);
    history.replaceState(null, "", invitePath(roomId));
    accept(next, sentAt);
    schedulePoll();
  } catch (error) {
    notice(error.message);
  } finally {
    busy = control.disabled = false;
  }
}

async function send(action, data, control) {
  if (busy) return;
  busy = control.disabled = true;
  notice();
  try {
    const sentAt = Date.now();
    const next = await api("/" + roomId + "/" + action, data);
    busy = false;
    if (next.left) {
      exitRoom("You left the room.");
    } else {
      accept(next, sentAt);
    }
  } catch (error) {
    notice(error.message);
  } finally {
    busy = false;
    if (control.isConnected) control.disabled = Boolean(action !== "leave" && room?.deadline && !timeLeft());
  }
}

function exitRoom(message) {
  clearTimeout(pollTimer);
  localStorage.removeItem("player:" + roomId);
  roomId = pass = room = null;
  viewKey = "";
  syncFailed = false;
  resultId = null;
  chosen = new Set();
  history.replaceState(null, "", "/");
  renderWelcome(message);
}

function schedulePoll(delay = 900) {
  clearTimeout(pollTimer);
  if (room?.phase !== "results") pollTimer = setTimeout(poll, delay);
}

async function poll() {
  if (!roomId || !pass) return;
  const pollingRoom = roomId;
  try {
    const sentAt = Date.now();
    const next = await api("/" + pollingRoom);
    if (pollingRoom !== roomId) return;
    accept(next, sentAt);
  } catch (error) {
    if (pollingRoom !== roomId) return;
    if ([404, 410].includes(error.status) || (room && error.status === 401)) {
      exitRoom(error.message);
      return;
    }
    if (!room && error.status === 401) {
      renderWelcome();
      return;
    }
    syncFailed = true;
    setStatus();
  }
  schedulePoll(room?.deadline && timeLeft() < 1600 ? 300 : 900);
}

if (roomId && pass) {
  setStatus();
  app.innerHTML = '<p class="waiting-line loading"><span class="dot"></span>Opening the room…</p>';
  poll();
} else {
  renderWelcome();
}
setInterval(updateTimer, 100);

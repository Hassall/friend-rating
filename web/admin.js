const status = document.querySelector("#activity-status");
const refresh = document.querySelector("#refresh-activity");
const entries = document.querySelector("#player-entries");
const cards = document.querySelectorAll("[data-metric]");
const number = new Intl.NumberFormat();
const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
let loading = false;

function showPlayers(players, emptyMessage) {
  const rows = players.map(({ name, host, joinedAt }) => {
    const row = document.createElement("tr");
    for (const value of [name, host ? "Host" : "Guest", timestamp.format(joinedAt)]) {
      const cell = row.insertCell();
      cell.textContent = value;
    }
    return row;
  });
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = row.insertCell();
    cell.colSpan = 3;
    cell.textContent = emptyMessage;
    rows.push(row);
  }
  entries.replaceChildren(...rows);
}

async function loadActivity() {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  try {
    const response = await fetch("/api/admin/activity", { signal: AbortSignal.timeout(6500) });
    if (response.status === 401 || response.status === 403) {
      for (const card of cards) {
        card.querySelector("strong").textContent = "—";
        card.querySelector("small").textContent = "";
      }
      showPlayers([], "Sign in to view player entries.");
      status.textContent = "Reload this page to sign in as the site owner.";
      return;
    }
    if (!response.ok) throw new Error("Site activity is temporarily unavailable.");
    const activity = await response.json();
    const counts = new Map(activity.counts.map((item) => [item.kind, item]));
    for (const card of cards) {
      const { total = 0, today = 0 } = counts.get(card.dataset.metric) ?? {};
      card.querySelector("strong").textContent = number.format(total);
      card.querySelector("small").textContent = number.format(today) + " in the last 24 hours";
    }
    showPlayers(activity.players, "No player entries yet.");
    status.textContent = "Updated " + timestamp.format(activity.now);
  } catch {
    status.textContent = "Couldn’t refresh site activity. Try again shortly.";
  } finally {
    loading = false;
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", loadActivity);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadActivity();
});
setInterval(() => {
  if (!document.hidden) loadActivity();
}, 15_000);
loadActivity();

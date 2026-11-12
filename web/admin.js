const status = document.querySelector("#activity-status");
const refresh = document.querySelector("#refresh-activity");
const cards = document.querySelectorAll("[data-metric]");
const trendSelect = document.querySelector("#trend-metric");
const trend = document.querySelector("#activity-trend");
const countries = document.querySelector("#activity-countries");
const durations = document.querySelector("#activity-durations");
const sizes = document.querySelector("#activity-sizes");
const modes = document.querySelector("#activity-modes");
const completionRate = document.querySelector("#completion-rate");
const completionDetail = document.querySelector("#completion-detail");
const averageDuration = document.querySelector("#average-duration");
const durationDetail = document.querySelector("#duration-detail");
const livePlayers = document.querySelector("#live-players");
const liveRooms = document.querySelector("#live-rooms");
const liveRoomDetail = document.querySelector("#live-room-detail");
const number = new Intl.NumberFormat();
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dayLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const countryLabel = new Intl.DisplayNames(navigator.languages, { type: "region" });
const DAY_MS = 86_400_000;
const DURATION_LABELS = { under_5: "Under 5 minutes", "5_to_10": "5 to under 10 minutes",
  "10_to_20": "10 to under 20 minutes", "20_to_40": "20 to under 40 minutes", "40_plus": "40 minutes or more" };
const SIZE_LABELS = { "2": "2 players", "3_to_5": "3–5 players", "6_to_10": "6–10 players",
  "11_plus": "11–21 players", unknown: "Unknown size" };
const MODE_LABELS = { classic: "Trait ratings only", most_likely: "Most Likely To",
  guessing: "Guess the Winners", both: "Both optional rounds", unknown: "Unknown settings" };
let loading = false;
let activity = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderTrend() {
  if (!activity) return;
  const metric = trendSelect.value;
  const data = new Map(activity.daily.filter(({ kind }) => kind === metric).map(({ day, count }) => [day, count]));
  const firstDay = Math.floor(activity.now / DAY_MS) - activity.trendDays + 1;
  const max = Math.max(1, ...data.values());
  const chart = element("ol", "", "activity-trend");
  chart.setAttribute("aria-label", trendSelect.selectedOptions[0].textContent + " by day");
  for (let i = 0; i < activity.trendDays; i++) {
    const day = firstDay + i;
    const count = data.get(day) ?? 0;
    const date = dayLabel.format(day * DAY_MS);
    const column = element("li", "", "trend-column");
    column.setAttribute("aria-label", date + ", " + number.format(count));
    const track = element("div", "", "trend-track");
    const bar = element("span", "", "trend-bar");
    bar.style.height = (count / max) * 100 + "%";
    track.append(bar);
    column.append(element("strong", number.format(count), "trend-value"), track, element("span", date, "trend-label"));
    chart.append(column);
  }
  trend.replaceChildren(chart);
}

function renderBreakdown(container, entries, emptyMessage) {
  if (!entries.length) {
    container.replaceChildren(element("p", emptyMessage, "muted activity-empty"));
    return;
  }
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const list = element("ul", "", "activity-breakdown");
  for (const { label, count } of entries) {
    const row = element("li");
    const header = element("div", "", "breakdown-label");
    const share = count / total;
    header.append(element("span", label), element("strong", number.format(count) + " · " + percent.format(share)));
    const track = element("div", "", "breakdown-track");
    const bar = element("span");
    bar.style.width = share * 100 + "%";
    track.setAttribute("aria-hidden", "true");
    track.append(bar);
    row.append(header, track);
    list.append(row);
  }
  container.replaceChildren(list);
}

function labeledBuckets(rows, labels) {
  return Object.entries(labels).flatMap(([bucket, label]) => {
    const value = rows.find((row) => row.bucket === bucket);
    return value ? [{ label, count: value.count }] : [];
  });
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
}

function renderActivity() {
  const live = activity.live;
  livePlayers.textContent = number.format(live.players);
  liveRooms.textContent = number.format(live.rooms);
  liveRoomDetail.textContent = [
    number.format(live.lobbies) + " waiting",
    number.format(live.playing) + " playing",
    number.format(live.results) + " at results",
  ].join(" · ");
  const counts = new Map(activity.counts.map((item) => [item.kind, item]));
  for (const card of cards) {
    const { total = 0, today = 0 } = counts.get(card.dataset.metric) ?? {};
    card.querySelector("strong").textContent = number.format(total);
    card.querySelector("small").textContent = number.format(today) + " in the last 24 hours";
  }
  const sizeGroups = activity.gameGroups.filter(({ category }) => category === "size");
  const started = sizeGroups.reduce((sum, group) => sum + group.count, 0);
  const completed = sizeGroups.reduce((sum, group) => sum + group.finished, 0);
  completionRate.textContent = started ? percent.format(completed / started) : "—";
  completionDetail.textContent = started ? number.format(completed) + " of " + number.format(started) + " games started" : "No games started yet";
  const measured = activity.durations.reduce((sum, group) => sum + group.count, 0);
  const totalDuration = activity.durations.reduce((sum, group) => sum + group.totalMs, 0);
  averageDuration.textContent = measured ? formatDuration(totalDuration / measured) : "—";
  durationDetail.textContent = measured ? number.format(measured) + (measured === 1 ? " finished game" : " finished games") : "No finished games yet";
  renderTrend();
  const knownCountries = activity.countries.filter(({ country }) => country);
  const topCountries = knownCountries.slice(0, 12).map(({ country, count }) => ({ label: countryLabel.of(country) ?? country, count }));
  const otherCount = knownCountries.slice(12).reduce((sum, item) => sum + item.count, 0);
  if (otherCount) topCountries.push({ label: "Other countries", count: otherCount });
  const unknown = activity.countries.find(({ country }) => !country);
  if (unknown) topCountries.push({ label: "Unknown country", count: unknown.count });
  renderBreakdown(countries, topCountries, "No player entries yet.");
  renderBreakdown(durations, labeledBuckets(activity.durations, DURATION_LABELS), "No game lengths recorded yet.");
  renderBreakdown(sizes, labeledBuckets(sizeGroups, SIZE_LABELS), "No games started yet.");
  renderBreakdown(modes, labeledBuckets(activity.gameGroups.filter(({ category }) => category === "mode"), MODE_LABELS), "No games started yet.");
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
      activity = null;
      for (const field of [livePlayers, liveRooms, completionRate, averageDuration]) field.textContent = "—";
      for (const field of [liveRoomDetail, completionDetail, durationDetail]) field.textContent = "";
      for (const section of [trend, countries, durations, sizes, modes]) section.replaceChildren();
      status.textContent = "Reload this page to sign in as the site owner.";
      return;
    }
    if (!response.ok) throw new Error("Site activity is temporarily unavailable.");
    activity = await response.json();
    renderActivity();
    status.textContent = "Updated " + timestamp.format(activity.now);
  } catch {
    status.textContent = "Couldn’t refresh site activity. Try again shortly.";
  } finally {
    loading = false;
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", loadActivity);
trendSelect.addEventListener("change", renderTrend);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadActivity();
});
setInterval(() => {
  if (!document.hidden) loadActivity();
}, 15_000);
loadActivity();

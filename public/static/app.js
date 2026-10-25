const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let units = store.get("units", "metric");
let place = store.get("place", null);
let chart = null;
let reqId = 0;
const DEFAULT_PLACE = { name: "London", region: "England, United Kingdom", lat: 51.5072, lon: -0.1276 };

/* ---------- units ---------- */
function paintUnits() {
  document.querySelectorAll(".toggle button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.units === units)));
}
document.querySelectorAll(".toggle button").forEach((b) =>
  b.addEventListener("click", () => {
    units = b.dataset.units; store.set("units", units); paintUnits();
    if (place) load(place);
  }));

/* ---------- search ---------- */
const input = $("q"), list = $("results");
let timer;
input.addEventListener("input", () => {
  clearTimeout(timer);
  const q = input.value.trim();
  if (q.length < 2) { list.hidden = true; return; }
  timer = setTimeout(() => search(q), 250);
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) list.hidden = true; });

async function search(q) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error((await res.json()).detail);
    const items = await res.json();
    list.replaceChildren();
    if (!items.length) {
      const li = document.createElement("li");
      li.textContent = "No places found. Try a different spelling.";
      li.style.cssText = "padding:9px 12px;color:var(--muted)";
      list.append(li);
    }
    items.forEach((p) => {
      const li = document.createElement("li"), b = document.createElement("button");
      b.type = "button"; b.textContent = p.name;
      const s = document.createElement("small"); s.textContent = p.region; b.append(s);
      b.addEventListener("click", () => { list.hidden = true; input.value = ""; showNotice(""); load(p); });
      li.append(b); list.append(li);
    });
    list.hidden = false;
  } catch (e) { showError(e.message || "Search failed."); }
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 600000 });
  });
}

async function loadCurrentLocation() {
  const { latitude: lat, longitude: lon } = (await getPosition()).coords;
  showNotice("");
  let name = "Your location", region = "";
  try {
    const r = await fetch(`/api/reverse?lat=${lat}&lon=${lon}`);
    if (r.ok) ({ name, region } = await r.json());
  } catch {}
  await load({ name, region, lat, lon });
}

$("locate").addEventListener("click", async () => {
  try { await loadCurrentLocation(); }
  catch { showError("Location access was blocked. Search for a city instead."); }
});

/* ---------- load + render ---------- */
function setEmpty(title, text) {
  $("empty-title").textContent = title; $("empty-text").textContent = text; $("empty").hidden = false;
}
function showNotice(msg) { const el = $("notice"); el.textContent = msg; el.hidden = !msg; }
function showError(msg) { const el = $("error"); el.textContent = msg; el.hidden = !msg; }

async function load(p) {
  place = p; store.set("place", p); showError("");
  const id = ++reqId;
  const qs = new URLSearchParams({ lat: p.lat, lon: p.lon, name: p.name, units });
  if ($("view").hidden) setEmpty("Loading the forecast…", "");
  try {
    const res = await fetch(`/api/forecast?${qs}`);
    if (!res.ok) throw new Error((await res.json()).detail);
    const data = await res.json();
    if (id !== reqId) return;
    render(data, p);
    Sky.show(data);
    $("empty").hidden = true; $("view").hidden = false;
    loadSummary(qs, id);
  } catch (e) {
    $("view").hidden = true;
    setEmpty("Where are you headed?", "Search for a city to see the forecast and a short written summary.");
    showError(e.message || "Something went wrong.");
  }
}

async function loadSummary(qs, id) {
  const el = $("summary");
  el.className = "summary-text loading"; el.textContent = "Writing your summary…"; $("source").textContent = "";
  try {
    const res = await fetch(`/api/summary?${qs}`);
    const s = await res.json();
    if (id !== reqId) return;
    el.className = "summary-text"; el.textContent = s.text;
    $("source").textContent =
      s.source === "ai" ? "Written by AI from the forecast data."
      : s.source === "no_key" ? `Basic summary. ${s.reason || "Add GROQ_API_KEY to .env for an AI-written one."}`
      : `Basic summary. ${s.reason || "The AI summary is unavailable right now."}`;
  } catch { el.className = "summary-text"; el.textContent = "Summary unavailable right now."; }
}

const fmt = (n) => Math.round(n);
const weekday = (d, i) => i === 0 ? "Today" : new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short" });

function render(d, p) {
  const c = d.current, u = d.units;
  $("place").textContent = [p.name, p.region].filter(Boolean).join(", ");
  $("temp").textContent = fmt(c.temp); $("deg").textContent = u.temp;
  $("cond").textContent = c.label;
  $("feels").textContent = `${fmt(c.feels)}${u.temp}`;
  $("humidity").textContent = `${c.humidity}%`;
  $("wind").textContent = `${fmt(c.wind)} ${u.wind}`;

  const lo = Math.min(...d.daily.map((x) => x.min)), hi = Math.max(...d.daily.map((x) => x.max));
  const span = hi - lo || 1;
  $("days").replaceChildren(...d.daily.map((x, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong></strong><span class="label"></span><span class="rain"></span>
      <span class="bar"><span></span></span><span class="range"></span>`;
    const [day, label, rain, bar, range] = li.children;
    day.textContent = weekday(x.date, i);
    label.textContent = x.label;
    rain.textContent = `${x.precip}%`;
    const left = ((x.min - lo) / span) * 100, width = ((x.max - x.min) / span) * 100;
    Object.assign(bar.firstElementChild.style, { left: `${left}%`, width: `${Math.max(width, 6)}%` });
    range.textContent = `${fmt(x.min)}° / ${fmt(x.max)}°`;
    return li;
  }));
  drawChart(d);
}

function drawChart(d) {
  const labels = d.hourly.map((h) => new Date(h.time).toLocaleTimeString(undefined, { hour: "numeric" }));
  const tick = "rgba(255,255,255,.78)", grid = "rgba(255,255,255,.14)";
  const cfg = {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Rain chance (%)", data: d.hourly.map((h) => h.precip), yAxisID: "r",
          backgroundColor: "rgba(255,255,255,.22)", borderRadius: 4, order: 2 },
        { type: "line", label: `Temperature (${d.units.temp})`, data: d.hourly.map((h) => h.temp), yAxisID: "t",
          borderColor: "#ffffff", backgroundColor: "#ffffff", tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 3, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: "rgba(10,16,35,.92)", padding: 10 },
      },
      scales: {
        x: { ticks: { color: tick, maxTicksLimit: 8 }, grid: { display: false } },
        t: { position: "left", grace: "10%", ticks: { color: tick, callback: (v) => `${Math.round(v)}°` }, grid: { color: grid } },
        r: { position: "right", min: 0, max: 100, ticks: { color: tick, callback: (v) => v + "%" }, grid: { display: false } },
      },
    },
  };
  if (chart) chart.destroy();
  chart = new Chart($("chart"), cfg);
}

/* ---------- boot: start with where you are ---------- */
async function boot() {
  paintUnits();
  setEmpty("Finding your location…", "Allow location access to see the weather where you are.");
  try {
    await loadCurrentLocation();
  } catch {
    const fallback = place || DEFAULT_PLACE;
    await load(fallback);
    showNotice(`Location is off, so you're seeing ${fallback.name}. Use “Use my location” any time.`);
  }
}
boot();

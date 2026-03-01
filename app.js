// app.js

/* =========================
   TSV HELPERS
========================= */
async function loadTSV(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  const text = await res.text();
  return parseTSV(text);
}

function parseTSV(tsvText) {
  const lines = tsvText
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trimEnd())
    .filter(l => l.trim().length);

  if (!lines.length) return [];

  const headers = lines[0].split("\t").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split("\t");
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] ?? "").trim());
    return obj;
  });
}

function norm(s) { return (s ?? "").trim(); }

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   THEME TOGGLE
========================= */
const THEME_KEY = "ids4_theme_mode";

function applyTheme(mode){
  const btn = document.getElementById("themeToggle");
  if(mode === "dark"){
    document.body.classList.add("dark-mode");
    if (btn) btn.textContent = "LIGHT";
  } else {
    document.body.classList.remove("dark-mode");
    if (btn) btn.textContent = "DARK";
  }
}

function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === "dark" ? "dark" : "light");

  const btn = document.getElementById("themeToggle");
  if(!btn) return;
  btn.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark-mode");
    const newMode = isDark ? "light" : "dark";
    localStorage.setItem(THEME_KEY, newMode);
    applyTheme(newMode);
  });
}

/* =========================
   WINDOW / PANEL TOGGLES
========================= */
const DOCK_KEY = "ids4_dock_visibility_v1";

function getDockState() {
  try {
    const raw = localStorage.getItem(DOCK_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === "object") return obj;
  } catch {}
  return {
    boxPrd: true,
    boxNavaid: true,
    boxMain: true,
    boxWx: true,
    boxRunway: true,
    boxRvr: true
  };
}

function saveDockState(state) {
  localStorage.setItem(DOCK_KEY, JSON.stringify(state));
}

function setPanelVisible(panelId, visible) {
  const el = document.getElementById(panelId);
  if (!el) return;
  el.classList.toggle("isHidden", !visible);
}

function syncDockButtons(state) {
  const btns = document.querySelectorAll(".dockBtn[data-target]");
  btns.forEach(b => {
    const target = b.getAttribute("data-target");
    const on = !!state[target];
    b.classList.toggle("isOn", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function applyDockState(state) {
  Object.keys(state).forEach(id => setPanelVisible(id, !!state[id]));
  syncDockButtons(state);

  const leftWrap = document.querySelector(".leftStack");
  const rightWrap = document.querySelector(".rightStack");
  const mainBox = document.getElementById("boxMain");

  if (leftWrap) {
    const anyLeftOn = !!state.boxPrd || !!state.boxNavaid;
    leftWrap.classList.toggle("isHidden", !anyLeftOn);
  }
  if (rightWrap) {
    const anyRightOn = !!state.boxWx || !!state.boxRunway || !!state.boxRvr;
    rightWrap.classList.toggle("isHidden", !anyRightOn);
  }
  if (mainBox) {
    mainBox.classList.toggle("isHidden", !state.boxMain);
  }
}

function wireDock() {
  const state = getDockState();
  applyDockState(state);

  const wrap = document.getElementById("btnGrid");
  if (!wrap) return;

  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".dockBtn[data-target]");
    if (!btn) return;

    const target = btn.getAttribute("data-target");
    const cur = getDockState();
    cur[target] = !cur[target];
    saveDockState(cur);
    applyDockState(cur);
  });
}

/* =========================
   NAVAID + AIRPORT SUPPORT
========================= */
const KLGA_LAT = 40.7772;
const KLGA_LON = -73.8726;

let navaidsRows = [];
let navaidByIdent = new Map();
let navaidSearchIndex = [];

let airportsRows = [];
let airportByIdent = new Map();
let airportSearchIndex = [];

function toNumberOrNaN(v) {
  const n = Number(norm(v));
  return Number.isFinite(n) ? n : NaN;
}

function haversineNM(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = deg => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function freqDisplayFromFrequencyKhz(raw) {
  const s = norm(raw);
  if (!s) return "(unknown)";

  const n = Number(s);
  if (!Number.isFinite(n)) return s;

  if (n >= 100000) return `${(n / 1000).toFixed(2)} MHz`;
  return `${n} kHz`;
}

function buildNavaidMaps(rows) {
  navaidByIdent = new Map();
  navaidSearchIndex = [];

  for (const r of rows) {
    const ident = norm(r.ident).toUpperCase();
    if (!ident) continue;

    const lat = toNumberOrNaN(r.latitude_deg);
    const lon = toNumberOrNaN(r.longitude_deg);

    const hasPos = Number.isFinite(lat) && Number.isFinite(lon);
    const dist = hasPos ? haversineNM(KLGA_LAT, KLGA_LON, lat, lon) : Infinity;

    const obj = {
      KIND: "NAVAID",
      IDENT: ident,
      NAME: norm(r.name),
      TYPE: norm(r.type).toUpperCase(),
      FREQ_RAW: norm(r.frequency_khz),
      FREQ_DISPLAY: freqDisplayFromFrequencyKhz(r.frequency_khz),
      LAT: lat,
      LON: lon,
      DIST_NM: dist
    };

    if (!navaidByIdent.has(ident)) navaidByIdent.set(ident, []);
    navaidByIdent.get(ident).push(obj);

    const key = `${obj.IDENT} ${obj.NAME} ${obj.TYPE}`.toUpperCase();
    navaidSearchIndex.push({ ...obj, key });
  }

  for (const [, list] of navaidByIdent.entries()) {
    list.sort((a, b) => (a.DIST_NM - b.DIST_NM) || a.NAME.localeCompare(b.NAME));
  }

  navaidSearchIndex.sort((a, b) =>
    (a.DIST_NM - b.DIST_NM) || a.IDENT.localeCompare(b.IDENT)
  );
}

function buildAirportMaps(rows) {
  airportByIdent = new Map();
  airportSearchIndex = [];

  for (const r of rows) {
    const ident = norm(r.ident).toUpperCase();
    if (!ident) continue;

    const obj = { KIND: "AIRPORT", IDENT: ident, NAME: norm(r.name) };
    if (!airportByIdent.has(ident)) airportByIdent.set(ident, obj);

    const key = `${obj.IDENT} ${obj.NAME} AIRPORT APT HELIPORT`.toUpperCase();
    airportSearchIndex.push({ ...obj, key });
  }

  airportSearchIndex.sort((a, b) => a.IDENT.localeCompare(b.IDENT));
}

function setInfoDefault() {
  const info = document.getElementById("navaidInfo");
  if (info) info.textContent = "";
}

function setNavaidInfoText(obj) {
  const info = document.getElementById("navaidInfo");
  if (!info) return;
  if (!obj) return setInfoDefault();

  const latStr = Number.isFinite(obj.LAT) ? obj.LAT.toFixed(6) : "(unknown)";
  const lonStr = Number.isFinite(obj.LON) ? obj.LON.toFixed(6) : "(unknown)";
  const distStr = Number.isFinite(obj.DIST_NM) && obj.DIST_NM !== Infinity
    ? `${obj.DIST_NM.toFixed(1)} NM`
    : "(unknown)";

  info.textContent =
    `KIND:  NAVAID\n` +
    `IDENT: ${obj.IDENT}\n` +
    `TYPE:  ${obj.TYPE || "(unknown)"}\n` +
    `FREQ:  ${obj.FREQ_DISPLAY}\n` +
    `NAME:  ${obj.NAME || "(unknown)"}\n` +
    `LAT:   ${latStr}\n` +
    `LON:   ${lonStr}\n` +
    `DIST:  ${distStr} (from KLGA)`;
}

function setAirportInfoText(obj) {
  const info = document.getElementById("navaidInfo");
  if (!info) return;
  if (!obj) return setInfoDefault();

  info.textContent =
    `KIND:  AIRPORT\n` +
    `IDENT: ${obj.IDENT}\n` +
    `TYPE:  AIRPORT\n` +
    `NAME:  ${obj.NAME || "(unknown)"}`;
}

function renderOverlaps(ident, selectedIndex = 0) {
  const wrap = document.getElementById("navaidOverlaps");
  if (!wrap) return;

  const key = norm(ident).toUpperCase();
  const list = navaidByIdent.get(key) || [];

  if (!list.length) {
    wrap.innerHTML = `<div class="console" style="min-height:auto;">No overlaps.</div>`;
    return;
  }

  wrap.innerHTML = list.map((o, idx) => {
    const distStr = Number.isFinite(o.DIST_NM) && o.DIST_NM !== Infinity
      ? `${o.DIST_NM.toFixed(1)} NM`
      : "—";
    const style = idx === selectedIndex ? `style="background: rgba(255,204,0,.10);"` : "";

    return `
      <div class="navaidOverlapRow" data-ident="${escHtml(o.IDENT)}" data-idx="${idx}" ${style}>
        <div class="ovIdent">${escHtml(o.IDENT)}</div>
        <div class="ovType">${escHtml(o.TYPE || "-")}</div>
        <div class="ovName">${escHtml(o.NAME || "-")}</div>
        <div class="ovDist">${escHtml(distStr)}</div>
      </div>
    `;
  }).join("");
}

function setOverlapsBlank() {
  const el = document.getElementById("navaidOverlaps");
  if (!el) return;
  el.innerHTML = `<div class="console" style="min-height:auto;">—</div>`;
}

function selectNavaid(ident, idx = 0) {
  const key = norm(ident).toUpperCase();
  const list = navaidByIdent.get(key);

  if (!list || !list.length) {
    setInfoDefault();
    const el = document.getElementById("navaidOverlaps");
    if (el) el.innerHTML = `<div class="console" style="min-height:auto;">No NAVAID data for IDENT: ${escHtml(key)}</div>`;
    return;
  }

  const safeIdx = Math.max(0, Math.min(Number(idx) || 0, list.length - 1));
  setNavaidInfoText(list[safeIdx]);
  renderOverlaps(key, safeIdx);
}

function selectAirport(ident) {
  const key = norm(ident).toUpperCase();
  const apt = airportByIdent.get(key);
  setAirportInfoText(apt || { IDENT: key, NAME: "" });
  setOverlapsBlank();
}

function renderUnifiedSearch(q) {
  const resultsEl = document.getElementById("navaidResults");
  if (!resultsEl) return;

  const query = norm(q).toUpperCase();
  if (!query) {
    resultsEl.innerHTML = "";
    return;
  }

  const hits = [];
  for (const v of navaidSearchIndex) {
    if (v.key.includes(query)) {
      hits.push(v);
      if (hits.length >= 50) break;
    }
  }

  if (hits.length < 50) {
    for (const a of airportSearchIndex) {
      if (a.key.includes(query)) {
        hits.push(a);
        if (hits.length >= 50) break;
      }
    }
  }

  if (!hits.length) {
    resultsEl.innerHTML = `<div class="console" style="min-height:auto;">No matches.</div>`;
    return;
  }

  resultsEl.innerHTML = hits.map(v => {
    const kind = v.KIND;
    const typeLabel = kind === "NAVAID" ? (v.TYPE || "-") : "AIRPORT";
    const nameLabel = v.NAME || "-";

    const distLabel =
      kind === "NAVAID" && Number.isFinite(v.DIST_NM) && v.DIST_NM !== Infinity
        ? `${v.DIST_NM.toFixed(1)} NM`
        : (kind === "AIRPORT" ? "APT" : "—");

    return `
      <div class="navaidRow" data-kind="${escHtml(kind)}" data-ident="${escHtml(v.IDENT)}">
        <div class="cellIdent">${escHtml(v.IDENT)}</div>
        <div class="cellType">${escHtml(typeLabel)}</div>
        <div class="cellName">${escHtml(nameLabel)}</div>
        <div class="cellDist">${escHtml(distLabel)}</div>
      </div>
    `;
  }).join("");
}

function wireUnifiedPanelClicks() {
  const search = document.getElementById("navaidSearch");
  const results = document.getElementById("navaidResults");
  const overlaps = document.getElementById("navaidOverlaps");

  setInfoDefault();
  setOverlapsBlank();

  if (search) search.addEventListener("input", () => renderUnifiedSearch(search.value));

  if (results) {
    results.addEventListener("click", (e) => {
      const row = e.target.closest(".navaidRow");
      if (!row) return;

      const kind = row.getAttribute("data-kind");
      const ident = row.getAttribute("data-ident");

      if (kind === "AIRPORT") selectAirport(ident);
      else selectNavaid(ident, 0);
    });
  }

  if (overlaps) {
    overlaps.addEventListener("click", (e) => {
      const row = e.target.closest(".navaidOverlapRow");
      if (!row) return;
      const ident = row.getAttribute("data-ident");
      const idx = row.getAttribute("data-idx");
      selectNavaid(ident, idx);
    });
  }

  document.addEventListener("click", (e) => {
    const nav = e.target.closest(".navaidToken");
    if (nav) {
      const ident = nav.getAttribute("data-navaid");
      selectNavaid(ident, 0);
      return;
    }
    const apt = e.target.closest(".airportToken");
    if (apt) {
      const ident = apt.getAttribute("data-airport");
      selectAirport(ident);
    }
  });
}

function renderRouteWithLinks(routeStr) {
  const rawTokens = norm(routeStr).split(/\s+/g).filter(Boolean);

  const displayTokens = rawTokens.map(tok => {
    const key = tok.toUpperCase();

    if (navaidByIdent.has(key)) {
      return `<span class="navaidToken" data-navaid="${escHtml(key)}">${escHtml(key)}</span>`;
    }
    if (airportByIdent.has(key)) {
      return `<span class="airportToken" data-airport="${escHtml(key)}">${escHtml(key)}</span>`;
    }
    return escHtml(tok);
  });

  return displayTokens.join(".");
}

/* ROUTES */
function renderRoutesTable(rows) {
  if (!rows.length) return `<div class="console" style="min-height:auto;">No routes found.</div>`;

  const header = `
    <table class="routesTable">
      <thead>
        <tr>
          <th>Route</th>
          <th>Type</th>
          <th>Aircraft</th>
          <th>Nav</th>
          <th>Altitude</th>
        </tr>
      </thead>
      <tbody>
  `;

  const body = rows.map(r => {
    const routeHtml = renderRouteWithLinks(r.Route);
    return `
      <tr>
        <td>${routeHtml}</td>
        <td>${escHtml(r.Type || "-")}</td>
        <td>${escHtml(r.Aircraft || "-")}</td>
        <td>${escHtml(r.Nav || "-")}</td>
        <td>${escHtml(r.Altitude || "-")}</td>
      </tr>
    `;
  }).join("");

  return header + body + `</tbody></table>`;
}

/* MATCHING */
function matchAirspace(ruleVal, inputVal) {
  const r = norm(ruleVal);
  const v = norm(inputVal);

  if (r === "*" || r === "") return true;
  if (v === "") return false;

  const V = v.toUpperCase();
  const reqParts = r.toUpperCase().split(/\s*\+\s*|\s*,\s*|\s*&\s*/g).map(s => s.trim()).filter(Boolean);
  return reqParts.every(part => V.includes(part));
}

function matchField(ruleVal, inputVal) {
  const r = norm(ruleVal);
  const v = norm(inputVal);

  if (r === "*" || r === "") return true;
  if (v === "") return false;

  return r.toUpperCase() === v.toUpperCase();
}

/* DATA */
let lgaConfigRows = [];
let jfkConfigRows = [];
let gatesRows = [];
let depRulesRows = [];
let routesRows = [];

/* WX */
const WX_STORAGE_KEY = "ids4_wx_watchlist_v2";
let wxWatchlist = [];

function loadWxWatchlist() {
  try {
    const raw = localStorage.getItem(WX_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) wxWatchlist = arr.map(x => norm(x).toUpperCase()).filter(Boolean);
    else wxWatchlist = [];
  } catch { wxWatchlist = []; }
  if (!wxWatchlist.length) wxWatchlist = ["KLGA", "KJFK", "KEWR", "KTEB"];
}

function saveWxWatchlist() {
  localStorage.setItem(WX_STORAGE_KEY, JSON.stringify(wxWatchlist));
}

function renderWxChips() {
  const wrap = document.getElementById("wxChips");
  if (!wrap) return;
  wrap.innerHTML = wxWatchlist.map(icao => `
    <div class="wxChip">
      <span>${escHtml(icao)}</span>
      <button type="button" data-icao="${escHtml(icao)}">X</button>
    </div>
  `).join("");
}

function isLikelyIcao(s) {
  const v = norm(s).toUpperCase();
  return /^[A-Z0-9]{3,5}$/.test(v);
}

async function fetchVatsimMetar(icao) {
  const id = norm(icao).toUpperCase();
  const url = `https://metar.vatsim.net/metar.php?id=${encodeURIComponent(id)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`METAR fetch failed (${res.status})`);
  const text = await res.text();
  const lines = text.replace(/\r/g, "").split("\n").map(l => l.trim()).filter(Boolean);
  const exact = lines.find(l => l.toUpperCase().startsWith(id + " "));
  return exact || lines[0] || `${id} (no METAR)`;
}

function parseVisSM(metar) {
  const m = metar.match(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+)\s*SM\b/);
  if (!m) return NaN;

  const raw = m[1].trim();
  if (raw.includes(" ")) {
    const [whole, frac] = raw.split(/\s+/);
    const [a,b] = frac.split("/").map(Number);
    const w = Number(whole);
    if (!Number.isFinite(w) || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return NaN;
    return w + (a/b);
  }
  if (raw.includes("/")) {
    const [a,b] = raw.split("/").map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return NaN;
    return a/b;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function parseCeilFt(metar) {
  const layers = [...metar.matchAll(/\b(BKN|OVC|VV)(\d{3})\b/g)];
  if (!layers.length) return Infinity;

  let minFt = Infinity;
  for (const x of layers) {
    const h = Number(x[2]);
    if (Number.isFinite(h)) minFt = Math.min(minFt, h * 100);
  }
  return minFt;
}

function flightCategory(metar) {
  const m = norm(metar);
  if (!m) return { cat: "—", cls: "" };

  const vis = parseVisSM(m);
  const ceil = parseCeilFt(m);

  if ((Number.isFinite(ceil) && ceil < 500) || (Number.isFinite(vis) && vis < 1)) return { cat: "LIFR", cls: "wxCatLIFR" };
  if ((Number.isFinite(ceil) && ceil < 1000) || (Number.isFinite(vis) && vis < 3)) return { cat: "IFR", cls: "wxCatIFR" };
  if ((Number.isFinite(ceil) && ceil < 3000) || (Number.isFinite(vis) && vis < 5)) return { cat: "MVFR", cls: "wxCatMVFR" };
  return { cat: "VFR", cls: "wxCatVFR" };
}

function renderMetarLineHtml(icao, metar) {
  const id = norm(icao).toUpperCase();
  const text = norm(metar);
  const { cat, cls } = flightCategory(text);

  if (text.toUpperCase().startsWith(id + " ")) {
    const rest = text.slice(id.length);
    return `<span class="wxIdent">${escHtml(id)}</span> <span class="${escHtml(cls)}">${escHtml(cat)}</span>${escHtml(rest)}`;
  }
  return `<span class="wxIdent">${escHtml(id)}</span> <span class="${escHtml(cls)}">${escHtml(cat)}</span> ${escHtml(text)}`;
}

async function refreshWx() {
  const out = document.getElementById("wxOut");
  if (!out) return;

  if (!wxWatchlist.length) { out.innerHTML = ""; return; }

  out.textContent = "Fetching METARs...\n";

  const concurrency = 5;
  const results = new Array(wxWatchlist.length);
  let i = 0;

  async function worker() {
    while (i < wxWatchlist.length) {
      const idx = i++;
      const icao = wxWatchlist[idx];
      try {
        const metar = await fetchVatsimMetar(icao);
        results[idx] = { icao, metar };
      } catch {
        results[idx] = { icao, metar: `${icao} (error)` };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, wxWatchlist.length) }, worker));

  out.innerHTML = results
    .filter(Boolean)
    .map((r, idx) => {
      const sep = idx === 0 ? "" : `<div class="wxBlockLine"></div>`;
      return `${sep}<div>${renderMetarLineHtml(r.icao, r.metar)}</div>`;
    })
    .join("");
}

function wireWxPanel() {
  const addInput = document.getElementById("wxAddInput");
  const addBtn = document.getElementById("wxAddBtn");
  const refreshBtn = document.getElementById("wxRefreshBtn");
  const chips = document.getElementById("wxChips");

  loadWxWatchlist();
  renderWxChips();

  if (addBtn && addInput) {
    addBtn.addEventListener("click", () => {
      const v = norm(addInput.value).toUpperCase();
      if (!isLikelyIcao(v)) return;

      if (!wxWatchlist.includes(v)) {
        wxWatchlist.unshift(v);
        wxWatchlist = wxWatchlist.slice(0, 20);
        saveWxWatchlist();
        renderWxChips();
        refreshWx();
      }
      addInput.value = "";
      addInput.focus();
    });

    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addBtn.click();
    });
  }

  if (chips) {
    chips.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-icao]");
      if (!btn) return;
      const icao = btn.getAttribute("data-icao");
      wxWatchlist = wxWatchlist.filter(x => x !== icao);
      saveWxWatchlist();
      renderWxChips();
      refreshWx();
    });
  }

  if (refreshBtn) refreshBtn.addEventListener("click", refreshWx);

  refreshWx();
  setInterval(refreshWx, 60000);
}

/* RUNWAY + RVR same as prior (kept short here) */
function parseWindFromMetar(metar) {
  const m = norm(metar).toUpperCase();
  const w = m.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (!w) return { dir: "", spd: NaN, raw: "" };
  return { dir: w[1], spd: Number(w[2]), raw: w[0] };
}

function lgaSuggestedConfigFromInputs(rawDir, rawSpd, rawCat) {
  if (!rawDir || !Number.isFinite(rawSpd)) return "";
  const dirStr = String(rawDir).toUpperCase();
  const spd = Number(rawSpd);
  const imc = /^(IFR|LIFR|IMC)$/.test(String(rawCat || "").toUpperCase());

  if (dirStr === "VRB") return "Depart 31, Land ILS 22";
  let dir = Number(dirStr);
  if (!Number.isFinite(dir)) return "";
  dir = ((dir % 360) + 360) % 360;

  if (spd <= 4) return "Depart 31, Land ILS 22";
  if (spd <= 14) {
    if (dir >= 315 || dir <= 44) return imc ? "Depart 4, Land LOC 31" : "Depart 4, Land RNAV GPS X 31";
    if (dir >= 45 && dir <= 134) return "Depart 13, Land ILS 4";
    if (dir >= 135 && dir <= 259) return "Depart 13, Land ILS 22";
    if (dir >= 260 && dir <= 314) return "Depart 31, Land ILS 22";
  }
  if (spd <= 27) {
    if (dir >= 315 || dir <= 44) return imc ? "Depart 4, Land LOC 31" : "Depart 4, Land RNAV GPS X 31";
    if (dir >= 45 && dir <= 134) return "Depart 13, Land ILS 4";
    if (dir >= 135 && dir <= 224) return "Depart 13, Land ILS 22";
    if (dir >= 225 && dir <= 314) return "Depart 31, Land ILS 22";
  }
  if (dir <= 89) return "Depart 4, Land ILS 4";
  if (dir <= 179) return imc ? "Depart 13, Land ILS 13" : "Depart 13, Land ILS 22 CIR 13";
  if (dir <= 269) return "Depart 22, Land ILS 22";
  return "Depart 31, Land LOC 31";
}

function jfkSuggestedConfigFromInputs(rawDir, rawSpd) {
  if (!rawDir || !Number.isFinite(rawSpd)) return "";
  const dirStr = String(rawDir).toUpperCase();
  const spd = Number(rawSpd);
  if (dirStr === "VRB" || spd <= 4) return "Depart 31L/R, Land 31L/R";
  let dir = Number(dirStr);
  if (!Number.isFinite(dir)) return "";
  dir = ((dir % 360) + 360) % 360;
  if (dir <= 99) return "Depart 04L, Land 04L/R";
  if (dir <= 159) return "Depart 13L/R, Land 13L + 22L";
  if (dir <= 259) return "Depart 22R, Land 22L/R";
  return "Depart 31L/R, Land 31L/R";
}

function renderRunwayHelperBlock(icao, metar) {
  const id = norm(icao).toUpperCase();
  const m = norm(metar);

  const { cat } = flightCategory(m);
  const wind = parseWindFromMetar(m);

  let config = "—";
  if (id === "KLGA") config = lgaSuggestedConfigFromInputs(wind.dir, wind.spd, cat) || "—";
  if (id === "KJFK") config = jfkSuggestedConfigFromInputs(wind.dir, wind.spd) || "—";

  const metarLine = renderMetarLineHtml(id, m);
  const windLine = wind.raw
    ? `<div class="runwayHint">WIND: ${escHtml(wind.raw)}</div>`
    : `<div class="runwayHint">WIND: (not found in METAR)</div>`;

  return `
    <div>${metarLine}</div>
    ${windLine}
    <div class="runwayHint">SUGGESTED AIRPORT CONFIGURATION - <span class="runwayConfig">${escHtml(config)}</span></div>
  `;
}

async function refreshRunwayHelper() {
  const out = document.getElementById("runwayOut");
  if (!out) return;

  out.textContent = "Fetching KLGA / KJFK METAR...\n";

  const airports = ["KLGA", "KJFK"];
  const results = [];

  for (const a of airports) {
    try { results.push({ a, metar: await fetchVatsimMetar(a), ok: true }); }
    catch { results.push({ a, metar: `${a} (error)`, ok: false }); }
  }

  out.innerHTML = results.map((r, idx) => {
    const sep = idx === 0 ? "" : `<div class="runwayBlockLine"></div>`;
    if (!r.ok) return `${sep}<div><span class="runwayIdent">${escHtml(r.a)}</span> <span class="runwayHint">(error fetching METAR)</span></div>`;
    return `${sep}<div>${renderRunwayHelperBlock(r.a, r.metar)}</div>`;
  }).join("");
}

function wireRunwayHelperPanel() {
  const refreshBtn = document.getElementById("runwayRefreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", refreshRunwayHelper);
  refreshRunwayHelper();
  setInterval(refreshRunwayHelper, 60000);
}

/* RVR (disabled display but saved chips) */
const RVR_STORAGE_KEY = "ids4_rvr_watchlist_v1";
let rvrWatchlist = [];

function loadRvrWatchlist() {
  try {
    const raw = localStorage.getItem(RVR_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) rvrWatchlist = arr.map(x => norm(x).toUpperCase()).filter(Boolean);
    else rvrWatchlist = [];
  } catch { rvrWatchlist = []; }
  if (!rvrWatchlist.length) rvrWatchlist = ["LGA", "JFK", "EWR"];
}
function saveRvrWatchlist(){ localStorage.setItem(RVR_STORAGE_KEY, JSON.stringify(rvrWatchlist)); }
function renderRvrChips(){
  const wrap = document.getElementById("rvrChips");
  if (!wrap) return;
  wrap.innerHTML = rvrWatchlist.map(apt => `
    <div class="rvrChip">
      <span>${escHtml(apt)}</span>
      <button type="button" data-apt="${escHtml(apt)}">X</button>
    </div>
  `).join("");
}
function faaRvrUrl(apt){
  const a = norm(apt).toUpperCase();
  return `https://rvr.data.faa.gov/cgi-bin/rvr-details.pl?content=table&airport=${encodeURIComponent(a)}&rrate=medium&layout=2x2&gifsize=large&fontsize=large&fs=lg`;
}
function renderRvrBlockHtml(apt){
  const a = norm(apt).toUpperCase();
  const link = faaRvrUrl(a);
  return `
    <div><span class="rvrIdent">${escHtml(a)}</span>  (disabled)</div>
    <div class="rvrHint">RVR monitor is currently disabled.</div>
    <div style="margin-top:6px;"><a class="rvrLink" href="${escHtml(link)}" target="_blank" rel="noopener">Open FAA RVR page</a></div>
  `;
}
async function refreshRvr(){
  const out = document.getElementById("rvrOut");
  if (!out) return;
  if (!rvrWatchlist.length) { out.innerHTML = ""; return; }
  out.innerHTML = rvrWatchlist.map((apt, idx) => {
    const sep = idx === 0 ? "" : `<div class="rvrBlockLine"></div>`;
    return `${sep}<div>${renderRvrBlockHtml(apt)}</div>`;
  }).join("");
}
function wireRvrPanel(){
  const addInput = document.getElementById("rvrAddInput");
  const addBtn = document.getElementById("rvrAddBtn");
  const refreshBtn = document.getElementById("rvrRefreshBtn");
  const chips = document.getElementById("rvrChips");

  loadRvrWatchlist();
  renderRvrChips();

  if (addBtn && addInput) {
    addBtn.addEventListener("click", () => {
      const v = norm(addInput.value).toUpperCase();
      if (!isLikelyIcao(v)) return;
      if (!rvrWatchlist.includes(v)) {
        rvrWatchlist.unshift(v);
        rvrWatchlist = rvrWatchlist.slice(0, 15);
        saveRvrWatchlist();
        renderRvrChips();
        refreshRvr();
      }
      addInput.value = "";
      addInput.focus();
    });
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });
  }

  if (chips) {
    chips.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-apt]");
      if (!btn) return;
      const apt = btn.getAttribute("data-apt");
      rvrWatchlist = rvrWatchlist.filter(x => x !== apt);
      saveRvrWatchlist();
      renderRvrChips();
      refreshRvr();
    });
  }

  if (refreshBtn) refreshBtn.addEventListener("click", refreshRvr);
  refreshRvr();
  setInterval(refreshRvr, 60000);
}

/* CLIMB VIA */
function isClimbViaSidFromProcedure(procStr) {
  const p = norm(procStr).toUpperCase();
  if (!p) return false;
  const pNorm = p.replace(/\s+/g, ".");
  if (pNorm.includes("LGA7.MASPETH")) return true;
  if (pNorm.includes("LGA7.CONEY")) return true;
  const rnav = ["HOPEA","JUTES","TNNIS","NTHNS","GLDMN"];
  return rnav.some(k => pNorm.includes(k + "#") || pNorm.includes(k));
}

/* DROPDOWNS + DERIVED */
function populateDropdowns() {
  const lgaSel = document.getElementById("lgaConfig");
  const jfkSel = document.getElementById("jfkConfig");
  if (!lgaSel || !jfkSel) return;

  lgaSel.innerHTML = lgaConfigRows.map(r =>
    `<option value="${escHtml(r.LGA_ATIS_Config)}">${escHtml(r.LGA_ATIS_Config)}</option>`
  ).join("");

  jfkSel.innerHTML = jfkConfigRows.map(r =>
    `<option value="${escHtml(r.JFK_ATIS_Config)}">${escHtml(r.JFK_ATIS_Config)}</option>`
  ).join("");
}

function getGateDirection(exitFix) {
  const ef = norm(exitFix).toUpperCase();
  const row = gatesRows.find(r => norm(r.Gate).toUpperCase() === ef);
  return row ? norm(row.Direction) : "";
}

function getLgaDerived(lgaConfig) {
  const row = lgaConfigRows.find(r => norm(r.LGA_ATIS_Config) === norm(lgaConfig));
  return { depRwy: row ? norm(row.DEP_RWY) : "", ldgClass: row ? norm(row.LGA_LDG_CLASS) : "" };
}

function getAirspaceFromJfkConfig(jfkConfig) {
  const row = jfkConfigRows.find(r => norm(r.JFK_ATIS_Config) === norm(jfkConfig));
  return { jfkAirspace: row ? norm(row.JFK_AIRSPACE) : "", lgaAirspace: row ? norm(row.LGA_AIRSPACE) : "" };
}

function pickDepartureRule(inputs) {
  const matches = depRulesRows.filter(r =>
    matchField(r.DEP_RWY, inputs.DEP_RWY) &&
    matchAirspace(r.LGA_AIRSPACE_REQ, inputs.LGA_AIRSPACE) &&
    matchAirspace(r.JFK_AIRSPACE_REQ, inputs.JFK_AIRSPACE) &&
    matchField(r.EXIT_GATE_DIR, inputs.EXIT_GATE_DIR) &&
    matchField(r.EXIT_FIX_REQ, inputs.EXIT_FIX) &&
    matchField(r.ACFT_TYPE, inputs.ACFT_TYPE) &&
    matchField(r.LGA_LDG_CLASS_REQ, inputs.LGA_LDG_CLASS)
  );
  if (!matches.length) return null;
  matches.sort((a, b) => Number(a.PRIORITY) - Number(b.PRIORITY));
  return matches[0];
}

function getRoutes(dest) {
  const d = norm(dest).toUpperCase();
  if (!d) return [];
  return routesRows.filter(r =>
    norm(r.Origin).toUpperCase() === "KLGA" &&
    norm(r.Destination).toUpperCase() === d
  );
}

/* RUN TOOL */
function runTool() {
  const lgaConfig = document.getElementById("lgaConfig")?.value ?? "";
  const jfkConfig = document.getElementById("jfkConfig")?.value ?? "";
  const exitFix = norm(document.getElementById("exitFix")?.value).toUpperCase();
  const acftType = document.getElementById("acftType")?.value ?? "*";
  const dest = document.getElementById("dest")?.value ?? "";

  const { depRwy, ldgClass } = getLgaDerived(lgaConfig);
  const { jfkAirspace, lgaAirspace } = getAirspaceFromJfkConfig(jfkConfig);
  const gateDir = getGateDirection(exitFix);

  const inputs = {
    DEP_RWY: depRwy,
    LGA_LDG_CLASS: ldgClass,
    LGA_AIRSPACE: lgaAirspace,
    JFK_AIRSPACE: jfkAirspace,
    EXIT_GATE_DIR: gateDir,
    EXIT_FIX: exitFix,
    ACFT_TYPE: acftType
  };

  const computedOut = document.getElementById("computedOut");
  if (computedOut) {
    computedOut.textContent =
      `DEP RWY: ${depRwy || "(unknown)"}\n` +
      `LGA LDG CLASS: ${ldgClass || "(unknown)"}\n` +
      `JFK Airspace: ${jfkAirspace || "(unknown)"}\n` +
      `LGA Airspace: ${lgaAirspace || "(unknown)"}\n` +
      `Exit Fix: ${exitFix || "(blank)"}\n` +
      `Exit Direction: ${gateDir || "(unknown)"}`;
  }

  const rule = pickDepartureRule(inputs);
  const depOut = document.getElementById("depOut");

  if (depOut) {
    if (!rule) {
      depOut.textContent = "No matching departure rule found.";
    } else {
      const proc = norm(rule.OUTPUT);
      const climbVia = isClimbViaSidFromProcedure(proc);
      const climbText = climbVia ? "CLIMB VIA SID" : "CLIMB AND MAINTAIN 5,000";

      let html =
        `<span class="depLabel">PROCEDURE:</span> <span class="depValue">${escHtml(proc)}</span>` +
        `<br><span class="depLabel">CLIMB:</span> <span class="depNotes">${escHtml(climbText)}</span>`;

      if (norm(rule.NOTES)) html += `<br><span class="depNotes">NOTES: ${escHtml(rule.NOTES)}</span>`;
      depOut.innerHTML = html;
    }
  }

  const routesOut = document.getElementById("routesOut");
  const rts = getRoutes(dest);

  if (routesOut) {
    if (!norm(dest)) {
      routesOut.innerHTML = `<div class="console" style="min-height:auto;">Enter a destination (e.g. KPHL).</div>`;
    } else if (!rts.length) {
      routesOut.innerHTML = `<div class="console" style="min-height:auto;">No routes found for ${escHtml(norm(dest).toUpperCase())}.</div>`;
    } else {
      routesOut.innerHTML = renderRoutesTable(rts);
    }
  }
}

/* INIT */
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  wireDock();

  const computedOut = document.getElementById("computedOut");
  if (computedOut) computedOut.textContent = "Loading TSV data...";

  try {
    lgaConfigRows = await loadTSV("LGA_ATIS_Config.tsv");
    jfkConfigRows = await loadTSV("JFK_ATIS_Config.tsv");
    gatesRows = await loadTSV("Gates.tsv");
    depRulesRows = await loadTSV("Dep_Rules.tsv");
    routesRows = await loadTSV("PRD.tsv");

    navaidsRows = await loadTSV("NAVAIDs.tsv");
    buildNavaidMaps(navaidsRows);

    airportsRows = await loadTSV("Airports.tsv");
    buildAirportMaps(airportsRows);

    wireUnifiedPanelClicks();
    wireWxPanel();
    wireRunwayHelperPanel();
    wireRvrPanel();

    populateDropdowns();

    const exitFixEl = document.getElementById("exitFix");
    const destEl = document.getElementById("dest");
    if (exitFixEl) exitFixEl.value = "WHITE";
    if (destEl) destEl.value = "KPHL";

    const runBtn = document.getElementById("runBtn");
    if (runBtn) runBtn.addEventListener("click", runTool);

    if (computedOut) computedOut.textContent = "Ready. Fill inputs and hit EXEC.";
  } catch (err) {
    if (computedOut) computedOut.textContent = "ERROR:\n\n" + (err?.message || String(err));
  }
});
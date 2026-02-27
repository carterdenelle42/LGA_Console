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

/* -------------------- NAVAID + AIRPORT SUPPORT --------------------
NAVAIDs.tsv headers:
ident  name  type  frequency_khz  latitude_deg  longitude_deg

Airports.tsv headers:
ident  name
---------------------------------------------------------- */

const KLGA_LAT = 40.7772;
const KLGA_LON = -73.8726;

let navaidsRows = [];
let navaidByIdent = new Map(); // IDENT -> [records...] sorted by distance asc
let navaidSearchIndex = [];    // flattened, searchable (nearest first)

let airportsRows = [];
let airportByIdent = new Map(); // IDENT -> airport record
let airportSearchIndex = [];    // flattened, searchable (alpha)

/* ---------- math / format helpers ---------- */
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

/* ---------- build indices ---------- */
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

  // sort each overlap group by distance asc
  for (const [ident, list] of navaidByIdent.entries()) {
    list.sort((a, b) => (a.DIST_NM - b.DIST_NM) || a.NAME.localeCompare(b.NAME));
  }

  // search list nearest-first
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

    const obj = {
      KIND: "AIRPORT",
      IDENT: ident,
      NAME: norm(r.name)
    };

    if (!airportByIdent.has(ident)) {
      airportByIdent.set(ident, obj);
    }

    // Add some extra searchable words so "heliport" / "airport" queries work
    const key = `${obj.IDENT} ${obj.NAME} AIRPORT APT HELIPORT` .toUpperCase();
    airportSearchIndex.push({ ...obj, key });
  }

  airportSearchIndex.sort((a, b) => a.IDENT.localeCompare(b.IDENT));
}

/* ---------- display (selected) ---------- */
function setInfoDefault() {
  const info = document.getElementById("navaidInfo");
  info.textContent =
    "";
}

function setNavaidInfoText(obj) {
  const info = document.getElementById("navaidInfo");

  if (!obj) {
    setInfoDefault();
    return;
  }

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

  if (!obj) {
    setInfoDefault();
    return;
  }

  info.textContent =
    `KIND:  AIRPORT\n` +
    `IDENT: ${obj.IDENT}\n` +
    `TYPE:  AIRPORT\n` +
    `NAME:  ${obj.NAME || "(unknown)"}`;
}

/* ---------- overlaps ---------- */
function renderOverlaps(ident, selectedIndex = 0) {
  const wrap = document.getElementById("navaidOverlaps");
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

    const style = idx === selectedIndex ? `style="background: rgba(255,233,74,.08);"` : "";

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
  document.getElementById("navaidOverlaps").innerHTML =
    `<div class="console" style="min-height:auto;">—</div>`;
}

function selectNavaid(ident, idx = 0) {
  const key = norm(ident).toUpperCase();
  const list = navaidByIdent.get(key);

  if (!list || !list.length) {
    setInfoDefault();
    document.getElementById("navaidOverlaps").innerHTML =
      `<div class="console" style="min-height:auto;">No NAVAID data for IDENT: ${escHtml(key)}</div>`;
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

/* ---------- unified search (navaids + airports) ---------- */
function renderUnifiedSearch(q) {
  const resultsEl = document.getElementById("navaidResults");
  const query = norm(q).toUpperCase();

  if (!query) {
    resultsEl.innerHTML = "";
    return;
  }

  const hits = [];

  // Navaids first (nearest-first)
  for (const v of navaidSearchIndex) {
    if (v.key.includes(query)) {
      hits.push(v);
      if (hits.length >= 50) break;
    }
  }

  // Fill remaining with airports (alpha)
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

  search.addEventListener("input", () => renderUnifiedSearch(search.value));

  // click a search result -> select by kind
  results.addEventListener("click", (e) => {
    const row = e.target.closest(".navaidRow");
    if (!row) return;

    const kind = row.getAttribute("data-kind");
    const ident = row.getAttribute("data-ident");

    if (kind === "AIRPORT") selectAirport(ident);
    else selectNavaid(ident, 0);
  });

  // click an overlap -> select that specific navaid record
  overlaps.addEventListener("click", (e) => {
    const row = e.target.closest(".navaidOverlapRow");
    if (!row) return;
    const ident = row.getAttribute("data-ident");
    const idx = row.getAttribute("data-idx");
    selectNavaid(ident, idx);
  });

  // delegated clicks for tokens inside routes
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

/* route: dots + clickable tokens
   - navaid tokens cyan if token matches navaid ident
   - airport tokens yellow if token matches airport ident (and not a navaid)
*/
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

/* -------------------- ROUTES TABLE -------------------- */
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

  const footer = `
      </tbody>
    </table>
  `;

  return header + body + footer;
}

/* -------------------- MATCHING -------------------- */
function matchAirspace(ruleVal, inputVal) {
  const r = norm(ruleVal);
  const v = norm(inputVal);

  if (r === "*" || r === "") return true;
  if (v === "") return false;

  const V = v.toUpperCase();

  const reqParts = r
    .toUpperCase()
    .split(/\s*\+\s*|\s*,\s*|\s*&\s*/g)
    .map(s => s.trim())
    .filter(Boolean);

  return reqParts.every(part => V.includes(part));
}

function matchField(ruleVal, inputVal) {
  const r = norm(ruleVal);
  const v = norm(inputVal);

  if (r === "*" || r === "") return true;
  if (v === "") return false;

  return r.toUpperCase() === v.toUpperCase();
}

/* -------------------- DATA -------------------- */
let lgaConfigRows = [];
let jfkConfigRows = [];
let gatesRows = [];
let depRulesRows = [];
let routesRows = [];

document.addEventListener("DOMContentLoaded", async () => {
  const computedOut = document.getElementById("computedOut");
  computedOut.textContent = "Loading TSV data...";

  try {
    lgaConfigRows = await loadTSV("LGA_ATIS_Config.tsv");
    jfkConfigRows = await loadTSV("JFK_ATIS_Config.tsv");
    gatesRows = await loadTSV("Gates.tsv");
    depRulesRows = await loadTSV("Dep_Rules.tsv");
    routesRows = await loadTSV("PRD.tsv");

    // Navaids with lat/lon
    navaidsRows = await loadTSV("NAVAIDs.tsv");
    buildNavaidMaps(navaidsRows);

    // Airports (84k lines) - header: ident  name
    airportsRows = await loadTSV("Airports.tsv");
    buildAirportMaps(airportsRows);

    wireUnifiedPanelClicks();

    populateDropdowns();

    document.getElementById("exitFix").value = "WHITE";
    document.getElementById("dest").value = "KPHL";

    document.getElementById("runBtn").addEventListener("click", runTool);

    computedOut.textContent = "Ready. Fill inputs and hit EXEC.";
  } catch (err) {
    computedOut.textContent = "ERROR:\n\n" + err.message;
  }
});

function populateDropdowns() {
  const lgaSel = document.getElementById("lgaConfig");
  const jfkSel = document.getElementById("jfkConfig");

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
  return {
    depRwy: row ? norm(row.DEP_RWY) : "",
    ldgClass: row ? norm(row.LGA_LDG_CLASS) : ""
  };
}

function getAirspaceFromJfkConfig(jfkConfig) {
  const row = jfkConfigRows.find(r => norm(r.JFK_ATIS_Config) === norm(jfkConfig));
  return {
    jfkAirspace: row ? norm(row.JFK_AIRSPACE) : "",
    lgaAirspace: row ? norm(row.LGA_AIRSPACE) : ""
  };
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

/* -------------------- RUN TOOL -------------------- */
function runTool() {
  const lgaConfig = document.getElementById("lgaConfig").value;
  const jfkConfig = document.getElementById("jfkConfig").value;
  const exitFix = norm(document.getElementById("exitFix").value).toUpperCase();
  const acftType = document.getElementById("acftType").value;
  const dest = document.getElementById("dest").value;

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

  document.getElementById("computedOut").textContent =
    `DEP RWY: ${depRwy || "(unknown)"}\n` +
    `LGA LDG CLASS: ${ldgClass || "(unknown)"}\n` +
    `JFK Airspace: ${jfkAirspace || "(unknown)"}\n` +
    `LGA Airspace: ${lgaAirspace || "(unknown)"}\n` +
    `Exit Fix: ${exitFix || "(blank)"}\n` +
    `Exit Direction: ${gateDir || "(unknown)"}`;

  const rule = pickDepartureRule(inputs);

if (!rule) {
  document.getElementById("depOut").textContent =
    "No matching departure rule found.";
} else {
  let text =
    `OUTPUT: ${rule.OUTPUT}\n` +
    `PRIORITY: ${rule.PRIORITY}`;

  if (norm(rule.NOTES)) {
    text =
      `OUTPUT: ${rule.OUTPUT}\n` +
      `NOTES: ${rule.NOTES}\n` +
      `PRIORITY: ${rule.PRIORITY}`;
  }

  document.getElementById("depOut").textContent = text;
}

  const rts = getRoutes(dest);
  const routesOut = document.getElementById("routesOut");

  if (!norm(dest)) {
    routesOut.innerHTML = `<div class="console" style="min-height:auto;">Enter a destination (e.g. KPHL).</div>`;
  } else if (!rts.length) {
    routesOut.innerHTML = `<div class="console" style="min-height:auto;">No routes found for ${escHtml(norm(dest).toUpperCase())}.</div>`;
  } else {
    routesOut.innerHTML = renderRoutesTable(rts);
  }
}
// ==================== Parsing ====================
function parseUMAPCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(",").map(h => h.trim());
    const iX = header.indexOf("umap_x"), iY = header.indexOf("umap_y"), iC = header.indexOf("superclass");
    if (iX === -1 || iY === -1 || iC === -1) throw new Error("CSV must have columns: umap_x, umap_y, superclass");
    const rows = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(",").map(c => c.trim());
        const x = Number(cols[iX]), y = Number(cols[iY]), c = cols[iC];
        if (Number.isFinite(x) && Number.isFinite(y)) rows.push({ x, y, c });
    } return rows;
}
function parseAccuracyCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(",").map(h => h.trim());
    const iC = header.indexOf("superclass"), iV = header.indexOf("value"), iN = header.indexOf("n");
    if (iC === -1 || iV === -1) throw new Error("CSV must have columns: superclass, value[, n]");
    const rows = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(",").map(c => c.trim());
        const c = cols[iC], v = Number(cols[iV]), n = iN >= 0 ? Number(cols[iN] || 0) : undefined;
        if (c && Number.isFinite(v)) rows.push({ c, v, n });
    } return rows;
}

function plotReady(id) {
  const el = document.getElementById(id);
  return !!(el && Array.isArray(el.data) && el._fullLayout);
}

// ===== Metrics available for each UMAP selection =====
const METRIC_DEFS = {
    CLS: [
        { key: "silhouette_cls_native", label: "Silhouette (CLS native)", better: "high", axis: { type: "linear", range: [-1, 1] } },
        { key: "radius_cls_native", label: "Centroid radius (CLS native)", better: "low" }, // Euclidean; lower=tighter
        { key: "knn10_cls_native", label: "Mean 10-NN distance (CLS native)", better: "low" },
        { key: "silhouette_cls_umap", label: "Silhouette (CLS UMAP 2D)", better: "high", axis: { type: "linear", range: [-1, 1] } },
    ],
    TANI: [
        { key: "silhouette_fp_native", label: "Silhouette (FP native, Jaccard)", better: "high", axis: { type: "linear", range: [-1, 1] } },
        { key: "medoid_radius_fp_native", label: "Medoid radius (FP native, Jaccard)", better: "low", axis: { type: "linear", range: [0, 1] } },
        { key: "knn10_fp_native", label: "Mean 10-NN distance (FP native, Jaccard)", better: "low", axis: { type: "linear", range: [0, 1] } },
        { key: "silhouette_fp_umap", label: "Silhouette (FP UMAP 2D)", better: "high", axis: { type: "linear", range: [-1, 1] } },
    ]
};

// Short descriptions shown on the right panel
const METRIC_INFO = {
    silhouette_cls_native:
    {
        title: "Silhouette (CLS native)", body:
            "Silhouette in the scaled CLS feature space (Euclidean). Range −1..1; higher means samples are closer to their own class and farther from others."
    },
    radius_cls_native:
    {
        title: "Centroid radius (CLS native)", body:
            "Mean Euclidean distance from each sample to its class centroid in the scaled CLS space. Lower = tighter, more compact class."
    },
    knn10_cls_native:
    {
        title: "Mean 10-NN distance (CLS native)", body:
            "Mean Euclidean distance to the 10 nearest neighbors from the same class in the scaled CLS space. Lower = tighter within-class neighborhoods."
    },
    silhouette_cls_umap:
    {
        title: "Silhouette (CLS UMAP 2D)", body:
            "Silhouette computed in the 2-D UMAP of CLS embeddings (Euclidean). Higher = better separation."
    },
    silhouette_fp_native:
    {
        title: "Silhouette (FP native, Jaccard)", body:
            "Silhouette on 16,384-bit fingerprints using Jaccard distance. Higher = better separation."
    },
    medoid_radius_fp_native:
    {
        title: "Medoid radius (FP native, Jaccard)", body:
            "Mean Jaccard distance to the class medoid fingerprint. Lower = tighter, more cohesive class."
    },
    knn10_fp_native:
    {
        title: "Mean 10-NN distance (FP native, Jaccard)", body:
            "Mean Jaccard distance to the 10 nearest neighbors within the same class. Lower = tighter within-class neighborhoods."
    },
    silhouette_fp_umap:
    {
        title: "Silhouette (FP UMAP 2D)", body:
            "Silhouette computed in the 2-D UMAP of fingerprints (Euclidean). Higher = better separation."
    },
};

// Parse the metrics CSV you’ll place at /data/metrics.csv
function parseMetricsCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(",").map(h => h.trim());
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const out = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(",").map(c => c.trim());
        const row = { class: cols[idx["class"]], n: Number(cols[idx["n"]] || 0) };
        for (const h of header) {
            if (h === "class" || h === "n") continue;
            const v = Number(cols[idx[h]]);
            row[h] = Number.isFinite(v) ? v : NaN;
        }
        if (row.class) out.push(row);
    }
    return out;
}

// ==================== Samples ====================
const SAMPLE_POINTS = (() => {
    const cls = ["Alkaloids", "Terpenoids", "Polyketides", "Flavonoids"];
    const pts = []; let seed = 42; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 600; i++) {
        const k = i % cls.length, jit = () => (rand() - 0.5) * 0.7;
        const centers = [[0, 0], [3.2, 1.8], [-2.5, 2.0], [1.2, -2.8]], [cx, cy] = centers[k];
        pts.push({ x: cx + jit(), y: cy + jit(), c: cls[k] });
    } return pts;
})();
const SAMPLE_BARS = [{ c: "Steroids", v: 0.60, n: 188 }, { c: "Isoflavonoids", v: 0.60, n: 94 }, { c: "Triterpenoids", v: 0.59, n: 342 }, { c: "Flavonoids", v: 0.53, n: 348 }, { c: "Meroterpenoids", v: 0.52, n: 116 }];

// ==================== Colors ====================
function hexToHsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b); let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
        const d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min);
        switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; case b: h = (r - g) / d + 4; break; }h *= 60;
    } return { h, s: s * 100, l: l * 100 };
}
function hslToHex(h, s, l) {
    s /= 100; l /= 100; const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - C / 2;
    let r = 0, g = 0, b = 0;
    if (0 <= h && h < 60) { r = C; g = X; b = 0; } else if (60 <= h && h < 120) { r = X; g = C; b = 0; }
    else if (120 <= h && h < 180) { r = 0; g = C; b = X; } else if (180 <= h && h < 240) { r = 0; g = X; b = C; }
    else if (240 <= h && h < 300) { r = X; g = 0; b = C; } else { r = C; g = 0; b = X; }
    const toHex = v => (Math.round((v + m) * 255).toString(16).padStart(2, "0"));
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function makePalette(n) {
    const OI = ["#1f77b4", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#999999", "#17BECF"];
    const T20 = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC",
        "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF"];
    const base = [...OI, ...T20];
    if (n <= base.length) return base.slice(0, n);
    const extra = []; for (let i = 0; extra.length < n - base.length; i++) {
        const { h, s, l } = hexToHsl(base[i % base.length]);
        const dl = ((i / base.length | 0) % 2) ? 6 : -6; extra.push(hslToHex(h, s, Math.max(25, Math.min(80, l + dl))));
    }
    return base.concat(extra);
}

// ==================== State ====================
const STATE = {
    UMAP_TAB: "CLS",          // "CLS" | "TANI" | null (none)
    ACC_TAB: null,            // "R1" | "MEAN" | "TANIS" | null
    CLS: { DATA: [], CLASSES: [], SELECTED: new Set(), COLORS: {} },
    TANI: { DATA: [], CLASSES: [], SELECTED: new Set(), COLORS: {} },
    ACC: { R1: { ROWS: [] }, MEAN: { ROWS: [] }, TANIS: { ROWS: [] } }
};
let pointSize = 5, dimOpacity = 0.12, hideUnselected = false;

let HOVER_CLASS = null;  // when set, overrides checklist selection for both plots

let GLOBAL_COLORS = {};

function rebuildGlobalColors() {
    // Collect all class names seen anywhere (UMAP: CLS/TANI; ACC: R1/MEAN/TANIS)
    const all = new Set();
    if (STATE.CLS?.DATA?.length) STATE.CLS.DATA.forEach(d => all.add(d.c));
    if (STATE.TANI?.DATA?.length) STATE.TANI.DATA.forEach(d => all.add(d.c));
    ["R1", "MEAN", "TANIS"].forEach(k => {
        const rows = STATE.ACC?.[k]?.ROWS || [];
        rows.forEach(r => all.add(r.c));
    });

    const names = Array.from(all).sort((a, b) => a.localeCompare(b));
    const pal = makePalette(names.length);
    const map = {};
    names.forEach((c, i) => map[c] = pal[i % pal.length]);
    GLOBAL_COLORS = map;
}

function colorFor(cls) {
    return GLOBAL_COLORS[cls] || "#9aa0a6"; // neutral fallback if a new class sneaks in
}

function setHoverClass(c) {
  HOVER_CLASS = c || null;
  if (plotReady("plot-umap"))    updateUMAPHighlight();
  if (plotReady("plot-acc"))     updateBarHighlight();
  if (plotReady("metrics-plot")) updateMetricHighlight();
}

function clearHoverClass() {
  HOVER_CLASS = null;
  if (plotReady("plot-umap"))    updateUMAPHighlight();
  if (plotReady("plot-acc"))     updateBarHighlight();
  if (plotReady("metrics-plot")) updateMetricHighlight();
}

// What's the current highlight set? (hover wins; otherwise the checklist selection)
function getHighlightSet() {
    if (HOVER_CLASS) return new Set([HOVER_CLASS]);
    const st = STATE.UMAP_TAB ? STATE[STATE.UMAP_TAB] : null;
    return (st && st.SELECTED && st.SELECTED.size) ? new Set(st.SELECTED) : new Set(); // empty = show all
}

function currentUMAP() { return STATE[STATE.UMAP_TAB]; }

// Metrics state
let METRICS_ROWS = [];      // array of {class, n, metric1, metric2, ...}
let METRIC_TAB = null;      // currently selected metric key, e.g., "silhouette_cls_native"

// Build metric buttons based on active UMAP (CLS/TANI)
function renderMetricTabs() {
    const wrap = document.getElementById("metric-tabs");
    wrap.innerHTML = "";
    if (STATE.UMAP_TAB === null) return;

    const defs = METRIC_DEFS[STATE.UMAP_TAB] || [];
    for (const def of defs) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = def.label;
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", METRIC_TAB === def.key);
        btn.addEventListener("click", () => {
            // toggle: clicking selected unselects (hide section) — but user asked metrics only when UMAP is selected,
            // so we keep at least one selected; clicking again just re-selects.
            METRIC_TAB = def.key;
            renderMetricTabs();
            drawMetricPlot();
        });
        wrap.appendChild(btn);
    }

    // choose a default if none
    if (!METRIC_TAB && defs.length) {
        // Prefer the UMAP version of silhouette by default
        const preferred = defs.find(d => d.key.includes("_umap")) || defs[0];
        METRIC_TAB = preferred.key;
        // Re-sync buttons
        Array.from(wrap.children).forEach(ch => {
            ch.setAttribute("aria-selected", ch.textContent === preferred.label);
        });
    } else {
        // Update aria-selected
        Array.from(wrap.children).forEach(ch => {
            const def = defs.find(d => d.label === ch.textContent);
            ch.setAttribute("aria-selected", def && def.key === METRIC_TAB);
        });
    }
}

function renderMetricDesc() {
    const box = document.getElementById("metric-desc");
    if (!METRIC_TAB) { box.innerHTML = "<em>Select a metric above to see its definition and interpretation.</em>"; return; }
    const info = METRIC_INFO[METRIC_TAB] || { title: METRIC_TAB, body: "" };
    const better = (METRIC_DEFS[STATE.UMAP_TAB] || []).find(d => d.key === METRIC_TAB)?.better;
    const betterText = better === "high" ? "Higher is better." : better === "low" ? "Lower is better." : "";
    box.innerHTML = `
    <div class="metric-desc">
      <h3>${info.title}</h3>
      <p>${info.body}</p>
      <p><strong>Interpretation:</strong> ${betterText}</p>
    </div>`;
}

function drawMetricPlot() {
    const section = document.getElementById("metrics");
    if (STATE.UMAP_TAB === null || !METRIC_TAB) { section.classList.add("disabled"); return; }
    section.classList.remove("disabled");
    renderMetricDesc();

    // rows: {class, n, [metric]}
    const mkey = METRIC_TAB;
    const all = METRICS_ROWS.slice().filter(r => Number.isFinite(r[mkey]));
    // Sort by count first to stabilize order, then by metric (best-at-top)
    const defs = METRIC_DEFS[STATE.UMAP_TAB] || [];
    const def = defs.find(d => d.key === mkey) || { better: "high" };
    const byCount = all.sort((a, b) => (b.n || 0) - (a.n || 0));
    const rows = byCount.sort((a, b) => def.better === "low" ? (a[mkey] - b[mkey]) : (b[mkey] - a[mkey]));

    const classes = rows.map(r => r.class);
    const xvals = rows.map(r => r[mkey]);
    const labels = rows.map(r => {
        const v = xvals[rows.indexOf(r)];
        const val = (mkey.includes("silhouette") ? v.toFixed(3) :
            mkey.includes("_native") || mkey.includes("_umap") ? v.toFixed(3) : v.toFixed(3));
        return Number.isFinite(r.n) ? `${val} (n=${r.n})` : `${val}`;
    });

    // Colors match global map
    const colors = classes.map(c => colorFor(c));
    const trace = {
        type: "bar",
        orientation: "h",
        y: classes,
        x: xvals,
        text: labels,
        textposition: "outside",
        cliponaxis: false,
        marker: { color: colors, line: { width: 0.5, color: "rgba(0,0,0,0.2)" } }
    };

    // Axis config
    const marginRight = rightMarginForLabels(labels, 12);
    const axisCfg = def.axis || { type: "linear" };
    const layout = {
        title: { text: `Per-class: ${METRIC_INFO[mkey]?.title || mkey}`, font: { size: 16 } },
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#ffffff",
        margin: { l: 220, r: marginRight, t: 40, b: 40 },
        yaxis: { automargin: true, autorange: "reversed" }, // best at top
        xaxis: Object.assign({ showgrid: true, gridcolor: "#e5e7eb", linecolor: "#d1d5db" }, axisCfg),
        bargap: 0.2
    };

    Plotly.newPlot("metrics-plot", [trace], layout, { responsive: true, displaylogo: false });

    // Save the category order so we can update opacities later
    STATE.METRICS_LAST_CLASSES = classes.slice();

    // Hover linking
    const el = document.getElementById("metrics-plot");
    el.on?.("plotly_hover", (ev) => {
        const cls = ev?.points?.[0]?.y;
        if (cls) setHoverClass(cls);
    });
    el.on?.("plotly_unhover", () => { clearHoverClass(); });

    // Apply initial dim/hide from sidebar selection
    updateMetricHighlight();
    schedulePlotsResize();
}

function updateMetricHighlight() {
  if (!STATE.METRICS_LAST_CLASSES || !STATE.METRICS_LAST_CLASSES.length) return;
  const gd = document.getElementById("metrics-plot");
  if (!plotReady("metrics-plot")) return;  // <- guard

  const highlight = getHighlightSet();
  const none = highlight.size === 0;
  const op = STATE.METRICS_LAST_CLASSES.map(c => {
    if (none) return 1.0;
    const sel = highlight.has(c);
    return hideUnselected ? (sel ? 1.0 : 0.0) : (sel ? 1.0 : dimOpacity);
  });
  Plotly.restyle(gd, { "marker.opacity": [op] });
}

// ======== Split divider (drag) ========
const SPLIT_KEY = "spectre_split_frac";  // save as fraction of panes width
const DIVIDER_W = 6;
const MIN_LEFT = 220; // px
const MIN_RIGHT = 220; // px

let resizeRAF = 0;

function schedulePlotsResize() {
    if (resizeRAF) cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => {
        const u = document.getElementById("plot-umap");
        const a = document.getElementById("plot-acc");
        const m = document.getElementById("metrics-plot");   // NEW

        try { if (u && STATE.UMAP_TAB !== null) Plotly.Plots.resize(u); } catch { }
        try { if (a && STATE.ACC_TAB !== null) Plotly.Plots.resize(a); } catch { }
        try { if (m && METRIC_TAB && STATE.UMAP_TAB !== null) Plotly.Plots.resize(m); } catch { }  // NEW
        syncSidebarHeight();
        resizeRAF = 0;
    });
}

function attachResizeObserver(id) {
    const el = document.getElementById(id);
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => schedulePlotsResize());
    ro.observe(el);
    // keep a reference if you want to disconnect later:
    return ro;
}

function getSavedFrac() {
    const s = localStorage.getItem(SPLIT_KEY);
    const v = s ? Number(s) : NaN;
    return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.5;
}



function setGridByFrac(frac) {
    const panes = document.getElementById("panes");
    const total = panes.clientWidth || 0;
    const avail = Math.max(0, total - DIVIDER_W);

    // If space is too small for hard minimums, soften them symmetrically
    let minL = MIN_LEFT, minR = MIN_RIGHT;
    if (avail < (MIN_LEFT + MIN_RIGHT)) {
        const half = Math.max(100, Math.floor(avail / 2)); // never below 100px each
        minL = half; minR = half;
    }

    // Clamp the fraction so both sides meet (soft) mins
    const minFrac = avail > 0 ? (minL / avail) : 0.5;
    const maxFrac = avail > 0 ? (1 - (minR / avail)) : 0.5;
    const f = Math.max(minFrac, Math.min(maxFrac, (typeof frac === "number" ? frac : 0.5)));

    const leftPx = Math.round(avail * f);
    panes.style.gridTemplateColumns = `${leftPx}px ${DIVIDER_W}px 1fr`;
}


function initDividerDrag() {
    const divider = document.getElementById("divider");
    const panes = document.getElementById("panes");

    // initialize from saved fraction
    setGridByFrac(getSavedFrac());

    divider.addEventListener("pointerdown", (e) => {
        if (divider.hidden) return;  // only when dual
        divider.setPointerCapture(e.pointerId);
        divider.classList.add("dragging");
    });

    divider.addEventListener("pointermove", (e) => {
        if (!divider.hasPointerCapture(e.pointerId)) return;
        const rect = panes.getBoundingClientRect();
        const avail = Math.max(1, rect.width - DIVIDER_W);

        let minL = MIN_LEFT, minR = MIN_RIGHT;
        if (avail < (MIN_LEFT + MIN_RIGHT)) {
            const half = Math.max(100, Math.floor(avail / 2));
            minL = half; minR = half;
        }

        const x = e.clientX - rect.left;
        const minFrac = minL / avail;
        const maxFrac = 1 - (minR / avail);
        let frac = x / avail;
        frac = Math.max(minFrac, Math.min(maxFrac, frac));

        setGridByFrac(frac);
        localStorage.setItem(SPLIT_KEY, String(frac));
        schedulePlotsResize();
    });


    divider.addEventListener("pointerup", (e) => {
        if (!divider.hasPointerCapture(e.pointerId)) return;
        divider.releasePointerCapture(e.pointerId);
        divider.classList.remove("dragging");
        // ensure a final resize at drop
        schedulePlotsResize();
    });



    // Keep layout sane on window resize
    window.addEventListener("resize", () => {
        if (!divider.hidden) setGridByFrac(getSavedFrac());
        schedulePlotsResize();
    });
}


// ==================== Layout ====================
function clearMetricsWhenNoUMAP() {
    // Disable the section visually
    const sec = document.getElementById("metrics");
    sec.classList.add("disabled");

    // Clear tabs + chosen metric
    const tabs = document.getElementById("metric-tabs");
    tabs.innerHTML = "";
    METRIC_TAB = null;

    // Purge the plot and reset text
    try { Plotly.purge("metrics-plot"); } catch { }
    const desc = document.getElementById("metric-desc");
    desc.innerHTML = "<em>Select CLS or Tanimoto UMAP to see metrics.</em>";
    const status = document.getElementById("metrics-status");
    if (status) status.textContent = "";

    // Avoid later opacity updates against stale order
    STATE.METRICS_LAST_CLASSES = [];
}

function elementHeight(id) {
  const el = document.getElementById(id);
  return (el && !el.hidden) ? (el.offsetHeight || 0) : 0;
}

function syncSidebarHeight() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  // Use whatever is currently visible: UMAP, ACC, or the blank placeholder
  const hUMAP  = elementHeight("plot-umap");
  const hACC   = elementHeight("plot-acc");
  const hBlank = elementHeight("pane-blank");

  let h = Math.max(hUMAP, hACC, hBlank);

  // Fallback to our known targets if nothing is visible yet
  if (!h) {
    const dual = !(document.getElementById("divider")?.hidden);
    h = dual ? 420 : 560;
  }

  sidebar.style.maxHeight = h + "px";
  sidebar.style.overflow  = "auto";
  sidebar.style.alignSelf = "start"; // prevent stretching the grid row
}


function applyLayout() {
  const showUMAP = STATE.UMAP_TAB !== null;
  const showACC  = STATE.ACC_TAB  !== null;

  const panes   = document.getElementById("panes");
  const paneU   = document.getElementById("pane-umap");
  const paneA   = document.getElementById("pane-acc");
  const divider = document.getElementById("divider");
  const blank   = document.getElementById("pane-blank");

  // ---- 1) Visibility first (no drawing yet)
  paneU.hidden   = !showUMAP;
  paneA.hidden   = !showACC;
  divider.hidden = !(showUMAP && showACC);
  blank.hidden   =  (showUMAP || showACC);

  // Top toolbar visuals
  document.getElementById("umap-controls").classList.toggle("inactive", !showUMAP);
  document.getElementById("acc-controls").classList.toggle("inactive", !showACC);

  // Grid mode classes (so CSS picks heights)
  const dual = showUMAP && showACC;
  panes.classList.toggle("dual", dual);
  panes.classList.toggle("single", !dual);

  // Ensure single mode doesn't keep a stale explicit template
  if (!dual) panes.style.removeProperty("grid-template-columns");

  // If a pane is being hidden, purge its Plotly instance now
  if (!showUMAP) { try { Plotly.purge("plot-umap"); } catch {} }
  if (!showACC)  { try { Plotly.purge("plot-acc");  } catch {} }

  // Metrics: only when a UMAP is active; otherwise clear/disable
  if (!showUMAP) {
    clearMetricsWhenNoUMAP();
  } else {
    renderMetricTabs();
    // we'll draw the metrics plot after layout below
  }

  // ---- 2) Draw AFTER layout has applied (prevents 0×0 plots)
  requestAnimationFrame(() => {
    // Apply saved split only in dual mode (after both panes are visible)
    if (dual) setGridByFrac(getSavedFrac());

    // Draw visible panes now that they have size
    if (showUMAP) initUMAP();
    if (showACC)  drawBars();
    if (showUMAP) drawMetricPlot();

    // Final reflow
    schedulePlotsResize();
  });
}


// ==================== UMAP ====================
function refreshUMAPColors() {
    if (STATE.UMAP_TAB === null) return;
    const st = currentUMAP();
    st.COLORS = {};
    st.CLASSES.forEach(c => st.COLORS[c] = colorFor(c));
}
function renderChecklist() {
    if (STATE.UMAP_TAB === null) return;
    const st = currentUMAP(), list = document.getElementById("class-checklist");
    list.innerHTML = ""; const q = document.getElementById("search-input").value.toLowerCase();
    const filtered = st.CLASSES.filter(c => c.toLowerCase().includes(q));
    for (const c of filtered) {
        const row = document.createElement("label"); row.className = "chk";
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = st.SELECTED.has(c);
        cb.addEventListener("change", () => {
            cb.checked ? st.SELECTED.add(c) : st.SELECTED.delete(c);
            updateUMAPHighlight();
            updateBarHighlight();
            updateMetricHighlight();
        });
        const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = st.COLORS[c];
        const txt = document.createElement("span"); const count = st.DATA.filter(d => d.c === c).length; txt.textContent = `${c} (${count})`;
        row.append(cb, sw, txt); list.appendChild(row);
    }
}
function drawUMAP() {
    const st = currentUMAP();
    const trace = {
        x: st.DATA.map(d => d.x), y: st.DATA.map(d => d.y),
        mode: "markers", type: "scattergl",
        hovertemplate: "x: %{x:.3f}<br>y: %{y:.3f}<br>%{customdata}<extra></extra>",
        customdata: st.DATA.map(d => d.c),
        marker: {
            size: pointSize, color: st.DATA.map(d => st.COLORS[d.c]),
            opacity: st.DATA.map(d => 1.0), line: { width: 0.4, color: "rgba(0,0,0,0.25)" }
        }
    };
    const layout = {
        paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff",
        margin: { l: 40, r: 20, t: 10, b: 40 },
        xaxis: { zeroline: false, showgrid: true, gridcolor: "#e5e7eb", linecolor: "#d1d5db", title: "UMAP-1" },
        yaxis: { zeroline: false, showgrid: true, gridcolor: "#e5e7eb", linecolor: "#d1d5db", title: "UMAP-2" },
        dragmode: "pan"
    };
    Plotly.newPlot("plot-umap", [trace], layout, { responsive: true, displaylogo: false });
    const uEl = document.getElementById("plot-umap");
    uEl.on?.("plotly_hover", (ev) => {
        const cls = ev?.points?.[0]?.customdata;
        if (cls) setHoverClass(cls);
    });
    uEl.on?.("plotly_unhover", () => {
        clearHoverClass();
    });
    updateUMAPHighlight();
    updateBarHighlight();
    updateMetricHighlight();
}
function updateUMAPHighlight() {
  if (STATE.UMAP_TAB === null) return;
  const gd = document.getElementById("plot-umap");
  if (!plotReady("plot-umap")) return;   // <- guard

  const st = currentUMAP();
  const highlight = getHighlightSet();
  const noneSelected = (highlight.size === 0);

  const op = st.DATA.map(d => {
    if (noneSelected) return 1.0;
    const sel = highlight.has(d.c);
    return hideUnselected ? (sel ? 1.0 : 0.0) : (sel ? 1.0 : dimOpacity);
  });
  const size = st.DATA.map(d => {
    if (highlight.size === 0) return pointSize;
    return highlight.has(d.c) ? pointSize + 1.5 : pointSize;
  });

  Plotly.restyle(gd, { "marker.opacity": [op], "marker.size": [size] });

  const shown = highlight.size ? [...highlight].join(", ") : "All";
  const src = HOVER_CLASS ? "hover" : "selection";
  const stEl = document.getElementById("status-umap");
  if (stEl) stEl.textContent = `UMAP: ${STATE.UMAP_TAB} • Showing: ${shown} (${src})`;
}


function updateBarHighlight() {
  if (STATE.ACC_TAB === null) return;
  const gd = document.getElementById("plot-acc");
  if (!plotReady("plot-acc")) return;    // <- guard

  const key = STATE.ACC_TAB;
  const rows = STATE.ACC[key].LAST_ROWS;
  if (!rows || !rows.length) return;

  const highlight = getHighlightSet();
  const noneSelected = (highlight.size === 0);

  const op = rows.map(cls => {
    if (noneSelected) return 1.0;
    const sel = highlight.has(cls);
    return hideUnselected ? (sel ? 1.0 : 0.0) : (sel ? 1.0 : dimOpacity);
  });

  Plotly.restyle(gd, { "marker.opacity": [op] });
}


function initUMAP() {
    const st = currentUMAP();
    st.CLASSES = [...new Set(st.DATA.map(d => d.c))].sort((a, b) => a.localeCompare(b));
    refreshUMAPColors();
    if (!(st.SELECTED instanceof Set)) st.SELECTED = new Set();
    renderChecklist(); drawUMAP();
}

// ==================== Accuracy bars ====================
function rightMarginForLabels(labels, fontPx = 12) {
    if (!labels || !labels.length) return 40;
    // rough px-per-char heuristic (~0.6 * font size); clamp to a sane range
    const maxChars = labels.reduce((m, t) => Math.max(m, (t || "").length), 0);
    const px = Math.round(maxChars * fontPx * 0.62);
    return Math.max(60, Math.min(260, px + 16)); // min 60, max 260, +a bit of padding
}

function drawBars() {
    const key = STATE.ACC_TAB; if (!key) return;
    const all = STATE.ACC[key].ROWS.slice();

    // Top-K by count
    const K = Math.max(1, Number(document.getElementById("topk")?.value || 20));
    const byCount = all.slice().sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, K);

    // Sorting: MEAN (lower=better) vs others (higher=better). Checkbox allows reversing.
    const wantDesc = document.getElementById("sort-desc").checked;
    const rows = byCount.sort((a, b) => {
        if (key === "MEAN") return (wantDesc ? b.v - a.v : a.v - b.v);
        return (wantDesc ? b.v - a.v : a.v - b.v);
    });

    // Colors & labels
    const classes = rows.map(r => r.c);
    const barColors = classes.map(c => colorFor(c));

    const showN = document.getElementById("show-n").checked;
    const text = rows.map(r => {
        const val = (key === "MEAN" ? r.v.toFixed(2) : r.v.toFixed(3));
        return (showN && Number.isFinite(r.n)) ? `${val} (n=${r.n})` : val;
    });

    // Data for x: for MEAN (log axis), ensure strictly positive
    const EPS = 1e-6;
    const xData = rows.map(r => (key === "MEAN" ? Math.max(r.v, EPS) : r.v));

    const trace = {
        type: "bar",
        orientation: "h",
        y: classes,
        x: rows.map(r => r.v),
        text: text,
        textposition: "outside",
        cliponaxis: false,
        marker: {
            color: barColors,                         // <- consistent with UMAP
            line: { width: 0.5, color: "rgba(0,0,0,0.2)" }
        }
    };

    const titles = {
        R1: "Rank-1 Accuracy",
        MEAN: "Mean rank (lower is better)",
        TANIS: "Tanimoto similarity"
    };
    const isMean = key === "MEAN";

    // ✅ use the correct variable here
    const marginRight = rightMarginForLabels(text, 12);

    const layout = {
        title: { text: `NP superclass — ${titles[key]} (Top-${K} by count)`, font: { size: 16 } },
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#ffffff",
        margin: { l: 200, r: marginRight, t: 40, b: 40 },
        yaxis: { automargin: true, autorange: "reversed" }, // best at top
        xaxis: Object.assign(
            {
                title: isMean ? "Mean rank (log scale, lower is better)" :
                    (key === "TANIS" ? "Similarity" : "Accuracy"),
                showgrid: true, gridcolor: "#e5e7eb", linecolor: "#d1d5db"
            },
            isMean ? { type: "log" } : { range: [0, 1.02] }   // a bit of headroom above 1.0
        ),
        bargap: 0.2
    };
    STATE.ACC[key].LAST_ROWS = classes.slice();
    Plotly.newPlot("plot-acc", [trace], layout, { responsive: true, displaylogo: false });
    const aEl = document.getElementById("plot-acc");
    aEl.on?.("plotly_hover", (ev) => {
        const cls = ev?.points?.[0]?.y;   // y is the category label
        if (cls) setHoverClass(cls);
    });
    aEl.on?.("plotly_unhover", () => {
        clearHoverClass();
    });
    document.getElementById("status-acc").textContent =
        `Accuracy: ${key} • Top-${K} by count • ${rows.length} classes shown`;

    // make sure it paints after layout changes
    updateBarHighlight();
    schedulePlotsResize();
}


// ==================== Loaders ====================
async function fetchText(url) { const res = await fetch(url, { cache: "no-cache" }); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); }
async function loadUMAPFromUrl(url, tabKey) { try { const rows = parseUMAPCSV(await fetchText(url)); STATE[tabKey].DATA = rows; STATE[tabKey].SELECTED = new Set(); STATE[tabKey].CLASSES = []; return true; } catch { return false; } }
async function loadACCFromUrl(url, accKey) { try { STATE.ACC[accKey].ROWS = parseAccuracyCSV(await fetchText(url)); return true; } catch { return false; } }

// ==================== Tab toggles ====================
function toggleUMAPTab(tab) {
  const isSelected = (STATE.UMAP_TAB === tab);
  STATE.UMAP_TAB = isSelected ? null : tab;
  document.getElementById("tab-CLS").setAttribute("aria-selected", STATE.UMAP_TAB === "CLS");
  document.getElementById("tab-TANI").setAttribute("aria-selected", STATE.UMAP_TAB === "TANI");
  HOVER_CLASS = null;               // don't call updates yet
  applyLayout();                    // draws in rAF
}

function toggleACCTab(tab) {
  const isSelected = (STATE.ACC_TAB === tab);
  STATE.ACC_TAB = isSelected ? null : tab;
  document.getElementById("acc-R1").setAttribute("aria-selected", STATE.ACC_TAB === "R1");
  document.getElementById("acc-MEAN").setAttribute("aria-selected", STATE.ACC_TAB === "MEAN");
  document.getElementById("acc-TANIS").setAttribute("aria-selected", STATE.ACC_TAB === "TANIS");
  if (STATE.ACC_TAB === "MEAN") document.getElementById("sort-desc").checked = false;
  if (STATE.ACC_TAB === "R1" || STATE.ACC_TAB === "TANIS") document.getElementById("sort-desc").checked = true;
  HOVER_CLASS = null;               // don't call updates yet
  applyLayout();                    // draws in rAF
}

// Bind tab clicks
document.getElementById("tab-CLS").addEventListener("click", () => toggleUMAPTab("CLS"));
document.getElementById("tab-TANI").addEventListener("click", () => toggleUMAPTab("TANI"));
document.getElementById("acc-R1").addEventListener("click", () => toggleACCTab("R1"));
document.getElementById("acc-MEAN").addEventListener("click", () => toggleACCTab("MEAN"));
document.getElementById("acc-TANIS").addEventListener("click", () => toggleACCTab("TANIS"));

// Sidebar interactions
document.getElementById("point-size").addEventListener("input", (e) => { pointSize = Number(e.target.value); updateUMAPHighlight(); updateBarHighlight(); updateMetricHighlight(); });
document.getElementById("dim-opacity").addEventListener("input", (e) => { dimOpacity = Number(e.target.value); updateUMAPHighlight(); updateBarHighlight(); updateMetricHighlight(); });
document.getElementById("hide-unselected").addEventListener("change", (e) => { hideUnselected = e.target.checked; updateUMAPHighlight(); updateBarHighlight(); updateMetricHighlight(); });
document.getElementById("search-input").addEventListener("input", () => renderChecklist());
document.getElementById("sort-desc").addEventListener("change", () => drawBars());
document.getElementById("show-n").addEventListener("change", () => drawBars());
document.getElementById("topk").addEventListener("input", () => drawBars());

// ==================== Boot ====================
(async () => {
    // Auto-load server CSVs
    const gotCLS = await loadUMAPFromUrl("data/cls_umap.csv", "CLS");
    const gotTANI = await loadUMAPFromUrl("data/tanimoto_umap.csv", "TANI");
    if (!gotCLS) STATE.CLS.DATA = SAMPLE_POINTS.slice();
    if (!gotTANI) STATE.TANI.DATA = SAMPLE_POINTS.slice();

    await loadACCFromUrl("data/acc_rank1.csv", "R1");
    await loadACCFromUrl("data/acc_meanrank.csv", "MEAN");
    await loadACCFromUrl("data/acc_tanimoto.csv", "TANIS");
    if (!STATE.ACC.R1.ROWS.length && !STATE.ACC.MEAN.ROWS.length && !STATE.ACC.TANIS.ROWS.length) {
        STATE.ACC.R1.ROWS = SAMPLE_BARS.slice();
    }

    try {
        const txt = await fetchText("data/metrics.csv");
        METRICS_ROWS = parseMetricsCSV(txt);
    } catch {
        METRICS_ROWS = []; // ok if missing; section will show the hint
    }

    // Build color map AFTER all data loads
    rebuildGlobalColors();

    // Default metrics UI based on current UMAP selection
    renderMetricTabs();
    drawMetricPlot();

    // Default: CLS selected, accuracy none
    STATE.UMAP_TAB = "CLS";
    STATE.ACC_TAB = "R1";
    document.getElementById("tab-CLS").setAttribute("aria-selected", true);
    document.getElementById("tab-TANI").setAttribute("aria-selected", false);
    document.getElementById("acc-R1").setAttribute("aria-selected", true);
    document.getElementById("acc-MEAN").setAttribute("aria-selected", false);
    document.getElementById("acc-TANIS").setAttribute("aria-selected", false);
    rebuildGlobalColors();
    applyLayout();
    initDividerDrag();
    attachResizeObserver("plot-umap");
    attachResizeObserver("plot-acc");
    attachResizeObserver("metrics-plot");

    // Kick one resize to settle initial layout
    schedulePlotsResize();
})();

/* ==================== SPECTRE — app.js (clean) ==================== */

/* ---------- CSV parsing ---------- */
function parseUMAPCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(",").map(h => h.trim());
    const iX = header.indexOf("umap_x"), iY = header.indexOf("umap_y"), iC = header.indexOf("superclass");
    if (iX < 0 || iY < 0 || iC < 0) throw new Error("CSV must have columns: umap_x, umap_y, superclass");
    const out = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(",").map(c => c.trim());
        const x = Number(cols[iX]), y = Number(cols[iY]), c = cols[iC];
        if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y, c });
    }
    return out;
}
function parseAccuracyCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(",").map(h => h.trim());
    const iC = header.indexOf("superclass"), iV = header.indexOf("value"), iN = header.indexOf("n");
    if (iC < 0 || iV < 0) throw new Error("CSV must have columns: superclass, value[, n]");
    const out = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(",").map(c => c.trim());
        const c = cols[iC], v = Number(cols[iV]), n = iN >= 0 ? Number(cols[iN] || 0) : undefined;
        if (c && Number.isFinite(v)) out.push({ c, v, n });
    }
    return out;
}
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
function parseChemCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(",").map(h => h.trim());
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const need = ["superclass", "n_items", "n_valid_smiles", "mean_carbons", "mean_hydrogens", "mean_hsqc", "mean_cnmr", "mean_hnmr"];
    for (const k of need) if (!(k in idx)) throw new Error("Chem CSV missing column: " + k);

    const out = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(",").map(c => c.trim());
        const row = {
            c: cols[idx.superclass],
            n_items: Number(cols[idx.n_items] || 0),
            n_valid_smiles: Number(cols[idx.n_valid_smiles] || 0),
            mean_carbons: Number(cols[idx.mean_carbons]),
            mean_hydrogens: Number(cols[idx.mean_hydrogens]),
            mean_hsqc: Number(cols[idx.mean_hsqc]),
            mean_cnmr: Number(cols[idx.mean_cnmr]),
            mean_hnmr: Number(cols[idx.mean_hnmr]),
        };
        if (row.c) out.push(row);
    }
    return out;
}

/* ---------- Confusion CSV parsing ---------- */
/* Expects columns: true_class,<pred1>,<pred2>,... */
function parseConfusionCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(",").map(s => s.trim());
    const predLabels = header.slice(1);
    const trueLabels = [];
    const counts = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = line.split(",").map(c => c.trim());
        trueLabels.push(cols[0]);
        counts.push(cols.slice(1).map(v => {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        }));
    }
    return { trueLabels, predLabels, counts };
}


/* ---------- Plot helpers ---------- */
function plotReady(id) {
    const el = document.getElementById(id);
    return !!(el && Array.isArray(el.data) && el._fullLayout);
}
function rightMarginForLabels(labels, fontPx = 12) {
    if (!labels || !labels.length) return 40;
    const maxChars = labels.reduce((m, t) => Math.max(m, (t || "").length), 0);
    const px = Math.round(maxChars * fontPx * 0.62);
    return Math.max(60, Math.min(260, px + 16));
}
// Adaptive font sizes for crowded bar charts
function fontSizesForCount(count, { tickMax = 12, tickMin = 5, textDelta = 1 } = {}) {
    const n = Math.max(0, count);
    const n0 = 20;   // <= n0 → biggest fonts
    const n1 = 71;  // >= n1 → smallest fonts
    const lerp = n <= n0 ? 0 : n >= n1 ? 1 : (n - n0) / (n1 - n0);
    const tick = Math.round(tickMax - (tickMax - tickMin) * lerp);
    const text = Math.max(tickMin, tick - textDelta);
    return { tick, text };
}

/* ---------- Metric registry ---------- */
const METRIC_DEFS = {
    CLS: [
        { key: "silhouette_cls_native", label: "Silhouette (CLS native)", better: "high", axis: { type: "linear", range: [-1, 1] } },
        { key: "radius_cls_native", label: "Centroid radius (CLS native)", better: "low" },
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
const METRIC_INFO = {
    silhouette_cls_native: { title: "Silhouette (CLS native)", body: "Silhouette in the scaled CLS feature space (Euclidean). Range −1..1; higher means samples are closer to their own class and farther from others." },
    radius_cls_native: { title: "Centroid radius (CLS native)", body: "Mean Euclidean distance from each sample to its class centroid in the scaled CLS space. Lower = tighter, more compact class." },
    knn10_cls_native: { title: "Mean 10-NN distance (CLS native)", body: "Mean Euclidean distance to the 10 nearest neighbors from the same class in the scaled CLS space. Lower = tighter within-class neighborhoods." },
    silhouette_cls_umap: { title: "Silhouette (CLS UMAP 2D)", body: "Silhouette computed in the 2-D UMAP of CLS embeddings (Euclidean). Higher = better separation." },
    silhouette_fp_native: { title: "Silhouette (FP native, Jaccard)", body: "Silhouette on 16,384-bit fingerprints using Jaccard distance. Higher = better separation." },
    medoid_radius_fp_native: { title: "Medoid radius (FP native, Jaccard)", body: "Mean Jaccard distance to the class medoid fingerprint. Lower = tighter, more cohesive class." },
    knn10_fp_native: { title: "Mean 10-NN distance (FP native, Jaccard)", body: "Mean Jaccard distance to the 10 nearest neighbors within the same class. Lower = tighter within-class neighborhoods." },
    silhouette_fp_umap: { title: "Silhouette (FP UMAP 2D)", body: "Silhouette computed in the 2-D UMAP of fingerprints (Euclidean). Higher = better separation." },
};

const CHEM_METRICS = [
    {
        key: "mean_carbons", label: "Avg. # Carbons", unit: "atoms",
        explain: "Average number of carbon atoms per molecule among valid SMILES."
    },
    {
        key: "mean_hydrogens", label: "Avg. # Hydrogens", unit: "atoms",
        explain: "Average number of hydrogen atoms per molecule among valid SMILES."
    },
    {
        key: "mean_hsqc", label: "Avg. HSQC peaks", unit: "peaks",
        explain: "Average number of peaks observed in HSQC spectra."
    },
    {
        key: "mean_cnmr", label: "Avg. 13C NMR peaks", unit: "peaks",
        explain: "Average number of carbon (13C) NMR peaks."
    },
    {
        key: "mean_hnmr", label: "Avg. 1H NMR peaks", unit: "peaks",
        explain: "Average number of proton (1H) NMR peaks."
    },
];

function chemTopK() {
    return Math.max(1, Number(document.getElementById("chem-topk")?.value || 20));
}
function renderChemTabs() {
    const wrap = document.getElementById("chem-tabs");
    if (!wrap) return;
    wrap.innerHTML = "";
    CHEM_METRICS.forEach(def => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = def.label;
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", STATE.CHEM.METRIC === def.key);
        btn.addEventListener("click", () => {
            STATE.CHEM.METRIC = def.key;
            renderChemTabs();
            drawChemPlot();
        });
        wrap.appendChild(btn);
    });
}
function renderChemDesc() {
    const box = document.getElementById("chem-desc");
    if (!box) return;
    const def = CHEM_METRICS.find(d => d.key === STATE.CHEM.METRIC);
    if (!def) { box.innerHTML = "<em>Select a metric.</em>"; return; }
    box.innerHTML = `<h3>${def.label}</h3>
    <p>${def.explain}</p>
    <p><strong>Display:</strong> Top-K superclasses by <code>n_items</code>.</p>`;
}

/* ---------- Confusion Matrix state ---------- */
const CONF_FILES = {
    1: { counts: "data/conf_k1_counts.csv" },   // <-- adjust names if needed
    5: { counts: "data/conf_k5_counts.csv" },
    10: { counts: "data/conf_k10_counts.csv" }
};


/* ---------- Sample fallbacks ---------- */
const SAMPLE_POINTS = (() => { const cls = ["Alkaloids", "Terpenoids", "Polyketides", "Flavonoids"]; const pts = []; let seed = 42; const rnd = () => ((seed = seed * 1664525 + 1013904223 >>> 0) / 4294967296); for (let i = 0; i < 600; i++) { const k = i % cls.length, jit = () => (rnd() - 0.5) * 0.7; const centers = [[0, 0], [3.2, 1.8], [-2.5, 2.0], [1.2, -2.8]], [cx, cy] = centers[k]; pts.push({ x: cx + jit(), y: cy + jit(), c: cls[k] }); } return pts; })();
const SAMPLE_BARS = [{ c: "Steroids", v: 0.60, n: 188 }, { c: "Isoflavonoids", v: 0.60, n: 94 }, { c: "Triterpenoids", v: 0.59, n: 342 }, { c: "Flavonoids", v: 0.53, n: 348 }, { c: "Meroterpenoids", v: 0.52, n: 116 }];

/* ---------- Colors ---------- */
function hexToHsl(hex) { let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255; const max = Math.max(r, g, b), min = Math.min(r, g, b); let h, s, l = (max + min) / 2; if (max === min) { h = s = 0; } else { const d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min); switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; case b: h = (r - g) / d + 4; break }h *= 60; } return { h, s: s * 100, l: l * 100 }; }
function hslToHex(h, s, l) { s /= 100; l /= 100; const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = l - C / 2; let r = 0, g = 0, b = 0; if (0 <= h && h < 60) { r = C; g = X; b = 0; } else if (60 <= h && h < 120) { r = X; g = C; b = 0; } else if (120 <= h && h < 180) { r = 0; g = C; b = X; } else if (180 <= h && h < 240) { r = 0; g = X; b = C; } else if (240 <= h && h < 300) { r = X; g = 0; b = C; } else { r = C; g = 0; b = X; } const toHex = v => (Math.round((v + m) * 255).toString(16).padStart(2, "0")); return `#${toHex(r)}${toHex(g)}${toHex(b)}`; }
function makePalette(n) {
    const OI = ["#1f77b4", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#999999", "#17BECF"];
    const T20 = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC", "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF"];
    const base = [...OI, ...T20];
    if (n <= base.length) return base.slice(0, n);
    const extra = []; for (let i = 0; extra.length < n - base.length; i++) { const { h, s, l } = hexToHsl(base[i % base.length]); const dl = ((i / base.length | 0) % 2) ? 6 : -6; extra.push(hslToHex(h, s, Math.max(25, Math.min(80, l + dl)))); }
    return base.concat(extra);
}

/* ---------- State ---------- */
const STATE = {
    UMAP_TAB: "CLS",
    ACC_TAB: null,
    CLS: { DATA: [], CLASSES: [], SELECTED: new Set(), COLORS: {}, VIEW: [], VIEW_CLASSES: new Set() },
    TANI: { DATA: [], CLASSES: [], SELECTED: new Set(), COLORS: {}, VIEW: [], VIEW_CLASSES: new Set() },
    ACC: { R1: { ROWS: [] }, MEAN: { ROWS: [] }, TANIS: { ROWS: [] } },
    CHEM: { ROWS: [], METRIC: "mean_carbons", LAST_CLASSES: [] }
};

STATE.CONF = {
    DATA: { 1: null, 5: null, 10: null },          // parsed counts matrices
    settings: { k: 1, mode: "row", topk: 20 }    // mode: "row" | "counts"
};

let pointSize = 5, dimOpacity = 0.12, hideUnselected = false;
let HOVER_CLASS = null;
let GLOBAL_COLORS = {};

function rebuildGlobalColors() {
    // 1) Gather union of ALL classes across UMAP/ACC/METRICS/CHEM
    const all = new Set();

    if (STATE.CLS?.DATA?.length) STATE.CLS.DATA.forEach(d => all.add(d.c));
    if (STATE.TANI?.DATA?.length) STATE.TANI.DATA.forEach(d => all.add(d.c));

    ["R1", "MEAN", "TANIS"].forEach(k => {
        (STATE.ACC?.[k]?.ROWS || []).forEach(r => all.add(r.c));
    });

    // metrics.csv may use "class"; normalize to class name
    (Array.isArray(METRICS_ROWS) ? METRICS_ROWS : []).forEach(r => all.add(r.class));

    // CHEM rows may use c|class|superclass
    (STATE.CHEM?.ROWS || []).forEach(r => all.add(r.c || r.class || r.superclass));

    // 2) Preserve existing assignments; only add colors for NEW names
    const map = { ...GLOBAL_COLORS };
    const have = new Set(Object.keys(map));
    const newNames = [...all].filter(c => c && !have.has(c)).sort((a, b) => a.localeCompare(b));

    if (newNames.length === 0) {
        GLOBAL_COLORS = map; // nothing to add; stable
        return;
    }

    // 3) Append new colors without touching existing ones
    const startIdx = Object.keys(map).length;
    const pal = makePalette(startIdx + newNames.length);

    newNames.forEach((c, i) => {
        map[c] = pal[startIdx + i];      // extend-only assignment
    });

    GLOBAL_COLORS = map;
}

const colorFor = cls => GLOBAL_COLORS[cls] || "#9aa0a6";


/* ---------- Hover linking ---------- */
function setHoverClass(c) {
    HOVER_CLASS = c || null;
    if (plotReady("plot-umap")) updateUMAPHighlight();
    if (plotReady("plot-acc")) updateBarHighlight();
    if (plotReady("metrics-plot")) updateMetricHighlight();
    if (plotReady("chem-plot")) updateChemHighlight();
}
function clearHoverClass() { setHoverClass(null); }

/* ---------- Selection helpers ---------- */
function getHighlightSet() {
    if (HOVER_CLASS) return new Set([HOVER_CLASS]);
    const st = STATE.UMAP_TAB ? STATE[STATE.UMAP_TAB] : null;
    return (st && st.SELECTED && st.SELECTED.size) ? new Set(st.SELECTED) : new Set();
}
const currentUMAP = () => STATE[STATE.UMAP_TAB];

/* ---------- Metrics UI ---------- */
let METRICS_ROWS = [];      // {class, n, ...metrics}
let METRIC_TAB = null;      // active metric key
function renderMetricTabs() {
    const wrap = document.getElementById("metric-tabs");
    wrap.innerHTML = "";
    if (STATE.UMAP_TAB === null) return;
    const defs = METRIC_DEFS[STATE.UMAP_TAB] || [];
    defs.forEach(def => {
        const btn = document.createElement("button");
        btn.type = "button"; btn.textContent = def.label;
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", METRIC_TAB === def.key);
        btn.addEventListener("click", () => { METRIC_TAB = def.key; renderMetricTabs(); drawMetricPlot(); });
        wrap.appendChild(btn);
    });
    if (!METRIC_TAB && defs.length) {
        const pref = defs.find(d => d.key.includes("_umap")) || defs[0];
        METRIC_TAB = pref.key;
        [...wrap.children].forEach(ch => ch.setAttribute("aria-selected", ch.textContent === pref.label));
    } else {
        [...wrap.children].forEach(ch => {
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
    box.innerHTML = `<div class="metric-desc"><h3>${info.title}</h3><p>${info.body}</p><p><strong>Interpretation:</strong> ${betterText}</p></div>`;
}
function getTopKValue() { return Math.max(1, Number(document.getElementById("topk")?.value || 20)); }

/* ---------- Metrics plot ---------- */
function drawMetricPlot() {
    const section = document.getElementById("metrics");
    if (STATE.UMAP_TAB === null || !METRIC_TAB) { section.classList.add("disabled"); return; }
    section.classList.remove("disabled");
    renderMetricDesc();

    const K = getTopKValue();
    const mkey = METRIC_TAB;
    const defs = METRIC_DEFS[STATE.UMAP_TAB] || [];
    const def = defs.find(d => d.key === mkey) || { better: "high" };

    const all = METRICS_ROWS.filter(r => Number.isFinite(r[mkey]));
    const byCount = all.slice().sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, K);
    const rows = byCount.sort((a, b) => def.better === "low" ? (a[mkey] - b[mkey]) : (b[mkey] - a[mkey]));

    const classes = rows.map(r => r.class);
    const xvals = rows.map(r => r[mkey]);
    const labels = rows.map((r, i) => Number.isFinite(r.n) ? `${xvals[i].toFixed(3)} (n=${r.n})` : xvals[i].toFixed(3));
    const colors = classes.map(c => colorFor(c));

    // >>> adaptive fonts
    const { tick: tickSize, text: textSize } = fontSizesForCount(classes.length);

    // dynamic height so labels don't collide when K grows
    const BAR_H = 26;            // slightly tighter now
    const TOP_BOT = 90;
    const hPlot = Math.max(220, TOP_BOT + BAR_H * classes.length);

    const trace = {
        type: "bar", orientation: "h",
        y: classes, x: xvals,
        text: labels, textposition: "outside", cliponaxis: false,
        textfont: { size: textSize },                    // <<< shrink bar-label font
        marker: { color: colors, line: { width: 0.5, color: "rgba(0,0,0,0.2)" } }
    };

    const layout = {
        title: { text: `Per-class: ${METRIC_INFO[mkey]?.title || mkey} (Top-${K} by count)`, font: { size: 16 } },
        paper_bgcolor: "#fff", plot_bgcolor: "#fff",
        margin: { l: 220, r: rightMarginForLabels(labels, textSize), t: 40, b: 40 }, // <<< use textSize
        height: hPlot,
        yaxis: {
            type: "category",
            autorange: "reversed",
            tickmode: "array",
            tickvals: classes,
            ticktext: classes,
            tickfont: { size: tickSize },                 // <<< shrink y tick labels
            automargin: true
        },
        xaxis: Object.assign({ showgrid: true, gridcolor: "#e5e7eb", linecolor: "#d1d5db" }, def.axis || { type: "linear" }),
        uniformtext: { minsize: textSize, mode: "show" }, // keep consistent; avoid overlaps
        bargap: 0.18
    };

    Plotly.newPlot("metrics-plot", [trace], layout, { responsive: true, displaylogo: false });
    STATE.METRICS_LAST_CLASSES = classes.slice();

    const el = document.getElementById("metrics-plot");
    el.on?.("plotly_hover", (ev) => { const cls = ev?.points?.[0]?.y; if (cls) setHoverClass(cls); });
    el.on?.("plotly_unhover", () => { clearHoverClass(); });

    updateMetricHighlight();
    schedulePlotsResize();
}

function updateMetricHighlight() {
    if (!STATE.METRICS_LAST_CLASSES?.length) return;
    const gd = document.getElementById("metrics-plot");
    if (!plotReady("metrics-plot")) return;
    const highlight = getHighlightSet();
    const none = highlight.size === 0;
    const op = STATE.METRICS_LAST_CLASSES.map(c => {
        if (none) return 1.0;
        const sel = highlight.has(c);
        return hideUnselected ? (sel ? 1.0 : 0.0) : (sel ? 1.0 : dimOpacity);
    });
    Plotly.restyle(gd, { "marker.opacity": [op] });
}

/* ---------- Split divider ---------- */
const SPLIT_KEY = "spectre_split_frac";
const DIVIDER_W = 6, MIN_LEFT = 220, MIN_RIGHT = 220;
let resizeRAF = 0;

function getSavedFrac() {
    const s = localStorage.getItem(SPLIT_KEY), v = s ? Number(s) : NaN;
    return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.5;
}
function setGridByFrac(frac) {
    const panes = document.getElementById("panes");
    const total = panes.clientWidth || 0;
    const avail = Math.max(0, total - DIVIDER_W);

    let minL = MIN_LEFT, minR = MIN_RIGHT;
    if (avail < (MIN_LEFT + MIN_RIGHT)) {
        const half = Math.max(100, Math.floor(avail / 2));
        minL = half; minR = half;
    }
    const minFrac = avail > 0 ? (minL / avail) : 0.5;
    const maxFrac = avail > 0 ? (1 - (minR / avail)) : 0.5;
    const f = Math.max(minFrac, Math.min(maxFrac, typeof frac === "number" ? frac : 0.5));

    const leftPx = Math.round(avail * f);
    panes.style.gridTemplateColumns = `${leftPx}px ${DIVIDER_W}px 1fr`;
}
function initDividerDrag() {
    const divider = document.getElementById("divider");
    const panes = document.getElementById("panes");
    setGridByFrac(getSavedFrac());

    divider.addEventListener("pointerdown", (e) => {
        if (divider.hidden) return;
        divider.setPointerCapture(e.pointerId);
        divider.classList.add("dragging");
    });
    divider.addEventListener("pointermove", (e) => {
        if (!divider.hasPointerCapture(e.pointerId)) return;
        const rect = panes.getBoundingClientRect();
        const avail = Math.max(1, rect.width - DIVIDER_W);

        let minL = MIN_LEFT, minR = MIN_RIGHT;
        if (avail < (MIN_LEFT + MIN_RIGHT)) { const half = Math.max(100, Math.floor(avail / 2)); minL = half; minR = half; }

        const x = e.clientX - rect.left;
        const minFrac = minL / avail, maxFrac = 1 - (minR / avail);
        let frac = Math.max(minFrac, Math.min(maxFrac, x / avail));

        setGridByFrac(frac);
        localStorage.setItem(SPLIT_KEY, String(frac));
        schedulePlotsResize();
    });
    divider.addEventListener("pointerup", (e) => {
        if (!divider.hasPointerCapture(e.pointerId)) return;
        divider.releasePointerCapture(e.pointerId);
        divider.classList.remove("dragging");
        schedulePlotsResize();
    });
    window.addEventListener("resize", () => {
        if (!divider.hidden) setGridByFrac(getSavedFrac());
        schedulePlotsResize();
    });
}

/* ---------- Resize coordination ---------- */

function schedulePlotsResize() {
    if (resizeRAF) cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => {
        const u = document.getElementById("plot-umap");
        const a = document.getElementById("plot-acc");
        const m = document.getElementById("metrics-plot");
        const c = document.getElementById("chem-plot");
        try { if (c && STATE.CHEM?.ROWS?.length) Plotly.Plots.resize(c); } catch { }
        try { if (u && STATE.UMAP_TAB !== null) Plotly.Plots.resize(u); } catch { }
        try {
            if (a && STATE.ACC_TAB !== null) {
                // keep bar chart capped to its pane height
                setAccPlotHeightToPane();
                Plotly.Plots.resize(a);
            }
        } catch { }
        try { if (m && METRIC_TAB && STATE.UMAP_TAB !== null) Plotly.Plots.resize(m); } catch { }
        try { const cm = document.getElementById("conf-plot"); if (cm) Plotly.Plots.resize(cm); } catch { }
        resizeRAF = 0;
    });
}

/* ---------- UMAP (Top-K view) ---------- */
function computeUMAPView(st) {
    const counts = new Map();
    st.DATA.forEach(d => counts.set(d.c, (counts.get(d.c) || 0) + 1));
    const K = getTopKValue();
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, K).map(([c]) => c);
    const allow = new Set(top);
    st.VIEW = st.DATA.filter(d => allow.has(d.c));
    st.VIEW_CLASSES = allow;
    st.CLASSES = top.slice().sort((a, b) => a.localeCompare(b));
    if (st.SELECTED?.size) for (const c of [...st.SELECTED]) if (!allow.has(c)) st.SELECTED.delete(c);
}

/* ---------- Layout & visibility ---------- */
function clearMetricsWhenNoUMAP() {
    const sec = document.getElementById("metrics");
    sec.classList.add("disabled");
    document.getElementById("metric-tabs").innerHTML = "";
    METRIC_TAB = null;
    try { Plotly.purge("metrics-plot"); } catch { }
    const desc = document.getElementById("metric-desc");
    if (desc) desc.innerHTML = "<em>Select CLS or Tanimoto UMAP to see metrics.</em>";
    STATE.METRICS_LAST_CLASSES = [];
}
function applyLayout() {
    const showUMAP = STATE.UMAP_TAB !== null;
    const showACC = STATE.ACC_TAB !== null;

    const panes = document.getElementById("panes");
    const paneU = document.getElementById("pane-umap");
    const paneA = document.getElementById("pane-acc");
    const divider = document.getElementById("divider");
    const blank = document.getElementById("pane-blank");

    // Visibility
    paneU.hidden = !showUMAP;
    paneA.hidden = !showACC;
    divider.hidden = !(showUMAP && showACC);
    blank.hidden = (showUMAP || showACC);

    // Sidebar section visuals
    document.getElementById("umap-controls").classList.toggle("inactive", !showUMAP);
    document.getElementById("acc-controls").classList.toggle("inactive", !showACC);

    // Grid mode classes (no fixed heights; CSS gives row 1 full viewport)
    const dual = showUMAP && showACC;
    panes.classList.toggle("dual", dual);
    panes.classList.toggle("single", !dual);

    // Clear any stale column template when single
    if (!dual) panes.style.removeProperty("grid-template-columns");

    // Purge hidden plots immediately
    if (!showUMAP) { try { Plotly.purge("plot-umap"); } catch { } }
    if (!showACC) { try { Plotly.purge("plot-acc"); } catch { } }

    // Metrics tabs only when a UMAP is active
    if (!showUMAP) {
        clearMetricsWhenNoUMAP();
    } else {
        renderMetricTabs();
        // we’ll draw after layout
    }

    // Let CSS drive heights; plots fill 100% of their pane
    const uDiv = document.getElementById("plot-umap");
    if (uDiv) uDiv.style.height = "100%";
    const aDiv = document.getElementById("plot-acc");
    if (aDiv) aDiv.style.height = "100%";  // will be overridden in drawBars if needed

    // Draw AFTER layout settles
    requestAnimationFrame(() => {
        if (dual) setGridByFrac(getSavedFrac());   // width split only

        if (showUMAP) initUMAP();
        if (showACC) drawBars();       // may set a taller explicit height for many classes
        if (showUMAP) drawMetricPlot();

        schedulePlotsResize();          // reflow to container sizes
    });
}


/* ---------- UMAP rendering ---------- */
function refreshUMAPColors() {
    if (STATE.UMAP_TAB === null) return;
    const st = currentUMAP();
    st.COLORS = {}; st.CLASSES.forEach(c => st.COLORS[c] = colorFor(c));
}
function renderChecklist() {
    if (STATE.UMAP_TAB === null) return;
    const st = currentUMAP(), list = document.getElementById("class-checklist");
    list.innerHTML = "";
    const q = (document.getElementById("search-input").value || "").toLowerCase();
    const filtered = st.CLASSES.filter(c => c.toLowerCase().includes(q));
    for (const c of filtered) {
        const row = document.createElement("label"); row.className = "chk";
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = st.SELECTED.has(c);
        cb.addEventListener("change", () => {
            cb.checked ? st.SELECTED.add(c) : st.SELECTED.delete(c);
            updateUMAPHighlight(); updateBarHighlight(); updateMetricHighlight();
        });
        const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = st.COLORS[c];
        const txt = document.createElement("span");
        const count = (st.DATA || []).reduce((t, d) => t + (d.c === c), 0);
        txt.textContent = `${c} (${count})`;
        row.append(cb, sw, txt); list.appendChild(row);
    }
}
function drawUMAP() {
    const st = currentUMAP();
    const pts = st.VIEW.length ? st.VIEW : st.DATA;
    const trace = {
        x: pts.map(d => d.x), y: pts.map(d => d.y),
        mode: "markers", type: "scattergl",
        hovertemplate: "x: %{x:.3f}<br>y: %{y:.3f}<br>%{customdata}<extra></extra>",
        customdata: pts.map(d => d.c),
        marker: { size: pointSize, color: pts.map(d => st.COLORS[d.c]), opacity: pts.map(() => 1.0), line: { width: 0.4, color: "rgba(0,0,0,0.25)" } }
    };
    const layout = {
        autosize: true,
        paper_bgcolor: "#fff", plot_bgcolor: "#fff",
        margin: { l: 40, r: 20, t: 10, b: 40 },
        xaxis: { zeroline: false, showgrid: true, gridcolor: "#e5e7eb", linecolor: "#d1d5db", title: "UMAP-1" },
        yaxis: { zeroline: false, showgrid: true, gridcolor: "#e5e7eb", linecolor: "#d1d5db", title: "UMAP-2" },
        dragmode: "pan"
    };
    Plotly.newPlot("plot-umap", [trace], layout, { responsive: true, displaylogo: false });

    const uEl = document.getElementById("plot-umap");
    uEl.on?.("plotly_hover", (ev) => { const cls = ev?.points?.[0]?.customdata; if (cls) setHoverClass(cls); });
    uEl.on?.("plotly_unhover", () => clearHoverClass());

    updateUMAPHighlight(); updateBarHighlight(); updateMetricHighlight();
}
function updateUMAPHighlight() {
    if (STATE.UMAP_TAB === null) return;
    const gd = document.getElementById("plot-umap");
    if (!plotReady("plot-umap")) return;

    const st = currentUMAP();
    const pts = st.VIEW.length ? st.VIEW : st.DATA;
    const highlight = getHighlightSet();
    const none = highlight.size === 0;

    const op = pts.map(d => {
        if (none) return 1.0;
        const sel = highlight.has(d.c);
        return hideUnselected ? (sel ? 1.0 : 0.0) : (sel ? 1.0 : dimOpacity);
    });
    const size = pts.map(d => {
        if (highlight.size === 0) return pointSize;
        return highlight.has(d.c) ? pointSize + 1.5 : pointSize;
    });
    Plotly.restyle(gd, { "marker.opacity": [op], "marker.size": [size] });

    const shown = highlight.size ? [...highlight].join(", ") : `Top-${getTopKValue()} by count`;
    const src = HOVER_CLASS ? "hover" : "selection";
    const stEl = document.getElementById("status-umap");
    if (stEl) stEl.textContent = `UMAP: ${STATE.UMAP_TAB} • Showing: ${shown} (${src})`;
}

function accPaneHeight() {
    const pane = document.getElementById("pane-acc");
    return (pane && !pane.hidden) ? (pane.clientHeight || 0) : 0;
}

function setAccPlotHeightToPane() {
    const h = accPaneHeight();
    if (!h) return;
    const gd = document.getElementById("plot-acc");
    if (!gd) return;
    try { Plotly.relayout(gd, { height: h }); } catch { }
}

/* ---------- Accuracy bars ---------- */
function drawBars() {
    const key = STATE.ACC_TAB; if (!key) return;
    const all = STATE.ACC[key].ROWS.slice();

    // Top-K by count
    const K = Math.max(1, Number(document.getElementById("topk")?.value || 20));
    const byCount = all.slice().sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, K);

    // Sort (MEAN lower=better; others higher=better)
    const wantDesc = document.getElementById("sort-desc").checked;
    const rows = byCount.sort((a, b) => {
        if (key === "MEAN") return (wantDesc ? b.v - a.v : a.v - b.v);
        return (wantDesc ? b.v - a.v : a.v - b.v);
    });

    const classes = rows.map(r => r.c);
    const barColors = classes.map(c => colorFor(c));
    const showN = document.getElementById("show-n").checked;
    const textVals = rows.map(r => (key === "MEAN" ? r.v.toFixed(2) : r.v.toFixed(3)));
    const text = rows.map((r, i) => (showN && Number.isFinite(r.n)) ? `${textVals[i]} (n=${r.n})` : textVals[i]);

    // >>> adaptive fonts based on class count
    const { tick: tickSize, text: textSize } = fontSizesForCount(classes.length);

    // Keep plot capped to pane height
    const aDiv = document.getElementById("plot-acc");
    if (aDiv) aDiv.style.height = "100%";
    const paneH = accPaneHeight() || 400;

    const trace = {
        type: "bar",
        orientation: "h",
        y: classes,
        x: rows.map(r => r.v),
        text,
        textposition: "outside",
        cliponaxis: false,
        textfont: { size: textSize },                // <<< shrink bar-label font
        marker: { color: barColors, line: { width: 0.5, color: "rgba(0,0,0,0.2)" } }
    };

    const titles = { R1: "Rank-1 Accuracy", MEAN: "Mean rank (lower is better)", TANIS: "Tanimoto similarity" };
    const isMean = key === "MEAN";

    const layout = {
        title: { text: `NP superclass — ${titles[key]} (Top-${K} by count)`, font: { size: 16 } },
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#ffffff",
        margin: { l: 220, r: rightMarginForLabels(text, textSize), t: 40, b: 40 }, // <<< use textSize
        height: paneH,
        yaxis: {
            automargin: true,
            autorange: "reversed",
            tickfont: { size: tickSize }               // <<< shrink y tick labels
        },
        xaxis: Object.assign(
            {
                title: isMean ? "Mean rank (log scale, lower is better)" :
                    (key === "TANIS" ? "Similarity" : "Accuracy"),
                showgrid: true, gridcolor: "#e5e7eb", linecolor: "#d1d5db"
            },
            isMean ? { type: "log" } : { range: [0, 1.02] }
        ),
        uniformtext: { minsize: textSize, mode: "show" }, // consistent sizing
        bargap: 0.2
    };

    STATE.ACC[key].LAST_ROWS = classes.slice();
    Plotly.newPlot("plot-acc", [trace], layout, { responsive: true, displaylogo: false });

    const aEl = document.getElementById("plot-acc");
    aEl.on?.("plotly_hover", (ev) => { const cls = ev?.points?.[0]?.y; if (cls) setHoverClass(cls); });
    aEl.on?.("plotly_unhover", () => { clearHoverClass(); });

    const status = document.getElementById("status-acc");
    if (status) status.textContent = `Accuracy: ${key} • Top-${K} by count • ${rows.length} classes shown`;

    updateBarHighlight();
    setAccPlotHeightToPane();
    schedulePlotsResize();
}


function updateBarHighlight() {
    if (STATE.ACC_TAB === null) return;
    const gd = document.getElementById("plot-acc");
    if (!plotReady("plot-acc")) return;
    const key = STATE.ACC_TAB;
    const rows = STATE.ACC[key].LAST_ROWS;
    if (!rows?.length) return;
    const highlight = getHighlightSet();
    const none = highlight.size === 0;
    const op = rows.map(cls => {
        if (none) return 1.0;
        const sel = highlight.has(cls);
        return hideUnselected ? (sel ? 1.0 : 0.0) : (sel ? 1.0 : dimOpacity);
    });
    Plotly.restyle(gd, { "marker.opacity": [op] });
}

function drawChemPlot() {
    const metric = STATE.CHEM.METRIC || "mean_carbons";
    const el = document.getElementById("chem-plot");
    if (!el) return;
    const rowsAll = (STATE.CHEM.ROWS || []).filter(r => Number.isFinite(r[metric]));
    if (!rowsAll.length) {
        // show a tiny placeholder
        el.innerHTML = '<div style="padding:12px;color:#6b7280;border:1px dashed #e5e7eb;border-radius:8px;background:#fafcff;">No chemistry CSV loaded.</div>';
        return;
    }
    const K = chemTopK();
    const byCount = rowsAll.slice().sort((a, b) => (b.n_items || 0) - (a.n_items || 0)).slice(0, K);
    const rows = byCount.sort((a, b) => (b[metric] - a[metric]));
    const classes = rows.map(r => r.c || r.class || r.superclass);
    const colors = classes.map(c => colorFor(c));     // now no more gray on first load

    const xvals = rows.map(r => r[metric]);
    const labels = rows.map((r, i) => `${xvals[i].toFixed(2)} (n=${r.n_items})`);

    // Reuse your shrinking font logic if available; otherwise sane fallback
    const fs = (typeof fontSizesForCount === "function")
        ? fontSizesForCount(classes.length)
        : { tick: (classes.length > 80 ? 8 : (classes.length > 40 ? 10 : 12)), text: (classes.length > 80 ? 9 : (classes.length > 40 ? 11 : 12)) };

    // Dynamic height so all labels can breathe
    const BAR_H = 26, TOP_BOT = 90;
    const hPlot = Math.max(220, TOP_BOT + BAR_H * classes.length);
    el.style.height = hPlot + "px";

    const trace = {
        type: "bar",
        orientation: "h",
        y: classes,
        x: xvals,
        text: labels,
        textposition: "outside",
        cliponaxis: false,
        marker: { color: colors, line: { width: 0.5, color: "rgba(0,0,0,0.2)" } },
        textfont: { size: fs.text }
    };

    const layout = {
        title: { text: `${CHEM_METRICS.find(m => m.key === metric)?.label || metric} (Top-${K} by items)`, font: { size: 16 } },
        paper_bgcolor: "#fff",
        plot_bgcolor: "#fff",
        margin: { l: 220, r: rightMarginForLabels(labels, fs.text), t: 40, b: 40 },
        height: hPlot,
        yaxis: {
            type: "category",
            autorange: "reversed",
            tickmode: "array",
            tickvals: classes,
            ticktext: classes,
            automargin: true,
            tickfont: { size: fs.tick }
        },
        xaxis: { showgrid: true, gridcolor: "#e5e7eb", linecolor: "#d1d5db" },
        bargap: 0.2,
        uniformtext: { minsize: fs.text, mode: classes.length > 150 ? "hide" : "show" }
    };

    Plotly.newPlot(el, [trace], layout, { responsive: true, displaylogo: false });

    STATE.CHEM.LAST_CLASSES = classes.slice();
    renderChemDesc();

    el.on?.("plotly_hover", (ev) => { const cls = ev?.points?.[0]?.y; if (cls) setHoverClass(cls); });
    el.on?.("plotly_unhover", () => clearHoverClass());

    updateChemHighlight();
    schedulePlotsResize();
}

function updateChemHighlight() {
    const classes = STATE.CHEM.LAST_CLASSES || [];
    if (!classes.length) return;
    const gd = document.getElementById("chem-plot");
    if (!gd || !plotReady("chem-plot")) return;

    const highlight = getHighlightSet();
    const none = highlight.size === 0;
    const op = classes.map(c => {
        if (none) return 1.0;
        const sel = highlight.has(c);
        return hideUnselected ? (sel ? 1.0 : 0.0) : (sel ? 1.0 : dimOpacity);
    });
    Plotly.restyle(gd, { "marker.opacity": [op] });
}


/* ---------- Init helpers ---------- */
function initUMAP() {
    const st = currentUMAP();
    if (!(st.SELECTED instanceof Set)) st.SELECTED = new Set();
    computeUMAPView(st);
    refreshUMAPColors();
    renderChecklist();
    drawUMAP();
}

/* ---------- Data loading ---------- */
async function fetchText(url) { const res = await fetch(url, { cache: "no-cache" }); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); }
async function loadUMAPFromUrl(url, tabKey) { try { const rows = parseUMAPCSV(await fetchText(url)); Object.assign(STATE[tabKey], { DATA: rows, SELECTED: new Set(), CLASSES: [] }); return true; } catch { return false; } }
async function loadACCFromUrl(url, accKey) { try { STATE.ACC[accKey].ROWS = parseAccuracyCSV(await fetchText(url)); return true; } catch { return false; } }
async function loadConfusionCounts(url) {
    try {
        const txt = await fetchText(url);
        return parseConfusionCSV(txt);
    } catch { return null; }
}


/* ---------- Tab toggles ---------- */
function toggleUMAPTab(tab) {
    const isSelected = (STATE.UMAP_TAB === tab);
    STATE.UMAP_TAB = isSelected ? null : tab;
    document.getElementById("tab-CLS").setAttribute("aria-selected", STATE.UMAP_TAB === "CLS");
    document.getElementById("tab-TANI").setAttribute("aria-selected", STATE.UMAP_TAB === "TANI");
    HOVER_CLASS = null;
    applyLayout();
}
function toggleACCTab(tab) {
    const isSelected = (STATE.ACC_TAB === tab);
    STATE.ACC_TAB = isSelected ? null : tab;
    document.getElementById("acc-R1").setAttribute("aria-selected", STATE.ACC_TAB === "R1");
    document.getElementById("acc-MEAN").setAttribute("aria-selected", STATE.ACC_TAB === "MEAN");
    document.getElementById("acc-TANIS").setAttribute("aria-selected", STATE.ACC_TAB === "TANIS");
    if (STATE.ACC_TAB === "MEAN") document.getElementById("sort-desc").checked = false;
    if (STATE.ACC_TAB === "R1" || STATE.ACC_TAB === "TANIS") document.getElementById("sort-desc").checked = true;
    HOVER_CLASS = null;
    applyLayout();
}

/* Build Top-K (+Other) counts matrix from a full counts matrix. */
function aggregateConfusionCounts(data, topK) {
    const { trueLabels, predLabels, counts } = data;
    const rowTotals = trueLabels.map((_, i) => counts[i].reduce((a, b) => a + b, 0));

    // choose the K most frequent "true" classes
    const order = rowTotals.map((t, i) => [i, t]).sort((a, b) => b[1] - a[1]);
    const keepIdx = order.slice(0, Math.max(1, topK)).map(([i]) => i);
    const keepSet = new Set(keepIdx);
    const keptLabels = keepIdx.map(i => trueLabels[i]);

    // we will keep the SAME label set on columns for readability
    const keepPredSet = new Set(keptLabels);
    const n = keptLabels.length + 1; // +Other
    const z = Array.from({ length: n }, () => Array(n).fill(0));

    // fill kept rows
    keepIdx.forEach((ri, r) => {
        let otherCol = 0;
        for (let pj = 0; pj < predLabels.length; pj++) {
            const plabel = predLabels[pj];
            const v = counts[ri][pj] || 0;
            if (keepPredSet.has(plabel)) {
                const c = keptLabels.indexOf(plabel);
                z[r][c] += v;
            } else {
                otherCol += v;
            }
        }
        z[r][n - 1] = otherCol;
    });

    // aggregate "Other" row
    const otherRow = Array(n).fill(0);
    trueLabels.forEach((tlabel, ri) => {
        if (keepSet.has(ri)) return;
        let otherCol = 0;
        for (let pj = 0; pj < predLabels.length; pj++) {
            const plabel = predLabels[pj];
            const v = counts[ri][pj] || 0;
            if (keepPredSet.has(plabel)) {
                const c = keptLabels.indexOf(plabel);
                otherRow[c] += v;
            } else {
                otherCol += v;
            }
        }
        otherRow[n - 1] += otherCol;
    });
    z[n - 1] = otherRow;

    return { xLabels: keptLabels.concat("Other"), yLabels: keptLabels.concat("Other"), counts: z };
}

function normalizeRows(matrix) {
    return matrix.map(row => {
        const s = row.reduce((a, b) => a + b, 0);
        return s > 0 ? row.map(v => v / s) : row.map(() => 0);
    });
}

/* Color scales: calmer, colorblind-safe */
const CM_COLOR_SCALES = {
    row: "Cividis",   // perceptually uniform, not super blue
    counts: "YlOrRd"  // warm sequential for magnitudes
};

function flatten2D(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr[i].length; j++) out.push(arr[i][j]);
    return out;
}
function quantile(sortedArr, q) {  // sorted ascending
    if (!sortedArr.length) return 0;
    const pos = (sortedArr.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sortedArr[base + 1] !== undefined) {
        return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
    }
    return sortedArr[base];
}
function fontSizeForCats(n) {
    if (n >= 80) return 8;
    if (n >= 60) return 9;
    if (n >= 40) return 10;
    if (n >= 28) return 11;
    return 12;
}

// Rough, but works well for -45° to -65° angles
function topMarginForTopTicks(labels, tickPx, angleDeg = 55) {
    if (!labels?.length) return 80;
    const maxChars = labels.reduce((m, s) => Math.max(m, (s || "").length), 0);
    const charW = tickPx * 0.62;            // ≈ px per character
    const rad = (Math.abs(angleDeg) * Math.PI) / 180;
    const labelBand = Math.sin(rad) * (maxChars * charW) + tickPx * 1.2; // rotated label "height"
    // title band (~28–34px) + a bit of breathing room
    return Math.max(90, Math.min(220 + 34, Math.round(labelBand) + 34));
}

/* ---------- Confusion Matrix plot ---------- */
function drawConfusion() {
    // read settings from button tabs + input
    const kTabs = document.getElementById("cm-k-tabs");
    const modeTabs = document.getElementById("cm-mode-tabs");
    const topkEl = document.getElementById("cm-topk");

    const kBtn = kTabs?.querySelector('button[aria-selected="true"]');
    const modeBtn = modeTabs?.querySelector('button[aria-selected="true"]');

    const k = Number(kBtn?.dataset.k || STATE.CONF.settings.k || 1);
    const mode = (modeBtn?.dataset.mode || STATE.CONF.settings.mode || "row");
    const topK = Math.max(1, Number(topkEl?.value || STATE.CONF.settings.topk || 20));

    STATE.CONF.settings = { k, mode, topk: topK };

    const base = STATE.CONF.DATA[k];
    if (!base) { try { Plotly.purge("conf-plot"); } catch { }; return; }

    const agg = aggregateConfusionCounts(base, topK);
    const zCounts = agg.counts;
    const z = (mode === "row") ? normalizeRows(zCounts) : zCounts;

    // colorscale + dynamic max for counts so outliers don’t wash it out
    let coloraxis;
    if (mode === "row") {
        coloraxis = { cmin: 0, cmax: 1, colorscale: CM_COLOR_SCALES.row };
    } else {
        const flat = flatten2D(zCounts).filter(v => v > 0).sort((a, b) => a - b);
        const vmax = flat.length ? quantile(flat, 0.98) : 1;
        coloraxis = { cmin: 0, cmax: vmax, colorscale: CM_COLOR_SCALES.counts };
    }

    const hovertemplate = mode === "row"
        ? "True: %{y}<br>Pred: %{x}<br>Fraction: %{z:.3f}<extra></extra>"
        : "True: %{y}<br>Pred: %{x}<br>Count: %{z}<extra></extra>";

    // height + tick font sizing
    const nCats = agg.xLabels.length;
    const rowH = 26;
    const basePad = 160;
    const h = Math.max(380, Math.min(900, basePad + rowH * nCats));
    const tickSize = fontSizeForCats(nCats);
    const tickAngle = -55;  // a touch steeper to avoid collisions

    const layout = {
        title: {
            text: `Confusion Matrix — k=${k} (${mode === "row" ? "row-normalized" : "counts"})`,
            font: { size: 16 },
            y: 0.995,           // sit at the very top of the paper
            yanchor: "top",
            pad: { t: 2, b: 10 } // add space BELOW title
        },
        paper_bgcolor: "#fff",
        plot_bgcolor: "#fff",
        margin: {
            l: 220,
            r: 40,
            t: topMarginForTopTicks(agg.xLabels, tickSize, Math.abs(tickAngle)), // dynamic room for top ticks
            b: 80
        },
        height: h,
        xaxis: {
            side: "top",
            tickangle: tickAngle,
            ticklabelposition: "outside top",
            automargin: true,
            tickfont: { size: tickSize }
        },
        yaxis: {
            autorange: "reversed",
            automargin: true,
            tickfont: { size: tickSize }
        },
        coloraxis
    };

    Plotly.newPlot("conf-plot", [{
        type: "heatmap",
        z,
        x: agg.xLabels,
        y: agg.yLabels,
        coloraxis: "coloraxis",
        hovertemplate
    }], layout, { responsive: true, displaylogo: false });

    schedulePlotsResize();
}

function initConfControls() {
    const kTabs = document.getElementById("cm-k-tabs");
    const modeTabs = document.getElementById("cm-mode-tabs");
    const topkEl = document.getElementById("cm-topk");

    if (kTabs) {
        kTabs.addEventListener("click", (e) => {
            const b = e.target.closest("button[data-k]");
            if (!b) return;
            kTabs.querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", "false"));
            b.setAttribute("aria-selected", "true");
            drawConfusion();
        });
    }
    if (modeTabs) {
        modeTabs.addEventListener("click", (e) => {
            const b = e.target.closest("button[data-mode]");
            if (!b) return;
            modeTabs.querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", "false"));
            b.setAttribute("aria-selected", "true");
            drawConfusion();
        });
    }
    if (topkEl) {
        topkEl.addEventListener("input", drawConfusion);
    }

    // Reflect current state into UI (in case you change defaults elsewhere)
    const { k, mode } = STATE.CONF.settings || { k: 1, mode: "row" };
    const kBtn = kTabs?.querySelector(`button[data-k="${k}"]`);
    const mBtn = modeTabs?.querySelector(`button[data-mode="${mode}"]`);
    if (kBtn) { kTabs.querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", "false")); kBtn.setAttribute("aria-selected", "true"); }
    if (mBtn) { modeTabs.querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", "false")); mBtn.setAttribute("aria-selected", "true"); }
}


// UI events
["cm-k", "cm-mode", "cm-topk"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", drawConfusion);
});




/* ---------- Wire UI ---------- */
document.getElementById("tab-CLS").addEventListener("click", () => toggleUMAPTab("CLS"));
document.getElementById("tab-TANI").addEventListener("click", () => toggleUMAPTab("TANI"));
document.getElementById("acc-R1").addEventListener("click", () => toggleACCTab("R1"));
document.getElementById("acc-MEAN").addEventListener("click", () => toggleACCTab("MEAN"));
document.getElementById("acc-TANIS").addEventListener("click", () => toggleACCTab("TANIS"));

document.getElementById("point-size").addEventListener("input", (e) => { pointSize = Number(e.target.value); updateUMAPHighlight(); updateBarHighlight(); updateMetricHighlight(); });
document.getElementById("dim-opacity").addEventListener("input", (e) => { dimOpacity = Number(e.target.value); updateUMAPHighlight(); updateBarHighlight(); updateMetricHighlight(); });
document.getElementById("hide-unselected").addEventListener("change", (e) => { hideUnselected = e.target.checked; updateUMAPHighlight(); updateBarHighlight(); updateMetricHighlight(); });
document.getElementById("search-input").addEventListener("input", () => renderChecklist());
document.getElementById("sort-desc").addEventListener("change", () => drawBars());
document.getElementById("show-n").addEventListener("change", () => drawBars());
document.getElementById("topk").addEventListener("input", () => {
    if (STATE.UMAP_TAB !== null) initUMAP();  // recompute view + redraw
    drawBars();                              // redraw bars
    drawMetricPlot();                        // redraw metrics
});
document.getElementById("chem-topk")?.addEventListener("input", () => drawChemPlot());

/* ---------- Boot ---------- */
(async () => {
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

    try { METRICS_ROWS = parseMetricsCSV(await fetchText("data/metrics.csv")); } catch { METRICS_ROWS = []; }

    // Load chemical composition/NMR CSV (change path if needed)
    try {
        STATE.CHEM.ROWS = parseChemCSV(await fetchText("data/chem_summary.csv"));
    } catch {
        STATE.CHEM.ROWS = [];
    }

    // --- Confusion Matrix datasets (counts only; we'll normalize rows in code)
    for (const kk of [1, 5, 10]) {
        const f = CONF_FILES[kk]?.counts;
        if (f) STATE.CONF.DATA[kk] = await loadConfusionCounts(f);
    }

    // Build chem UI and first render
    renderChemTabs();
    rebuildGlobalColors();
    initConfControls();
    drawConfusion();
    drawChemPlot();
    renderMetricTabs();           // creates metric buttons for default UMAP
    // Defaults: CLS UMAP + R1 bars per your earlier flow
    STATE.UMAP_TAB = "CLS";
    STATE.ACC_TAB = "R1";
    document.getElementById("tab-CLS").setAttribute("aria-selected", true);
    document.getElementById("tab-TANI").setAttribute("aria-selected", false);
    document.getElementById("acc-R1").setAttribute("aria-selected", true);
    document.getElementById("acc-MEAN").setAttribute("aria-selected", false);
    document.getElementById("acc-TANIS").setAttribute("aria-selected", false);

    applyLayout();
    initDividerDrag();
    ["plot-umap", "plot-acc", "metrics-plot", "chem-plot"].forEach(id => {
        const el = document.getElementById(id);
        if (el && typeof ResizeObserver !== "undefined") {
            new ResizeObserver(() => schedulePlotsResize()).observe(el);
        }
    });
    schedulePlotsResize();
})();

/* ---------- Help drawer (robust) ---------- */
(() => {
    const HELP_BTN_ID = 'help-btn';
    const DRAWER_ID = 'help-drawer';
    const OVERLAY_ID = 'help-overlay';
    const CLOSE_ID = 'help-close';
    let lastFocus = null;

    function qs(id) { return document.getElementById(id); }

    // Create minimal drawer/overlay if not present
    function ensureDOM() {
        let drawer = qs(DRAWER_ID);
        if (!drawer) {
            drawer = document.createElement('aside');
            drawer.id = DRAWER_ID;
            drawer.className = 'help-drawer';
            drawer.setAttribute('role', 'dialog');
            drawer.setAttribute('aria-modal', 'true');
            drawer.setAttribute('aria-hidden', 'true');
            drawer.tabIndex = -1;
            drawer.innerHTML = `
        <header class="help-drawer__header">
          <button id="${CLOSE_ID}" class="help-close" aria-label="Close help">✕</button>
          <h2 id="help-title">How to use this dashboard</h2>
        </header>
        <div class="help-drawer__body">
          <h3>Tabs</h3>
          <ul>
            <li><strong>CLS/Tanimoto UMAP</strong> — toggle the scatter & metrics.</li>
            <li><strong>Rank-1/Mean-rank/Tanimoto</strong> — accuracy bar chart.</li>
          </ul>
          <h3>UMAP Sidebar</h3>
          <ul>
            <li>Search, class checklist, point styling.</li>
          </ul>
          <h3>Accuracy Sidebar</h3>
          <ul>
            <li>Sort, show sample size, Top-K by count.</li>
          </ul>
          <h3>Clustering Metrics</h3>
          <ul>
            <li>Select a metric tab; read the explanation box.</li>
          </ul>
          <h3>Chem/NMR</h3>
          <ul>
            <li>Choose metric; Top-K filters classes; colors match palette.</li>
          </ul>
          <h3>Tips</h3>
          <ul>
            <li>Drag center divider to resize; panels scroll if needed.</li>
            <li>Shortcuts: <strong>?</strong>/<strong>H</strong> to open, <strong>Esc</strong> to close.</li>
          </ul>
        </div>`;
            document.body.appendChild(drawer);
        }
        let overlay = qs(OVERLAY_ID);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = OVERLAY_ID;
            overlay.className = 'help-overlay';
            overlay.hidden = true;
            document.body.appendChild(overlay);
        }
        return { drawer, overlay, closeBtn: drawer.querySelector(`#${CLOSE_ID}`) };
    }

    function focusables(root) {
        return Array.from(root.querySelectorAll(
            'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ));
    }

    function trapFocus(e, drawer) {
        if (e.key !== 'Tab') return;
        const nodes = focusables(drawer);
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }

    function openHelp() {
        const btn = qs(HELP_BTN_ID);
        const { drawer, overlay } = ensureDOM();
        lastFocus = document.activeElement;

        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        btn?.setAttribute('aria-expanded', 'true');
        overlay.hidden = false;
        overlay.classList.add('open');
        document.body.classList.add('help-open');

        const nodes = focusables(drawer);
        (nodes[0] || drawer).focus();

        const tf = (e) => trapFocus(e, drawer);
        drawer._tf = tf;
        drawer.addEventListener('keydown', tf);

        const onEsc = (e) => { if (e.key === 'Escape') closeHelp(); };
        drawer._esc = onEsc;
        document.addEventListener('keydown', onEsc);
    }

    function closeHelp() {
        const btn = qs(HELP_BTN_ID);
        const { drawer, overlay } = ensureDOM();

        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        btn?.setAttribute('aria-expanded', 'false');
        overlay.classList.remove('open');
        document.body.classList.remove('help-open');

        setTimeout(() => { overlay.hidden = true; }, 200);

        if (drawer._tf) drawer.removeEventListener('keydown', drawer._tf);
        if (drawer._esc) document.removeEventListener('keydown', drawer._esc);

        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    // Wire once the page has the button (drawer/overlay are created on demand)
    const helpBtn = qs(HELP_BTN_ID);
    if (!helpBtn) return;   // no button => no feature (nothing crashes)

    helpBtn.addEventListener('click', openHelp);

    // Delegate clicks for dynamically created nodes
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.id === OVERLAY_ID || t.id === CLOSE_ID) closeHelp();
    });

    // Global shortcut to open
    document.addEventListener('keydown', (e) => {
        const drawer = qs(DRAWER_ID);
        const isOpen = !!drawer && drawer.classList.contains('open');
        if (!isOpen && (e.key === '?' || e.key === 'h' || e.key === 'H')) {
            // ignore when typing in inputs
            const tag = (document.activeElement?.tagName || '').toLowerCase();
            if (tag !== 'input' && tag !== 'textarea') { openHelp(); }
        }
    });
})();

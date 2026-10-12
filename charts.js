// Small SVG chart primitives: line (crosshair + tooltip), columns, horizontal bars.
// Each chart re-renders on resize; text goes through textContent only.
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const div = (cls, parent, text) => {
  const e = document.createElement("div");
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const observed = new WeakMap();
function mount(el, render) {
  observed.set(el, render);
  if (!el._ro) {
    let lastW = 0;
    el._ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w && Math.abs(w - lastW) > 1) {
        lastW = w;
        observed.get(el)();
      }
    });
    el._ro.observe(el);
  }
  render();
}

export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
  return ticks;
}

function tooltip(el) {
  let t = el.querySelector(":scope > .tip");
  if (!t) t = div("tip", el);
  return {
    show(x, y, header, rows) {
      t.replaceChildren();
      if (header) div("tip-h", t, header);
      for (const r of rows) {
        const row = div("tip-r", t);
        if (r.color) {
          const key = div(r.kind === "box" ? "key-box" : "key-line", row);
          key.style.background = r.color;
        }
        div("tip-v", row, r.value);
        if (r.label) div("tip-l", row, r.label);
      }
      t.style.display = "block";
      const pad = 12;
      const w = t.offsetWidth;
      const left = x + pad + w > el.clientWidth ? x - pad - w : x + pad;
      t.style.left = `${Math.max(0, left)}px`;
      t.style.top = `${Math.max(0, y - t.offsetHeight / 2)}px`;
    },
    hide() {
      t.style.display = "none";
    },
  };
}

function legend(el, series) {
  if (series.length < 2) return;
  const lg = div("legend", el);
  for (const s of series) {
    const item = div("legend-i", lg);
    div(s.kind === "box" ? "key-box" : "key-line", item).style.background = s.color;
    div(null, item, s.label);
  }
}

function frame(el, height, yTicks, yFmt) {
  el.querySelector(":scope > svg")?.remove();
  const width = Math.max(240, el.clientWidth);
  const yLabelW = Math.max(...yTicks.map((t) => yFmt(t).length)) * 7 + 10;
  const m = { l: yLabelW, r: 12, t: 12, b: 26 };
  const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "plot" });
  el.appendChild(svg);
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  const yMax = yTicks[yTicks.length - 1];
  const y = (v) => m.t + ph - (v / yMax) * ph;
  for (const t of yTicks) {
    svgEl("line", { x1: m.l, x2: m.l + pw, y1: y(t), y2: y(t), class: t === 0 ? "axis" : "grid" }, svg);
    svgEl("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end", class: "tick" }, svg).textContent = yFmt(t);
  }
  return { svg, m, pw, ph, y, width };
}

function xTicks(xs, pw, minGap = 64) {
  const n = Math.max(1, Math.floor(pw / minGap));
  const step = Math.max(1, Math.ceil(xs.length / n));
  return xs.filter((_, i) => i % step === 0);
}

// series: [{label, color, points: [[x, y], ...]}]; x numeric (ms or index)
export function lineChart(el, opts) {
  mount(el, () => renderLine(el, opts));
}

function renderLine(el, { series, height = 240, xFmt, xTipFmt, yFmt, area = false, markers = [], yMaxHint = 0, xDomain, xTickValues }) {
  el.replaceChildren();
  legend(el, series);
  const all = series.flatMap((s) => s.points.filter((p) => p[1] != null));
  if (!all.length) return div("empty", el, "Sem dados para este período.");
  const xs = [...new Set(all.map((p) => p[0]))].sort((a, b) => a - b);
  const yTicks = niceTicks(Math.max(yMaxHint, ...all.map((p) => p[1])));
  const f = frame(el, height, yTicks, yFmt);
  const [x0, x1] = xDomain || [xs[0], xs[xs.length - 1]];
  const x = (v) => f.m.l + (x1 === x0 ? f.pw / 2 : ((v - x0) / (x1 - x0)) * f.pw);
  for (const t of xTickValues || xTicks(xs, f.pw)) {
    svgEl("text", { x: x(t), y: f.m.t + f.ph + 18, "text-anchor": "middle", class: "tick" }, f.svg).textContent = xFmt(t);
  }
  for (const mk of markers) {
    if (mk.x < x0 || mk.x > x1) continue;
    svgEl("line", { x1: x(mk.x), x2: x(mk.x), y1: f.m.t, y2: f.m.t + f.ph, class: "marker" }, f.svg);
    svgEl("text", { x: x(mk.x) + 3, y: f.m.t + 9, class: "marker-l" }, f.svg).textContent = mk.label;
  }
  for (const s of series) {
    const pts = s.points.filter((p) => p[1] != null);
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${f.y(p[1]).toFixed(1)}`).join("");
    if (area && series.length === 1) {
      const base = f.y(0).toFixed(1);
      svgEl("path", { d: `${d}L${x(pts[pts.length - 1][0]).toFixed(1)},${base}L${x(pts[0][0]).toFixed(1)},${base}Z`, fill: s.color, class: "area" }, f.svg);
    }
    svgEl("path", { d, stroke: s.color, class: "line" }, f.svg);
    if (pts.length === 1) svgEl("circle", { cx: x(pts[0][0]), cy: f.y(pts[0][1]), r: 4, fill: s.color, class: "dot" }, f.svg);
  }
  const hover = svgEl("g", { class: "hover", visibility: "hidden" }, f.svg);
  const cross = svgEl("line", { y1: f.m.t, y2: f.m.t + f.ph, class: "cross" }, hover);
  const dots = series.map((s) => svgEl("circle", { r: 4, fill: s.color, class: "dot" }, hover));
  const hit = svgEl("rect", { x: f.m.l, y: f.m.t, width: f.pw, height: f.ph, class: "hit", tabindex: 0 }, f.svg);
  hit.setAttribute("aria-label", "Gráfico: use as setas para ler os valores");
  const tip = tooltip(el);
  const lookup = series.map((s) => new Map(s.points.map((p) => [p[0], p[1]])));
  let idx = -1;
  const showAt = (i) => {
    idx = Math.max(0, Math.min(xs.length - 1, i));
    const xv = xs[idx];
    const px = x(xv);
    cross.setAttribute("x1", px);
    cross.setAttribute("x2", px);
    const rows = [];
    series.forEach((s, k) => {
      const v = lookup[k].get(xv);
      dots[k].setAttribute("visibility", v == null ? "hidden" : "visible");
      if (v == null) return;
      dots[k].setAttribute("cx", px);
      dots[k].setAttribute("cy", f.y(v));
      rows.push({ color: s.color, value: yFmt(v, true), label: series.length > 1 ? s.label : null, v });
    });
    rows.sort((a, b) => b.v - a.v);
    hover.setAttribute("visibility", "visible");
    tip.show(px, f.m.t + f.ph / 3, (xTipFmt || xFmt)(xv), rows);
  };
  const nearest = (px) => {
    let best = 0;
    xs.forEach((v, i) => {
      if (Math.abs(x(v) - px) < Math.abs(x(xs[best]) - px)) best = i;
    });
    return best;
  };
  hit.addEventListener("pointermove", (e) => showAt(nearest(e.clientX - f.svg.getBoundingClientRect().left)));
  hit.addEventListener("pointerleave", () => {
    hover.setAttribute("visibility", "hidden");
    tip.hide();
  });
  hit.addEventListener("focus", () => showAt(idx < 0 ? xs.length - 1 : idx));
  hit.addEventListener("blur", () => {
    hover.setAttribute("visibility", "hidden");
    tip.hide();
  });
  hit.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      showAt(idx + (e.key === "ArrowLeft" ? -1 : 1));
    }
  });
}

// points: [{x, y, label?}] evenly spaced columns
export function columnChart(el, opts) {
  mount(el, () => renderColumns(el, opts));
}

function colPath(x, y, w, base) {
  const r = Math.min(4, w / 2, Math.max(0, base - y));
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

function renderColumns(el, { points, height = 220, xFmt, xTipFmt, yFmt, color, markers = [], seriesLabel }) {
  el.replaceChildren();
  if (!points.length || points.every((p) => !p.y)) return div("empty", el, "Sem dados para este período.");
  const yTicks = niceTicks(Math.max(...points.map((p) => p.y || 0)));
  const f = frame(el, height, yTicks, yFmt);
  const band = f.pw / points.length;
  const w = Math.max(1, Math.min(24, band - 2));
  const base = f.y(0);
  const markerAt = new Map(markers.map((m) => [m.x, m]));
  const bars = points.map((p, i) => {
    const bx = f.m.l + i * band + (band - w) / 2;
    if (markerAt.has(p.x)) {
      const mx = bx + w / 2;
      svgEl("line", { x1: mx, x2: mx, y1: f.m.t, y2: base, class: "marker" }, f.svg);
      svgEl("text", { x: mx + 3, y: f.m.t + 9, class: "marker-l" }, f.svg).textContent = markerAt.get(p.x).label;
    }
    return p.y ? svgEl("path", { d: colPath(bx, f.y(p.y), w, base), fill: color, class: "col" }, f.svg) : null;
  });
  for (const t of xTicks(points.map((_, i) => i), f.pw)) {
    svgEl("text", { x: f.m.l + t * band + band / 2, y: f.m.t + f.ph + 18, "text-anchor": "middle", class: "tick" }, f.svg).textContent = xFmt(points[t].x);
  }
  const tip = tooltip(el);
  const hits = svgEl("g", {}, f.svg);
  points.forEach((p, i) => {
    const h = svgEl("rect", { x: f.m.l + i * band, y: f.m.t, width: Math.max(band, 1), height: f.ph, class: "hit", tabindex: i === points.length - 1 ? 0 : -1 }, hits);
    const on = () => {
      bars.forEach((b, k) => b && b.classList.toggle("dim", k !== i));
      const rows = [{ value: yFmt(p.y || 0, true), label: seriesLabel || null }];
      if (markerAt.has(p.x)) rows.push({ value: markerAt.get(p.x).note || markerAt.get(p.x).label });
      tip.show(f.m.l + i * band + band / 2, f.y(p.y || 0), (xTipFmt || xFmt)(p.x), rows);
    };
    const off = () => {
      bars.forEach((b) => b && b.classList.remove("dim"));
      tip.hide();
    };
    h.addEventListener("pointerenter", on);
    h.addEventListener("pointerleave", off);
    h.addEventListener("focus", on);
    h.addEventListener("blur", off);
    h.addEventListener("keydown", (e) => {
      const next = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
      if (next == null || next < 0 || next >= points.length) return;
      e.preventDefault();
      hits.children[next].focus();
    });
  });
}

// rows: [{label, value, detail: [[label, text]]}] — one series, so one color
export function hbarChart(el, { rows, fmt, color }) {
  el.replaceChildren();
  if (!rows.length) return div("empty", el, "Sem dados.");
  const max = Math.max(...rows.map((r) => r.value || 0)) || 1;
  const tip = tooltip(el);
  for (const r of rows) {
    const row = div("hbar", el);
    row.tabIndex = 0;
    div("hbar-l", row, r.label);
    const track = div("hbar-t", row);
    const bar = div("hbar-b", track);
    bar.style.width = `${Math.max(0.5, ((r.value || 0) / max) * 100)}%`;
    bar.style.background = color;
    div("hbar-v", track, fmt(r.value || 0));
    const on = () => {
      const box = row.getBoundingClientRect();
      const host = el.getBoundingClientRect();
      tip.show(box.left - host.left + box.width * 0.4, box.top - host.top + box.height / 2, r.label,
        (r.detail || []).map(([label, value]) => ({ label, value })));
    };
    row.addEventListener("pointerenter", on);
    row.addEventListener("focus", on);
    row.addEventListener("pointerleave", () => tip.hide());
    row.addEventListener("blur", () => tip.hide());
  }
}

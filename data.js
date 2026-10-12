// Formatting, aggregation and small DOM helpers shared by the views.
const nf = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const PT_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });

export const fmtInt = (v) => (v == null ? "—" : nf.format(Math.round(v)));
export const fmtSigned = (v) => (v == null ? "—" : (v > 0 ? "+" : "") + nf.format(Math.round(v)));
export const fmtPct = (v, d = 1) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
export const fmtHours = (v) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
export const fmtAxis = (v) => (Math.abs(v) >= 10000 ? compact.format(v) : nf.format(v));
export function fmtDur(s) {
  if (s == null) return "—";
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const METRICS = [
  { key: "views", label: "Views", fmt: fmtInt, axis: fmtAxis, sum: true },
  { key: "impr", label: "Impressões", fmt: fmtInt, axis: fmtAxis, sum: true },
  { key: "ctr", label: "CTR", fmt: (v) => fmtPct(v), axis: (v) => fmtPct(v, 0) },
  { key: "avd", label: "Duração média", fmt: fmtDur, axis: fmtDur },
  { key: "avp", label: "% assistida", fmt: (v) => fmtPct(v), axis: (v) => fmtPct(v, 0) },
  { key: "wt", label: "Horas assistidas", fmt: fmtHours, axis: fmtAxis, sum: true },
  { key: "subs", label: "Inscritos", fmt: fmtSigned, axis: fmtAxis, sum: true },
];
export const metric = (key) => METRICS.find((m) => m.key === key);

// "2026-10-11" helpers (Studio days are Pacific-time calendar days)
export const pacificDay = (sec) => PT_DAY.format(new Date(sec * 1000));
export const addDays = (d, n) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
export const dayShort = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export function dayLong(d) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
// Times are always shown in São Paulo time, whatever the device's zone.
const SP = "America/Sao_Paulo";
const SP_HOUR = new Intl.DateTimeFormat("pt-BR", { timeZone: SP, hour: "2-digit", hourCycle: "h23" });
const SP_DAY = new Intl.DateTimeFormat("pt-BR", { timeZone: SP, day: "2-digit", month: "2-digit" });
const SP_DT = new Intl.DateTimeFormat("pt-BR", { timeZone: SP, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const spHour = (ms) => SP_HOUR.format(new Date(ms)).padStart(2, "0");
export const hourShort = (ms) => `${Number(spHour(ms))}h`;
export const hourTick = (ms) => `${SP_DAY.format(new Date(ms))} ${Number(spHour(ms))}h`;
export const hourLong = (ms) => `${SP_DAY.format(new Date(ms))}, ${spHour(ms)}:00–${spHour(ms + 3600000)}:00`;
export const dateTime = (ms) => SP_DT.format(new Date(ms)).replace(" ", " às ").replace(",", "");

// Sums for counts, impression-weighted CTR, view-weighted duration and %.
export function aggregate(rows) {
  let views = 0, impr = 0, clicks = 0, wt = 0, subs = 0, avdW = 0, avpW = 0, wViews = 0;
  for (const r of rows) {
    views += r.views || 0;
    impr += r.impr || 0;
    clicks += ((r.ctr || 0) * (r.impr || 0)) / 100;
    wt += r.wt || 0;
    subs += r.subs || 0;
    if (r.avd != null && r.views) {
      avdW += r.avd * r.views;
      avpW += (r.avp || 0) * r.views;
      wViews += r.views;
    }
  }
  return {
    views, impr, wt, subs,
    ctr: impr ? (clicks / impr) * 100 : null,
    avd: wViews ? avdW / wViews : null,
    avp: wViews ? avpW / wViews : null,
  };
}

export const inRange = (rows, from, to) => rows.filter((r) => r.d >= from && r.d <= to);

// DOM builder: h("div", {class: "x"}, "text", child). Strings become text nodes.
export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return e;
}

export const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"];
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const shortTitle = (t, n = 42) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// A card with a "Tabela" toggle so every chart has a table twin.
export function chartCard(title, sub, tableFn) {
  const body = h("div", { class: "chart" });
  const tableBox = h("div", { class: "tablewrap", hidden: true });
  const toggle = h("button", { class: "linkbtn", type: "button" }, "Ver tabela");
  toggle.addEventListener("click", () => {
    const showTable = tableBox.hidden;
    if (showTable) {
      const { head, rows } = tableFn();
      tableBox.replaceChildren(
        h("table", {}, h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))),
          h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))),
      );
    }
    tableBox.hidden = !showTable;
    body.hidden = showTable;
    toggle.textContent = showTable ? "Ver gráfico" : "Ver tabela";
  });
  const card = h("div", { class: "card" },
    h("div", { class: "card-h" }, h("div", {}, h("h3", {}, title), sub ? h("div", { class: "sub" }, sub) : null), tableFn ? toggle : null),
    body, tableBox);
  return { card, body };
}

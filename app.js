// Painel GNB: unlock, then render the channel view from the decrypted Studio data.
import { columnChart, lineChart, hbarChart } from "./charts.js";
import * as D from "./data.js";
import * as C from "./crypto.js";
import { detailSection, compareSection } from "./views.js";

const { h } = D;
const $ = (s) => document.querySelector(s);
const PERIODS = [[7, "7 dias"], [28, "28 dias"], [90, "90 dias"], [0, "Tudo"], [-1, "Personalizado"]];
const REFRESH_MS = 10 * 60000;
const STALE_MS = 150 * 60000;
const TRAILER_MAX_SEC = 120; // shorter uploads are the channel trailer, not a numbered video
const prefs = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`painel-gnb-${k}`);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`painel-gnb-${k}`, JSON.stringify(v));
    } catch {
      /* per-device convenience only */
    }
  },
};

export const state = {
  env: null, key: null, data: null,
  period: prefs.get("period", 28),
  from: prefs.get("from", null),
  to: prefs.get("to", null),
  metric: prefs.get("metric", "views"),
  sort: { key: "published", dir: -1 },
  selected: null,
  compare: null,
  slots: new Map(),
};

// ---------- unlock ----------
async function boot() {
  applyTheme(prefs.get("theme", null));
  try {
    state.env = await C.fetchEnvelope();
  } catch (e) {
    return showLock(`Não consegui carregar os dados (${e.message}).`);
  }
  const key = await C.storedKey(state.env.salt);
  if (key && (await open(key))) return;
  showLock();
}

async function open(key) {
  try {
    state.data = await C.decrypt(key, state.env);
    state.key = key;
  } catch {
    return false;
  }
  $("#lock").hidden = true;
  $("#app").hidden = false;
  prepare();
  render();
  return true;
}

function showLock(msg = "") {
  $("#app").hidden = true;
  $("#lock").hidden = false;
  $("#lock-err").textContent = msg;
  $("#pw").focus();
}

$("#lock form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#lock button");
  btn.disabled = true;
  $("#lock-err").textContent = "Abrindo…";
  try {
    const key = await C.keyFromPassword($("#pw").value.trim(), state.env);
    if (await open(key)) {
      if ($("#remember").checked) await C.rememberKey(key, state.env.salt);
      $("#pw").value = "";
      $("#lock-err").textContent = "";
    } else $("#lock-err").textContent = "Senha incorreta.";
  } finally {
    btn.disabled = false;
  }
});

async function refresh() {
  if (!state.key || document.hidden) return;
  try {
    const env = await C.fetchEnvelope();
    if (env.iv === state.env.iv) return;
    const data = await C.decrypt(state.key, env);
    Object.assign(state, { env, data });
    prepare();
    render();
  } catch {
    /* keep the current render; the next tick tries again */
  }
}
setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", refresh);

// ---------- theme ----------
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
const isDark = () =>
  document.documentElement.dataset.theme === "dark" ||
  (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

// ---------- derived data ----------
function prepare() {
  const vids = [...state.data.videos].sort((a, b) => (a.published || 0) - (b.published || 0));
  // Only full videos are numbered, so v1…vN match the production names; the trailer is just "trailer".
  const trailers = vids.filter((v) => v.lengthSec > 0 && v.lengthSec < TRAILER_MAX_SEC);
  let n = 0;
  vids.forEach((v) => {
    v.trailer = trailers.includes(v);
    v.tag = v.trailer ? (trailers.length > 1 ? `trailer ${trailers.indexOf(v) + 1}` : "trailer") : `v${++n}`;
    v.pubDay = v.published ? D.pacificDay(v.published) : v.daily[0]?.d || null;
  });
  state.videos = vids;
  state.byId = new Map(vids.map((v) => [v.id, v]));
  state.events = (state.data.events || []).filter((e) => !e.vid || state.byId.has(e.vid));
  for (const v of vids) v.events = state.events.filter((e) => e.vid === v.id);
  state.lastDay = state.data.channel.daily.at(-1)?.d;
  if (!state.compare) state.compare = vids.filter((v) => !v.trailer).slice(-4).map((v) => v.id);
  state.compare = state.compare.filter((id) => state.byId.has(id));
  for (const id of [...state.slots.keys()]) if (!state.compare.includes(id)) state.slots.delete(id);
  for (const id of state.compare) assignSlot(id);
  if (state.selected && !state.byId.has(state.selected)) state.selected = null;
}

export function assignSlot(id) {
  if (state.slots.has(id)) return;
  const used = new Set(state.slots.values());
  const free = D.SERIES.findIndex((_, i) => !used.has(i));
  if (free >= 0) state.slots.set(id, free);
}

export function range() {
  const first = state.data.channel.daily[0]?.d;
  const last = state.lastDay;
  let r;
  if (state.period === -1) {
    let from = state.from && state.from >= first && state.from <= last ? state.from : D.addDays(last, -27);
    let to = state.to && state.to <= last && state.to >= first ? state.to : last;
    if (from > to) [from, to] = [to, from];
    r = { from, to, custom: true };
  } else if (!state.period) r = { from: first, to: last, all: true };
  else r = { from: D.addDays(last, -(state.period - 1)), to: last };
  r.n = D.daysBetween(r.from, r.to) + 1;
  r.label = r.all ? "desde o início" : r.custom ? `${D.dayShort(r.from)} a ${D.dayShort(r.to)}` : `${state.period} dias`;
  r.title = r.all ? "Desde o início" : r.custom ? `De ${D.dayShort(r.from)} a ${D.dayShort(r.to)}` : `Últimos ${state.period} dias`;
  return r;
}
const periodName = () => range().label;

// Publish days and recorded changes, one marker per day (labels joined).
export function dayMarkers(videos, events, { tags = true } = {}) {
  const byDay = new Map();
  const add = (d, label, note) => {
    if (!d) return;
    const m = byDay.get(d) || { d, label: "", note: "" };
    m.label = m.label ? `${m.label} ${label}` : label;
    m.note = m.note ? `${m.note} · ${note}` : note;
    byDay.set(d, m);
  };
  for (const v of videos) add(v.pubDay, tags ? v.tag : "▶", `${v.tag} publicado`);
  for (const e of events) {
    const v = state.byId.get(e.vid);
    add(D.pacificDay(e.t / 1000), tags && v ? `✎${v.tag}` : "✎", `${v ? `${v.tag}: ` : ""}${e.text}`);
  }
  return [...byDay.values()];
}

export const videoStats = (v, r) => (r.all ? { ...v.totals } : D.aggregate(D.inRange(v.daily, r.from, r.to)));

// Every day of the range, with empty days kept (counts as 0, rates as gaps).
export function dailySeries(rows, r, key) {
  const m = D.metric(key);
  const byDay = new Map(rows.map((x) => [x.d, x]));
  const out = [];
  for (let d = r.from; d && d <= r.to; d = D.addDays(d, 1)) {
    const v = byDay.get(d)?.[key];
    out.push({ d, v: v ?? (m.sum ? 0 : null) });
  }
  return out;
}

// Columns for counts, a line for rates; publish days marked with the video tag.
export function metricChart(el, rows, r, key, { color, markers = [] } = {}) {
  const m = D.metric(key);
  const series = dailySeries(rows, r, key);
  const marks = markers.filter((mk) => mk.d >= r.from && mk.d <= r.to);
  if (m.sum) {
    columnChart(el, {
      points: series.map((p) => ({ x: p.d, y: p.v })),
      xFmt: D.dayShort, xTipFmt: D.dayLong, yFmt: (v, tip) => (tip ? m.fmt(v) : m.axis(v)),
      color, seriesLabel: m.label.toLowerCase(), markers: marks.map((mk) => ({ x: mk.d, label: mk.label, note: mk.note })),
    });
  } else {
    const ms = (d) => Date.parse(`${d}T12:00:00Z`);
    lineChart(el, {
      series: [{ label: m.label, color, points: series.map((p) => [ms(p.d), p.v]) }],
      xFmt: (x) => D.dayShort(new Date(x).toISOString()), xTipFmt: (x) => D.dayLong(new Date(x).toISOString().slice(0, 10)),
      yFmt: (v, tip) => (tip ? m.fmt(v) : m.axis(v)), area: true, markers: marks.map((mk) => ({ x: ms(mk.d), label: mk.label, note: mk.note })),
    });
  }
  return () => ({ head: ["Dia", m.label], rows: series.map((p) => [D.dayShort(p.d), m.fmt(p.v)]) });
}

// ---------- sections ----------
const SECTIONS = ["head", "alert", "now", "filters", "period", "videos", "detail", "compare"];
export function render(only = SECTIONS) {
  const builders = { head, alert, now, filters, period, videos, detail: () => detailSection(ctx()), compare: () => compareSection(ctx()) };
  for (const name of only) {
    const slot = $(`#s-${name}`);
    slot.replaceChildren(builders[name]() || "");
  }
}
const ctx = () => ({ state, range, render, metricChart, assignSlot, sourceRows, dayMarkers, eventsCard });

function head() {
  const d = state.data;
  return h("header", { class: "top" },
    h("div", {},
      h("h1", {}, "Gone Brands · Painel"),
      h("p", { class: "muted" },
        `Coletado do Studio em ${D.dateTime(d.collectedAt || d.generatedAt)} (horário de São Paulo) · dias completos até ${D.dayShort(state.lastDay || "0000-00-00")}`)),
    h("div", { class: "top-actions" },
      h("button", { class: "btn", type: "button", onclick: () => {
        const next = isDark() ? "light" : "dark";
        prefs.set("theme", next);
        applyTheme(next);
        render();
      } }, isDark() ? "Tema claro" : "Tema escuro"),
      h("button", { class: "btn", type: "button", onclick: () => {
        C.forgetKey();
        location.reload();
      } }, "Sair")));
}

function alert() {
  const d = state.data;
  const items = [];
  const age = Date.now() - (d.collectedAt || d.generatedAt);
  if (age > STALE_MS) {
    items.push(h("div", {}, h("strong", {}, `Sem coleta nova há ${Math.round(age / 3600000)} h.`),
      " O PC pode estar desligado ou o Chrome do canal fechado; os números abaixo são da última coleta."));
  }
  if (d.errors?.length) {
    items.push(h("details", {}, h("summary", {}, `A última coleta teve ${d.errors.length} falha(s) — alguns números podem estar desatualizados.`),
      h("ul", {}, d.errors.map((e) => h("li", {}, `${e.step}: ${e.msg}`)))));
  }
  if (!items.length) return null;
  return h("div", { class: "alert", role: "status" }, h("span", { class: "icon", "aria-hidden": "true" }, "!"), h("div", {}, items));
}

function now() {
  const d = state.data;
  const hourly = d.channel.hourly.slice(-48);
  const total = d.channel.realtime48?.total ?? hourly.reduce((a, p) => a + p[1], 0);
  const lastHour = state.videos.reduce((a, v) => a + (v.realtime60 || 0), 0);
  const left = D.chartCard("Últimas 48 horas", "Views do canal, hora a hora", () => ({
    head: ["Hora", "Views"], rows: hourly.map(([t, v]) => [D.hourLong(t), D.fmtInt(v)]),
  }));
  left.body.before(h("div", {},
    h("div", { class: "hero" }, D.fmtInt(total)),
    h("div", { class: "muted" }, `views em 48 h · ${D.fmtInt(lastHour)} na última hora · ${D.fmtInt(d.channel.subs)} inscritos agora`)));
  const right = D.chartCard("Views em 48 h por vídeo", "Tempo real do Studio", () => ({
    head: ["Vídeo", "48 h", "Última hora"], rows: perVideo.map((v) => [D.videoLabel(v), D.fmtInt(v.realtime48), D.fmtInt(v.realtime60)]),
  }));
  const perVideo = state.videos.filter((v) => v.realtime48).sort((a, b) => b.realtime48 - a.realtime48);
  queueMicrotask(() => {
    columnChart(left.body, {
      points: hourly.map(([t, v]) => ({ x: t, y: v })), xFmt: D.hourShort, xTipFmt: D.hourLong,
      yFmt: (v) => D.fmtInt(v), color: D.cssVar("--s1"), seriesLabel: "views", height: 180,
    });
    hbarChart(right.body, {
      rows: perVideo.map((v) => ({ label: D.videoLabel(v), value: v.realtime48,
        detail: [["na última hora", D.fmtInt(v.realtime60)], ["views em 48 h", D.fmtInt(v.realtime48)]] })),
      fmt: D.fmtInt, color: D.cssVar("--s1"),
    });
  });
  return h("section", {}, h("h2", {}, scope("canal"), "Agora"), h("div", { class: "grid g2" }, left.card, right.card));
}

const scope = (kind) => h("span", { class: `scope ${kind}` }, kind === "canal" ? "Canal" : "Por vídeo");

function filters() {
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Período" },
    PERIODS.map(([n, label]) => h("button", { type: "button", "aria-pressed": String(state.period === n), onclick: () => {
      if (n === -1 && state.period !== -1) {
        const cur = range(); // start the custom range from what is on screen
        Object.assign(state, { from: cur.from, to: cur.to });
      }
      state.period = n;
      prefs.set("period", n);
      render(["filters", "period", "videos", "detail"]);
    } }, label)));
  const first = state.data.channel.daily[0]?.d;
  const setDay = (key) => (e) => {
    if (!e.target.value) return;
    state[key] = e.target.value;
    prefs.set(key, state[key]);
    render(["filters", "period", "videos", "detail"]);
  };
  const sel = h("select", { "aria-label": "Métrica dos gráficos por dia", onchange: (e) => {
    state.metric = e.target.value;
    prefs.set("metric", state.metric);
    render(["period", "detail"]);
  } }, D.METRICS.map((m) => h("option", { value: m.key, selected: m.key === state.metric }, m.label)));
  const r = range();
  const custom = r.custom
    ? h("span", { class: "custom" },
      h("input", { type: "date", value: r.from, min: first, max: state.lastDay, "aria-label": "Início do período", onchange: setDay("from") }),
      h("span", { class: "muted" }, "até"),
      h("input", { type: "date", value: r.to, min: first, max: state.lastDay, "aria-label": "Fim do período", onchange: setDay("to") }))
    : null;
  return h("nav", { class: "filters" }, h("span", { class: "muted" }, "Período"), seg, custom,
    h("span", { class: "muted" }, "Gráfico por dia"), sel,
    h("span", { class: "muted note" }, `${D.dayShort(r.from)} – ${D.dayShort(r.to)} · ${r.n} dias`));
}

function delta(cur, prev, m, r) {
  if (!prev || cur == null || prev == null) return null;
  const diff = cur - prev;
  let text;
  if (m.sum) text = prev ? `${Math.abs(Math.round((diff / prev) * 100))}%` : diff ? "novo" : "0%";
  else if (m.key === "avd") text = D.fmtDur(Math.abs(diff));
  else text = `${Math.abs(diff).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "";
  return h("div", { class: `delta ${dir}` }, `${diff > 0 ? "▲" : diff < 0 ? "▼" : "="} ${text} vs ${r.n} dias anteriores`);
}

function period() {
  const r = range();
  const daily = state.data.channel.daily;
  const cur = r.all ? state.data.channel.totals : D.aggregate(D.inRange(daily, r.from, r.to));
  const prevRows = r.all ? [] : D.inRange(daily, D.addDays(r.from, -r.n), D.addDays(r.from, -1));
  const prev = prevRows.length ? D.aggregate(prevRows) : null;
  const tiles = h("div", { class: "tiles" }, D.METRICS.map((m) =>
    h("div", { class: "tile" }, h("div", { class: "label" }, m.label), h("div", { class: "value" }, m.fmt(cur?.[m.key])),
      delta(cur?.[m.key], prev?.[m.key], m, r))));
  const m = D.metric(state.metric);
  let tableFn = () => ({ head: [], rows: [] });
  const chart = D.chartCard(`${m.label} por dia`, `Canal · ${periodName()}`, () => tableFn());
  const sources = D.chartCard("Fontes de tráfego", "Views do canal desde o início (o período não se aplica)", () => ({
    head: ["Fonte", "Views", "Impressões", "CTR", "Duração média"],
    rows: state.data.channel.sources.map((s) => [s.name, D.fmtInt(s.views), D.fmtInt(s.impr), D.fmtPct(s.ctr), D.fmtDur(s.avd)]),
  }));
  queueMicrotask(() => {
    const markers = dayMarkers(state.videos, state.events);
    tableFn = metricChart(chart.body, daily, r, state.metric, { color: D.cssVar("--s1"), markers });
    hbarChart(sources.body, { rows: sourceRows(state.data.channel.sources), fmt: D.fmtInt, color: D.cssVar("--s1") });
  });
  return h("section", {}, h("h2", {}, scope("canal"), r.title),
    h("p", { class: "sub" }, r.all ? "Totais desde o início" : `Comparado com os ${r.n} dias anteriores`),
    tiles, h("div", { class: "grid g2", style: "margin-top:12px" }, chart.card, sources.card));
}

export const sourceRows = (sources) =>
  sources.filter((s) => s.views).map((s) => ({
    label: s.name, value: s.views,
    detail: [["views", D.fmtInt(s.views)], ["impressões", D.fmtInt(s.impr)], ["CTR", D.fmtPct(s.ctr)], ["duração média", D.fmtDur(s.avd)]],
  }));

const COLS = [
  ["published", "Vídeo"], ["views", "Views"], ["impr", "Impressões"], ["ctr", "CTR"], ["avd", "Duração média"],
  ["avp", "% assistida"], ["wt", "Horas"], ["subs", "Inscritos"], ["intro", "Retenção 0:30"], ["rt48", "48 h"],
];
const CMP = { ABOVE_AVERAGE: "acima", AVERAGE: "na média", BELOW_AVERAGE: "abaixo" };

function videos() {
  const r = range();
  const rows = state.videos.map((v) => ({ v, s: videoStats(v, r) }));
  const val = ({ v, s }, k) => (k === "published" ? v.published : k === "intro" ? v.intro?.pct : k === "rt48" ? v.realtime48 : s[k]);
  rows.sort((a, b) => ((val(a, state.sort.key) ?? -Infinity) - (val(b, state.sort.key) ?? -Infinity)) * state.sort.dir);
  const th = ([k, label]) => h("th", { "aria-sort": state.sort.key === k ? (state.sort.dir > 0 ? "ascending" : "descending") : null },
    h("button", { type: "button", onclick: () => {
      state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 };
      render(["videos"]);
    } }, label + (state.sort.key === k ? (state.sort.dir > 0 ? " ↑" : " ↓") : "")));
  const tr = ({ v, s }) => h("tr", { class: `clickable${state.selected === v.id ? " sel" : ""}`, tabindex: 0,
    onclick: () => select(v.id), onkeydown: (e) => e.key === "Enter" && select(v.id) },
  h("td", {}, h("div", { class: "vcell" }, h("img", { src: D.thumb(v.id), alt: "", loading: "lazy" }),
    h("div", {}, h("div", { class: "t" }, D.videoLabel(v, 0)),
      h("div", { class: "d" }, `${v.published ? D.dateTime(v.published * 1000) : "—"} · ${D.fmtDur(v.lengthSec)}`)))),
  ["views", "impr", "ctr", "avd", "avp", "wt", "subs"].map((k) => h("td", {}, D.metric(k).fmt(s[k]))),
  h("td", {}, v.intro ? D.fmtPct(v.intro.pct, 0) : "—", v.intro ? h("span", { class: "tag" }, CMP[v.intro.cmp] || "") : null),
  h("td", {}, D.fmtInt(v.realtime48)));
  return h("section", {}, h("h2", {}, scope("video"), `Vídeos · ${periodName()}`),
    h("p", { class: "sub" }, "Clique num vídeo para ver os detalhes. Retenção 0:30 e 48 h não dependem do período."),
    h("div", { class: "card tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, COLS.map(th))), h("tbody", {}, rows.map(tr)))),
    h("div", { style: "margin-top:12px" }, eventsCard(state.events, true)));
}

const SRC = { anotado: "anotado", detectado: "detectado na coleta", studio: "horário do Studio" };
export function eventsCard(events, withTag) {
  const list = [...events].sort((a, b) => b.t - a.t);
  return h("div", { class: "card" },
    h("div", { class: "card-h" }, h("h3", {}, "Alterações registradas"), h("div", { class: "sub" }, "Horário de São Paulo · ✎ nos gráficos")),
    list.length
      ? h("ul", { class: "evlist" }, list.map((e) => {
        const v = state.byId.get(e.vid);
        return h("li", {}, h("span", { class: "ev-t" }, D.dateTime(e.t)),
          withTag && v ? h("span", { class: "scope video" }, v.tag) : null,
          h("span", { class: "ev-x" }, e.text), h("span", { class: "tag" }, SRC[e.src] || e.src));
      }))
      : h("p", { class: "muted", style: "margin:0" },
        "Nada registrado ainda. Trocas de thumbnail e de título são detectadas sozinhas; outras mudanças, peça para anotar."));
}

function select(id) {
  state.selected = state.selected === id ? null : id;
  render(["videos", "detail"]);
  if (state.selected) $("#s-detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

boot();

// Video detail and the side-by-side comparison of videos.
import { columnChart, lineChart, hbarChart } from "./charts.js";
import * as D from "./data.js";

const { h } = D;
const HOUR = 3600000;
const CMP = { ABOVE_AVERAGE: "acima da média", AVERAGE: "na média", BELOW_AVERAGE: "abaixo da média" };

function tile(label, value, note) {
  return h("div", { class: "tile" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value),
    note ? h("div", { class: "delta" }, note) : null);
}

// ---------- reach (the Studio "Alcance" card) ----------
const REACH_TABS = [
  ["impr", "Impressões de miniaturas", D.fmtInt,
    "Acumulado desde a publicação. O Studio mostra as impressões até este momento; é uma estimativa e pode ser ajustada depois."],
  ["ctr", "Taxa de cliques na miniatura", (v) => D.fmtPct(v), "CTR de cada dia desde a publicação (não acumulado)."],
  ["views", "Visualizações", D.fmtInt, "Acumulado desde a publicação."],
  ["uniq", "Espectadores únicos", D.fmtInt, "Por dia. O Studio libera este número com alguns dias de atraso."],
];

function drawReach(el, v, k, label, fmt) {
  const s = v.reach[k];
  const blue = D.cssVar("--s1");
  if (k === "uniq") {
    const pts = s.pts.map(([x, y]) => ({ x: D.pacificDay(x / 1000), y }));
    columnChart(el, { points: pts, xFmt: D.dayShort, xTipFmt: D.dayLong, yFmt: (y) => D.fmtInt(y), color: blue, seriesLabel: "espectadores únicos" });
    return () => ({ head: ["Dia", label], rows: pts.map((p) => [D.dayShort(p.x), fmt(p.y)]) });
  }
  const pub = v.published ? v.published * 1000 : s.pts[0]?.[0];
  const pts = s.pts.filter(([x]) => x >= pub).map(([x, y]) => [(x - pub) / HOUR, y]);
  const endH = Math.max(s.end ? (s.end - pub) / HOUR : 0, pts.at(-1)?.[0] || 0);
  let days = Math.max(1, Math.ceil(endH / 24 - 1e-9));
  const step = Math.ceil(days / 7);
  days = Math.ceil(days / step) * step;
  const ticks = [];
  for (let d = 0; d <= days; d += step) ticks.push(d * 24);
  const rel = (hh) => (hh < 48 ? `${Math.round(hh)} h após publicar` : `${Math.floor(hh / 24)} dias após publicar`);
  lineChart(el, {
    series: [{ label, color: blue, points: pts }],
    markers: v.events.map((e) => ({ x: (e.t - pub) / HOUR, label: "✎" })),
    xDomain: [0, days * 24], xTickValues: ticks,
    xFmt: (hh) => (hh === days * 24 ? `${days} dias` : String(hh / 24)),
    xTipFmt: (hh) => `${D.dateTime(pub + hh * HOUR)} · ${rel(hh)}`,
    yFmt: (y, tip) => (k === "ctr" ? D.fmtPct(y, tip ? 1 : 0) : tip ? D.fmtInt(y) : D.fmtAxis(y)),
    area: s.cum,
  });
  return () => ({ head: ["Momento", label], rows: pts.map(([hh, y]) => [`${D.dateTime(pub + hh * HOUR)} (${rel(hh)})`, fmt(y)]) });
}

function reachCard(v, state) {
  let tableFn = () => ({ head: [], rows: [] });
  const c = D.chartCard("Alcance", "Desde a publicação, como na aba Alcance do Studio", () => tableFn());
  const reach = v.reach || {};
  const tabs = REACH_TABS.filter(([k]) => reach[k]);
  if (!tabs.length) {
    c.body.appendChild(h("div", { class: "empty" }, "Ainda não coletado — aparece na próxima atualização."));
    return c.card;
  }
  let active = reach[state.reachTab] ? state.reachTab : tabs[0][0];
  const note = h("p", { class: "muted rnote" });
  const bar = h("div", { class: "rtabs", role: "tablist", "aria-label": "Métricas de alcance" },
    tabs.map(([k, label, fmt]) => h("button", { type: "button", role: "tab", class: "rtab", "data-k": k,
      onclick: () => {
        active = k;
        state.reachTab = k;
        draw();
      } }, h("span", { class: "rtab-l" }, label), h("span", { class: "rtab-v" }, fmt(reach[k].total)))));
  c.body.before(bar, note);
  const draw = () => {
    const [, label, fmt, help] = REACH_TABS.find(([k]) => k === active);
    bar.querySelectorAll(".rtab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === active)));
    note.textContent = help;
    tableFn = drawReach(c.body, v, active, label, fmt);
    if (c.body.hidden) {
      const toggle = c.card.querySelector(".card-h .linkbtn");
      toggle.click();
      toggle.click();
    }
  };
  queueMicrotask(draw);
  return c.card;
}

export function detailSection(ctx) {
  const { state } = ctx;
  const v = state.selected && state.byId.get(state.selected);
  if (!v) return null;
  const r = ctx.range();
  const vr = { ...r, from: v.pubDay && v.pubDay > r.from ? v.pubDay : r.from };
  const t = v.totals || {};
  const blue = D.cssVar("--s1");
  const m = D.metric(state.metric);

  let dailyTable = () => ({ head: [], rows: [] });
  const daily = D.chartCard(`${m.label} por dia`, `${v.tag} · ${r.label}`, () => dailyTable());
  const hourly = v.hourly.slice(-168);
  const hourCard = D.chartCard("Views por hora", "Histórico do tempo real (últimos 7 dias guardados)", () => ({
    head: ["Hora", "Views"], rows: hourly.map(([x, y]) => [D.hourLong(x), D.fmtInt(y)]),
  }));
  const ret = v.retention || [];
  const len = v.lengthSec || 0;
  const retX = (i) => Math.round(((i + 1) / 100) * len);
  const retCard = D.chartCard("Retenção do público", "Studio · % dos espectadores em cada ponto, desde a publicação", () => ({
    head: ["Momento", "Assistindo"], rows: ret.map((y, i) => [D.fmtDur(retX(i)), D.fmtPct(y)]),
  }));
  const srcCard = D.chartCard("Fontes de tráfego", "Desde a publicação", () => ({
    head: ["Fonte", "Views", "Impressões", "CTR", "Duração média"],
    rows: v.sources.map((s) => [s.name, D.fmtInt(s.views), D.fmtInt(s.impr), D.fmtPct(s.ctr), D.fmtDur(s.avd)]),
  }));
  const chapters = (v.chapters || []).filter((c) => c.s > 0);
  if (v.chapters?.length) {
    retCard.card.appendChild(h("ol", { class: "muted", style: "margin:8px 0 0;padding-left:20px;font-size:12px" },
      v.chapters.map((c) => h("li", {}, `${D.fmtDur(c.s)} · ${c.t}`))));
  }

  const hourMarks = [
    ...(v.published ? [{ t: v.published * 1000, label: "▶", note: "publicado" }] : []),
    ...v.events.map((e) => ({ t: e.t, label: "✎", note: e.text })),
  ].map((mk) => ({ ...mk, x: Math.floor(mk.t / HOUR) * HOUR }));

  queueMicrotask(() => {
    const markers = ctx.dayMarkers([v], v.events, { tags: false });
    if (v.pubDay && v.pubDay > r.to) {
      daily.body.appendChild(h("div", { class: "empty" }, `O vídeo só foi publicado em ${D.dayShort(v.pubDay)}, depois deste período.`));
    } else dailyTable = ctx.metricChart(daily.body, v.daily, vr, state.metric, { color: blue, markers });
    if (hourly.length) {
      columnChart(hourCard.body, {
        points: hourly.map(([x, y]) => ({ x, y })), xFmt: D.hourTick, xTipFmt: D.hourLong,
        yFmt: (y) => D.fmtInt(y), color: blue, seriesLabel: "views", markers: hourMarks,
      });
    } else hourCard.body.appendChild(h("div", { class: "empty" }, "Sem dados por hora ainda."));
    if (ret.length && len) {
      lineChart(retCard.body, {
        series: [{ label: "Assistindo", color: blue, points: ret.map((y, i) => [retX(i), y]) }],
        xFmt: D.fmtDur, yFmt: (y, tip) => D.fmtPct(y, tip ? 1 : 0), area: true, yMaxHint: 100,
        markers: chapters.map((c) => ({ x: c.s, label: String(v.chapters.indexOf(c) + 1) })),
      });
    } else retCard.body.appendChild(h("div", { class: "empty" }, "O Studio ainda não mostra a retenção deste vídeo."));
    hbarChart(srcCard.body, { rows: ctx.sourceRows(v.sources), fmt: D.fmtInt, color: blue });
  });

  const links = h("div", {},
    h("a", { href: `https://studio.youtube.com/video/${v.id}/analytics/tab-overview/period-default`, target: "_blank", rel: "noopener" }, "Abrir no Studio"),
    h("a", { href: `https://youtu.be/${v.id}`, target: "_blank", rel: "noopener" }, "Ver no YouTube"),
    h("button", { class: "linkbtn", type: "button", onclick: () => {
      state.selected = null;
      ctx.render(["videos", "detail"]);
    } }, "Fechar"));
  return h("section", { class: "video-panel", "aria-label": `Informações do vídeo ${v.tag}` },
    h("div", { class: "detail-head" }, h("img", { src: D.thumb(v.id), alt: "" }),
      h("div", {}, h("span", { class: "scope video" }, `Vídeo ${v.tag}`),
        h("h2", {}, v.title),
        h("p", { class: "muted", style: "margin:4px 0" }, `Publicado ${v.published ? D.dateTime(v.published * 1000) : "—"} · ${D.fmtDur(v.lengthSec)}`),
        links)),
    h("div", { class: "tiles", style: "margin-top:14px" },
      tile("Duração média", D.fmtDur(t.avd), "desde a publicação"),
      tile("% assistida", D.fmtPct(t.avp)),
      tile("Inscritos", D.fmtSigned(t.subs)),
      tile("Retenção 0:30", v.intro ? D.fmtPct(v.intro.pct, 0) : "—", v.intro ? CMP[v.intro.cmp] : "o Studio ainda não calculou"),
      tile("Views em 48 h", D.fmtInt(v.realtime48), `${D.fmtInt(v.realtime60)} na última hora`)),
    h("div", { class: "grid", style: "margin-top:12px" }, reachCard(v, state), ctx.eventsCard(v.events, false)),
    h("div", { class: "grid g2e", style: "margin-top:12px" }, daily.card, hourCard.card, retCard.card, srcCard.card));
}

// ---------- comparison ----------
function cumulativeByDay(v) {
  let acc = 0;
  return v.daily
    .filter((r) => v.pubDay && r.d >= v.pubDay)
    .map((r) => [D.daysBetween(v.pubDay, r.d) + 1, (acc += r.views || 0)]);
}

function cumulativeByHour(v) {
  if (!v.published || !v.hourly.length) return null;
  const start = Math.floor((v.published * 1000) / HOUR) * HOUR;
  if (v.hourly[0][0] > start + HOUR) return null; // history began after the video went live
  let acc = 0;
  return v.hourly.filter(([t]) => t >= start && t < start + 72 * HOUR).map(([t, y]) => [Math.round((t - start) / HOUR) + 1, (acc += y)]);
}

function dayValue(v, day, key) {
  const rows = v.daily.filter((r) => v.pubDay && r.d >= v.pubDay && D.daysBetween(v.pubDay, r.d) < day);
  const lastIdx = v.daily.length ? D.daysBetween(v.pubDay, v.daily.at(-1).d) + 1 : 0;
  if (lastIdx < day) return null; // the video is not that old yet
  return D.aggregate(rows)[key];
}

export function compareSection(ctx) {
  const { state } = ctx;
  const chosen = state.compare.map((id) => state.byId.get(id)).filter(Boolean);
  const colorOf = (v) => D.cssVar(D.SERIES[state.slots.get(v.id)] || "--s1");
  const label = (v) => `${v.tag} · ${D.shortTitle(v.title, 30)}`;
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Vídeos comparados" },
    [...state.videos].reverse().map((v) => {
      const on = state.compare.includes(v.id);
      const chip = h("button", { class: "chip", type: "button", "aria-pressed": String(on), disabled: !on && state.compare.length >= 8,
        onclick: () => {
          if (on) {
            state.compare = state.compare.filter((x) => x !== v.id);
            state.slots.delete(v.id);
          } else {
            state.compare.push(v.id);
            ctx.assignSlot(v.id);
          }
          ctx.render(["compare"]);
        } }, h("span", { class: "key-line" }), label(v));
      chip.firstChild.style.background = on ? colorOf(v) : "var(--axis)";
      return chip;
    }));

  const byDay = chosen.map((v) => ({ label: label(v), color: colorOf(v), points: cumulativeByDay(v) }));
  const byHour = chosen.map((v) => ({ v, points: cumulativeByHour(v) })).filter((x) => x.points?.length)
    .map(({ v, points }) => ({ label: label(v), color: colorOf(v), points }));
  const retention = chosen.filter((v) => v.retention?.length)
    .map((v) => ({ label: label(v), color: colorOf(v), points: v.retention.map((y, i) => [i + 1, y]) }));
  const seriesTable = (series, xName, xFmt, yFmt) => () => {
    const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b);
    return {
      head: [xName, ...series.map((s) => s.label)],
      rows: xs.map((x) => [xFmt(x), ...series.map((s) => {
        const p = s.points.find((q) => q[0] === x);
        return p ? yFmt(p[1]) : "—";
      })]),
    };
  };
  const c1 = D.chartCard("Views acumuladas por dia desde a publicação", "Dia 1 = dia da publicação (calendário do Studio, horário do Pacífico)",
    seriesTable(byDay, "Dia", (x) => `dia ${x}`, D.fmtInt));
  const c2 = D.chartCard("Primeiras 72 horas", "Views acumuladas hora a hora desde a publicação",
    seriesTable(byHour, "Hora", (x) => `${x}ª hora`, D.fmtInt));
  const c3 = D.chartCard("Retenção do público", "% dos espectadores ao longo do vídeo (0–100% da duração)",
    seriesTable(retention, "Ponto do vídeo", (x) => `${x}%`, (y) => D.fmtPct(y)));

  queueMicrotask(() => {
    if (byDay.some((s) => s.points.length)) {
      lineChart(c1.body, { series: byDay, xFmt: (x) => `dia ${x}`, yFmt: (y, tip) => (tip ? D.fmtInt(y) : D.fmtAxis(y)) });
    } else c1.body.appendChild(h("div", { class: "empty" }, "Escolha vídeos acima."));
    if (byHour.length) {
      lineChart(c2.body, { series: byHour, xFmt: (x) => `${x}h`, xTipFmt: (x) => `${x}ª hora`, yFmt: (y) => D.fmtInt(y), xDomain: [1, 72] });
    } else {
      c2.body.appendChild(h("div", { class: "empty" },
        "Nenhum vídeo escolhido tem dados hora a hora desde a publicação. O painel guarda isso a partir de agora, então os próximos lançamentos aparecem aqui."));
    }
    if (retention.length) {
      lineChart(c3.body, { series: retention, xFmt: (x) => `${x}%`, yFmt: (y, tip) => D.fmtPct(y, tip ? 1 : 0), yMaxHint: 100 });
    } else c3.body.appendChild(h("div", { class: "empty" }, "Sem curva de retenção para os vídeos escolhidos."));
  });

  const marks = [[1, "Dia 1"], [2, "Dia 2"], [7, "Dia 7"], [28, "Dia 28"]];
  const table = h("div", { class: "card tablewrap" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "Vídeo"), marks.map(([, l]) => h("th", {}, `Views até ${l.toLowerCase()}`)),
      h("th", {}, "Impressões 7 dias"), h("th", {}, "CTR 7 dias"), h("th", {}, "Duração média"), h("th", {}, "Retenção 0:30"))),
    h("tbody", {}, chosen.map((v) => h("tr", {},
      h("td", {}, h("span", { class: "key-line", style: `display:inline-block;vertical-align:middle;margin-right:6px;background:${colorOf(v)}` }), label(v)),
      marks.map(([d]) => h("td", {}, D.fmtInt(dayValue(v, d, "views")))),
      h("td", {}, D.fmtInt(dayValue(v, 7, "impr"))),
      h("td", {}, D.fmtPct(dayValue(v, 7, "ctr"))),
      h("td", {}, D.fmtDur(v.totals?.avd)),
      h("td", {}, v.intro ? D.fmtPct(v.intro.pct, 0) : "—"))))));

  return h("section", {}, h("h2", {}, h("span", { class: "scope video" }, "Vídeos"), "Comparar vídeos"),
    h("p", { class: "sub" }, "Escolha até 8 vídeos. Cada vídeo mantém a mesma cor enquanto estiver escolhido."),
    chips, h("div", { class: "grid g2e" }, c1.card, c2.card, c3.card, table));
}

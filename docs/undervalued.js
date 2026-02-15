const dataPath = "data/apt_trade/undervalued.json";
const byAptBase = "data/apt_trade/by_apt/";

const tabsEl = document.getElementById("tabs");
const contentEl = document.getElementById("content");

let data = null;
let activeSido = null;
const txnCache = {};
const chartColors = ["#1a6f5a", "#d63a3a", "#2563eb", "#8c3b1f"];

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

function sortTxns(txns) {
  return (txns || []).slice().sort(function (a, b) {
    return new Date(a[0]).getTime() - new Date(b[0]).getTime();
  });
}

async function loadTxns(id) {
  if (txnCache[id]) return txnCache[id];
  const res = await fetch(byAptBase + id + ".json");
  if (!res.ok) {
    txnCache[id] = [];
    return [];
  }
  const data = await res.json();
  txnCache[id] = sortTxns(data);
  return txnCache[id];
}

function drawMultiSeries(canvas, seriesList) {
  if (!seriesList.length) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width * dpr;
  const h = rect.height * dpr;
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const cw = rect.width;
  const ch = rect.height;
  const pad = { top: 10, right: 12, bottom: 24, left: 46 };
  const plotW = cw - pad.left - pad.right;
  const plotH = ch - pad.top - pad.bottom;

  const allPoints = [];
  seriesList.forEach(function (s) {
    s.points.forEach(function (p) {
      allPoints.push(p);
    });
  });
  if (!allPoints.length) return;

  const minT = Math.min.apply(null, allPoints.map(function (p) { return p.t; }));
  const maxT = Math.max.apply(null, allPoints.map(function (p) { return p.t; }));
  const prices = allPoints.map(function (p) { return p.price; });
  let minP = Math.min.apply(null, prices);
  let maxP = Math.max.apply(null, prices);
  const pRange = maxP - minP || 1;
  minP -= pRange * 0.08;
  maxP += pRange * 0.08;

  function xPos(t) {
    if (maxT === minT) return pad.left + plotW / 2;
    return pad.left + ((t - minT) / (maxT - minT)) * plotW;
  }
  function yPos(p) {
    return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH;
  }

  ctx.strokeStyle = "#e8e0d4";
  ctx.lineWidth = 0.6;
  for (let i = 0; i <= 3; i++) {
    const gy = pad.top + (plotH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + plotW, gy);
    ctx.stroke();
  }

  ctx.fillStyle = "#9a9590";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 3; i++) {
    const val = minP + ((maxP - minP) / 3) * (3 - i);
    const label = (val / 10000).toFixed(1) + "억";
    const ly = pad.top + (plotH / 3) * i;
    ctx.fillText(label, pad.left - 4, ly);
  }

  const minYear = new Date(minT).getFullYear();
  const maxYear = new Date(maxT).getFullYear();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let y = minYear; y <= maxYear; y++) {
    const xt = new Date(y, 0, 1).getTime();
    if (xt < minT || xt > maxT) continue;
    ctx.fillText(String(y).slice(2) + "/1/1", xPos(xt), pad.top + plotH + 6);
  }

  seriesList.forEach(function (s) {
    if (!s.points.length) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    s.points.forEach(function (p, idx) {
      const px = xPos(p.t);
      const py = yPos(p.price);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = s.color;
    s.points.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(xPos(p.t), yPos(p.price), 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function renderTabs(sidoOrder) {
  tabsEl.innerHTML = "";
  sidoOrder.forEach(function (sido) {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      renderTabs(sidoOrder);
      renderSections();
    });
    tabsEl.appendChild(btn);
  });
}

function renderItem(r, idx) {
  const card = document.createElement("div");
  card.className = "rank-card";

  const num = document.createElement("div");
  num.className = "rank-num";
  num.textContent = idx + 1;
  card.appendChild(num);

  const content = document.createElement("div");
  const top = document.createElement("div");
  top.className = "rank-top";

  const info = document.createElement("div");
  const apt = document.createElement("div");
  apt.className = "rank-apt";
  apt.textContent = r.apt_name;
  info.appendChild(apt);
  const detail = document.createElement("div");
  detail.className = "rank-detail";
  detail.textContent = r.sigungu + " " + r.dong_name + " · " + r.area_m2 + "m²";
  info.appendChild(detail);
  top.appendChild(info);

  const change = document.createElement("div");
  change.className = "rank-change";
  const pct = document.createElement("div");
  pct.className = "rank-pct";
  const ratio = (r.recent_avg && r.compare_avg_recent)
    ? ((r.recent_avg / r.compare_avg_recent - 1) * 100)
    : null;
  const ratioText = (ratio !== null) ? (" · " + ratio.toFixed(1) + "%") : "";
  pct.textContent = "최근6개월 " + fmt(Math.round(r.recent_avg)) + "만" + ratioText;
  change.appendChild(pct);
  const diff = document.createElement("div");
  diff.className = "rank-diff";
  diff.textContent = "비교평균 " + fmt(Math.round(r.compare_avg_recent)) + "만";
  change.appendChild(diff);
  top.appendChild(change);

  content.appendChild(top);

  const meta = document.createElement("div");
  meta.className = "rank-detail";
  if (r.compare && r.compare.length) {
    const names = r.compare.map(function (c) {
      return c.apt_name + "(" + c.sigungu + " " + c.dong_name + ")";
    });
    meta.textContent = "비교: " + names.join(" · ");
  }
  content.appendChild(meta);

  card.appendChild(content);
  card.addEventListener("click", function () {
    toggleCompare(card, r);
  });
  return card;
}

async function toggleCompare(card, r) {
  const existing = card.querySelector(".compare-panel");
  if (existing) {
    existing.remove();
    return;
  }

  const panel = document.createElement("div");
  panel.className = "compare-panel";

  const title = document.createElement("div");
  title.className = "compare-title";
  title.textContent = "단지별 시세 비교";
  panel.appendChild(title);

  const canvas = document.createElement("canvas");
  canvas.className = "compare-chart";
  panel.appendChild(canvas);

  const legend = document.createElement("div");
  legend.className = "compare-legend";
  panel.appendChild(legend);

  const ids = [r.id].concat((r.compare || []).map(function (c) { return c.id; }));
  const txnsList = await Promise.all(ids.map(loadTxns));

  const seriesList = ids.map(function (id, i) {
    const txns = txnsList[i] || [];
    const points = txns.map(function (t) {
      return { t: new Date(t[0]).getTime(), price: t[1] };
    });
    const meta = (i === 0) ? r : (r.compare || [])[i - 1];
    const last = txns[txns.length - 1];
    const lastDate = last ? last[0] : "";
    const lastPrice = last ? last[1] : null;
    return {
      id: id,
      name: meta ? meta.apt_name : id,
      sigungu: meta ? meta.sigungu : "",
      dong_name: meta ? meta.dong_name : "",
      area_m2: meta ? meta.area_m2 : "",
      color: chartColors[i % chartColors.length],
      points: points,
      last_date: lastDate,
      last_price: lastPrice
    };
  });

  drawMultiSeries(canvas, seriesList);

  seriesList.forEach(function (s) {
    const item = document.createElement("div");
    item.className = "legend-item";

    const dot = document.createElement("span");
    dot.className = "legend-color";
    dot.style.background = s.color;
    item.appendChild(dot);

    const label = document.createElement("span");
    const priceText = s.last_price ? (fmt(Math.round(s.last_price)) + "만") : "-";
    const dateText = s.last_date ? s.last_date : "";
    const locText = (s.sigungu || s.dong_name) ? (" · " + s.sigungu + " " + s.dong_name) : "";
    label.textContent = s.name + locText + " · 최근거래 " + dateText + " · " + priceText;
    item.appendChild(label);

    legend.appendChild(item);
  });

  card.appendChild(panel);
}

function renderSection(title, sub, items) {
  const sec = document.createElement("div");
  sec.className = "section";
  const h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  if (sub) {
    const p = document.createElement("p");
    p.className = "section-sub";
    p.textContent = sub;
    sec.appendChild(p);
  }
  if (!items || !items.length) {
    const p = document.createElement("p");
    p.className = "no-data";
    p.textContent = "해당 없음";
    sec.appendChild(p);
    return sec;
  }
  items.slice(0, 3).forEach(function (r, i) {
    sec.appendChild(renderItem(r, i));
  });
  return sec;
}

function renderSections() {
  contentEl.innerHTML = "";
  if (!data || !activeSido) return;
  const s = data.sidos[activeSido];
  if (!s) return;

  contentEl.appendChild(
    renderSection(
      "저평가 TOP3",
      "비교 단지 평균 대비 최근 6개월 평균가가 낮은 순",
      s.undervalued || []
    )
  );

  (s.bands || []).forEach(function (b) {
    contentEl.appendChild(
      renderSection(
        "저평가 TOP3 (가격대: " + b.label + ")",
        "최근 6개월 평균가 기준",
        b.top3 || []
      )
    );
  });
}

async function init() {
  const res = await fetch(dataPath);
  if (!res.ok) {
    contentEl.textContent = "데이터를 불러오지 못했습니다.";
    return;
  }
  data = await res.json();
  const sidoOrder = data ? Object.keys(data.sidos || {}) : [];
  activeSido = sidoOrder[0] || null;
  renderTabs(sidoOrder);
  renderSections();
}

init();

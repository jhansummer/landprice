const dataPath = "data/apt_trade/undervalued.json";
const byAptBase = "data/apt_trade/by_apt/";

const tabsEl = document.getElementById("tabs");
const contentEl = document.getElementById("content");

let data = null;
let activeSido = null;
const txnCache = {};
const chartColors = ["#2563eb", "#ef4444", "#16a34a", "#f59e0b"];

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

function fmtEok(v) {
  return (v / 10000).toFixed(2) + "\uC5B5";
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
  tabsEl.setAttribute("role", "tablist");
  var label = document.createElement("span");
  label.className = "region-label";
  label.textContent = "지역";
  tabsEl.appendChild(label);
  sidoOrder.forEach(function (sido) {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", sido === activeSido ? "true" : "false");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      renderTabs(sidoOrder);
      renderSections();
      history.replaceState(null, "", "#" + sido);
      APTWatchlist.track("tab_switch", { sido: sido, page: "undervalued" });
    });
    tabsEl.appendChild(btn);
  });
}

function renderItem(r, idx) {
  const card = document.createElement("div");
  card.className = "rank-card";

  const num = document.createElement("div");
  num.className = "rank-num" + (idx < 3 ? " n" + (idx + 1) : "");
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

  const ratio6 = (r.recent_avg && r.compare_avg_recent)
    ? ((r.recent_avg / r.compare_avg_recent - 1) * 100)
    : null;
  const ratio36 = (r.avg_36 && r.compare_avg_36)
    ? ((r.avg_36 / r.compare_avg_36 - 1) * 100)
    : null;

  // 최근 6개월 행
  const pct = document.createElement("div");
  pct.className = "rank-pct";
  pct.innerHTML = "\uCD5C\uADFC6\uAC1C\uC6D4 " + fmtEok(r.recent_avg)
    + (ratio6 !== null ? " <span class=\"pct-value\">" + ratio6.toFixed(1) + "%</span>" : "");
  change.appendChild(pct);

  // 비교평균 행
  const diff = document.createElement("div");
  diff.className = "rank-diff";
  diff.textContent = "\uBE44\uAD50\uD3C9\uADE0 " + fmtEok(r.compare_avg_recent);
  change.appendChild(diff);

  // 최근 3년 행 - 6개월과 비교
  const diff36 = document.createElement("div");
  diff36.className = "rank-diff";
  diff36.style.marginTop = "6px";
  if (ratio36 !== null && ratio6 !== null) {
    var arrow = (ratio36 > ratio6) ? "\u25B2" : (ratio36 < ratio6) ? "\u25BC" : "";
    diff36.innerHTML = "\uCD5C\uADFC3\uB144 \uBE44\uAD50\uD3C9\uADE0 \uB300\uBE44 <span class=\"pct-value\">" + ratio36.toFixed(1) + "%</span>"
      + (arrow ? " <span style=\"font-size:10px;color:" + (ratio36 > ratio6 ? "var(--up)" : "var(--down)") + "\">" + arrow + "</span>" : "");
  } else {
    diff36.textContent = "\uCD5C\uADFC3\uB144 \uBE44\uAD50\uD3C9\uADE0 \uB300\uBE44 -";
  }
  change.appendChild(diff36);

  // CTA 버튼 그룹
  var ctaGroup = document.createElement("div");
  ctaGroup.className = "cta-group";

  var detailBtn = document.createElement("button");
  detailBtn.className = "detail-btn";
  detailBtn.textContent = "\uC0C1\uC138";
  detailBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleCompare(card, r);
    APTWatchlist.track("view_detail", { apt_name: r.apt_name, page: "undervalued" });
  });
  ctaGroup.appendChild(detailBtn);

  if (r.id) {
    var cmpBtn = document.createElement("button");
    cmpBtn.className = "detail-btn";
    cmpBtn.textContent = APTWatchlist.hasCompare(r.id) ? "\uCD94\uAC00\uB428" : "\uBE44\uAD50\uCD94\uAC00";
    if (APTWatchlist.hasCompare(r.id)) { cmpBtn.style.borderColor = "var(--accent)"; cmpBtn.style.color = "var(--accent)"; }
    cmpBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var added = APTWatchlist.addCompare({ id: r.id, apt_name: r.apt_name, area_m2: r.area_m2, sigungu: r.sigungu, dong_name: r.dong_name });
      if (added) { cmpBtn.textContent = "\uCD94\uAC00\uB428"; cmpBtn.style.borderColor = "var(--accent)"; cmpBtn.style.color = "var(--accent)"; }
      APTWatchlist.track("add_to_compare", { apt_name: r.apt_name, page: "undervalued" });
    });
    ctaGroup.appendChild(cmpBtn);

    var watchBtn = document.createElement("button");
    watchBtn.className = "detail-btn";
    var isW = APTWatchlist.has(r.id);
    watchBtn.textContent = isW ? "\uAD00\uC2EC\uD574\uC81C" : "\uAD00\uC2EC";
    if (isW) { watchBtn.style.background = "var(--accent-soft)"; watchBtn.style.color = "var(--accent)"; watchBtn.style.borderColor = "var(--accent)"; }
    watchBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (APTWatchlist.has(r.id)) {
        APTWatchlist.remove(r.id);
        watchBtn.textContent = "\uAD00\uC2EC"; watchBtn.style.background = ""; watchBtn.style.color = ""; watchBtn.style.borderColor = "";
      } else {
        APTWatchlist.add({ id: r.id, apt_name: r.apt_name, area_m2: r.area_m2, sigungu: r.sigungu, dong_name: r.dong_name, latest_price: r.recent_avg });
        watchBtn.textContent = "\uAD00\uC2EC\uD574\uC81C"; watchBtn.style.background = "var(--accent-soft)"; watchBtn.style.color = "var(--accent)"; watchBtn.style.borderColor = "var(--accent)";
      }
      APTWatchlist.track("add_to_watchlist", { apt_name: r.apt_name, page: "undervalued" });
    });
    ctaGroup.appendChild(watchBtn);
  }
  change.appendChild(ctaGroup);
  top.appendChild(change);

  content.appendChild(top);

  // 비교 단지 목록
  const meta = document.createElement("div");
  meta.className = "rank-detail";
  if (r.compare && r.compare.length) {
    const names = r.compare.map(function (c) {
      return c.apt_name + " " + c.area_m2 + "m\u00B2(" + c.sigungu + " " + c.dong_name + ")";
    });
    meta.textContent = "\uBE44\uAD50: " + names.join(" \u00B7 ");
  }
  content.appendChild(meta);

  // 저평가 근거 3줄 설명
  var explain = document.createElement("div");
  explain.className = "explain-block";

  var reason1 = "\uC774 \uB2E8\uC9C0\uC758 \uCD5C\uADFC 6\uAC1C\uC6D4 \uD3C9\uADE0 \uAC70\uB798\uAC00\uB294 " + fmtEok(r.recent_avg) + "\uC73C\uB85C, ";
  reason1 += "\uAC19\uC740 \uC9C0\uC5ED \uC720\uC0AC \uBA74\uC801(" + (r.compare ? r.compare.length : 0) + "\uAC1C \uB2E8\uC9C0) \uD3C9\uADE0 " + fmtEok(r.compare_avg_recent) + " \uB300\uBE44 ";
  reason1 += (ratio6 !== null ? Math.abs(ratio6).toFixed(1) + "% \uB0AE\uC2B5\uB2C8\uB2E4." : "\uBE44\uAD50 \uBD88\uAC00\uC785\uB2C8\uB2E4.");

  var reason2 = "";
  if (ratio36 !== null && ratio6 !== null) {
    if (ratio36 > ratio6) {
      reason2 = "3\uB144 \uC7A5\uAE30\uB85C \uBCF4\uBA74 \uACA9\uCC28\uAC00 \uB354 \uD06C\uBBC0\uB85C(" + Math.abs(ratio36).toFixed(1) + "%), \uCD5C\uADFC \uD68C\uBCF5\uC138\uC785\uB2C8\uB2E4.";
    } else {
      reason2 = "3\uB144 \uC7A5\uAE30(" + Math.abs(ratio36).toFixed(1) + "%) \uB300\uBE44 \uCD5C\uADFC \uACA9\uCC28\uAC00 \uB354 \uBC8C\uC5B4\uC9C0\uB294 \uCD94\uC138\uC785\uB2C8\uB2E4.";
    }
  }

  var reason3 = "\uBE44\uAD50 \uAE30\uC900: \uAC19\uC740 \uC2DC\uAD70\uAD6C \uB0B4 \uBA74\uC801 \u00B115%, \uAC00\uACA9 \uC218\uC900 \u00B130% \uC774\uB0B4 \uB2E8\uC9C0.";

  explain.innerHTML = reason1 + "<br>" + (reason2 ? reason2 + "<br>" : "") + '<span class="source">' + reason3 + "</span>";
  content.appendChild(explain);

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
  panel.addEventListener("click", function (e) {
    e.stopPropagation();
  });

  const header = document.createElement("div");
  header.className = "compare-header";

  const title = document.createElement("div");
  title.className = "compare-title";
  title.textContent = "단지별 시세 비교";
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "compare-close";
  closeBtn.textContent = "닫기";
  closeBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    panel.remove();
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const canvas = document.createElement("canvas");
  canvas.className = "compare-chart";
  panel.appendChild(canvas);

  const legend = document.createElement("div");
  legend.className = "compare-legend";
  panel.appendChild(legend);

  const loading = document.createElement("div");
  loading.className = "rank-detail";
  loading.textContent = "로딩 중...";
  panel.appendChild(loading);

  const ids = [r.id].concat((r.compare || []).map(function (c) { return c.id; }));
  card.appendChild(panel);

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

  loading.remove();

  requestAnimationFrame(function () {
    drawMultiSeries(canvas, seriesList);
  });

  seriesList.forEach(function (s) {
    const item = document.createElement("div");
    item.className = "legend-item";

    const dot = document.createElement("span");
    dot.className = "legend-color";
    dot.style.background = s.color;
    item.appendChild(dot);

    const label = document.createElement("span");
    const priceText = s.last_price ? fmtEok(s.last_price) : "-";
    const dateText = s.last_date ? s.last_date : "";
    const locText = (s.sigungu || s.dong_name) ? (" · " + s.sigungu + " " + s.dong_name) : "";
    const areaText = s.area_m2 ? " " + s.area_m2 + "m²" : "";
    label.textContent = s.name + areaText + locText + " · 최근거래 " + dateText + " · " + priceText;
    item.appendChild(label);

    legend.appendChild(item);
  });
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
        "\uC800\uD3C9\uAC00 TOP3 (\uAC00\uACA9\uB300: " + b.label + ")",
        "\uCD5C\uADFC 6\uAC1C\uC6D4 \uD3C9\uADE0\uAC00 \uAE30\uC900",
        b.top3 || []
      )
    );
  });

  // "다음 행동" 섹션
  var nextAction = document.createElement("div");
  nextAction.className = "section next-action";
  nextAction.innerHTML = '<h2 class="section-title">\uB354 \uC54C\uC544\uBCF4\uAE30</h2>'
    + '<div class="popular-list">'
    + '<a class="popular-item" href="index.html#' + activeSido + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'undervalued\',target:\'main\'})">'
    + '<span class="popular-name">\uC624\uB298\uC758 TOP3</span>'
    + '<span class="popular-meta">\uC0C1\uC2B9 \u00B7 \uAC70\uB798 \u00B7 \uD68C\uBCF5 \uB7AD\uD0B9</span></a>'
    + '<a class="popular-item" href="regional.html#' + activeSido + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'undervalued\',target:\'regional\'})">'
    + '<span class="popular-name">\uC9C0\uC5ED \uC2DC\uC138</span>'
    + '<span class="popular-meta">\uD788\uD2B8\uB9F5 \u00B7 \uB3D9\uBCC4 \uBE44\uAD50</span></a>'
    + '<a class="popular-item" href="search.html#' + activeSido + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'undervalued\',target:\'search\'})">'
    + '<span class="popular-name">\uB2E8\uC9C0 \uAC80\uC0C9</span>'
    + '<span class="popular-meta">\uB2E8\uC9C0\uBA85\uC73C\uB85C \uC2E4\uAC70\uB798 \uC870\uD68C</span></a>'
    + '</div>';
  contentEl.appendChild(nextAction);
}

async function init() {
  try {
    const res = await fetch(dataPath + "?t=" + Date.now());
    if (!res.ok) {
      contentEl.textContent = "데이터를 불러오지 못했습니다.";
      return;
    }
    data = await res.json();
    const sidoOrder = data ? Object.keys(data.sidos || {}) : [];
    var hash = decodeURIComponent(location.hash.replace("#", ""));
    activeSido = (hash && sidoOrder.indexOf(hash) >= 0) ? hash : sidoOrder[0] || null;
    renderTabs(sidoOrder);
    renderSections();
  } catch (e) {
    contentEl.textContent = "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
  }
}

init();

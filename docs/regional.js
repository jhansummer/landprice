/* APT Mine - 지역별 시세 분석 페이지 */
const summaryPath = "data/apt_trade/summary.json";

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const tabsEl = document.getElementById("tabs");
const subtabsEl = document.getElementById("subtabs");

let globalData = null;
let activeSido = null;
let activeDistrict = null;

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

/* ── 시도 탭 ── */
function renderTabs(sidoOrder) {
  tabsEl.innerHTML = "";
  tabsEl.setAttribute("role", "tablist");
  var label = document.createElement("span");
  label.className = "region-label";
  label.textContent = "지역";
  tabsEl.appendChild(label);
  sidoOrder.forEach(function (sido) {
    var btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", sido === activeSido ? "true" : "false");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      activeDistrict = null;
      renderTabs(sidoOrder);
      renderSubTabs();
      renderSections();
      history.replaceState(null, "", "#" + sido);
      APTWatchlist.track("tab_switch", { sido: sido, page: "regional" });
    });
    tabsEl.appendChild(btn);
  });
}

/* ── 구/군 선택 ── */
function renderSubTabs() {
  subtabsEl.innerHTML = "";
  if (!globalData || !activeSido) return;
  var sidoData = globalData.sidos[activeSido];
  if (!sidoData || !sidoData.district_order || !sidoData.district_order.length) return;

  var select = document.createElement("select");
  select.className = "district-select";

  var allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = activeSido + " 전체";
  if (activeDistrict === null) allOpt.selected = true;
  select.appendChild(allOpt);

  sidoData.district_order.forEach(function (dist) {
    var opt = document.createElement("option");
    opt.value = dist;
    opt.textContent = dist;
    if (dist === activeDistrict) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", function () {
    activeDistrict = select.value || null;
    renderSections();
    history.replaceState(null, "", "#" + activeSido + (activeDistrict ? "/" + activeDistrict : ""));
    APTWatchlist.track("district_select", { sido: activeSido, district: activeDistrict || "all", page: "regional" });
  });

  subtabsEl.appendChild(select);
}

/* ── 차트: 시세 추이 + 거래량 ── */
function drawTrendChart(canvas, trendData) {
  if (!trendData || trendData.length < 2) return;
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  var w = rect.width * dpr;
  var h = rect.height * dpr;
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width;
  var ch = rect.height;
  var pad = { top: 10, right: 40, bottom: 24, left: 48 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var prices = trendData.map(function (d) { return d[1]; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.05;

  var volumes = trendData.map(function (d) { return d[2] || 0; });
  var maxVol = Math.max.apply(null, volumes) || 1;
  var volMaxH = plotH * 0.75;

  function xPos(i) { return pad.left + (i / (trendData.length - 1)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  var barW = Math.max(2, plotW / trendData.length * 0.6);
  for (var i = 0; i < trendData.length; i++) {
    var vol = volumes[i];
    if (vol <= 0) continue;
    var barH = (vol / maxVol) * volMaxH;
    var bx = xPos(i) - barW / 2;
    var by = pad.top + plotH - barH;
    ctx.fillStyle = "rgba(37,99,235,0.1)";
    ctx.fillRect(bx, by, barW, barH);
  }

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minP + ((maxP - minP) / 4) * (4 - g);
    ctx.fillText(Math.round(val).toLocaleString(), pad.left - 4, pad.top + (plotH / 4) * g);
  }
  ctx.fillStyle = "#94a3b8"; ctx.textAlign = "left";
  for (var g = 0; g <= 3; g++) {
    var vVal = Math.round(maxVol / 3 * (3 - g));
    var vy = pad.top + plotH - (volMaxH / 3) * (3 - g);
    ctx.fillText(vVal.toLocaleString(), pad.left + plotW + 4, vy);
  }
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  var seenYear = {};
  for (var i = 0; i < trendData.length; i++) {
    var ym = trendData[i][0];
    var yr = ym.slice(0, 4);
    if (ym.slice(4) === "01" && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  }
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.lineTo(xPos(trendData.length - 1), pad.top + plotH);
  ctx.lineTo(xPos(0), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(37,99,235,0.06)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.5; ctx.stroke();
  var lastIdx = trendData.length - 1;
  ctx.fillStyle = "#ef4444";
  ctx.beginPath(); ctx.arc(xPos(lastIdx), yPos(trendData[lastIdx][1]), 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ef4444"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(Math.round(trendData[lastIdx][1]).toLocaleString() + "만/m²", xPos(lastIdx) - 6, yPos(trendData[lastIdx][1]) - 6);
}

function renderTrendSection(trendData, title) {
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "월별 평균 m²당 가격 + 거래량";
  sec.appendChild(sub);
  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "250px";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);
  sec.appendChild(chartDiv);
  requestAnimationFrame(function () { drawTrendChart(canvas, trendData); });
  return sec;
}

/* ── 구별 색상 팔레트 ── */
var DIST_COLORS = [
  "#2563eb", "#7c3aed", "#0891b2", "#4f46e5", "#0d9488",
  "#6366f1", "#0284c7", "#8b5cf6", "#0e7490", "#3b82f6",
  "#6d28d9", "#0369a1", "#7e22ce", "#0c4a6e", "#4338ca",
  "#155e75", "#5b21b6", "#1e40af", "#0f766e", "#1d4ed8",
  "#059669", "#475569", "#9333ea", "#1e3a5f", "#334155"
];

function getDistColor(idx) {
  return DIST_COLORS[idx % DIST_COLORS.length];
}

/* ── 가격대 색상 (히트맵용) ── */
function priceColor(price, minP, maxP) {
  var t = maxP > minP ? (price - minP) / (maxP - minP) : 0.5;
  t = Math.max(0, Math.min(1, t));
  // 4-stop gradient: #2563eb(blue) → #0891b2(teal) → #d97706(amber) → #dc2626(red)
  var stops = [
    [37, 99, 235],   // 0.0 blue
    [8, 145, 178],   // 0.33 teal
    [217, 119, 6],   // 0.66 amber
    [220, 38, 38]    // 1.0 red
  ];
  var seg = t * (stops.length - 1);
  var i = Math.min(Math.floor(seg), stops.length - 2);
  var s = seg - i;
  var r = Math.round(stops[i][0] + (stops[i + 1][0] - stops[i][0]) * s);
  var g = Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * s);
  var b = Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * s);
  return "rgb(" + r + "," + g + "," + b + ")";
}

/* ── 시세 회복 상태 ── */
var RECOVERY_STATUS = {
  recovered: { label: "상승", color: "#2563eb", barColor: "#2563eb", bgColor: "#dbeafe", textColor: "#1e40af" },
  rising:    { label: "회복", color: "#16a34a", barColor: "#16a34a", bgColor: "#dcfce7", textColor: "#166534" },
  flat:      { label: "횡보", color: "#94a3b8", barColor: "#94a3b8", bgColor: "#f1f5f9", textColor: "#64748b" },
  falling:   { label: "하락", color: "#ef4444", barColor: "#ef4444", bgColor: "#fef2f2", textColor: "#dc2626" }
};

/* ── 히트맵 그리드: 구 통계 빌드 ── */
function buildDistrictStats(sidoData) {
  var distOrder = sidoData.district_order || Object.keys(sidoData.districts);
  var stats = [];
  distOrder.forEach(function(distName) {
    var dist = sidoData.districts[distName];
    if (!dist || !dist.dong_stats || !dist.dong_stats.length) return;
    var totalPrice = 0, totalCount = 0;
    dist.dong_stats.forEach(function(d) {
      totalPrice += d.avg_per_m2 * d.txn_count;
      totalCount += d.txn_count;
    });
    if (totalCount === 0) return;
    var rec = null;
    if (sidoData.recovery && sidoData.recovery.items) {
      sidoData.recovery.items.forEach(function(r) {
        if (r.name === distName) rec = r;
      });
    }
    stats.push({
      name: distName,
      avg_per_m2: Math.round(totalPrice / totalCount),
      txn_count: totalCount,
      dong_count: dist.dong_stats.length,
      recovery: rec
    });
  });
  return stats;
}

/* ── 거래량 막대 그래프 (구/동별 시세 현황) ── */
function renderHeatmapGrid(items, title, subtitle) {
  if (!items || !items.length) return null;

  var sec = document.createElement("div");
  sec.className = "section";

  var topBar = document.createElement("div");
  topBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.style.margin = "0";
  h2.textContent = title;
  topBar.appendChild(h2);

  var sortWrap = document.createElement("div");
  sortWrap.className = "sort-btns";

  var prices = items.map(function(d) { return d.avg_per_m2; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);

  var listContainer = document.createElement("div");

  function renderList(sortBy) {
    var sorted = items.slice();
    if (sortBy === "volume") {
      sorted.sort(function(a, b) { return b.txn_count - a.txn_count; });
    } else if (sortBy === "price") {
      sorted.sort(function(a, b) { return b.avg_per_m2 - a.avg_per_m2; });
    } else if (sortBy === "recovery") {
      sorted.sort(function(a, b) {
        var va = a.recovery ? a.recovery.vs_peak : -999;
        var vb = b.recovery ? b.recovery.vs_peak : -999;
        return vb - va;
      });
    }

    listContainer.innerHTML = "";
    var list = document.createElement("div");
    list.className = "vol-bar-list";

    // 막대 기준값은 정렬 기준에 따라 결정
    var maxBarVal;
    if (sortBy === "price") {
      maxBarVal = Math.max.apply(null, sorted.map(function(d) { return d.avg_per_m2; }));
    } else if (sortBy === "recovery") {
      var peaks = sorted.map(function(d) { return d.recovery ? Math.abs(d.recovery.vs_peak) : 0; });
      maxBarVal = Math.max.apply(null, peaks) || 1;
    } else {
      maxBarVal = Math.max.apply(null, sorted.map(function(d) { return d.txn_count; }));
    }

    sorted.forEach(function(item) {
      var row = document.createElement("div");
      row.className = "vol-bar-row";

      var barWrap = document.createElement("div");
      barWrap.className = "vol-bar-wrap";
      var bar = document.createElement("div");
      bar.className = "vol-bar";

      var barVal, barText;
      if (sortBy === "price") {
        barVal = item.avg_per_m2 / maxBarVal * 100;
        barText = Math.round(item.avg_per_m2).toLocaleString() + "\uB9CC";
      } else if (sortBy === "recovery") {
        var vp = item.recovery ? item.recovery.vs_peak : 0;
        barVal = Math.abs(vp) / maxBarVal * 100;
        barText = (vp >= 0 ? "+" : "") + vp + "%";
      } else {
        barVal = item.txn_count / maxBarVal * 100;
        barText = item.txn_count + "\uAC74";
      }
      bar.style.width = Math.max(barVal, 3) + "%";
      bar.style.background = priceColor(item.avg_per_m2, minP, maxP);

      var countEl = document.createElement("span");
      countEl.className = "vol-bar-count";
      countEl.textContent = barText;
      bar.appendChild(countEl);
      barWrap.appendChild(bar);
      row.appendChild(barWrap);

      var label = document.createElement("div");
      label.className = "vol-bar-label";
      var nameSpan = document.createElement("span");
      nameSpan.className = "vol-bar-name";
      nameSpan.textContent = item.name;
      label.appendChild(nameSpan);

      var metaLine = document.createElement("span");
      metaLine.className = "vol-bar-price";
      var metaParts = [];
      if (sortBy !== "price") metaParts.push(Math.round(item.avg_per_m2).toLocaleString() + "\uB9CC/m\u00B2");
      if (sortBy !== "volume") metaParts.push(item.txn_count + "\uAC74");
      metaLine.textContent = metaParts.join(" \u00B7 ");
      if (item.recovery) {
        var st = RECOVERY_STATUS[item.recovery.status] || RECOVERY_STATUS.flat;
        metaLine.textContent += " ";
        var badge = document.createElement("span");
        badge.className = "recovery-badge " + item.recovery.status;
        badge.style.cssText = "font-size:9px;padding:1px 5px";
        badge.textContent = st.label;
        metaLine.appendChild(badge);
      }
      label.appendChild(metaLine);
      row.appendChild(label);

      list.appendChild(row);
    });
    listContainer.appendChild(list);
  }

  [["volume", "\uAC70\uB798\uB7C9\uC21C"], ["price", "\uAC00\uACA9\uC21C"], ["recovery", "\uACE0\uC810\uB300\uBE44\uC21C"]].forEach(function(pair) {
    var btn = document.createElement("button");
    btn.className = "sort-btn" + (pair[0] === "volume" ? " active" : "");
    btn.textContent = pair[1];
    btn.addEventListener("click", function() {
      sortWrap.querySelectorAll(".sort-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      renderList(pair[0]);
    });
    sortWrap.appendChild(btn);
  });

  topBar.appendChild(sortWrap);
  sec.appendChild(topBar);
  sec.appendChild(listContainer);
  renderList("volume");
  return sec;
}

/* ── 구/동 비교 트렌드 차트 ── */
function drawMultiTrendChart(canvas, series) {
  if (!series || !series.length) return;

  var monthMap = {};
  series.forEach(function(s) {
    s.trend.forEach(function(d) { monthMap[d[0]] = true; });
  });
  var months = Object.keys(monthMap).sort();
  if (months.length < 2) return;

  var monthIdx = {};
  months.forEach(function(m, i) { monthIdx[m] = i; });

  series.forEach(function(s) {
    s._prices = {};
    s.trend.forEach(function(d) { s._prices[d[0]] = d[1]; });
  });

  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width;
  var ch = rect.height;
  var pad = { top: 10, right: 12, bottom: 24, left: 48 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var allPrices = [];
  series.forEach(function(s) {
    s.trend.forEach(function(d) { allPrices.push(d[1]); });
  });
  var minP = Math.min.apply(null, allPrices);
  var maxP = Math.max.apply(null, allPrices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.05;

  function xPos(i) { return pad.left + (i / (months.length - 1)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }

  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minP + ((maxP - minP) / 4) * (4 - g);
    ctx.fillText(Math.round(val).toLocaleString(), pad.left - 4, pad.top + (plotH / 4) * g);
  }

  ctx.fillStyle = "#94a3b8"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  var seenYear = {};
  for (var i = 0; i < months.length; i++) {
    var ym = months[i];
    var yr = ym.slice(0, 4);
    if (ym.slice(4) === "01" && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  }

  series.forEach(function(s) {
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < months.length; i++) {
      var price = s._prices[months[i]];
      if (price === undefined) continue;
      if (!started) { ctx.moveTo(xPos(i), yPos(price)); started = true; }
      else ctx.lineTo(xPos(i), yPos(price));
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.stroke();

    var lastMonth = null;
    for (var i = months.length - 1; i >= 0; i--) {
      if (s._prices[months[i]] !== undefined) { lastMonth = months[i]; break; }
    }
    if (lastMonth) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(xPos(monthIdx[lastMonth]), yPos(s._prices[lastMonth]), 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "10px sans-serif"; ctx.textAlign = "right";
      ctx.fillText(Math.round(s._prices[lastMonth]).toLocaleString(), xPos(monthIdx[lastMonth]) - 6, yPos(s._prices[lastMonth]) - 8);
    }
  });
}

function renderCompareSection(sidoData) {
  if (!sidoData || !sidoData.districts) return null;
  var distOrder = sidoData.district_order || Object.keys(sidoData.districts);

  var hasTrend = distOrder.some(function(d) {
    return sidoData.districts[d] && sidoData.districts[d].trend && sidoData.districts[d].trend.length > 1;
  });
  if (!hasTrend) return null;

  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = activeSido + " 구별 시세 비교";
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "2~5개 구를 선택하여 시세 추이를 비교하세요";
  sec.appendChild(sub);

  var checkWrap = document.createElement("div");
  checkWrap.className = "compare-checks";
  var selected = [];

  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "280px";
  chartDiv.style.display = "none";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);

  var legendDiv = document.createElement("div");
  legendDiv.className = "compare-legend";

  var hintEl = document.createElement("p");
  hintEl.className = "compare-hint";
  hintEl.textContent = "구를 2개 이상 선택하면 차트가 표시됩니다";

  function redraw() {
    if (selected.length < 2) {
      chartDiv.style.display = "none";
      legendDiv.innerHTML = "";
      hintEl.style.display = "block";
      return;
    }
    hintEl.style.display = "none";
    chartDiv.style.display = "block";
    var seriesArr = selected.map(function(name) {
      return {
        label: name,
        trend: sidoData.districts[name].trend,
        color: getDistColor(distOrder.indexOf(name))
      };
    });
    requestAnimationFrame(function() { drawMultiTrendChart(canvas, seriesArr); });

    legendDiv.innerHTML = "";
    seriesArr.forEach(function(s) {
      var item = document.createElement("span");
      item.className = "legend-item";
      item.innerHTML = '<span class="legend-color" style="background:' + s.color + '"></span>' + s.label;
      legendDiv.appendChild(item);
    });
  }

  distOrder.forEach(function(distName) {
    var dist = sidoData.districts[distName];
    if (!dist || !dist.trend || dist.trend.length < 2) return;

    var lbl = document.createElement("label");
    lbl.className = "compare-check-label";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "compare-check";
    cb.value = distName;
    cb.addEventListener("change", function() {
      if (cb.checked) {
        if (selected.length >= 5) { cb.checked = false; return; }
        selected.push(distName);
      } else {
        selected = selected.filter(function(n) { return n !== distName; });
      }
      redraw();
    });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(" " + distName));
    checkWrap.appendChild(lbl);
  });

  sec.appendChild(checkWrap);
  sec.appendChild(hintEl);
  sec.appendChild(chartDiv);
  sec.appendChild(legendDiv);
  return sec;
}

/* ── 동네별 시세 비교 (정렬 가능, 단일 구) ── */
function renderDongStats(dongStats, title, dongRecovery) {
  if (!dongStats || !dongStats.length) return null;

  var recoveryMap = {};
  if (dongRecovery && dongRecovery.items) {
    dongRecovery.items.forEach(function(item) { recoveryMap[item.name] = item; });
  }

  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);

  var topBar = document.createElement("div");
  topBar.className = "sort-bar";
  var sub = document.createElement("span");
  sub.className = "section-sub";
  sub.style.margin = "0";
  sub.textContent = "최근 3개월 거래 기준 · m²당 평균가 (만원)";
  topBar.appendChild(sub);

  var sortWrap = document.createElement("div");
  sortWrap.className = "sort-btns";
  var currentSort = "price";
  var listContainer = document.createElement("div");

  function renderList(sortBy) {
    var INITIAL_COUNT = 20;
    var sorted = dongStats.slice();
    if (sortBy === "price") {
      sorted.sort(function(a,b) { return b.avg_per_m2 - a.avg_per_m2; });
    } else if (sortBy === "volume") {
      sorted.sort(function(a,b) { return b.txn_count - a.txn_count; });
    } else if (sortBy === "recovery") {
      sorted.sort(function(a,b) {
        var ra = recoveryMap[a.dong_name], rb = recoveryMap[b.dong_name];
        return (rb ? rb.vs_peak : -999) - (ra ? ra.vs_peak : -999);
      });
    }

    listContainer.innerHTML = "";
    var maxVal = Math.max.apply(null, sorted.map(function(d) { return d.avg_per_m2; }));
    var table = document.createElement("div");
    table.className = "dong-stats-list";

    function renderItem(d) {
      var row = document.createElement("div");
      row.className = "dong-stat-row";
      var nameEl = document.createElement("span");
      nameEl.className = "dong-stat-name";
      nameEl.textContent = d.dong_name;
      row.appendChild(nameEl);
      var barWrap = document.createElement("div");
      barWrap.className = "dong-stat-bar-wrap";
      var bar = document.createElement("div");
      bar.className = "dong-stat-bar";
      bar.style.width = (d.avg_per_m2 / maxVal * 100) + "%";
      barWrap.appendChild(bar);
      row.appendChild(barWrap);
      var valEl = document.createElement("span");
      valEl.className = "dong-stat-val";
      var valText = Math.round(d.avg_per_m2).toLocaleString() + " (" + d.txn_count + "건)";
      var rec = recoveryMap[d.dong_name];
      if (rec) {
        var st = RECOVERY_STATUS[rec.status] || RECOVERY_STATUS.flat;
        valText += " ";
        valEl.textContent = "";
        var span1 = document.createTextNode(Math.round(d.avg_per_m2).toLocaleString() + " (" + d.txn_count + "건) ");
        valEl.appendChild(span1);
        var badge = document.createElement("span");
        badge.className = "recovery-badge " + rec.status;
        badge.style.fontSize = "9px";
        badge.style.padding = "1px 6px";
        badge.textContent = st.label;
        valEl.appendChild(badge);
      } else {
        valEl.textContent = valText;
      }
      row.appendChild(valEl);
      table.appendChild(row);
    }

    sorted.slice(0, INITIAL_COUNT).forEach(renderItem);
    listContainer.appendChild(table);

    if (sorted.length > INITIAL_COUNT) {
      var moreBtn = document.createElement("button");
      moreBtn.className = "sort-btn";
      moreBtn.style.cssText = "display:block;margin:12px auto 0;padding:8px 24px";
      moreBtn.textContent = "\uB354\uBCF4\uAE30 (" + sorted.length + "\uAC1C \uC804\uCCB4)";
      moreBtn.addEventListener("click", function() {
        sorted.slice(INITIAL_COUNT).forEach(renderItem);
        moreBtn.remove();
      });
      listContainer.appendChild(moreBtn);
    }
  }

  [["price", "가격순"], ["volume", "거래량순"], ["recovery", "고점대비순"]].forEach(function(pair) {
    var btn = document.createElement("button");
    btn.className = "sort-btn" + (pair[0] === "price" ? " active" : "");
    btn.textContent = pair[1];
    btn.addEventListener("click", function() {
      currentSort = pair[0];
      sortWrap.querySelectorAll(".sort-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      renderList(pair[0]);
    });
    sortWrap.appendChild(btn);
  });

  topBar.appendChild(sortWrap);
  sec.appendChild(topBar);
  sec.appendChild(listContainer);
  renderList("price");
  return sec;
}

/* ── 동네별 시세 비교 (시도 전체 — 정렬 가능) ── */
function renderAllDongStats(sidoData, title) {
  if (!sidoData || !sidoData.districts) return null;
  var distOrder = sidoData.district_order || Object.keys(sidoData.districts);

  var distColorMap = {};
  var allDongs = [];
  var recoveryMap = {};
  if (sidoData.recovery && sidoData.recovery.items) {
    sidoData.recovery.items.forEach(function(item) { recoveryMap[item.name] = item; });
  }

  distOrder.forEach(function(distName, idx) {
    var dist = sidoData.districts[distName];
    if (!dist || !dist.dong_stats) return;
    distColorMap[distName] = getDistColor(idx);
    var distRec = null;
    if (dist.dong_recovery && dist.dong_recovery.items) {
      dist.dong_recovery.items.forEach(function(r) {
        // dong-level recovery for this dong
      });
    }
    dist.dong_stats.forEach(function(d) {
      var dongRec = null;
      if (dist.dong_recovery && dist.dong_recovery.items) {
        dist.dong_recovery.items.forEach(function(r) {
          if (r.name === d.dong_name) dongRec = r;
        });
      }
      allDongs.push({
        dong_name: d.dong_name,
        avg_per_m2: d.avg_per_m2,
        txn_count: d.txn_count,
        district: distName,
        color: getDistColor(idx),
        recovery: dongRec
      });
    });
  });

  if (!allDongs.length) return null;

  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);

  var topBar = document.createElement("div");
  topBar.className = "sort-bar";
  var sub = document.createElement("span");
  sub.className = "section-sub";
  sub.style.margin = "0";
  sub.textContent = "최근 3개월 거래 기준 · m²당 평균가 (만원) · 구별 색상 구분";
  topBar.appendChild(sub);

  var sortWrap = document.createElement("div");
  sortWrap.className = "sort-btns";
  var listContainer = document.createElement("div");

  function renderList(sortBy) {
    var sorted = allDongs.slice();
    if (sortBy === "price") {
      sorted.sort(function(a,b) { return b.avg_per_m2 - a.avg_per_m2; });
    } else if (sortBy === "volume") {
      sorted.sort(function(a,b) { return b.txn_count - a.txn_count; });
    } else if (sortBy === "recovery") {
      sorted.sort(function(a,b) {
        var va = a.recovery ? a.recovery.vs_peak : -999;
        var vb = b.recovery ? b.recovery.vs_peak : -999;
        return vb - va;
      });
    }

    listContainer.innerHTML = "";
    var maxVal = Math.max.apply(null, sorted.map(function(d) { return d.avg_per_m2; }));
    var table = document.createElement("div");
    table.className = "dong-stats-list";
    function renderItem(d) {
      var row = document.createElement("div");
      row.className = "dong-stat-row dong-stat-row-wide";
      var distLabel = document.createElement("span");
      distLabel.className = "dong-stat-district";
      distLabel.textContent = d.district;
      distLabel.style.color = d.color;
      row.appendChild(distLabel);
      var nameEl = document.createElement("span");
      nameEl.className = "dong-stat-name";
      nameEl.textContent = d.dong_name;
      row.appendChild(nameEl);
      var barWrap = document.createElement("div");
      barWrap.className = "dong-stat-bar-wrap";
      var bar = document.createElement("div");
      bar.className = "dong-stat-bar";
      bar.style.width = (d.avg_per_m2 / maxVal * 100) + "%";
      bar.style.background = d.color;
      barWrap.appendChild(bar);
      row.appendChild(barWrap);
      var valEl = document.createElement("span");
      valEl.className = "dong-stat-val";
      valEl.textContent = Math.round(d.avg_per_m2).toLocaleString() + " (" + d.txn_count + "건)";
      row.appendChild(valEl);
      table.appendChild(row);
    }

    var INITIAL_COUNT = 20;
    sorted.slice(0, INITIAL_COUNT).forEach(renderItem);
    listContainer.appendChild(table);

    if (sorted.length > INITIAL_COUNT) {
      var moreBtn = document.createElement("button");
      moreBtn.className = "sort-btn";
      moreBtn.style.cssText = "display:block;margin:12px auto 0;padding:8px 24px";
      moreBtn.textContent = "\uB354\uBCF4\uAE30 (" + sorted.length + "\uAC1C \uC804\uCCB4)";
      moreBtn.addEventListener("click", function() {
        sorted.slice(INITIAL_COUNT).forEach(renderItem);
        moreBtn.remove();
      });
      listContainer.appendChild(moreBtn);
    }
  }

  [["price", "가격순"], ["volume", "거래량순"], ["recovery", "고점대비순"]].forEach(function(pair) {
    var btn = document.createElement("button");
    btn.className = "sort-btn" + (pair[0] === "price" ? " active" : "");
    btn.textContent = pair[1];
    btn.addEventListener("click", function() {
      sortWrap.querySelectorAll(".sort-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      renderList(pair[0]);
    });
    sortWrap.appendChild(btn);
  });

  topBar.appendChild(sortWrap);
  sec.appendChild(topBar);
  sec.appendChild(listContainer);
  renderList("price");
  return sec;
}

/* ── 시세 회복 현황 (바 차트) ── */
function renderRecoverySection(items, title, isDong) {
  if (!items || !items.length) return null;

  var INITIAL_COUNT = 20;
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "2021~2022 전고점 대비 · 같은 단지 같은 평수 기준 중앙값 · 클릭시 단지별 상세";
  sec.appendChild(sub);

  var list = document.createElement("div");
  list.className = "dong-stats-list";

  var showCount = Math.min(INITIAL_COUNT, items.length);

  function renderItem(item) {
    var st = RECOVERY_STATUS[item.status] || RECOVERY_STATUS.flat;
    var ratio = item.peak > 0 ? Math.min(item.price / item.peak * 100, 120) : 0;

    var rowWrap = document.createElement("div");
    var row = document.createElement("div");
    row.className = "recovery-row";
    row.style.cursor = item.apt_details && item.apt_details.length ? "pointer" : "default";

    var nameEl = document.createElement("span");
    nameEl.className = "dong-stat-name";
    nameEl.textContent = item.name;
    if (item.apt_details && item.apt_details.length) {
      nameEl.innerHTML = item.name + ' <span style="font-size:9px;color:var(--muted);">\u25BC</span>';
    }
    row.appendChild(nameEl);

    var barWrap = document.createElement("div");
    barWrap.className = "recovery-bar-wrap";
    var bar = document.createElement("div");
    bar.className = "recovery-bar " + item.status;
    bar.style.width = Math.min(ratio, 100) + "%";
    barWrap.appendChild(bar);
    if (ratio < 100) {
      var peakLine = document.createElement("div");
      peakLine.className = "recovery-peak-line";
      barWrap.appendChild(peakLine);
    }
    row.appendChild(barWrap);

    var valEl = document.createElement("span");
    valEl.className = "recovery-val";
    var vsPeakStr = (item.vs_peak >= 0 ? "+" : "") + item.vs_peak + "%";
    var chg6mStr = (item.chg6m >= 0 ? "+" : "") + item.chg6m + "%";
    var badge = document.createElement("span");
    badge.className = "recovery-badge " + item.status;
    badge.textContent = st.label;
    valEl.innerHTML = "<span style='font-weight:700;color:" + st.textColor + ";'>" + vsPeakStr + "</span>"
      + " <span style='color:#9a9590;font-size:10px;'>6m " + chg6mStr + "</span> ";
    valEl.appendChild(badge);
    row.appendChild(valEl);
    rowWrap.appendChild(row);

    if (item.apt_details && item.apt_details.length) {
      row.addEventListener("click", function() {
        var existing = rowWrap.querySelector(".apt-detail-list");
        if (existing) {
          existing.remove();
          nameEl.innerHTML = item.name + ' <span style="font-size:9px;color:var(--muted);">\u25BC</span>';
          return;
        }
        nameEl.innerHTML = item.name + ' <span style="font-size:9px;color:var(--muted);">\u25B2</span>';
        var detailList = document.createElement("div");
        detailList.className = "apt-detail-list";
        var header = document.createElement("div");
        header.className = "apt-detail-header";
        header.textContent = item.name + " 단지별 고점 대비 (같은 평수 기준)";
        detailList.appendChild(header);
        item.apt_details.forEach(function(a) {
          var ast = RECOVERY_STATUS[a.status] || RECOVERY_STATUS.flat;
          var avp = (a.vs_peak >= 0 ? "+" : "") + a.vs_peak + "%";
          var aRow = document.createElement("div");
          aRow.className = "apt-detail-row";
          aRow.innerHTML = '<span class="apt-detail-name">' + a.apt_name
            + ' <span style="color:var(--muted);font-weight:400;">' + a.area_m2 + 'm\u00B2</span></span>'
            + '<span class="apt-detail-val">'
            + '<span style="color:' + ast.textColor + ';font-weight:700;">' + avp + '</span>'
            + ' <span class="recovery-badge ' + a.status + '" style="font-size:9px;padding:1px 6px;">' + ast.label + '</span>'
            + '</span>';
          detailList.appendChild(aRow);
        });
        rowWrap.appendChild(detailList);
      });
    }

    list.appendChild(rowWrap);
  }

  items.slice(0, showCount).forEach(renderItem);
  sec.appendChild(list);

  if (items.length > INITIAL_COUNT) {
    var moreBtn = document.createElement("button");
    moreBtn.className = "sort-btn";
    moreBtn.style.cssText = "display:block;margin:12px auto 0;padding:8px 24px";
    moreBtn.textContent = "\uB354\uBCF4\uAE30 (" + items.length + "\uAC1C \uC804\uCCB4)";
    moreBtn.addEventListener("click", function () {
      items.slice(showCount).forEach(renderItem);
      moreBtn.remove();
    });
    sec.appendChild(moreBtn);
  }

  return sec;
}

/* ── 동별 전세가율 ── */
function renderDongJeonseRatio(dongStats, jeonseDongStats, title) {
  if (!dongStats || !dongStats.length || !jeonseDongStats || !jeonseDongStats.length) return null;

  var saleMap = {};
  dongStats.forEach(function(d) { saleMap[d.dong_name] = d.avg_per_m2; });

  var rows = [];
  jeonseDongStats.forEach(function(d) {
    var salePrice = saleMap[d.dong_name];
    if (!salePrice || salePrice <= 0) return;
    var ratio = d.avg_per_m2 / salePrice * 100;
    rows.push({
      dong_name: d.dong_name,
      jeonse_per_m2: d.avg_per_m2,
      sale_per_m2: salePrice,
      ratio: ratio,
      txn_count: d.txn_count
    });
  });
  if (!rows.length) return null;

  rows.sort(function(a, b) { return b.ratio - a.ratio; });

  var INITIAL_COUNT = 15;
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uC804\uC138 m\u00B2\uB2F9 \uD3C9\uADE0\uAC00 \u00F7 \uB9E4\uB9E4 m\u00B2\uB2F9 \uD3C9\uADE0\uAC00 \u00D7 100";
  sec.appendChild(sub);

  var list = document.createElement("div");
  list.className = "dong-stats-list";
  var maxRatio = Math.max.apply(null, rows.map(function(r) { return r.ratio; }));

  function renderItem(r) {
    var row = document.createElement("div");
    row.className = "dong-stat-row";
    var nameEl = document.createElement("span");
    nameEl.className = "dong-stat-name";
    nameEl.textContent = r.dong_name;
    row.appendChild(nameEl);
    var barWrap = document.createElement("div");
    barWrap.className = "dong-stat-bar-wrap";
    var bar = document.createElement("div");
    bar.className = "dong-stat-bar";
    bar.style.width = (r.ratio / maxRatio * 100) + "%";
    bar.style.background = r.ratio >= 60 ? "var(--up)" : r.ratio >= 40 ? "var(--accent)" : "#94a3b8";
    barWrap.appendChild(bar);
    row.appendChild(barWrap);
    var valEl = document.createElement("span");
    valEl.className = "dong-stat-val";
    valEl.textContent = r.ratio.toFixed(1) + "% (" + r.txn_count + "\uAC74)";
    row.appendChild(valEl);
    list.appendChild(row);
  }

  rows.slice(0, INITIAL_COUNT).forEach(renderItem);
  sec.appendChild(list);

  if (rows.length > INITIAL_COUNT) {
    var moreBtn = document.createElement("button");
    moreBtn.className = "sort-btn";
    moreBtn.style.cssText = "display:block;margin:12px auto 0;padding:8px 24px";
    moreBtn.textContent = "\uB354\uBCF4\uAE30 (" + rows.length + "\uAC1C \uC804\uCCB4)";
    moreBtn.addEventListener("click", function() {
      rows.slice(INITIAL_COUNT).forEach(renderItem);
      moreBtn.remove();
    });
    sec.appendChild(moreBtn);
  }

  return sec;
}

/* ── 전세가율 ── */
function renderJeonseSection(jeonse) {
  if (!jeonse || !jeonse.avg_ratio) return null;
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "전세가율";
  sec.appendChild(h2);

  var ratioDiv = document.createElement("div");
  ratioDiv.className = "jeonse-ratio-big";
  ratioDiv.textContent = jeonse.avg_ratio.toFixed(1) + "%";
  sec.appendChild(ratioDiv);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "평균 전세가율 (" + jeonse.count + "개 단지 기준)";
  sec.appendChild(sub);

  if (jeonse.sample_apts && jeonse.sample_apts.length) {
    var INITIAL_COUNT = 10;
    var samples = jeonse.sample_apts;
    var list = document.createElement("div");
    list.className = "jeonse-sample";
    function renderSample(a) {
      var row = document.createElement("div");
      row.className = "jeonse-sample-row";
      var nameEl = document.createElement("span");
      nameEl.className = "jeonse-sample-name";
      nameEl.textContent = a.apt_name;
      row.appendChild(nameEl);
      var areaEl = document.createElement("span");
      areaEl.className = "jeonse-sample-area";
      areaEl.textContent = a.area_m2 + "m\u00B2";
      row.appendChild(areaEl);
      var priceEl = document.createElement("span");
      priceEl.className = "jeonse-sample-price";
      priceEl.textContent = fmt(a.jeonse_price) + "/" + fmt(a.sale_price);
      row.appendChild(priceEl);
      var ratioEl = document.createElement("span");
      ratioEl.className = "jeonse-sample-ratio";
      ratioEl.textContent = a.ratio + "%";
      row.appendChild(ratioEl);
      list.appendChild(row);
    }
    samples.slice(0, INITIAL_COUNT).forEach(renderSample);
    sec.appendChild(list);
    if (samples.length > INITIAL_COUNT) {
      var moreBtn = document.createElement("button");
      moreBtn.className = "sort-btn";
      moreBtn.style.cssText = "display:block;margin:12px auto 0;padding:8px 24px";
      moreBtn.textContent = "\uB354\uBCF4\uAE30 (" + samples.length + "\uAC1C \uC804\uCCB4)";
      moreBtn.addEventListener("click", function() {
        samples.slice(INITIAL_COUNT).forEach(renderSample);
        moreBtn.remove();
      });
      sec.appendChild(moreBtn);
    }
  }
  return sec;
}

/* drawJeonseTrendChart moved to chart-utils.js */

function renderJeonseTrendSection(jeonseTrend, title) {
  if (!jeonseTrend || jeonseTrend.length < 2) return null;
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "월별 평균 전세가율 추이";
  sec.appendChild(sub);
  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "220px";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);
  sec.appendChild(chartDiv);
  requestAnimationFrame(function() { drawJeonseTrendChart(canvas, jeonseTrend); });
  return sec;
}

/* ── 메인 렌더 ── */
function renderSections() {
  gridEl.innerHTML = "";
  if (!globalData || !activeSido) return;

  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;

  var data = sidoData;
  if (activeDistrict && sidoData.districts && sidoData.districts[activeDistrict]) {
    data = sidoData.districts[activeDistrict];
  }

  var regionName = activeDistrict || activeSido;

  // 히트맵 그리드 (지도 대체)
  if (activeDistrict && data.dong_stats && data.dong_stats.length > 1) {
    var dongItems = data.dong_stats.map(function(d) {
      var rec = null;
      if (data.dong_recovery && data.dong_recovery.items) {
        data.dong_recovery.items.forEach(function(r) {
          if (r.name === d.dong_name) rec = r;
        });
      }
      return { name: d.dong_name, avg_per_m2: d.avg_per_m2, txn_count: d.txn_count, recovery: rec };
    });
    var hmSec = renderHeatmapGrid(dongItems, activeDistrict + " 동별 시세 현황", "m²당 평균가 · 셀 색상=가격대, 크기=거래량 · 클릭시 상세");
    if (hmSec) gridEl.appendChild(hmSec);
  } else if (!activeDistrict && sidoData.districts) {
    var distStats = buildDistrictStats(sidoData);
    if (distStats.length) {
      var hmSec2 = renderHeatmapGrid(distStats, activeSido + " 구별 시세 현황", "m²당 평균가 · 셀 색상=가격대, 크기=거래량 · 클릭시 상세");
      if (hmSec2) gridEl.appendChild(hmSec2);
    }
  }

  // 시세 추이 차트
  if (data.trend && data.trend.length > 1) {
    gridEl.appendChild(renderTrendSection(data.trend, regionName + " 시세 추이"));
  }

  // 평형대별 추이
  if (data.trend_by_size) {
    var sizeSec = document.createElement("div");
    sizeSec.className = "section";
    var sizeH2 = document.createElement("h2");
    sizeH2.className = "section-title";
    sizeH2.textContent = regionName + " 평형대별 추이";
    sizeSec.appendChild(sizeH2);
    var sizeSub = document.createElement("p");
    sizeSub.className = "section-sub";
    sizeSub.textContent = "소형(~60m\u00B2) · 중형(60~85m\u00B2) · 대형(85m\u00B2~) m\u00B2당 평균가";
    sizeSec.appendChild(sizeSub);
    var sizeChart = document.createElement("div");
    sizeChart.className = "scatter-chart";
    sizeChart.style.height = "220px";
    var sizeCanvas = document.createElement("canvas");
    sizeChart.appendChild(sizeCanvas);
    sizeSec.appendChild(sizeChart);
    requestAnimationFrame(function() { drawSizeTrendChart(sizeCanvas, data.trend_by_size); });
    // 범례
    var legend = document.createElement("div");
    legend.className = "rank-detail";
    legend.style.marginTop = "8px";
    ["small", "mid", "large"].forEach(function(k) {
      if (!data.trend_by_size[k]) return;
      var wrap = document.createElement("span");
      wrap.style.cssText = "display:inline-flex;align-items:center;gap:5px;margin-right:12px";
      var dot = document.createElement("span");
      dot.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:50%;background:" + SIZE_COLORS[k];
      wrap.appendChild(dot);
      var lbl = document.createElement("span");
      lbl.textContent = SIZE_NAMES[k];
      wrap.appendChild(lbl);
      legend.appendChild(wrap);
    });
    sizeSec.appendChild(legend);
    gridEl.appendChild(sizeSec);
  }

  // 구별 비교 차트 (시도 전체일 때만)
  if (!activeDistrict && sidoData.districts) {
    var compareSec = renderCompareSection(sidoData);
    if (compareSec) gridEl.appendChild(compareSec);
  }

  // 동네별 시세 비교 (바 차트 + 정렬)
  if (activeDistrict && data.dong_stats && data.dong_stats.length > 1) {
    var dongSec = renderDongStats(data.dong_stats, activeDistrict + " 동별 시세 비교", data.dong_recovery);
    if (dongSec) gridEl.appendChild(dongSec);
  } else if (!activeDistrict && sidoData.districts) {
    var allDongSec = renderAllDongStats(sidoData, activeSido + " 동별 시세 비교");
    if (allDongSec) gridEl.appendChild(allDongSec);
  }

  // 시세 회복 현황 (바 차트) — 시도/구 모두 표시
  var recovery = sidoData.recovery;
  if (recovery && recovery.items && recovery.items.length) {
    var recSec = renderRecoverySection(recovery.items, activeSido + " 고점 대비 현황", false);
    if (recSec) gridEl.appendChild(recSec);
  }
  var dongRec = data.dong_recovery;
  if (activeDistrict && dongRec && dongRec.items && dongRec.items.length) {
    var dRecSec = renderRecoverySection(dongRec.items, activeDistrict + " 동별 고점 대비 현황", true);
    if (dRecSec) gridEl.appendChild(dRecSec);
  }

  // 전세가율
  if (data.jeonse) {
    var jeonseSec = renderJeonseSection(data.jeonse);
    if (jeonseSec) gridEl.appendChild(jeonseSec);
  }

  // 동별 전세가율
  if (activeDistrict && data.dong_stats && data.jeonse_dong_stats) {
    var djrSec = renderDongJeonseRatio(data.dong_stats, data.jeonse_dong_stats, activeDistrict + " \uB3D9\uBCC4 \uC804\uC138\uAC00\uC728");
    if (djrSec) gridEl.appendChild(djrSec);
  }

  // 전세가율 추이
  if (data.jeonse_trend && data.jeonse_trend.length > 1) {
    var jtSec = renderJeonseTrendSection(data.jeonse_trend, regionName + " 전세가율 추이");
    if (jtSec) gridEl.appendChild(jtSec);
  }

  // 데이터 없을 때
  if (!gridEl.children.length) {
    var empty = document.createElement("p");
    empty.className = "no-data";
    empty.style.textAlign = "center";
    empty.style.padding = "40px 0";
    empty.textContent = regionName + "\uC758 \uC2DC\uC138 \uB370\uC774\uD130\uAC00 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4.";
    gridEl.appendChild(empty);
  }

  // "다음 행동" 섹션
  var distParam = activeDistrict ? "/" + activeDistrict : "";
  var nextAction = document.createElement("div");
  nextAction.className = "section next-action";
  nextAction.innerHTML = '<h2 class="section-title">\uB354 \uC54C\uC544\uBCF4\uAE30</h2>'
    + '<div class="popular-list">'
    + '<a class="popular-item" href="index.html#' + activeSido + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'regional\',target:\'main\'})">'
    + '<span class="popular-name">\uC624\uB298\uC758 TOP3</span>'
    + '<span class="popular-meta">\uC0C1\uC2B9 \u00B7 \uAC70\uB798 \u00B7 \uD68C\uBCF5 \uB7AD\uD0B9</span></a>'
    + '<a class="popular-item" href="undervalued.html#' + activeSido + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'regional\',target:\'undervalued\'})">'
    + '<span class="popular-name">\uC800\uD3C9\uAC00 TOP3</span>'
    + '<span class="popular-meta">\uC778\uADFC \uB2E8\uC9C0 \uB300\uBE44 \uC800\uD3C9\uAC00 \uBD84\uC11D</span></a>'
    + '<a class="popular-item" href="jeonse.html#' + activeSido + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'regional\',target:\'jeonse\'})">'
    + '<span class="popular-name">\uC804\uC138 \uC2DC\uC138</span>'
    + '<span class="popular-meta">\uC804\uC138\uAC00\uC728 \u00B7 \uAC2D\uD22C\uC790 \uBD84\uC11D</span></a>'
    + '</div>';
  gridEl.appendChild(nextAction);
}

/* ── 초기화 ── */
async function init() {
  try {
    var response = await fetch(summaryPath + "?t=" + Date.now());
    if (!response.ok) {
      statusEl.textContent = "데이터를 불러오지 못했습니다.";
      return;
    }
    globalData = await response.json();

    var sidoOrder = globalData.sido_order || [];
    var hash = decodeURIComponent(location.hash.replace("#", ""));
    var parts = hash.split("/");
    var hashSido = parts[0] || "";
    var hashDist = parts[1] || "";
    activeSido = sidoOrder.indexOf(hashSido) >= 0 ? hashSido : sidoOrder[0] || null;
    if (hashDist && activeSido && globalData.sidos[activeSido]) {
      var dOrder = globalData.sidos[activeSido].district_order || [];
      if (dOrder.indexOf(hashDist) >= 0) activeDistrict = hashDist;
    }

    renderTabs(sidoOrder);
    renderSubTabs();
    renderSections();

    statusEl.innerHTML = "";
    var dateOnly = globalData.updated_at ? globalData.updated_at.slice(0, 10) : "";
    metaEl.textContent = "업데이트: " + dateOnly;
  } catch (e) {
    statusEl.textContent = "네트워크 오류가 발생했습니다. 새로고침해주세요.";
  }
}

init();

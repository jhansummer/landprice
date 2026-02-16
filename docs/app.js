const summaryPath = "data/apt_trade/summary.json";

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const tabsEl = document.getElementById("tabs");
const subtabsEl = document.getElementById("subtabs");
const filtersEl = document.getElementById("filters");

let globalData = null;
let activeSido = null;
let activeDistrict = null;
let activeDong = null;

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

function calcChangeBadge(history, latestPrice) {
  if (!history || history.length < 2 || !latestPrice) return null;
  var prevPrice = history[history.length - 2][1];
  if (!prevPrice) return null;
  return ((latestPrice / prevPrice) - 1) * 100;
}

function renderTabs(sidoOrder) {
  tabsEl.innerHTML = "";
  sidoOrder.forEach(function (sido) {
    var btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      activeDistrict = null;
      activeDong = null;
      renderTabs(sidoOrder);
      renderSubTabs();
      renderFilters();
      renderSections();
      history.replaceState(null, "", "#" + sido);
    });
    tabsEl.appendChild(btn);
  });
}

function drawScatter(canvas, history) {
  if (!history || !history.length) return;

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
  var pad = { top: 8, right: 12, bottom: 22, left: 42 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  // Parse data
  var points = history.map(function (p) {
    var d = new Date(p[0]);
    return { t: d.getTime(), price: p[1] };
  });

  var minT = points[0].t;
  var maxT = points[points.length - 1].t;
  if (minT === maxT) { maxT = minT + 86400000; }

  var prices = points.map(function (p) { return p.price; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.05;

  function xPos(t) { return pad.left + ((t - minT) / (maxT - minT)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  // Grid lines
  ctx.strokeStyle = "#e8e0d4";
  ctx.lineWidth = 0.5;
  for (var i = 0; i <= 3; i++) {
    var gy = pad.top + (plotH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + plotW, gy);
    ctx.stroke();
  }

  // Y-axis labels (억원)
  ctx.fillStyle = "#9a9590";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (var i = 0; i <= 3; i++) {
    var val = minP + ((maxP - minP) / 3) * (3 - i);
    var label = (val / 10000).toFixed(1) + "\uc5b5";
    var ly = pad.top + (plotH / 3) * i;
    ctx.fillText(label, pad.left - 4, ly);
  }

  // X-axis labels (Jan 1 of each year)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  var xLabels = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  for (var li = 0; li < xLabels.length; li++) {
    var xt = new Date(xLabels[li], 0, 1).getTime();
    if (xt < minT || xt > maxT) continue;
    var shortY = String(xLabels[li]).slice(2);
    ctx.fillText(shortY + "/1/1", xPos(xt), pad.top + plotH + 6);
  }

  // Draw connecting line
  ctx.strokeStyle = "#1a6f5a";
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (var i = 0; i < points.length; i++) {
    var px = xPos(points[i].t);
    var py = yPos(points[i].price);
    if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
  }
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  // Plot points
  ctx.fillStyle = "#1a6f5a";
  for (var i = 0; i < points.length; i++) {
    var px = xPos(points[i].t);
    var py = yPos(points[i].price);
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pick key points for labels: first, min, max, last
  var labelIndices = {};
  labelIndices[0] = true;
  labelIndices[points.length - 1] = true;
  var minIdx = 0, maxIdx = 0;
  for (var i = 1; i < points.length; i++) {
    if (points[i].price < points[minIdx].price) minIdx = i;
    if (points[i].price > points[maxIdx].price) maxIdx = i;
  }
  labelIndices[minIdx] = true;
  labelIndices[maxIdx] = true;

  // Draw labels on key points
  ctx.font = "9px sans-serif";
  var drawn = [];
  Object.keys(labelIndices).sort(function(a,b){return a-b;}).forEach(function(idx) {
    idx = parseInt(idx);
    var pt = points[idx];
    var px = xPos(pt.t);
    var py = yPos(pt.price);
    var d = new Date(pt.t);
    var dateStr = (d.getMonth()+1) + "/" + d.getDate();
    var priceStr = (pt.price / 10000).toFixed(1) + "\uc5b5";
    var label = dateStr + " " + priceStr;
    var labelW = ctx.measureText(label).width;

    // Position above point, shift down if near top
    var ly = py - 10;
    if (ly < pad.top + 4) ly = py + 14;

    // Align: left edge for early points, right edge for late points
    var lx = px;
    var align = "center";
    if (px - labelW / 2 < pad.left) { align = "left"; lx = px; }
    else if (px + labelW / 2 > pad.left + plotW) { align = "right"; lx = px; }

    // Skip if overlapping with previously drawn labels
    var overlap = false;
    for (var j = 0; j < drawn.length; j++) {
      if (Math.abs(lx - drawn[j].x) < 50 && Math.abs(ly - drawn[j].y) < 12) {
        overlap = true; break;
      }
    }
    if (overlap) return;

    ctx.textAlign = align;
    ctx.textBaseline = "bottom";
    ctx.fillStyle = idx === points.length - 1 ? "#d63a3a" : "#6e6a63";
    ctx.fillText(label, lx, ly);
    drawn.push({ x: lx, y: ly });
  });

  // Highlight latest point
  var last = points[points.length - 1];
  ctx.fillStyle = "#d63a3a";
  ctx.beginPath();
  ctx.arc(xPos(last.t), yPos(last.price), 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawMultiScatter(canvas, seriesList) {
  if (!seriesList || !seriesList.length) return;

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
  var pad = { top: 8, right: 12, bottom: 22, left: 42 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var allPoints = [];
  seriesList.forEach(function (s) {
    var pts = s.history.map(function (p) {
      var d = new Date(p[0]);
      return { t: d.getTime(), price: p[1] };
    });
    s._points = pts;
    allPoints = allPoints.concat(pts);
  });

  if (!allPoints.length) return;

  var minT = Math.min.apply(null, allPoints.map(function (p) { return p.t; }));
  var maxT = Math.max.apply(null, allPoints.map(function (p) { return p.t; }));
  if (minT === maxT) { maxT = minT + 86400000; }

  var prices = allPoints.map(function (p) { return p.price; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.05;

  function xPos(t) { return pad.left + ((t - minT) / (maxT - minT)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  ctx.strokeStyle = "#e8e0d4";
  ctx.lineWidth = 0.5;
  for (var i = 0; i <= 3; i++) {
    var gy = pad.top + (plotH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + plotW, gy);
    ctx.stroke();
  }

  ctx.fillStyle = "#9a9590";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (var i = 0; i <= 3; i++) {
    var val = minP + ((maxP - minP) / 3) * (3 - i);
    var label = (val / 10000).toFixed(1) + "\uc5b5";
    var ly = pad.top + (plotH / 3) * i;
    ctx.fillText(label, pad.left - 4, ly);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  var xLabels = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  for (var li = 0; li < xLabels.length; li++) {
    var xt = new Date(xLabels[li], 0, 1).getTime();
    if (xt < minT || xt > maxT) continue;
    var shortY = String(xLabels[li]).slice(2);
    ctx.fillText(shortY + "/1/1", xPos(xt), pad.top + plotH + 6);
  }

  var colors = ["#1a6f5a", "#2a6f97", "#b56576"];
  seriesList.forEach(function (s, idx) {
    var pts = s._points || [];
    if (pts.length < 2) return;
    ctx.strokeStyle = colors[idx % colors.length];
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var px = xPos(pts[i].t);
      var py = yPos(pts[i].price);
      if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
    ctx.stroke();

    var last = pts[pts.length - 1];
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors[idx % colors.length];
    ctx.beginPath();
    ctx.arc(xPos(last.t), yPos(last.price), 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

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
  var pad = { top: 10, right: 12, bottom: 24, left: 48 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var prices = trendData.map(function (d) { return d[1]; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.05;

  function xPos(i) { return pad.left + (i / (trendData.length - 1)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  // 그리드
  ctx.strokeStyle = "#e8e0d4";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  // Y축 라벨
  ctx.fillStyle = "#9a9590"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minP + ((maxP - minP) / 4) * (4 - g);
    ctx.fillText(Math.round(val).toLocaleString(), pad.left - 4, pad.top + (plotH / 4) * g);
  }
  // X축 라벨 (연도)
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
  // 영역 채우기
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.lineTo(xPos(trendData.length - 1), pad.top + plotH);
  ctx.lineTo(xPos(0), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(26,111,90,0.1)";
  ctx.fill();
  // 라인
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.strokeStyle = "#1a6f5a"; ctx.lineWidth = 1.5; ctx.stroke();
  // 최신 포인트
  var lastIdx = trendData.length - 1;
  ctx.fillStyle = "#d63a3a";
  ctx.beginPath(); ctx.arc(xPos(lastIdx), yPos(trendData[lastIdx][1]), 4, 0, Math.PI * 2); ctx.fill();
  // 최신값 라벨
  ctx.fillStyle = "#d63a3a"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(Math.round(trendData[lastIdx][1]).toLocaleString() + "\uB9CC/m\u00B2", xPos(lastIdx) - 6, yPos(trendData[lastIdx][1]) - 6);
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
  sub.textContent = "\uC6D4\uBCC4 \uD3C9\uADE0 m\u00B2\uB2F9 \uAC00\uACA9 \uCD94\uC774";
  sec.appendChild(sub);
  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "180px";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);
  sec.appendChild(chartDiv);
  requestAnimationFrame(function () { drawTrendChart(canvas, trendData); });
  return sec;
}

function renderDongStats(dongStats, title) {
  if (!dongStats || !dongStats.length) return null;
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uCD5C\uADFC 3\uAC1C\uC6D4 \uAC70\uB798 \uAE30\uC900 \u00B7 m\u00B2\uB2F9 \uD3C9\uADE0\uAC00 (\uB9CC\uC6D0)";
  sec.appendChild(sub);

  var maxVal = dongStats[0].avg_per_m2;
  var table = document.createElement("div");
  table.className = "dong-stats-list";
  dongStats.slice(0, 15).forEach(function (d) {
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
    valEl.textContent = Math.round(d.avg_per_m2).toLocaleString() + " (" + d.txn_count + "\uAC74)";
    row.appendChild(valEl);
    table.appendChild(row);
  });
  sec.appendChild(table);
  return sec;
}

function renderJeonseSection(jeonse) {
  if (!jeonse || !jeonse.avg_ratio) return null;
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "\uC804\uC138\uAC00\uC728";
  sec.appendChild(h2);

  var ratioDiv = document.createElement("div");
  ratioDiv.className = "jeonse-ratio-big";
  ratioDiv.textContent = jeonse.avg_ratio.toFixed(1) + "%";
  sec.appendChild(ratioDiv);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uD3C9\uADE0 \uC804\uC138\uAC00\uC728 (" + jeonse.count + "\uAC1C \uB2E8\uC9C0 \uAE30\uC900)";
  sec.appendChild(sub);

  if (jeonse.sample_apts && jeonse.sample_apts.length) {
    var list = document.createElement("div");
    list.className = "dong-stats-list";
    jeonse.sample_apts.forEach(function (a) {
      var row = document.createElement("div");
      row.className = "dong-stat-row";
      var nameEl = document.createElement("span");
      nameEl.className = "dong-stat-name";
      nameEl.textContent = a.apt_name + " " + a.area_m2 + "m\u00B2";
      row.appendChild(nameEl);
      var valEl = document.createElement("span");
      valEl.className = "dong-stat-val";
      valEl.textContent = fmt(a.jeonse_price) + "/" + fmt(a.sale_price) + "\uB9CC = " + a.ratio + "%";
      row.appendChild(valEl);
      list.appendChild(row);
    });
    sec.appendChild(list);
  }
  return sec;
}

function drawJeonseTrendChart(canvas, trendData) {
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
  var pad = { top: 10, right: 12, bottom: 24, left: 42 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var ratios = trendData.map(function (d) { return d[1]; });
  var minR = Math.min.apply(null, ratios);
  var maxR = Math.max.apply(null, ratios);
  var rRange = maxR - minR || 1;
  minR -= rRange * 0.05;
  maxR += rRange * 0.05;

  function xPos(i) { return pad.left + (i / (trendData.length - 1)) * plotW; }
  function yPos(r) { return pad.top + (1 - (r - minR) / (maxR - minR)) * plotH; }

  // \uADF8\uB9AC\uB4DC
  ctx.strokeStyle = "#e8e0d4";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  // Y\uCD95 \uB77C\uBCA8
  ctx.fillStyle = "#9a9590"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minR + ((maxR - minR) / 4) * (4 - g);
    ctx.fillText(val.toFixed(0) + "%", pad.left - 4, pad.top + (plotH / 4) * g);
  }
  // X\uCD95 \uB77C\uBCA8 (\uC5F0\uB3C4)
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
  // \uC601\uC5ED \uCC44\uC6B0\uAE30
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.lineTo(xPos(trendData.length - 1), pad.top + plotH);
  ctx.lineTo(xPos(0), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(37,99,235,0.08)";
  ctx.fill();
  // \uB77C\uC778
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.5; ctx.stroke();
  // \uCD5C\uC2E0 \uD3EC\uC778\uD2B8
  var lastIdx = trendData.length - 1;
  ctx.fillStyle = "#d63a3a";
  ctx.beginPath(); ctx.arc(xPos(lastIdx), yPos(trendData[lastIdx][1]), 4, 0, Math.PI * 2); ctx.fill();
  // \uCD5C\uC2E0\uAC12 \uB77C\uBCA8
  ctx.fillStyle = "#d63a3a"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(trendData[lastIdx][1].toFixed(1) + "%", xPos(lastIdx) - 6, yPos(trendData[lastIdx][1]) - 6);
}

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
  sub.textContent = "\uC6D4\uBCC4 \uD3C9\uADE0 \uC804\uC138\uAC00\uC728 \uCD94\uC774";
  sec.appendChild(sub);
  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "180px";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);
  sec.appendChild(chartDiv);
  requestAnimationFrame(function () { drawJeonseTrendChart(canvas, jeonseTrend); });
  return sec;
}

function renderRankedItem(r, idx) {
  var card = document.createElement("div");
  card.className = "rank-card";

  // Rank number
  var num = document.createElement("span");
  var nClass = idx < 3 ? " n" + (idx + 1) : "";
  num.className = "rank-num" + nClass;
  num.textContent = idx + 1;
  card.appendChild(num);

  // Content area
  var content = document.createElement("div");

  // Top row: info + change
  var top = document.createElement("div");
  top.className = "rank-top";

  var info = document.createElement("div");
  info.className = "rank-info";
  var aptEl = document.createElement("div");
  aptEl.className = "rank-apt";
  aptEl.textContent = r.apt_name;
  info.appendChild(aptEl);
  var detail = document.createElement("div");
  detail.className = "rank-detail";
  var detailText = r.sigungu + " " + r.dong_name + " \u00B7 " + r.area_m2 + "m\u00B2";
  if (r.floor) {
    detailText += " \u00B7 " + r.floor + "\uCE35";
  }
  if (r.total_trades) {
    detailText += " \u00B7 " + r.total_trades + "\uAC74";
  }
  detail.textContent = detailText;
  // 직거래 / 저층 태그
  if (r.deal_type && r.deal_type !== "\uC911\uAC1C\uAC70\uB798") {
    var tag = document.createElement("span");
    tag.className = "tag tag-warn";
    tag.textContent = r.deal_type;
    detail.appendChild(tag);
  }
  if (r.floor && r.floor <= 2) {
    var tag = document.createElement("span");
    tag.className = "tag tag-muted";
    tag.textContent = "\uC800\uCE35";
    detail.appendChild(tag);
  }
  // 직전 거래 대비 등락률 뱃지
  var prevChg = calcChangeBadge(r.history, r.latest_price);
  if (prevChg !== null) {
    var chgTag = document.createElement("span");
    chgTag.className = "tag " + (prevChg >= 0 ? "tag-change-up" : "tag-change-down");
    chgTag.textContent = "\uC9C1\uC804 " + (prevChg >= 0 ? "+" : "") + prevChg.toFixed(1) + "%";
    detail.appendChild(chgTag);
  }
  info.appendChild(detail);
  var dateEl = document.createElement("div");
  dateEl.className = "rank-detail";
  dateEl.textContent = r.latest_date;
  info.appendChild(dateEl);
  top.appendChild(info);

  var changeEl = document.createElement("div");
  changeEl.className = "rank-change";
  var pctEl = document.createElement("div");
  pctEl.className = "rank-pct";
  if (r.pct >= 0) {
    pctEl.textContent = "+" + r.pct.toFixed(1) + "%";
    pctEl.style.color = "var(--up)";
  } else {
    pctEl.textContent = r.pct.toFixed(1) + "%";
    pctEl.style.color = "var(--down)";
  }
  changeEl.appendChild(pctEl);
  var diffEl = document.createElement("div");
  diffEl.className = "rank-diff";
  diffEl.textContent = fmt(r.prev_price) + " \u2192 " + fmt(r.latest_price) + "\uB9CC";
  changeEl.appendChild(diffEl);
  var detailBtn = document.createElement("button");
  detailBtn.className = "detail-btn";
  detailBtn.textContent = "\uC790\uC138\uD788";
  detailBtn.style.marginTop = "6px";
  detailBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    showDetail(r);
  });
  changeEl.appendChild(detailBtn);
  top.appendChild(changeEl);

  content.appendChild(top);

  // Scatter chart
  if (r.history && r.history.length > 1) {
    var chartDiv = document.createElement("div");
    chartDiv.className = "scatter-chart";
    var canvas = document.createElement("canvas");
    chartDiv.appendChild(canvas);
    content.appendChild(chartDiv);

    // Draw after DOM insertion
    requestAnimationFrame(function () {
      drawScatter(canvas, r.history);
    });
  }

  card.appendChild(content);

  // section3 항목 (id 있음): 클릭 시 상세 이력 팝업
  if (r.id) {
    card.style.cursor = "pointer";
    card.addEventListener("click", function () {
      showDetail(r);
    });
  }

  return card;
}


function renderSection(sectionData) {
  var sec = document.createElement("div");
  sec.className = "section";

  var title = document.createElement("h2");
  title.className = "section-title";
  title.textContent = sectionData.title;
  sec.appendChild(title);

  if (sectionData.month) {
    var sub = document.createElement("p");
    sub.className = "section-sub";
    sub.textContent = sectionData.month.slice(0, 4) + "\uB144 " + parseInt(sectionData.month.slice(4), 10) + "\uC6D4 \uAE30\uC900";
    sec.appendChild(sub);
  }
  if (sectionData.date) {
    var sub = document.createElement("p");
    sub.className = "section-sub";
    sub.textContent = sectionData.date + " \uAE30\uC900";
    sec.appendChild(sub);
  }

  var top3 = sectionData.top3 || [];
  if (!top3.length) {
    var p = document.createElement("p");
    p.className = "no-data";
    p.textContent = "\uBE44\uAD50 \uAC00\uB2A5\uD55C \uC0C1\uC2B9 \uAC70\uB798 \uC5C6\uC74C";
    sec.appendChild(p);
    return sec;
  }

  top3.forEach(function (r, i) {
    sec.appendChild(renderRankedItem(r, i));
  });

  return sec;
}

function renderSubTabs() {
  subtabsEl.innerHTML = "";
  if (!globalData || !activeSido) return;
  var sidoData = globalData.sidos[activeSido];
  if (!sidoData || !sidoData.district_order || !sidoData.district_order.length) return;

  var select = document.createElement("select");
  select.className = "district-select";

  var allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = activeSido + " \uC804\uCCB4";
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
    activeDong = null;
    renderFilters();
    renderSections();
  });

  subtabsEl.appendChild(select);
}

function renderFilters() {
  filtersEl.innerHTML = "";
  if (!globalData || !activeSido) return;

  var searchLink = document.createElement("a");
  searchLink.href = "search.html";
  searchLink.className = "search-link-btn";
  searchLink.textContent = "\uB2E8\uC9C0\uBA85\uAC80\uC0C9";
  filtersEl.appendChild(searchLink);

  var undervalLink = document.createElement("a");
  undervalLink.href = "undervalued.html";
  undervalLink.className = "search-link-btn";
  undervalLink.textContent = "\uC800\uD3C9\uAC00 TOP3";
  filtersEl.appendChild(undervalLink);

  var mainLink = document.createElement("span");
  mainLink.className = "search-link-btn active";
  mainLink.textContent = "\uBA54\uC778";
  filtersEl.insertBefore(mainLink, searchLink);

}

function renderRecentSection() {
  var recents = getRecent();
  if (!recents.length) return null;

  var sec = document.createElement("div");
  sec.className = "section";

  var header = document.createElement("div");
  header.className = "recent-header";

  var title = document.createElement("h2");
  title.className = "section-title";
  title.textContent = "\uCD5C\uADFC \uBCF8 \uB2E8\uC9C0";
  title.style.margin = "0";
  header.appendChild(title);

  var toggleIcon = document.createElement("span");
  toggleIcon.textContent = "\u25BC";
  toggleIcon.style.color = "var(--muted)";
  toggleIcon.style.fontSize = "11px";
  header.appendChild(toggleIcon);

  sec.appendChild(header);

  var body = document.createElement("div");
  body.className = "recent-body";

  recents.slice(0, 5).forEach(function (item) {
    var row = document.createElement("div");
    row.className = "recent-row";

    var info = document.createElement("div");
    info.className = "recent-info";
    var nameEl = document.createElement("span");
    nameEl.className = "recent-name";
    nameEl.textContent = item.apt_name;
    info.appendChild(nameEl);
    var detailEl = document.createElement("div");
    detailEl.className = "recent-detail";
    detailEl.textContent = (item.sigungu ? item.sigungu + " " : "") + item.dong_name + " \u00B7 " + item.area_m2 + "m\u00B2";
    info.appendChild(detailEl);
    row.appendChild(info);

    var priceEl = document.createElement("div");
    priceEl.className = "recent-price";
    priceEl.textContent = fmt(item.latest_price) + "\uB9CC";
    row.appendChild(priceEl);

    row.addEventListener("click", function () { showDetail(item); });
    body.appendChild(row);
  });

  sec.appendChild(body);

  var collapsed = false;
  header.addEventListener("click", function () {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "block";
    toggleIcon.textContent = collapsed ? "\u25B6" : "\u25BC";
  });

  return sec;
}

function renderSections() {
  gridEl.innerHTML = "";
  if (!globalData || !activeSido) return;

  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;

  // 최근 본 단지
  var recentSec = renderRecentSection();
  if (recentSec) gridEl.appendChild(recentSec);

  var data = sidoData;
  if (activeDistrict && sidoData.districts && sidoData.districts[activeDistrict]) {
    data = sidoData.districts[activeDistrict];
  }

  if (data.section2) {
    gridEl.appendChild(renderSection(data.section2));
  }
  if (data.section1) {
    gridEl.appendChild(renderSection(data.section1));
  }
  if (data.section4) {
    gridEl.appendChild(renderSection(data.section4));
  }
  if (data.section3) {
    gridEl.appendChild(renderSection(data.section3));
  }

  // 시세 추이 차트
  if (data.trend && data.trend.length > 1) {
    var trendTitle = activeDistrict ? activeDistrict + " \uC2DC\uC138 \uCD94\uC774" : activeSido + " \uC2DC\uC138 \uCD94\uC774";
    gridEl.appendChild(renderTrendSection(data.trend, trendTitle));
  }

  // 동네별 비교 (구 선택시만)
  if (activeDistrict && data.dong_stats && data.dong_stats.length > 1) {
    var dongSec = renderDongStats(data.dong_stats, activeDistrict + " \uB3D9\uBCC4 \uC2DC\uC138 \uBE44\uAD50");
    if (dongSec) gridEl.appendChild(dongSec);
  }

  // 전세가율
  if (data.jeonse) {
    var jeonseSec = renderJeonseSection(data.jeonse);
    if (jeonseSec) gridEl.appendChild(jeonseSec);
  }

  // 전세가율 추이
  if (data.jeonse_trend && data.jeonse_trend.length > 1) {
    var jtTitle = activeDistrict ? activeDistrict + " \uC804\uC138\uAC00\uC728 \uCD94\uC774" : activeSido + " \uC804\uC138\uAC00\uC728 \uCD94\uC774";
    var jtSec = renderJeonseTrendSection(data.jeonse_trend, jtTitle);
    if (jtSec) gridEl.appendChild(jtSec);
  }
}

function showDetail(r) {
  if (r.id) addRecent(r);
  // 기존 모달 제거
  var old = document.getElementById("detail-modal");
  if (old) old.remove();

  var overlay = document.createElement("div");
  overlay.id = "detail-modal";
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.remove();
  });

  var modal = document.createElement("div");
  modal.className = "modal-content";

  // 닫기 버튼
  var closeBtn = document.createElement("button");
  closeBtn.className = "modal-close";
  closeBtn.textContent = "\u2715";
  closeBtn.addEventListener("click", function () { overlay.remove(); });
  modal.appendChild(closeBtn);

  // 헤더
  var title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = r.apt_name;
  modal.appendChild(title);

  var sub = document.createElement("p");
  sub.className = "modal-sub";
  sub.textContent = r.sigungu + " " + r.dong_name + " \u00B7 " + r.area_m2 + "m\u00B2";
  modal.appendChild(sub);

  // 로딩
  var body = document.createElement("div");
  body.className = "modal-body";
  body.textContent = "\uB85C\uB529 \uC911...";
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  var compare = (r.compare || []).slice(0, 2);
  var targets = [{ id: r.id, name: r.apt_name, price: r.current_price, region: r.sigungu + " " + r.dong_name }].concat(compare.map(function (c) {
    return { id: c.id, name: c.apt_name, price: c.current_price, region: c.sigungu + " " + c.dong_name };
  }));

  Promise.all(targets.map(function (t) {
    return fetch("data/apt_trade/by_apt/" + t.id + ".json")
      .then(function (res) {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then(function (history) { return { name: t.name, history: history, price: t.price, region: t.region }; });
  }))
    .then(function (seriesList) {
      body.innerHTML = "";

      // 차트
      var baseHistory = seriesList[0] ? seriesList[0].history : [];
      if (baseHistory.length > 1) {
        var chartDiv = document.createElement("div");
        chartDiv.className = "scatter-chart modal-chart";
        var canvas = document.createElement("canvas");
        chartDiv.appendChild(canvas);
        body.appendChild(chartDiv);
        requestAnimationFrame(function () { drawMultiScatter(canvas, seriesList); });
      }

      // 범례
      if (seriesList.length > 1) {
        var legend = document.createElement("div");
        legend.className = "rank-detail";
        var colors = ["#1a6f5a", "#2a6f97", "#b56576"];
        seriesList.forEach(function (s, idx) {
          var wrap = document.createElement("span");
          wrap.style.display = "inline-flex";
          wrap.style.alignItems = "center";
          wrap.style.gap = "6px";
          wrap.style.marginRight = "10px";

          var dot = document.createElement("span");
          dot.style.display = "inline-block";
          dot.style.width = "8px";
          dot.style.height = "8px";
          dot.style.borderRadius = "50%";
          dot.style.background = colors[idx % colors.length];
          wrap.appendChild(dot);

          var label = document.createElement("span");
          var priceText = (s.price != null) ? (" (현재 " + fmt(Math.round(s.price)) + "만)") : "";
          var regionText = s.region ? (" \u00B7 " + s.region) : "";
          label.textContent = s.name + regionText + priceText;
          wrap.appendChild(label);

          legend.appendChild(wrap);
        });
        body.appendChild(legend);
      }

      // 거래 테이블
      var table = document.createElement("table");
      table.className = "modal-table";
      var thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>\uB0A0\uC9DC</th><th>\uAC00\uACA9(\uB9CC)</th></tr>";
      table.appendChild(thead);
      var tbody = document.createElement("tbody");
      for (var i = baseHistory.length - 1; i >= 0; i--) {
        var tr = document.createElement("tr");
        var tdDate = document.createElement("td");
        tdDate.textContent = baseHistory[i][0];
        var tdPrice = document.createElement("td");
        tdPrice.textContent = fmt(baseHistory[i][1]);
        tr.appendChild(tdDate);
        tr.appendChild(tdPrice);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      body.appendChild(table);
    })
    .catch(function () {
      body.textContent = "\uC774\uB825 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
    });
}

async function init() {
  var response = await fetch(summaryPath);
  if (!response.ok) {
    statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
    return;
  }
  globalData = await response.json();

  var sidoOrder = globalData.sido_order || [];
  var hash = decodeURIComponent(location.hash.replace("#", ""));
  activeSido = sidoOrder.indexOf(hash) >= 0 ? hash : sidoOrder[0] || null;

  renderTabs(sidoOrder);
  renderSubTabs();
  renderFilters();
  renderSections();

  statusEl.textContent = "";
  var dateOnly = globalData.updated_at ? globalData.updated_at.slice(0, 10) : "";
  metaEl.textContent = "\uC5C5\uB370\uC774\uD2B8: " + dateOnly;
}

init();

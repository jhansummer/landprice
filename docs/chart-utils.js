/* APT Mine - 공통 차트 유틸리티 */

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
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.6;
  for (var i = 0; i <= 3; i++) {
    var gy = pad.top + (plotH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + plotW, gy);
    ctx.stroke();
  }

  // Y-axis labels
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (var i = 0; i <= 3; i++) {
    var val = minP + ((maxP - minP) / 3) * (3 - i);
    var label = (val / 10000).toFixed(1) + "\uc5b5";
    var ly = pad.top + (plotH / 3) * i;
    ctx.fillText(label, pad.left - 4, ly);
  }

  // X-axis labels
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
  ctx.strokeStyle = "#2563eb";
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
  ctx.fillStyle = "#2563eb";
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

    var ly = py - 10;
    if (ly < pad.top + 4) ly = py + 14;

    var lx = px;
    var align = "center";
    if (px - labelW / 2 < pad.left) { align = "left"; lx = px; }
    else if (px + labelW / 2 > pad.left + plotW) { align = "right"; lx = px; }

    var overlap = false;
    for (var j = 0; j < drawn.length; j++) {
      if (Math.abs(lx - drawn[j].x) < 50 && Math.abs(ly - drawn[j].y) < 12) {
        overlap = true; break;
      }
    }
    if (overlap) return;

    ctx.textAlign = align;
    ctx.textBaseline = "bottom";
    ctx.fillStyle = idx === points.length - 1 ? "#ef4444" : "#94a3b8";
    ctx.fillText(label, lx, ly);
    drawn.push({ x: lx, y: ly });
  });

  // Highlight latest point
  var last = points[points.length - 1];
  ctx.fillStyle = "#ef4444";
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

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (var i = 0; i <= 3; i++) {
    var gy = pad.top + (plotH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + plotW, gy);
    ctx.stroke();
  }

  ctx.fillStyle = "#64748b";
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

  var colors = ["#2563eb", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"];
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

/* ── 전세가율 추이 차트 ── */
function drawJeonseTrendChart(canvas, trendData) {
  if (!trendData || trendData.length < 2) return;
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width;
  var ch = rect.height;
  var pad = { top: 10, right: 12, bottom: 24, left: 42 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var ratios = trendData.map(function(d) { return d[1]; });
  var minR = 0;
  var maxR = 100;

  function xPos(i) { return pad.left + (i / (trendData.length - 1)) * plotW; }
  function yPos(r) { return pad.top + (1 - (r - minR) / (maxR - minR)) * plotH; }

  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minR + ((maxR - minR) / 4) * (4 - g);
    ctx.fillText(val.toFixed(0) + "%", pad.left - 4, pad.top + (plotH / 4) * g);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  var seenYear = {};
  for (var i = 0; i < trendData.length; i++) {
    var ym = trendData[i][0];
    var yr = ym.slice(0, 4);
    var mm = ym.slice(4);
    if ((mm === "01" || i === 0) && !seenYear[yr]) {
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
  ctx.fillText(trendData[lastIdx][1].toFixed(1) + "%", xPos(lastIdx) - 6, yPos(trendData[lastIdx][1]) - 6);
}

/* ── 전세 거래량 바 차트 ── */
function drawJeonseVolumeChart(canvas, volumeData) {
  if (!volumeData || volumeData.length < 2) return;
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width;
  var ch = rect.height;
  var pad = { top: 10, right: 12, bottom: 24, left: 42 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var counts = volumeData.map(function(d) { return d[1]; });
  var maxC = Math.max.apply(null, counts);
  if (maxC <= 0) return;
  maxC = Math.ceil(maxC * 1.15); /* 상단 15% 여유 */

  var barW = Math.max(2, (plotW / volumeData.length) - 2);

  // Grid
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  // Y labels
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = Math.round(maxC * (4 - g) / 4);
    ctx.fillText(val.toLocaleString(), pad.left - 4, pad.top + (plotH / 4) * g);
  }
  // X labels
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  var seenYear = {};
  for (var i = 0; i < volumeData.length; i++) {
    var ym = volumeData[i][0];
    var yr = ym.slice(0, 4), mm = ym.slice(4);
    if ((mm === "01" || i === 0) && !seenYear[yr]) {
      seenYear[yr] = true;
      var bx = pad.left + (i / (volumeData.length - 1)) * plotW;
      ctx.fillText(yr, bx, pad.top + plotH + 6);
    }
  }
  // Bars
  for (var i = 0; i < volumeData.length; i++) {
    var cnt = volumeData[i][1];
    var bx = pad.left + (i / (volumeData.length - 1)) * plotW - barW / 2;
    var bh = (cnt / maxC) * plotH;
    var by = pad.top + plotH - bh;
    ctx.fillStyle = i === volumeData.length - 1 ? "rgba(239,68,68,0.7)" : "rgba(37,99,235,0.4)";
    ctx.fillRect(bx, by, barW, bh);
  }
  // Latest count label
  var lastC = counts[counts.length - 1];
  ctx.fillStyle = "#ef4444"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
  var lastX = pad.left + ((volumeData.length - 1) / (volumeData.length - 1)) * plotW;
  var lastH = (lastC / maxC) * plotH;
  ctx.fillText(lastC.toLocaleString() + "건", lastX, pad.top + plotH - lastH - 12);
}

/* ── 갭 추이 차트 ── */
function drawGapTrendChart(canvas, trendData) {
  if (!trendData || trendData.length < 2) return;
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width, ch = rect.height;
  var pad = { top: 10, right: 12, bottom: 24, left: 50 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var gaps = trendData.map(function(d) { return d[1]; });
  var minG = Math.min.apply(null, gaps);
  var maxG = Math.max.apply(null, gaps);
  var gRange = maxG - minG || 1;
  minG -= gRange * 0.05; maxG += gRange * 0.05;

  function xPos(i) { return pad.left + (i / (trendData.length - 1)) * plotW; }
  function yPos(g) { return pad.top + (1 - (g - minG) / (maxG - minG)) * plotH; }

  // Grid
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  // Y labels (만원)
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minG + ((maxG - minG) / 4) * (4 - g);
    var label = val >= 10000 ? (val / 10000).toFixed(1) + "\uc5b5" : Math.round(val).toLocaleString() + "만";
    ctx.fillText(label, pad.left - 4, pad.top + (plotH / 4) * g);
  }
  // X labels
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  var seenYear = {};
  for (var i = 0; i < trendData.length; i++) {
    var ym = trendData[i][0], yr = ym.slice(0, 4), mm = ym.slice(4);
    if ((mm === "01" || i === 0) && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  }
  // Area fill
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.lineTo(xPos(trendData.length - 1), pad.top + plotH);
  ctx.lineTo(xPos(0), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(249,115,22,0.06)"; ctx.fill();
  // Line
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.strokeStyle = "#f97316"; ctx.lineWidth = 1.5; ctx.stroke();
  // Latest dot
  var li = trendData.length - 1;
  ctx.fillStyle = "#ef4444";
  ctx.beginPath(); ctx.arc(xPos(li), yPos(trendData[li][1]), 4, 0, Math.PI * 2); ctx.fill();
  var lv = trendData[li][1];
  var lbl = lv >= 10000 ? (lv / 10000).toFixed(1) + "\uc5b5" : Math.round(lv).toLocaleString() + "만";
  ctx.font = "10px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(lbl, xPos(li) - 6, yPos(lv) - 6);
}

/* ── 평형대별 추이 차트 (멀티라인) ── */
var SIZE_COLORS = { small: "#3b82f6", mid: "#10b981", large: "#f59e0b" };
var SIZE_NAMES = { small: "소형(~60)", mid: "중형(60~85)", large: "대형(85~)" };

function drawSizeTrendChart(canvas, trendBySize) {
  if (!trendBySize) return;
  var keys = Object.keys(trendBySize);
  if (!keys.length) return;

  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width, ch = rect.height;
  var pad = { top: 10, right: 12, bottom: 24, left: 48 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  // Collect all months + price range
  var allMonths = {};
  var minP = Infinity, maxP = -Infinity;
  keys.forEach(function(k) {
    trendBySize[k].forEach(function(d) {
      allMonths[d[0]] = true;
      if (d[1] < minP) minP = d[1];
      if (d[1] > maxP) maxP = d[1];
    });
  });
  var months = Object.keys(allMonths).sort();
  if (months.length < 2) return;
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05; maxP += pRange * 0.05;

  var monthIdx = {};
  months.forEach(function(m, i) { monthIdx[m] = i; });

  function xPos(i) { return pad.left + (i / (months.length - 1)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  // Grid
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minP + ((maxP - minP) / 4) * (4 - g);
    ctx.fillText(Math.round(val).toLocaleString(), pad.left - 4, pad.top + (plotH / 4) * g);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  var seenYear = {};
  for (var i = 0; i < months.length; i++) {
    var yr = months[i].slice(0, 4);
    if (months[i].slice(4) === "01" && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  }

  // Draw each size line
  var order = ["small", "mid", "large"];
  order.forEach(function(k) {
    var trend = trendBySize[k];
    if (!trend || trend.length < 2) return;
    ctx.strokeStyle = SIZE_COLORS[k]; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < trend.length; i++) {
      var mi = monthIdx[trend[i][0]];
      if (mi === undefined) continue;
      if (!started) { ctx.moveTo(xPos(mi), yPos(trend[i][1])); started = true; }
      else ctx.lineTo(xPos(mi), yPos(trend[i][1]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Latest dot + label
    var last = trend[trend.length - 1];
    var lmi = monthIdx[last[0]];
    ctx.fillStyle = SIZE_COLORS[k];
    ctx.beginPath(); ctx.arc(xPos(lmi), yPos(last[1]), 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = "9px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(SIZE_NAMES[k], xPos(lmi) + 6, yPos(last[1]) - 4);
  });
}

/* ── 가격+거래량 듀얼 차트 ── */
function drawPriceVolumeChart(canvas, trendData) {
  if (!trendData || trendData.length < 2) return;
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width, ch = rect.height;
  var pad = { top: 10, right: 40, bottom: 24, left: 48 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var prices = trendData.map(function(d) { return d[1]; });
  var volumes = trendData.map(function(d) { return d[2] || 0; });
  var minP = Math.min.apply(null, prices), maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05; maxP += pRange * 0.05;
  var maxV = Math.max.apply(null, volumes) || 1;

  function xPos(i) { return pad.left + (i / (trendData.length - 1)) * plotW; }
  function yPosP(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }
  function yPosV(v) { return pad.top + plotH - (v / maxV) * plotH * 0.4; }

  // Grid
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  // Y left (price)
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minP + ((maxP - minP) / 4) * (4 - g);
    ctx.fillText(Math.round(val).toLocaleString(), pad.left - 4, pad.top + (plotH / 4) * g);
  }
  // Y right (volume)
  ctx.textAlign = "left";
  for (var g = 0; g <= 2; g++) {
    var vVal = Math.round(maxV * (2 - g) / 2);
    var vy = pad.top + plotH - (vVal / maxV) * plotH * 0.4;
    ctx.fillText(vVal.toLocaleString(), pad.left + plotW + 4, vy);
  }
  // X labels
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  var seenYear = {};
  for (var i = 0; i < trendData.length; i++) {
    var ym = trendData[i][0], yr = ym.slice(0, 4);
    if (ym.slice(4) === "01" && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  }
  // Volume bars
  var barW = Math.max(2, (plotW / trendData.length) - 2);
  for (var i = 0; i < trendData.length; i++) {
    var v = volumes[i];
    var bx = xPos(i) - barW / 2;
    var bh = (v / maxV) * plotH * 0.4;
    ctx.fillStyle = "rgba(37,99,235,0.10)";
    ctx.fillRect(bx, pad.top + plotH - bh, barW, bh);
  }
  // Price line
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPosP(prices[0]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPosP(prices[i]));
  ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.5; ctx.stroke();
  // Latest dot
  var li = trendData.length - 1;
  ctx.fillStyle = "#ef4444";
  ctx.beginPath(); ctx.arc(xPos(li), yPosP(prices[li]), 4, 0, Math.PI * 2); ctx.fill();
  ctx.font = "10px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(Math.round(prices[li]).toLocaleString() + "만", xPos(li) - 6, yPosP(prices[li]) - 6);
}

/* ── 고점 대비 현재가격 비교 차트 (바닥찾기용) ── */
function drawPeakChart(canvas, txns, apt) {
  if (!txns || !txns.length) return;

  // 월별 평균 계산
  var monthlyMap = {};
  txns.forEach(function (t) {
    var d = new Date(t[0]);
    var ym = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0");
    if (!monthlyMap[ym]) monthlyMap[ym] = { sum: 0, count: 0 };
    monthlyMap[ym].sum += t[1];
    monthlyMap[ym].count += 1;
  });

  var months = Object.keys(monthlyMap).sort();
  if (months.length < 2) return;

  var data = months.map(function (ym) {
    var m = monthlyMap[ym];
    return { ym: ym, price: m.sum / m.count };
  });

  // 고점 찾기 (2021~2022 구간 우선, 없으면 전체 최고)
  var peakIdx = 0;
  var hasPeakRange = false;
  data.forEach(function (d, i) {
    if (d.ym >= "202101" && d.ym <= "202212") {
      if (!hasPeakRange || d.price > data[peakIdx].price) {
        peakIdx = i;
        hasPeakRange = true;
      }
    }
  });
  if (!hasPeakRange) {
    data.forEach(function (d, i) {
      if (d.price > data[peakIdx].price) peakIdx = i;
    });
  }
  var peakPrice = data[peakIdx].price;
  var peakYm = data[peakIdx].ym;

  // 저점 찾기 (고점 이후)
  var troughIdx = peakIdx;
  for (var ti = peakIdx + 1; ti < data.length; ti++) {
    if (data[ti].price < data[troughIdx].price) troughIdx = ti;
  }
  var troughPrice = data[troughIdx].price;
  var troughYm = data[troughIdx].ym;

  // 현재가: 마지막 1개월 평균
  var currentPrice = data[data.length - 1].price;

  // 고점 대비 %, 저점 대비 회복 %
  var vsPeakPct = peakPrice > 0 ? ((currentPrice - peakPrice) / peakPrice * 100) : 0;
  var recoveryPct = (troughIdx > peakIdx && peakPrice > troughPrice)
    ? ((currentPrice - troughPrice) / (peakPrice - troughPrice) * 100) : 0;

  // 캔버스 설정
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width;
  var ch = rect.height;
  var pad = { top: 44, right: 14, bottom: 24, left: 48 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  // 가격 범위
  var prices = data.map(function (d) { return d.price; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.1;

  function xPos(i) { return pad.left + (i / (data.length - 1)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  function fmtPrice(v) {
    if (v >= 10000) return (v / 10000).toFixed(1) + "\uc5b5";
    return Math.round(v).toLocaleString() + "\ub9cc";
  }

  // 배경
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, cw, ch);

  // 그리드
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }

  // Y축 라벨
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minP + ((maxP - minP) / 4) * (4 - g);
    ctx.fillText(fmtPrice(val), pad.left - 4, pad.top + (plotH / 4) * g);
  }

  // X축 라벨
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  var seenYear = {};
  data.forEach(function (d, i) {
    var yr = d.ym.slice(0, 4);
    if (d.ym.slice(4) === "01" && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  });

  var peakY = yPos(peakPrice);
  var curY = yPos(currentPrice);
  var lastIdx = data.length - 1;

  // 고점 수평 점선
  ctx.save();
  ctx.setLineDash([5, 3]);
  ctx.strokeStyle = "rgba(239, 68, 68, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, peakY);
  ctx.lineTo(pad.left + plotW, peakY);
  ctx.stroke();
  ctx.restore();

  // 현재가 수평 점선
  ctx.save();
  ctx.setLineDash([5, 3]);
  ctx.strokeStyle = "rgba(37, 99, 235, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, curY);
  ctx.lineTo(pad.left + plotW, curY);
  ctx.stroke();
  ctx.restore();

  // 고점~현재 사이 영역 채우기 (line 따라가는 영역)
  ctx.beginPath();
  ctx.moveTo(xPos(peakIdx), peakY);
  for (var fi = peakIdx; fi < data.length; fi++) {
    ctx.lineTo(xPos(fi), yPos(data[fi].price));
  }
  ctx.lineTo(xPos(data.length - 1), peakY);
  ctx.closePath();
  ctx.fillStyle = "rgba(239, 68, 68, 0.06)";
  ctx.fill();

  // 구간별 라인 (고점 전: 회색, 고점→저점: 빨강, 저점→현재: 초록)
  // 1) 고점 이전 (회색)
  if (peakIdx > 0) {
    ctx.beginPath();
    ctx.moveTo(xPos(0), yPos(data[0].price));
    for (var li = 1; li <= peakIdx; li++) {
      ctx.lineTo(xPos(li), yPos(data[li].price));
    }
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 2) 고점 → 저점 (빨강)
  if (troughIdx > peakIdx) {
    ctx.beginPath();
    ctx.moveTo(xPos(peakIdx), yPos(data[peakIdx].price));
    for (var li = peakIdx + 1; li <= troughIdx; li++) {
      ctx.lineTo(xPos(li), yPos(data[li].price));
    }
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 3) 저점 → 현재 (파랑/초록 - 회복 중이면 초록)
  var afterIdx = troughIdx > peakIdx ? troughIdx : peakIdx;
  if (afterIdx < lastIdx) {
    ctx.beginPath();
    ctx.moveTo(xPos(afterIdx), yPos(data[afterIdx].price));
    for (var li = afterIdx + 1; li <= lastIdx; li++) {
      ctx.lineTo(xPos(li), yPos(data[li].price));
    }
    ctx.strokeStyle = currentPrice > troughPrice ? "#16a34a" : "#ef4444";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 고점↔현재 비교 브릿지 (오른쪽 세로 화살표)
  var bridgeX = pad.left + plotW - 2;
  // 세로 이중선
  ctx.save();
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bridgeX, peakY);
  ctx.lineTo(bridgeX, curY);
  ctx.stroke();
  // 위 꺽쇠
  ctx.beginPath();
  ctx.moveTo(bridgeX - 3, peakY + 4);
  ctx.lineTo(bridgeX, peakY);
  ctx.lineTo(bridgeX + 3, peakY + 4);
  ctx.stroke();
  // 아래 꺽쇠
  ctx.beginPath();
  ctx.moveTo(bridgeX - 3, curY - 4);
  ctx.lineTo(bridgeX, curY);
  ctx.lineTo(bridgeX + 3, curY - 4);
  ctx.stroke();
  ctx.restore();
  // 브릿지 가운데 갭 라벨
  var bridgeMidY = (peakY + curY) / 2;
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = vsPeakPct >= 0 ? "#16a34a" : "#ef4444";
  var gapLabel = (vsPeakPct >= 0 ? "+" : "") + vsPeakPct.toFixed(1) + "%";
  ctx.fillText(gapLabel, bridgeX - 4, bridgeMidY + 3);

  // 라벨 위치 계산 (겹침 방지)
  var peakLabelY = yPos(peakPrice) - 10;
  var peakDateY = yPos(peakPrice) + 3;
  var hasTrough = troughIdx > peakIdx && troughIdx < lastIdx;
  var troughLabelY = hasTrough ? yPos(troughPrice) + 14 : 0;
  var troughDateY = hasTrough ? troughLabelY + 11 : 0;
  var curLabelY2 = curY - 2;

  // 고점 라벨이 차트 상단을 넘으면 아래로
  if (peakLabelY < pad.top + 4) {
    peakLabelY = yPos(peakPrice) + 16;
    peakDateY = peakLabelY + 12;
  }
  // 현재가 라벨이 고점 라벨과 겹치면 아래로
  if (Math.abs(curLabelY2 - peakLabelY) < 16) curLabelY2 = peakLabelY + 18;
  // 현재가 라벨이 차트 하단을 넘으면 위로
  if (curLabelY2 > pad.top + plotH - 4) curLabelY2 = curY - 16;
  // 저점 라벨이 현재가 라벨과 겹으면 더 아래로
  if (hasTrough && Math.abs(troughLabelY - curLabelY2) < 16 && Math.abs(xPos(troughIdx) - xPos(lastIdx)) < 60) {
    troughLabelY = Math.max(troughLabelY, curLabelY2 + 16);
    troughDateY = troughLabelY + 11;
  }
  // 저점 라벨이 차트 하단을 넘으면 위로
  if (hasTrough && troughDateY > pad.top + plotH - 2) {
    troughLabelY = yPos(troughPrice) - 12;
    troughDateY = troughLabelY - 11;
  }

  // 고점 포인트
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(xPos(peakIdx), yPos(peakPrice), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(xPos(peakIdx), yPos(peakPrice), 5, 0, Math.PI * 2); ctx.stroke();
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = peakIdx < data.length * 0.6 ? "left" : "right";
  var peakLabelX = peakIdx < data.length * 0.6 ? xPos(peakIdx) + 8 : xPos(peakIdx) - 8;
  ctx.fillStyle = "#ef4444";
  ctx.fillText(fmtPrice(peakPrice), peakLabelX, peakLabelY);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px sans-serif";
  ctx.fillText(peakYm.slice(0, 4) + "." + peakYm.slice(4), peakLabelX, peakDateY);

  // 저점 포인트 (고점 이후, 현재가 아닌 경우)
  if (hasTrough) {
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.arc(xPos(troughIdx), yPos(troughPrice), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(xPos(troughIdx), yPos(troughPrice), 4, 0, Math.PI * 2); ctx.stroke();
    ctx.font = "9px sans-serif";
    ctx.fillStyle = "#f59e0b";
    ctx.textAlign = "center";
    ctx.fillText("\uc800\uc810 " + fmtPrice(troughPrice), xPos(troughIdx), troughLabelY);
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(troughYm.slice(0, 4) + "." + troughYm.slice(4), xPos(troughIdx), troughDateY);
  }

  // 현재가 포인트 (마지막)
  ctx.fillStyle = "#2563eb";
  ctx.beginPath();
  ctx.arc(xPos(lastIdx), curY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(xPos(lastIdx), curY, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = "#2563eb";
  ctx.fillText("\ud604\uc7ac " + fmtPrice(currentPrice), xPos(lastIdx) - 10, curLabelY2);

  // 상단 Row 1: 범례(좌) + 고점대비(우)
  var row1Y = 14, row2Y = 28;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ef4444";
  ctx.fillText("\u25cf \uace0\uc810", pad.left, row1Y);
  ctx.fillStyle = "#2563eb";
  ctx.fillText("\u25cf \ud604\uc7ac", pad.left + 42, row1Y);
  if (troughIdx > peakIdx && troughIdx < lastIdx) {
    ctx.fillStyle = "#f59e0b";
    ctx.fillText("\u25cf \uc800\uc810", pad.left + 82, row1Y);
  }
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = vsPeakPct >= 0 ? "#16a34a" : "#ef4444";
  ctx.fillText("\uace0\uc810\ub300\ube44 " + (vsPeakPct >= 0 ? "+" : "") + vsPeakPct.toFixed(1) + "%", pad.left + plotW, row1Y);

  // 상단 Row 2: 저점대비 회복률(우)
  if (troughIdx > peakIdx && recoveryPct > 0) {
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = "#16a34a";
    ctx.fillText("\uc800\uc810\ub300\ube44 " + recoveryPct.toFixed(0) + "% \ud68c\ubcf5", pad.left + plotW, row2Y);
  }
}

/* ── 신고가검색용 간단 추이 차트 (직전거래 대비 상승폭) ── */
/* txns: by_apt/{id}.json — 각 항목 [날짜, 총매매가(만원)] */
function drawNewHighChart(canvas, txns) {
  if (!txns || !txns.length) return;

  function fmtPrice(v) {
    if (v >= 10000) return (v / 10000).toFixed(v % 10000 === 0 ? 0 : 1) + "억";
    if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "천만";
    return Math.round(v) + "만";
  }

  // 월별 평균 (by_apt 가격은 이미 총 매매가(만원))
  var monthlyMap = {};
  txns.forEach(function (t) {
    var d = new Date(t[0]);
    var ym = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0");
    if (!monthlyMap[ym]) monthlyMap[ym] = { sum: 0, count: 0 };
    monthlyMap[ym].sum += t[1];
    monthlyMap[ym].count += 1;
  });
  var months = Object.keys(monthlyMap).sort();
  if (months.length < 2) return;
  var data = months.map(function (ym) {
    var m = monthlyMap[ym];
    return { ym: ym, price: m.sum / m.count };
  });

  // 직전 대비 상승
  var lastPrice = data[data.length - 1].price;
  var prevPrice = data[data.length - 2].price;
  var chgPct = prevPrice > 0 ? ((lastPrice - prevPrice) / prevPrice * 100) : 0;

  // 캔버스 설정
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width;
  var ch = rect.height;
  var pad = { top: 28, right: 14, bottom: 24, left: 48 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var prices = data.map(function (d) { return d.price; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.05;

  function xPos(i) { return pad.left + (i / (data.length - 1)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  // 배경
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(pad.left, pad.top, plotW, plotH);

  // Y축 그리드
  var nTicks = 4;
  ctx.font = "9px sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = "#94a3b8";
  for (var yi = 0; yi <= nTicks; yi++) {
    var pVal = minP + (maxP - minP) * (yi / nTicks);
    var yy = yPos(pVal);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(pad.left + plotW, yy); ctx.stroke();
    ctx.fillText(fmtPrice(pVal), pad.left - 4, yy + 3);
  }

  // X축 라벨
  ctx.textAlign = "center";
  ctx.fillStyle = "#94a3b8";
  var xStep = Math.max(1, Math.floor(data.length / 5));
  for (var xi = 0; xi < data.length; xi += xStep) {
    var ym = data[xi].ym;
    ctx.fillText(ym.slice(2, 4) + "." + ym.slice(4), xPos(xi), pad.top + plotH + 14);
  }

  // 라인
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  data.forEach(function (d, i) {
    var x = xPos(i), y = yPos(d.price);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 그라데이션 영역
  var grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  grad.addColorStop(0, "rgba(37,99,235,0.12)");
  grad.addColorStop(1, "rgba(37,99,235,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  data.forEach(function (d, i) {
    var x = xPos(i), y = yPos(d.price);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(xPos(data.length - 1), pad.top + plotH);
  ctx.lineTo(xPos(0), pad.top + plotH);
  ctx.closePath();
  ctx.fill();

  // 마지막 포인트
  var lastIdx = data.length - 1;
  var lastY = yPos(lastPrice);
  ctx.fillStyle = "#2563eb";
  ctx.beginPath();
  ctx.arc(xPos(lastIdx), lastY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(xPos(lastIdx), lastY, 5, 0, Math.PI * 2); ctx.stroke();

  // 현재가 라벨
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = "#2563eb";
  ctx.fillText(fmtPrice(lastPrice), xPos(lastIdx) - 8, lastY - 8);

  // 상단 배지: 직전거래 대비
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "right";
  var chgSign = chgPct >= 0 ? "+" : "";
  ctx.fillStyle = chgPct >= 0 ? "#16a34a" : "#ef4444";
  ctx.fillText("\uc9c1\uc804\uac70\ub798 \ub300\ube44 " + chgSign + chgPct.toFixed(1) + "%", pad.left + plotW, 14);
}

/* ── 백테스트 개별 종목 차트 (저평가 판정 시점 표시) ── */
function drawBacktestPickChart(canvas, txns, pick) {
  if (!txns || !txns.length) return;

  // 월별 평균 계산
  var monthlyMap = {};
  txns.forEach(function (t) {
    var d = new Date(t[0]);
    var ym = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0");
    if (!monthlyMap[ym]) monthlyMap[ym] = { sum: 0, count: 0 };
    monthlyMap[ym].sum += t[1];
    monthlyMap[ym].count += 1;
  });

  var months = Object.keys(monthlyMap).sort();
  if (months.length < 2) { drawScatter(canvas, txns); return; }

  var data = months.map(function (ym) {
    var m = monthlyMap[ym];
    return { ym: ym, price: m.sum / m.count };
  });

  // 판정 시점 인덱스 찾기
  var flagIdx = -1;
  for (var fi = 0; fi < data.length; fi++) {
    if (data[fi].ym >= pick.flag_ym) { flagIdx = fi; break; }
  }

  // 캔버스 설정
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

  var prices = data.map(function (d) { return d.price; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.1;

  function xPos(i) { return pad.left + (i / (data.length - 1)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  function fmtPrice(v) {
    if (v >= 10000) return (v / 10000).toFixed(1) + "\uc5b5";
    return Math.round(v).toLocaleString() + "\ub9cc";
  }

  // 그리드
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 3; g++) {
    var gy = pad.top + (plotH / 3) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }

  // Y축
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (var g = 0; g <= 3; g++) {
    var val = minP + ((maxP - minP) / 3) * (3 - g);
    ctx.fillText(fmtPrice(val), pad.left - 4, pad.top + (plotH / 3) * g);
  }

  // X축
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  var seenYear = {};
  data.forEach(function (d, i) {
    var yr = d.ym.slice(0, 4);
    if (d.ym.slice(4) === "01" && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  });

  // 판정 시점 수직선
  if (flagIdx >= 0) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xPos(flagIdx), pad.top);
    ctx.lineTo(xPos(flagIdx), pad.top + plotH);
    ctx.stroke();
    ctx.restore();

    // 판정 이후 영역 하이라이트
    ctx.fillStyle = "rgba(22, 163, 106, 0.04)";
    ctx.fillRect(xPos(flagIdx), pad.top, xPos(data.length - 1) - xPos(flagIdx), plotH);
  }

  // 판정 전 라인 (회색)
  if (flagIdx > 0) {
    ctx.beginPath();
    ctx.moveTo(xPos(0), yPos(data[0].price));
    for (var bi = 1; bi <= flagIdx && bi < data.length; bi++) {
      ctx.lineTo(xPos(bi), yPos(data[bi].price));
    }
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 판정 후 라인 (초록)
  var startIdx = Math.max(flagIdx, 0);
  if (startIdx < data.length - 1) {
    ctx.beginPath();
    ctx.moveTo(xPos(startIdx), yPos(data[startIdx].price));
    for (var ai = startIdx + 1; ai < data.length; ai++) {
      ctx.lineTo(xPos(ai), yPos(data[ai].price));
    }
    ctx.strokeStyle = pick.return_pct >= 0 ? "#16a34a" : "#ef4444";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 판정 시점 포인트
  if (flagIdx >= 0) {
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.arc(xPos(flagIdx), yPos(data[flagIdx].price), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("\uc800\ud3c9\uac00 \ud310\uc815", xPos(flagIdx), pad.top - 1);
  }

  // 현재 포인트
  var lastIdx = data.length - 1;
  ctx.fillStyle = pick.return_pct >= 0 ? "#16a34a" : "#ef4444";
  ctx.beginPath();
  ctx.arc(xPos(lastIdx), yPos(data[lastIdx].price), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(fmtPrice(data[lastIdx].price), xPos(lastIdx) - 8, yPos(data[lastIdx].price) - 8);
}

/* ── 백테스트 비교단지 포함 차트 ── */
function drawBacktestCompareChart(canvas, mainTxns, compareTxnList, pick) {
  if (!mainTxns || !mainTxns.length) return;

  // 월별 평균 계산 헬퍼
  function toMonthly(txns) {
    var map = {};
    txns.forEach(function (t) {
      var d = new Date(t[0]);
      var ym = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0");
      if (!map[ym]) map[ym] = { sum: 0, count: 0 };
      map[ym].sum += t[1];
      map[ym].count += 1;
    });
    var months = Object.keys(map).sort();
    return months.map(function (ym) { return { ym: ym, price: map[ym].sum / map[ym].count }; });
  }

  var mainData = toMonthly(mainTxns);
  if (mainData.length < 2) { drawBacktestPickChart(canvas, mainTxns, pick); return; }

  var compareDatas = compareTxnList.map(function (c) {
    return { name: c.name, data: toMonthly(c.txns) };
  });

  // 전체 YM 범위 결정
  var allYms = {};
  mainData.forEach(function (d) { allYms[d.ym] = true; });
  compareDatas.forEach(function (c) { c.data.forEach(function (d) { allYms[d.ym] = true; }); });
  var sortedYms = Object.keys(allYms).sort();

  // 판정 시점 인덱스
  var flagIdx = -1;
  for (var fi = 0; fi < sortedYms.length; fi++) {
    if (sortedYms[fi] >= pick.flag_ym) { flagIdx = fi; break; }
  }

  // 가격 범위 (모든 시리즈 고려)
  var allPrices = mainData.map(function (d) { return d.price; });
  compareDatas.forEach(function (c) {
    c.data.forEach(function (d) { allPrices.push(d.price); });
  });
  var minP = Math.min.apply(null, allPrices);
  var maxP = Math.max.apply(null, allPrices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.1;

  // 캔버스 설정
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

  function xPos(ymIdx) { return pad.left + (ymIdx / (sortedYms.length - 1)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }
  function fmtPrice(v) {
    if (v >= 10000) return (v / 10000).toFixed(1) + "\uc5b5";
    return Math.round(v).toLocaleString() + "\ub9cc";
  }

  // 그리드
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 3; g++) {
    var gy = pad.top + (plotH / 3) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }

  // Y축 라벨
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (var g = 0; g <= 3; g++) {
    var val = minP + ((maxP - minP) / 3) * (3 - g);
    ctx.fillText(fmtPrice(val), pad.left - 4, pad.top + (plotH / 3) * g);
  }

  // X축 라벨
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  var seenYear = {};
  sortedYms.forEach(function (ym, i) {
    var yr = ym.slice(0, 4);
    if (ym.slice(4) === "01" && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  });

  // 판정 시점 수직선
  if (flagIdx >= 0) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xPos(flagIdx), pad.top);
    ctx.lineTo(xPos(flagIdx), pad.top + plotH);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(22, 163, 106, 0.04)";
    ctx.fillRect(xPos(flagIdx), pad.top, xPos(sortedYms.length - 1) - xPos(flagIdx), plotH);
  }

  // YM→인덱스 맵
  var ymIdx = {};
  sortedYms.forEach(function (ym, i) { ymIdx[ym] = i; });

  // 비교단지 라인 (먼저 그려서 뒤에 깔림)
  var compColors = ["#94a3b8", "#f59e0b"];
  compareDatas.forEach(function (comp, ci) {
    if (comp.data.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = compColors[ci % compColors.length];
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.5;
    var first = true;
    comp.data.forEach(function (d) {
      var xi = ymIdx[d.ym];
      if (xi === undefined) return;
      if (first) { ctx.moveTo(xPos(xi), yPos(d.price)); first = false; }
      else { ctx.lineTo(xPos(xi), yPos(d.price)); }
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  // 메인 단지 라인 (판정 전 = 회색, 판정 후 = 파란색)
  var mainYmMap = {};
  mainData.forEach(function (d) { mainYmMap[d.ym] = d.price; });

  // 판정 전 구간
  if (flagIdx > 0) {
    ctx.beginPath();
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.5;
    var first = true;
    for (var i = 0; i < sortedYms.length; i++) {
      var ym = sortedYms[i];
      if (mainYmMap[ym] === undefined) continue;
      if (first) { ctx.moveTo(xPos(i), yPos(mainYmMap[ym])); first = false; }
      else { ctx.lineTo(xPos(i), yPos(mainYmMap[ym])); }
      if (i >= flagIdx) break;
    }
    ctx.stroke();
  }

  // 판정 후 구간
  var startIdx = Math.max(flagIdx, 0);
  ctx.beginPath();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  var first = true;
  for (var i = startIdx; i < sortedYms.length; i++) {
    var ym = sortedYms[i];
    if (mainYmMap[ym] === undefined) continue;
    if (first) { ctx.moveTo(xPos(i), yPos(mainYmMap[ym])); first = false; }
    else { ctx.lineTo(xPos(i), yPos(mainYmMap[ym])); }
  }
  ctx.stroke();

  // 판정 시점 포인트
  if (flagIdx >= 0) {
    var flagYm = sortedYms[flagIdx];
    if (mainYmMap[flagYm] !== undefined) {
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(xPos(flagIdx), yPos(mainYmMap[flagYm]), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("\uc800\ud3c9\uac00 \ud310\uc815", xPos(flagIdx), pad.top - 1);
    }
  }

  // 현재(마지막) 포인트
  var lastMain = mainData[mainData.length - 1];
  var lastMainIdx = ymIdx[lastMain.ym];
  if (lastMainIdx !== undefined) {
    ctx.fillStyle = "#2563eb";
    ctx.beginPath();
    ctx.arc(xPos(lastMainIdx), yPos(lastMain.price), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(fmtPrice(lastMain.price), xPos(lastMainIdx) - 8, yPos(lastMain.price) - 8);
  }
}

/**
 * 6축 레이더 차트 (교통/학군/인프라/환금성/실거주/재건축)
 * @param {HTMLCanvasElement} canvas
 * @param {Object} scores - 각 0~100
 */
function drawRadarChart(canvas, scores) {
  var labels = ["교통", "학군", "인프라", "환금성", "실거주", "재건축"];
  var keys = ["transport", "school", "infra", "liquidity", "livability", "rebuild"];
  var values = keys.map(function (k) { return scores[k] || 0; });

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
  var cx = cw / 2;
  var cy = ch / 2;
  var maxR = Math.min(cw, ch) / 2 - 24;
  var n = 6;
  var angleStep = (Math.PI * 2) / n;
  var startAngle = -Math.PI / 2; // top

  function angleFor(i) { return startAngle + angleStep * i; }
  function pointAt(i, r) {
    var a = angleFor(i);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }

  // Background grid rings (20, 40, 60, 80, 100)
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.7;
  for (var ring = 1; ring <= 5; ring++) {
    var r = (maxR / 5) * ring;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var p = pointAt(i, r);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Axis lines
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 0.7;
  for (var i = 0; i < n; i++) {
    var p = pointAt(i, maxR);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  // Data polygon
  ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (var i = 0; i < n; i++) {
    var r = (values[i] / 100) * maxR;
    var p = pointAt(i, r);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Data points
  ctx.fillStyle = "#2563eb";
  for (var i = 0; i < n; i++) {
    var r = (values[i] / 100) * maxR;
    var p = pointAt(i, r);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Labels
  ctx.fillStyle = "#334155";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (var i = 0; i < n; i++) {
    var lp = pointAt(i, maxR + 16);
    ctx.fillText(labels[i], lp.x, lp.y);
  }
}

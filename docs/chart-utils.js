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

  var colors = ["#2563eb", "#94a3b8", "#ef4444"];
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
  var maxR = 80;

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
    var yr = ym.slice(0, 4);
    if (ym.slice(4) === "01" && !seenYear[yr]) {
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
    var ym = trendData[i][0], yr = ym.slice(0, 4);
    if (ym.slice(4) === "01" && !seenYear[yr]) {
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

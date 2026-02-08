const summaryPath = "data/apt_trade/summary.json";

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const tabsEl = document.getElementById("tabs");

let globalData = null;
let activeSido = null;

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

function renderTabs(sidoOrder) {
  tabsEl.innerHTML = "";
  sidoOrder.forEach(function (sido) {
    var btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      renderTabs(sidoOrder);
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

  // X-axis labels (years)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  var startYear = new Date(minT).getFullYear();
  var endYear = new Date(maxT).getFullYear();
  for (var yr = startYear; yr <= endYear; yr++) {
    var xt = new Date(yr, 6, 1).getTime();
    if (xt < minT || xt > maxT) continue;
    ctx.fillText(yr.toString(), xPos(xt), pad.top + plotH + 6);
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

function renderRankedItem(r, idx) {
  var card = document.createElement("div");
  card.className = "rank-card";

  // Rank number
  var num = document.createElement("span");
  num.className = "rank-num n" + (idx + 1);
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
  var detailText = r.sigungu + " " + r.dong_name + " \u00B7 " + r.area_m2 + "m\u00B2 \u00B7 " + r.latest_date;
  if (r.total_trades) {
    detailText += " \u00B7 " + r.total_trades + "\uAC74";
  }
  detail.textContent = detailText;
  info.appendChild(detail);
  top.appendChild(info);

  var changeEl = document.createElement("div");
  changeEl.className = "rank-change";
  var pctEl = document.createElement("div");
  pctEl.className = "rank-pct";
  pctEl.textContent = "+" + r.pct.toFixed(1) + "%";
  changeEl.appendChild(pctEl);
  var diffEl = document.createElement("div");
  diffEl.className = "rank-diff";
  diffEl.textContent = fmt(r.prev_price) + " \u2192 " + fmt(r.latest_price) + "\uB9CC";
  changeEl.appendChild(diffEl);
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

function renderSections() {
  gridEl.innerHTML = "";
  if (!globalData || !activeSido) return;

  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;

  if (sidoData.section1) {
    gridEl.appendChild(renderSection(sidoData.section1));
  }
  if (sidoData.section2) {
    gridEl.appendChild(renderSection(sidoData.section2));
  }
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
  renderSections();

  statusEl.textContent = "";
  metaEl.textContent = "\uC5C5\uB370\uC774\uD2B8: " + globalData.updated_at +
    " \u00B7 \uCD1D \uAC70\uB798 " + fmt(globalData.total_txns) + "\uAC74" +
    " \u00B7 " + globalData.months_kept + "\uAC1C\uC6D4";
}

init();

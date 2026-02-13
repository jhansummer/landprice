var summaryPath = "data/apt_trade/summary.json";
var statusEl = document.getElementById("status");
var resultsEl = document.getElementById("results");
var searchInput = document.getElementById("searchInput");

var allItems = [];

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
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

  ctx.fillStyle = "#1a6f5a";
  for (var i = 0; i < points.length; i++) {
    var px = xPos(points[i].t);
    var py = yPos(points[i].price);
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

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
    ctx.fillStyle = idx === points.length - 1 ? "#d63a3a" : "#6e6a63";
    ctx.fillText(label, lx, ly);
    drawn.push({ x: lx, y: ly });
  });

  var last = points[points.length - 1];
  ctx.fillStyle = "#d63a3a";
  ctx.beginPath();
  ctx.arc(xPos(last.t), yPos(last.price), 4, 0, Math.PI * 2);
  ctx.fill();
}

function renderRankedItem(r, idx) {
  var card = document.createElement("div");
  card.className = "rank-card";

  var num = document.createElement("span");
  num.className = "rank-num";
  num.textContent = idx + 1;
  card.appendChild(num);

  var content = document.createElement("div");

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
  top.appendChild(changeEl);

  content.appendChild(top);

  if (r.history && r.history.length > 1) {
    var chartDiv = document.createElement("div");
    chartDiv.className = "scatter-chart";
    var canvas = document.createElement("canvas");
    chartDiv.appendChild(canvas);
    content.appendChild(chartDiv);
    requestAnimationFrame(function () {
      drawScatter(canvas, r.history);
    });
  }

  card.appendChild(content);

  if (r.id) {
    card.style.cursor = "pointer";
    card.addEventListener("click", function () {
      showDetail(r);
    });
  }

  return card;
}

function showDetail(r) {
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

  var closeBtn = document.createElement("button");
  closeBtn.className = "modal-close";
  closeBtn.textContent = "\u2715";
  closeBtn.addEventListener("click", function () { overlay.remove(); });
  modal.appendChild(closeBtn);

  var title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = r.apt_name;
  modal.appendChild(title);

  var sub = document.createElement("p");
  sub.className = "modal-sub";
  sub.textContent = r.sigungu + " " + r.dong_name + " \u00B7 " + r.area_m2 + "m\u00B2";
  modal.appendChild(sub);

  var body = document.createElement("div");
  body.className = "modal-body";
  body.textContent = "\uB85C\uB529 \uC911...";
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  fetch("data/apt_trade/by_apt/" + r.id + ".json")
    .then(function (res) {
      if (!res.ok) throw new Error("not found");
      return res.json();
    })
    .then(function (history) {
      body.innerHTML = "";

      if (history.length > 1) {
        var chartDiv = document.createElement("div");
        chartDiv.className = "scatter-chart modal-chart";
        var canvas = document.createElement("canvas");
        chartDiv.appendChild(canvas);
        body.appendChild(chartDiv);
        requestAnimationFrame(function () { drawScatter(canvas, history); });
      }

      var table = document.createElement("table");
      table.className = "modal-table";
      var thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>\uB0A0\uC9DC</th><th>\uAC00\uACA9(\uB9CC)</th></tr>";
      table.appendChild(thead);
      var tbody = document.createElement("tbody");
      for (var i = history.length - 1; i >= 0; i--) {
        var tr = document.createElement("tr");
        var tdDate = document.createElement("td");
        tdDate.textContent = history[i][0];
        var tdPrice = document.createElement("td");
        tdPrice.textContent = fmt(history[i][1]);
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

function doSearch(query) {
  resultsEl.innerHTML = "";
  if (!query || query.trim().length < 2) {
    resultsEl.innerHTML = '<div class="result-count">2글자 이상 입력해주세요.</div>';
    return;
  }
  var q = query.trim().toLowerCase();
  var matched = allItems.filter(function (r) {
    return r.apt_name.toLowerCase().indexOf(q) >= 0;
  });

  var countDiv = document.createElement("div");
  countDiv.className = "result-count";
  countDiv.textContent = '"' + query.trim() + '" 검색결과 ' + matched.length + '건';
  resultsEl.appendChild(countDiv);

  if (!matched.length) return;

  var sec = document.createElement("div");
  sec.className = "section";
  matched.forEach(function (r, i) {
    sec.appendChild(renderRankedItem(r, i));
  });
  resultsEl.appendChild(sec);
}

searchInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    doSearch(searchInput.value);
  }
});

async function init() {
  var response = await fetch(summaryPath);
  if (!response.ok) {
    statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
    return;
  }
  var data = await response.json();
  statusEl.textContent = "";

  // Collect all section3 items from all sidos/districts, dedup by id
  var seen = {};
  var sidoOrder = data.sido_order || [];
  sidoOrder.forEach(function (sido) {
    var sidoData = data.sidos[sido];
    if (!sidoData) return;

    // sido-level section3
    if (sidoData.section3 && sidoData.section3.top3) {
      sidoData.section3.top3.forEach(function (item) {
        if (item.id && !seen[item.id]) {
          seen[item.id] = true;
          allItems.push(item);
        }
      });
    }

    // district-level section3
    if (sidoData.districts) {
      var distOrder = sidoData.district_order || Object.keys(sidoData.districts);
      distOrder.forEach(function (dist) {
        var distData = sidoData.districts[dist];
        if (distData && distData.section3 && distData.section3.top3) {
          distData.section3.top3.forEach(function (item) {
            if (item.id && !seen[item.id]) {
              seen[item.id] = true;
              allItems.push(item);
            }
          });
        }
      });
    }
  });
}

init();

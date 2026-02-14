var summaryPath = "data/apt_trade/search_index.json";
var statusEl = document.getElementById("status");
var resultsEl = document.getElementById("results");
var searchInput = document.getElementById("searchInput");
var searchBtn = document.getElementById("searchBtn");
var tabsEl = document.getElementById("tabs");
var subtabsEl = document.getElementById("subtabs");

var filtersEl = document.getElementById("filters");

var globalData = null;
var activeSido = null;
var activeDistrict = null;
var activeDong = null;
var activeDanji = null;

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

function groupByApt(items) {
  var groups = [];
  var map = {};
  items.forEach(function (r) {
    var key = r.apt_name + "\t" + r.sigungu + "\t" + r.dong_name;
    if (!map[key]) {
      map[key] = { apt_name: r.apt_name, sigungu: r.sigungu, dong_name: r.dong_name, items: [] };
      groups.push(map[key]);
    }
    map[key].items.push(r);
  });
  groups.forEach(function (g) {
    g.items.sort(function (a, b) { return a.area_m2 - b.area_m2; });
  });
  return groups;
}

function renderGroup(group) {
  var wrap = document.createElement("div");
  wrap.className = "apt-group";

  var header = document.createElement("div");
  header.className = "apt-group-header";
  var nameEl = document.createElement("span");
  nameEl.className = "apt-group-name";
  nameEl.textContent = group.apt_name;
  header.appendChild(nameEl);
  var locEl = document.createElement("span");
  locEl.className = "apt-group-loc";
  locEl.textContent = group.sigungu + " " + group.dong_name;
  header.appendChild(locEl);
  wrap.appendChild(header);

  group.items.forEach(function (r) {
    var row = document.createElement("div");
    row.className = "apt-sub-item";

    var info = document.createElement("div");
    info.className = "apt-sub-info";
    var areaEl = document.createElement("span");
    areaEl.className = "apt-sub-area";
    areaEl.textContent = r.area_m2 + "m\u00B2";
    info.appendChild(areaEl);
    var detailEl = document.createElement("div");
    detailEl.className = "apt-sub-detail";
    var detailText = r.latest_date;
    if (r.floor) detailText += " \u00B7 " + r.floor + "\uCE35";
    if (r.deal_type && r.deal_type !== "\uC911\uAC1C\uAC70\uB798") detailText += " \u00B7 " + r.deal_type;
    detailEl.textContent = detailText;
    info.appendChild(detailEl);
    row.appendChild(info);

    var changeEl = document.createElement("div");
    changeEl.className = "apt-sub-change";
    var pctEl = document.createElement("div");
    pctEl.className = "apt-sub-pct";
    if (r.pct >= 0) {
      pctEl.textContent = "+" + r.pct.toFixed(1) + "%";
      pctEl.style.color = "var(--up)";
    } else {
      pctEl.textContent = r.pct.toFixed(1) + "%";
      pctEl.style.color = "var(--down)";
    }
    changeEl.appendChild(pctEl);
    var diffEl = document.createElement("div");
    diffEl.className = "apt-sub-diff";
    diffEl.textContent = fmt(r.prev_price) + " \u2192 " + fmt(r.latest_price) + "\uB9CC";
    changeEl.appendChild(diffEl);
    row.appendChild(changeEl);

    if (r.id) {
      row.addEventListener("click", function () { showDetail(r); });
    }

    wrap.appendChild(row);
  });

  return wrap;
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

function renderTabs() {
  tabsEl.innerHTML = "";
  if (!globalData) return;
  globalData.sido_order.forEach(function (sido) {
    var btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      activeDistrict = null;
      activeDong = null;
      activeDanji = null;
      renderTabs();
      renderSubTabs();
      renderFilters();
      resultsEl.innerHTML = "";
    });
    tabsEl.appendChild(btn);
  });
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
    activeDanji = null;
    renderFilters();
    resultsEl.innerHTML = "";
  });

  subtabsEl.appendChild(select);
}

function renderFilters() {
  filtersEl.innerHTML = "";
  if (!globalData || !activeSido) return;

  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;
  var items = sidoData.items || [];
  if (activeDistrict) {
    items = items.filter(function (r) { return r.district === activeDistrict; });
  }

  // 동 목록 추출 (가나다순)
  var dongSet = {};
  items.forEach(function (r) { if (r.dong_name) dongSet[r.dong_name] = true; });
  var dongList = Object.keys(dongSet).sort();

  if (dongList.length === 0) return;

  // 동 드롭다운
  var dongSelect = document.createElement("select");
  dongSelect.className = "dong-select";
  var allDongOpt = document.createElement("option");
  allDongOpt.value = "";
  allDongOpt.textContent = "\uB3D9 \uC804\uCCB4";
  if (!activeDong) allDongOpt.selected = true;
  dongSelect.appendChild(allDongOpt);

  dongList.forEach(function (dong) {
    var opt = document.createElement("option");
    opt.value = dong;
    opt.textContent = dong;
    if (dong === activeDong) opt.selected = true;
    dongSelect.appendChild(opt);
  });

  dongSelect.addEventListener("change", function () {
    activeDong = dongSelect.value || null;
    activeDanji = null;
    renderFilters();
    resultsEl.innerHTML = "";
  });

  filtersEl.appendChild(dongSelect);

  // 단지 드롭다운 (동이 선택된 경우만)
  if (activeDong) {
    var dongItems = items.filter(function (r) { return r.dong_name === activeDong; });
    var danjiSet = {};
    dongItems.forEach(function (r) { if (r.apt_name) danjiSet[r.apt_name] = true; });
    var danjiList = Object.keys(danjiSet).sort();

    if (danjiList.length > 0) {
      var danjiSelect = document.createElement("select");
      danjiSelect.className = "danji-select";
      var allDanjiOpt = document.createElement("option");
      allDanjiOpt.value = "";
      allDanjiOpt.textContent = "\uB2E8\uC9C0 \uC804\uCCB4";
      if (!activeDanji) allDanjiOpt.selected = true;
      danjiSelect.appendChild(allDanjiOpt);

      danjiList.forEach(function (name) {
        var opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === activeDanji) opt.selected = true;
        danjiSelect.appendChild(opt);
      });

      danjiSelect.addEventListener("change", function () {
        activeDanji = danjiSelect.value || null;
        if (activeDanji) {
          showDanjiResult();
        } else {
          resultsEl.innerHTML = "";
        }
      });

      filtersEl.appendChild(danjiSelect);
    }
  }
}

function showDanjiResult() {
  resultsEl.innerHTML = "";
  if (!globalData || !activeSido || !activeDistrict || !activeDong || !activeDanji) return;

  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;

  var matched = sidoData.items.filter(function (r) {
    return r.district === activeDistrict && r.dong_name === activeDong && r.apt_name === activeDanji;
  });

  if (!matched.length) {
    resultsEl.innerHTML = '<div class="result-count">\uAC80\uC0C9\uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
    return;
  }

  var groups = groupByApt(matched);
  var countDiv = document.createElement("div");
  countDiv.className = "result-count";
  countDiv.textContent = activeDanji + " " + matched.length + "\uAC74";
  resultsEl.appendChild(countDiv);

  var sec = document.createElement("div");
  sec.className = "section";
  groups.forEach(function (g) {
    sec.appendChild(renderGroup(g));
  });
  resultsEl.appendChild(sec);
}

function getFilteredItems() {
  if (!globalData || !activeSido) return [];
  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return [];
  var items = sidoData.items || [];
  if (activeDistrict) {
    items = items.filter(function (r) { return r.district === activeDistrict; });
  }
  if (activeDong) {
    items = items.filter(function (r) { return r.dong_name === activeDong; });
  }
  return items;
}

function doSearch(query) {
  resultsEl.innerHTML = "";
  var q = (query || "").trim().toLowerCase();
  var items = getFilteredItems();

  // 검색어 없이 지역도 구/동 선택 안 했으면 안내 표시
  if (q.length < 2 && !activeDistrict && !activeDong) {
    resultsEl.innerHTML = '<div class="result-count">2\uAE00\uC790 \uC774\uC0C1 \uC785\uB825\uD558\uAC70\uB098 \uC9C0\uC5ED\uC744 \uC120\uD0DD\uD574\uC8FC\uC138\uC694.</div>';
    return;
  }

  var matched;
  if (q.length >= 2) {
    matched = items.filter(function (r) {
      return r.apt_name.toLowerCase().indexOf(q) >= 0;
    });
  } else {
    matched = items;
  }

  var groups = groupByApt(matched);

  var countDiv = document.createElement("div");
  countDiv.className = "result-count";
  if (q.length >= 2) {
    countDiv.textContent = '"' + query.trim() + '" \uAC80\uC0C9\uACB0\uACFC ' + groups.length + '\uAC1C \uB2E8\uC9C0 (' + matched.length + '\uAC74)';
  } else {
    var label = activeSido || "";
    if (activeDistrict) label += " " + activeDistrict;
    if (activeDong) label += " " + activeDong;
    countDiv.textContent = label + ' \uC804\uCCB4 ' + groups.length + '\uAC1C \uB2E8\uC9C0 (' + matched.length + '\uAC74)';
  }
  resultsEl.appendChild(countDiv);

  if (!groups.length) return;

  var sec = document.createElement("div");
  sec.className = "section";
  groups.forEach(function (g) {
    sec.appendChild(renderGroup(g));
  });
  resultsEl.appendChild(sec);
}

searchInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    doSearch(searchInput.value);
  }
});

searchBtn.addEventListener("click", function () {
  doSearch(searchInput.value);
});

async function init() {
  var response = await fetch(summaryPath);
  if (!response.ok) {
    statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
    return;
  }
  globalData = await response.json();
  statusEl.textContent = "";

  activeSido = globalData.sido_order[0] || null;
  renderTabs();
  renderSubTabs();
  renderFilters();
}

init();

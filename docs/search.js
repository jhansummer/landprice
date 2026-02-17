var summaryPath = "data/apt_trade/search_index.json";
var statusEl = document.getElementById("status");
var resultsEl = document.getElementById("results");
var searchInput = document.getElementById("searchInput");
var searchBtn = document.getElementById("searchBtn");
var tabsEl = document.getElementById("tabs");
var subtabsEl = document.getElementById("subtabs");

var filtersEl = document.getElementById("filters");

var globalData = null;
var sidoCache = {};
var activeSido = null;
var activeDistrict = null;
var activeDong = null;
var activeDanji = null;
var activeArea = null;
var AREA_RANGES = [
  { label: "\uC804\uCCB4", min: 0, max: Infinity },
  { label: "~60m\u00B2 (20\uD3C9\uB300)", min: 0, max: 66 },
  { label: "~85m\u00B2 (30\uD3C9\uB300)", min: 66, max: 99 },
  { label: "~115m\u00B2 (40\uD3C9\uB300)", min: 99, max: 126 },
  { label: "135m\u00B2+ (50\uD3C9\uB300+)", min: 126, max: Infinity }
];

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

async function loadSido(sido) {
  if (sidoCache[sido]) return sidoCache[sido];
  var res = await fetch("data/apt_trade/search/" + encodeURIComponent(sido) + ".json?t=" + Date.now());
  if (!res.ok) return null;
  var data = await res.json();
  sidoCache[sido] = data;
  return data;
}

function getSidoData() {
  if (!activeSido) return null;
  return sidoCache[activeSido] || null;
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
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", r.apt_name + " 거래 이력");
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.remove();
  });

  var modal = document.createElement("div");
  modal.className = "modal-content";

  var closeBtn = document.createElement("button");
  closeBtn.className = "modal-close";
  closeBtn.setAttribute("aria-label", "닫기");
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
  tabsEl.setAttribute("role", "tablist");
  var label = document.createElement("span");
  label.className = "region-label";
  label.textContent = "지역";
  tabsEl.appendChild(label);
  globalData.sido_order.forEach(function (sido) {
    var btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", sido === activeSido ? "true" : "false");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      activeDistrict = null;
      activeDong = null;
      activeDanji = null;
      activeArea = null;
      renderTabs();
      loadSido(sido).then(function () {
        renderSubTabs();
        renderFilters();
        resultsEl.innerHTML = "";
      });
    });
    tabsEl.appendChild(btn);
  });
}

function renderSubTabs() {
  subtabsEl.innerHTML = "";
  if (!globalData || !activeSido) return;
  var sidoData = getSidoData();
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

  var sidoData = getSidoData();
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

  // 면적 드롭다운
  var areaSelect = document.createElement("select");
  areaSelect.className = "dong-select";
  AREA_RANGES.forEach(function (range, idx) {
    var opt = document.createElement("option");
    opt.value = idx === 0 ? "" : String(idx);
    opt.textContent = "\uBA74\uC801: " + range.label;
    if ((activeArea === null && idx === 0) || activeArea === idx) opt.selected = true;
    areaSelect.appendChild(opt);
  });
  areaSelect.addEventListener("change", function () {
    activeArea = areaSelect.value ? parseInt(areaSelect.value) : null;
    var q = searchInput.value.trim();
    if (q.length >= 2 || activeDistrict || activeDong) {
      doSearch(q);
    }
  });
  filtersEl.appendChild(areaSelect);
}

function showDanjiResult() {
  resultsEl.innerHTML = "";
  if (!globalData || !activeSido || !activeDistrict || !activeDong || !activeDanji) return;

  var sidoData = getSidoData();
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
  var sidoData = getSidoData();
  if (!sidoData) return [];
  var items = sidoData.items || [];
  if (activeDistrict) {
    items = items.filter(function (r) { return r.district === activeDistrict; });
  }
  if (activeDong) {
    items = items.filter(function (r) { return r.dong_name === activeDong; });
  }
  if (activeArea) {
    var range = AREA_RANGES[activeArea];
    items = items.filter(function (r) { return r.area_m2 >= range.min && r.area_m2 < range.max; });
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
  try {
    var response = await fetch(summaryPath + "?t=" + Date.now());
    if (!response.ok) {
      statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
      return;
    }
    globalData = await response.json();

    activeSido = globalData.sido_order[0] || null;
    renderTabs();

    // 첫 시도 데이터 로드
    if (activeSido) {
      await loadSido(activeSido);
    }
    renderSubTabs();
    renderFilters();
    statusEl.innerHTML = "";
  } catch (e) {
    statusEl.textContent = "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
  }
}

init();

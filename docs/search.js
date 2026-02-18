var summaryPath = "data/apt_trade/search_index.json";
var statusEl = document.getElementById("status");
var resultsEl = document.getElementById("results");
var searchInput = document.getElementById("searchInput");
var searchBtn = document.getElementById("searchBtn");
var tabsEl = document.getElementById("tabs");
var subtabsEl = document.getElementById("subtabs");

var filtersEl = document.getElementById("filters");

// compareList now uses APTWatchlist module

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

/* ── 자동완성 ── */
var acDropdown = null;
var acTimeout = null;

function createAutocomplete() {
  acDropdown = document.createElement("div");
  acDropdown.className = "autocomplete-dropdown";
  acDropdown.style.display = "none";
  var wrap = searchInput.closest(".search-wrap");
  if (wrap) wrap.appendChild(acDropdown);
}

function showAutocomplete(query) {
  if (!acDropdown || query.length < 2) {
    if (acDropdown) acDropdown.style.display = "none";
    return;
  }

  var items = getFilteredItems();
  var q = query.toLowerCase();
  var seen = {};
  var results = [];
  for (var i = 0; i < items.length && results.length < 10; i++) {
    var r = items[i];
    if (r.apt_name.toLowerCase().indexOf(q) < 0) continue;
    var key = r.apt_name + "\t" + (r.district || r.sigungu) + "\t" + r.dong_name;
    if (seen[key]) continue;
    seen[key] = true;
    results.push({ apt_name: r.apt_name, district: r.district || r.sigungu, dong_name: r.dong_name });
  }

  if (!results.length) {
    acDropdown.style.display = "none";
    return;
  }

  acDropdown.innerHTML = "";
  results.forEach(function(r) {
    var item = document.createElement("div");
    item.className = "ac-item";
    item.innerHTML = '<span class="ac-name">' + escapeHTML(r.apt_name) + '</span>'
      + '<span class="ac-loc">' + escapeHTML(r.district + " " + r.dong_name) + '</span>';
    item.addEventListener("mousedown", function(e) {
      e.preventDefault();
      searchInput.value = r.apt_name;
      acDropdown.style.display = "none";
      doSearch(r.apt_name);
      updateURL();
    });
    acDropdown.appendChild(item);
  });
  acDropdown.style.display = "block";
}

function escapeHTML(s) {
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ── URL 상태 유지 ── */
function updateURL() {
  var parts = [];
  if (activeSido) parts.push(activeSido);
  if (activeDistrict) parts.push(activeDistrict);
  var hash = parts.join("/");
  var q = searchInput.value.trim();
  if (q) hash += "?q=" + encodeURIComponent(q);
  if (hash) history.replaceState(null, "", "#" + hash);
}

function parseURL() {
  var hash = decodeURIComponent(location.hash.replace("#", ""));
  if (!hash) return {};
  var qIdx = hash.indexOf("?q=");
  var path = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
  var query = qIdx >= 0 ? decodeURIComponent(hash.slice(qIdx + 3)) : "";
  var parts = path.split("/");
  return { sido: parts[0] || null, district: parts[1] || null, query: query };
}

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
  var txnTotal = group.items.reduce(function(s, r) { return s + (r.total_trades || 0); }, 0);
  locEl.textContent = group.sigungu + " " + group.dong_name;
  if (txnTotal > 0) {
    var txnBadge = document.createElement("span");
    txnBadge.className = "tag tag-muted";
    txnBadge.style.marginLeft = "6px";
    txnBadge.textContent = txnTotal + "\uAC74";
    locEl.appendChild(txnBadge);
  }
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
      pctEl.innerHTML = '<span style="color:var(--up);">\u25B2 +' + r.pct.toFixed(1) + '%</span>';
    } else {
      pctEl.innerHTML = '<span style="color:var(--down);">\u25BC ' + r.pct.toFixed(1) + '%</span>';
    }
    changeEl.appendChild(pctEl);
    var diffEl = document.createElement("div");
    diffEl.className = "apt-sub-diff";
    diffEl.textContent = fmt(r.prev_price) + " \u2192 " + fmt(r.latest_price) + "\uB9CC";
    changeEl.appendChild(diffEl);
    row.appendChild(changeEl);

    if (r.id) {
      row.style.cursor = "pointer";
      row.addEventListener("click", function () { showDetail(r); });

      var ctaWrap = document.createElement("div");
      ctaWrap.className = "cta-group";
      ctaWrap.style.marginTop = "4px";

      var cmpBtn = document.createElement("button");
      cmpBtn.className = "detail-btn";
      cmpBtn.textContent = APTWatchlist.hasCompare(r.id) ? "\uCD94\uAC00\uB428" : "\uBE44\uAD50";
      if (APTWatchlist.hasCompare(r.id)) { cmpBtn.style.borderColor = "var(--accent)"; cmpBtn.style.color = "var(--accent)"; }
      cmpBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        var added = APTWatchlist.addCompare({ id: r.id, apt_name: r.apt_name, area_m2: r.area_m2, sigungu: r.sigungu, dong_name: r.dong_name });
        if (added) { cmpBtn.textContent = "\uCD94\uAC00\uB428"; cmpBtn.style.borderColor = "var(--accent)"; cmpBtn.style.color = "var(--accent)"; }
        else if (!APTWatchlist.hasCompare(r.id)) { alert("\uBE44\uAD50\uB294 \uCD5C\uB300 5\uAC1C\uAE4C\uC9C0 \uAC00\uB2A5\uD569\uB2C8\uB2E4."); }
        APTWatchlist.track("add_to_compare", { apt_name: r.apt_name, page: "search" });
      });
      ctaWrap.appendChild(cmpBtn);

      var watchBtn = document.createElement("button");
      watchBtn.className = "detail-btn";
      var isW = APTWatchlist.has(r.id);
      watchBtn.textContent = isW ? "\uAD00\uC2EC\uD574\uC81C" : "\uAD00\uC2EC";
      if (isW) { watchBtn.style.background = "var(--accent-soft)"; watchBtn.style.color = "var(--accent)"; watchBtn.style.borderColor = "var(--accent)"; }
      watchBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        if (APTWatchlist.has(r.id)) {
          APTWatchlist.remove(r.id);
          watchBtn.textContent = "\uAD00\uC2EC"; watchBtn.style.background = ""; watchBtn.style.color = ""; watchBtn.style.borderColor = "";
        } else {
          APTWatchlist.add({ id: r.id, apt_name: r.apt_name, area_m2: r.area_m2, sigungu: r.sigungu || group.sigungu, dong_name: r.dong_name || group.dong_name, latest_price: r.latest_price, pct: r.pct });
          watchBtn.textContent = "\uAD00\uC2EC\uD574\uC81C"; watchBtn.style.background = "var(--accent-soft)"; watchBtn.style.color = "var(--accent)"; watchBtn.style.borderColor = "var(--accent)";
        }
        APTWatchlist.track("add_to_watchlist", { apt_name: r.apt_name, page: "search" });
      });
      ctaWrap.appendChild(watchBtn);

      changeEl.appendChild(ctaWrap);
    }

    wrap.appendChild(row);
  });

  return wrap;
}

function showDetail(r) {
  APTWatchlist.track("view_detail", { apt_name: r.apt_name, sigungu: r.sigungu, area_m2: r.area_m2, page: "search" });
  var old = document.getElementById("detail-modal");
  if (old) old.remove();

  var overlay = document.createElement("div");
  overlay.id = "detail-modal";
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", r.apt_name + " \uAC70\uB798 \uC774\uB825");
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.remove();
  });

  var modal = document.createElement("div");
  modal.className = "modal-content";

  var closeBtn = document.createElement("button");
  closeBtn.className = "modal-close";
  closeBtn.setAttribute("aria-label", "\uB2EB\uAE30");
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

/* ── A vs B 비교 (APTWatchlist 모듈 사용) ── */
/* renderCompareBar, addToCompare, showCompareModal은 watchlist.js에서 공통 처리 */

function renderTabs() {
  tabsEl.innerHTML = "";
  if (!globalData) return;
  tabsEl.setAttribute("role", "tablist");
  var label = document.createElement("span");
  label.className = "region-label";
  label.textContent = "\uC9C0\uC5ED";
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
        updateURL();
      });
      APTWatchlist.track("tab_switch", { sido: sido, page: "search" });
    });
    tabsEl.appendChild(btn);
  });
}

/* 시/구 하위 구 목록 추출 (경기 수원시 → 수원시권선구, 수원시영통구 등) */
function getSubDistricts(sidoData, district) {
  if (!sidoData || !sidoData.items || !district) return [];
  var subs = {};
  sidoData.items.forEach(function (r) {
    if (r.district === district && r.sigungu && r.sigungu !== district) {
      subs[r.sigungu] = true;
    }
  });
  return Object.keys(subs).sort();
}

var activeSubDistrict = null;

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
    activeSubDistrict = null;
    activeDong = null;
    activeDanji = null;
    renderSubTabs();
    renderFilters();
    resultsEl.innerHTML = "";
    updateURL();
  });

  subtabsEl.appendChild(select);

  /* 시 선택 시 하위 구 드롭박스 (경기 수원시→수원시권선구 등) */
  if (activeDistrict) {
    var subDists = getSubDistricts(sidoData, activeDistrict);
    if (subDists.length > 1) {
      var subSelect = document.createElement("select");
      subSelect.className = "district-select";
      var subAllOpt = document.createElement("option");
      subAllOpt.value = "";
      subAllOpt.textContent = activeDistrict + " \uC804\uCCB4";
      if (!activeSubDistrict) subAllOpt.selected = true;
      subSelect.appendChild(subAllOpt);

      subDists.forEach(function (sub) {
        var opt = document.createElement("option");
        opt.value = sub;
        /* 수원시권선구 → 권선구 로 표시 */
        opt.textContent = sub.replace(activeDistrict, "");
        if (sub === activeSubDistrict) opt.selected = true;
        subSelect.appendChild(opt);
      });

      subSelect.addEventListener("change", function () {
        activeSubDistrict = subSelect.value || null;
        activeDong = null;
        activeDanji = null;
        renderFilters();
        resultsEl.innerHTML = "";
      });

      subtabsEl.appendChild(subSelect);
    }
  }
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
  if (activeSubDistrict) {
    items = items.filter(function (r) { return r.sigungu === activeSubDistrict; });
  }

  var dongSet = {};
  items.forEach(function (r) { if (r.dong_name) dongSet[r.dong_name] = true; });
  var dongList = Object.keys(dongSet).sort();

  if (dongList.length === 0) return;

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
    updateURL();
  });

  filtersEl.appendChild(dongSelect);

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
  if (activeSubDistrict) {
    items = items.filter(function (r) { return r.sigungu === activeSubDistrict; });
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
  updateURL();
  APTWatchlist.track("search_execute", { query: q, sido: activeSido, result_count: groups.length });
}

searchInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    if (acDropdown) acDropdown.style.display = "none";
    doSearch(searchInput.value);
  }
});

searchInput.addEventListener("input", function () {
  clearTimeout(acTimeout);
  acTimeout = setTimeout(function () {
    showAutocomplete(searchInput.value.trim());
  }, 200);
});

searchInput.addEventListener("blur", function () {
  setTimeout(function () {
    if (acDropdown) acDropdown.style.display = "none";
  }, 150);
});

searchBtn.addEventListener("click", function () {
  if (acDropdown) acDropdown.style.display = "none";
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

    // URL 상태 복원
    var urlState = parseURL();
    if (urlState.sido && globalData.sido_order.indexOf(urlState.sido) >= 0) {
      activeSido = urlState.sido;
    } else {
      activeSido = globalData.sido_order[0] || null;
    }

    renderTabs();

    if (activeSido) {
      await loadSido(activeSido);
    }

    // URL에서 구 복원
    if (urlState.district) {
      var sidoData = getSidoData();
      if (sidoData && sidoData.district_order && sidoData.district_order.indexOf(urlState.district) >= 0) {
        activeDistrict = urlState.district;
      }
    }

    renderSubTabs();
    renderFilters();
    createAutocomplete();

    // URL에서 검색어 복원
    if (urlState.query) {
      searchInput.value = urlState.query;
      doSearch(urlState.query);
    }

    statusEl.innerHTML = "";
  } catch (e) {
    statusEl.textContent = "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
  }
}

init();

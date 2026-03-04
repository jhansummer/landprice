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
  var _tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!acDropdown || !_tokens.length || _tokens[0].length < 2) {
    if (acDropdown) acDropdown.style.display = "none";
    return;
  }

  var q = query.toLowerCase();
  var seen = {};
  var results = [];

  /* 캐시된 전체 시도에서 검색 (추가 fetch 없음) */
  var sidoKeys = Object.keys(sidoCache);
  for (var si = 0; si < sidoKeys.length && results.length < 10; si++) {
    var sido = sidoKeys[si];
    var data = sidoCache[sido];
    if (!data || !data.items) continue;
    var items = data.items;
    for (var i = 0; i < items.length && results.length < 10; i++) {
      var r = items[i];
      if (!matchQuery(r.apt_name, q)) continue;
      var key = r.apt_name + "\t" + (r.district || r.sigungu) + "\t" + r.dong_name;
      if (seen[key]) continue;
      seen[key] = true;
      results.push({ apt_name: r.apt_name, district: r.district || r.sigungu, dong_name: r.dong_name, sido: sido });
    }
  }

  if (!results.length) {
    acDropdown.style.display = "none";
    return;
  }

  acDropdown.innerHTML = "";
  results.forEach(function(r) {
    var item = document.createElement("div");
    item.className = "ac-item";
    var locText = r.district + " " + r.dong_name;
    if (r.sido !== activeSido) locText = r.sido + " " + locText;
    item.innerHTML = '<span class="ac-name">' + escapeHTML(r.apt_name) + '</span>'
      + '<span class="ac-loc">' + escapeHTML(locText) + '</span>';
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

var escapeHTML = APTCommon.escapeHTML;

/* ── 검색 매칭: 띄어쓰기로 나눈 토큰 모두 포함 여부 ── */
function matchQuery(name, q) {
  if (!q) return true;
  var tokens = q.split(/\s+/).filter(Boolean);
  var lname = name.toLowerCase();
  return tokens.every(function(t) { return lname.indexOf(t) >= 0; });
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

var fmt = APTCommon.fmt;

async function loadSido(sido) {
  if (sidoCache[sido]) return sidoCache[sido];
  var res = await fetch("data/apt_trade/search/" + encodeURIComponent(sido) + ".json?t=" + Date.now());
  if (!res.ok) return null;
  var data = await res.json();
  sidoCache[sido] = data;
  return data;
}

async function loadAllSidos() {
  if (!globalData || !globalData.sido_order) return;
  var promises = globalData.sido_order.map(function (sido) {
    return loadSido(sido);
  });
  await Promise.all(promises);
}

function getSidoData() {
  if (!activeSido) return null;
  return sidoCache[activeSido] || null;
}

function groupByApt(items) {
  var groups = [];
  var map = {};
  items.forEach(function (r) {
    var sido = r._sido || activeSido || "";
    var key = sido + "\t" + r.apt_name + "\t" + r.sigungu + "\t" + r.dong_name;
    if (!map[key]) {
      map[key] = { apt_name: r.apt_name, sigungu: r.sigungu, dong_name: r.dong_name, sido: sido, items: [] };
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
  var locPrefix = (group.sido && group.sido !== activeSido) ? group.sido + " " : "";
  locEl.textContent = locPrefix + group.sigungu + " " + group.dong_name;
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
    if (r.pct == null) {
      pctEl.innerHTML = '<span style="color:var(--muted);">-</span>';
    } else if (r.pct >= 0) {
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
          APTWatchlist.add({ id: r.id, apt_name: r.apt_name, area_m2: r.area_m2, sigungu: r.sigungu || group.sigungu, dong_name: r.dong_name || group.dong_name, latest_price: r.latest_price, pct: r.pct, sido: r._sido || activeSido });
          watchBtn.textContent = "\uAD00\uC2EC\uD574\uC81C"; watchBtn.style.background = "var(--accent-soft)"; watchBtn.style.color = "var(--accent)"; watchBtn.style.borderColor = "var(--accent)";
        }
        APTWatchlist.track("add_to_watchlist", { apt_name: r.apt_name, page: "search" });
      });
      ctaWrap.appendChild(watchBtn);

      var aptLink = document.createElement("a");
      aptLink.className = "apt-detail-link";
      aptLink.href = "apt.html?id=" + encodeURIComponent(r.id) + "&s=" + encodeURIComponent(r._sido || activeSido);
      aptLink.textContent = "상세";
      aptLink.addEventListener("click", function(e) { e.stopPropagation(); });
      ctaWrap.appendChild(aptLink);

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
  if (!globalData) { tabsEl.innerHTML = ""; return; }
  APTCommon.renderTabs(tabsEl, globalData.sido_order, activeSido, function (sido) {
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
      if (typeof refreshMapMarkers === "function") refreshMapMarkers();
    });
    APTWatchlist.track("tab_switch", { sido: sido, page: "search" });
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
    var _qt = q.split(/\s+/).filter(Boolean);
    if ((_qt.length > 0 && _qt[0].length >= 2) || activeDistrict || activeDong) {
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

function renderInsightCard() {
  if (!activeSido) return null;
  var label = activeSido;
  if (activeDistrict) label += " " + activeDistrict;
  var hash = encodeURIComponent(activeSido);
  var card = document.createElement("div");
  card.className = "insight-card";
  var title = document.createElement("span");
  title.className = "insight-card-title";
  title.textContent = "\uD83D\uDCCA APT Mine \uBD84\uC11D";
  card.appendChild(title);
  var links = document.createElement("div");
  links.className = "insight-card-links";
  var items = [
    { icon: "\uD83D\uDCA1", text: "\uC800\uD3C9\uAC00 TOP3", href: "undervalued.html#" + hash },
    { icon: "\uD83D\uDCC9", text: "\uBC14\uB2E5\uCC3E\uAE30", href: "bottom.html#" + hash },
    { icon: "\uD83C\uDFC6", text: "\uC785\uC9C0 \uB7AD\uD0B9", href: "valuation.html" }
  ];
  items.forEach(function (it) {
    var a = document.createElement("a");
    a.className = "insight-card-link";
    a.href = it.href;
    a.textContent = it.icon + " " + it.text;
    links.appendChild(a);
  });
  card.appendChild(links);
  return card;
}

async function doSearch(query) {
  resultsEl.innerHTML = "";
  var q = (query || "").trim().toLowerCase();

  var qTokens = q.split(/\s+/).filter(Boolean);
  var hasValidQuery = qTokens.length > 0 && qTokens[0].length >= 2;

  if (!hasValidQuery && !activeDistrict && !activeDong) {
    resultsEl.innerHTML = '<div class="result-count">2\uAE00\uC790 \uC774\uC0C1 \uC785\uB825\uD558\uAC70\uB098 \uC9C0\uC5ED\uC744 \uC120\uD0DD\uD574\uC8FC\uC138\uC694.</div>';
    return;
  }

  var matched;
  if (hasValidQuery) {
    /* 텍스트 검색: 전체 시도 크로스 검색 */
    resultsEl.innerHTML = '<div class="result-count">\uAC80\uC0C9 \uC911...</div>';
    await loadAllSidos();
    matched = [];
    var sidoKeys = Object.keys(sidoCache);
    for (var si = 0; si < sidoKeys.length; si++) {
      var sido = sidoKeys[si];
      var data = sidoCache[sido];
      if (!data || !data.items) continue;
      var srcItems = data.items;
      /* 현재 활성 시도에서는 구/동/면적 필터 적용 */
      if (sido === activeSido) {
        if (activeDistrict) srcItems = srcItems.filter(function (r) { return r.district === activeDistrict; });
        if (activeSubDistrict) srcItems = srcItems.filter(function (r) { return r.sigungu === activeSubDistrict; });
        if (activeDong) srcItems = srcItems.filter(function (r) { return r.dong_name === activeDong; });
      }
      if (activeArea) {
        var range = AREA_RANGES[activeArea];
        srcItems = srcItems.filter(function (r) { return r.area_m2 >= range.min && r.area_m2 < range.max; });
      }
      for (var j = 0; j < srcItems.length; j++) {
        if (matchQuery(srcItems[j].apt_name, q)) {
          var item = srcItems[j];
          if (!item._sido) item._sido = sido;
          matched.push(item);
        }
      }
    }
    resultsEl.innerHTML = "";
  } else {
    /* 필터만 사용(텍스트 없음): 기존 동작 — 현재 시도만 */
    matched = getFilteredItems();
  }

  var groups = groupByApt(matched);

  var countDiv = document.createElement("div");
  countDiv.className = "result-count";
  if (hasValidQuery) {
    countDiv.textContent = '"' + query.trim() + '" \uAC80\uC0C9\uACB0\uACFC ' + groups.length + '\uAC1C \uB2E8\uC9C0 (' + matched.length + '\uAC74)';
  } else {
    var label = activeSido || "";
    if (activeDistrict) label += " " + activeDistrict;
    if (activeDong) label += " " + activeDong;
    countDiv.textContent = label + ' \uC804\uCCB4 ' + groups.length + '\uAC1C \uB2E8\uC9C0 (' + matched.length + '\uAC74)';
  }
  resultsEl.appendChild(countDiv);

  var insightEl = renderInsightCard();
  if (insightEl) resultsEl.appendChild(insightEl);

  if (!groups.length) {
    if (typeof gtag === "function") {
      gtag("event", "empty_result", { query: q, page: "search" });
    }
    return;
  }

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

/* ── 지도 뷰 ── */
var mapObj = null;
var mapClusterer = null;
var mapMarkers = [];
var coordsData = null;
var coordsLoading = false;
var activeOverlay = null;
var viewListBtn = document.getElementById("viewListBtn");
var viewMapBtn = document.getElementById("viewMapBtn");
var mapContainer = document.getElementById("mapContainer");

function loadCoords() {
  if (coordsData) return Promise.resolve(coordsData);
  if (coordsLoading) {
    return new Promise(function (resolve) {
      var iv = setInterval(function () {
        if (coordsData) { clearInterval(iv); resolve(coordsData); }
      }, 100);
    });
  }
  coordsLoading = true;
  return fetch("data/apt_trade/coords.json?t=" + Date.now())
    .then(function (res) { return res.ok ? res.json() : {}; })
    .then(function (data) { coordsData = data; return data; })
    .catch(function () { coordsData = {}; return {}; });
}

function initMap() {
  if (mapObj) return Promise.resolve();
  if (typeof kakao === "undefined" || !kakao.maps) return Promise.reject("no sdk");
  return new Promise(function (resolve) {
    kakao.maps.load(function () {
      var container = mapContainer;
      mapObj = new kakao.maps.Map(container, {
        center: new kakao.maps.LatLng(37.5665, 126.978),
        level: 8
      });
      mapClusterer = new kakao.maps.MarkerClusterer({
        map: mapObj,
        averageCenter: true,
        minLevel: 4,
        disableClickZoom: false
      });
      resolve();
    });
  });
}

function clearMapMarkers() {
  if (activeOverlay) { activeOverlay.setMap(null); activeOverlay = null; }
  if (mapClusterer) mapClusterer.clear();
  mapMarkers = [];
}

function getMarkerImage(pct) {
  var color;
  if (pct == null) color = "#94a3b8";
  else if (pct >= 0) color = "#ef4444";
  else color = "#3b82f6";

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="35">'
    + '<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 23 12 23s12-14 12-23C24 5.4 18.6 0 12 0z" fill="' + color + '"/>'
    + '<circle cx="12" cy="12" r="5" fill="#fff"/>'
    + '</svg>';
  return new kakao.maps.MarkerImage(
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
    new kakao.maps.Size(24, 35),
    { offset: new kakao.maps.Point(12, 35) }
  );
}

function showMapMarkers(items) {
  clearMapMarkers();
  if (!mapObj || !coordsData) return;

  var bounds = new kakao.maps.LatLngBounds();
  var hasAny = false;

  /* group items by apt (unique sigungu+dong+name) to pick representative */
  var seen = {};
  var reps = [];
  for (var i = 0; i < items.length; i++) {
    var r = items[i];
    if (!r.id || !coordsData[r.id]) continue;
    var gkey = (r.sigungu || "") + "\t" + (r.dong_name || "") + "\t" + (r.apt_name || "");
    if (seen[gkey]) continue;
    seen[gkey] = true;
    reps.push(r);
  }

  for (var j = 0; j < reps.length; j++) {
    (function (r) {
      var c = coordsData[r.id];
      var pos = new kakao.maps.LatLng(c[0], c[1]);
      var marker = new kakao.maps.Marker({
        position: pos,
        image: getMarkerImage(r.pct)
      });

      kakao.maps.event.addListener(marker, "click", function () {
        if (activeOverlay) { activeOverlay.setMap(null); activeOverlay = null; }

        var pctHtml = "";
        if (r.pct != null) {
          if (r.pct >= 0) {
            pctHtml = '<div class="map-info-pct up">\u25B2 +' + r.pct.toFixed(1) + '%</div>';
          } else {
            pctHtml = '<div class="map-info-pct down">\u25BC ' + r.pct.toFixed(1) + '%</div>';
          }
        }

        var sido = r._sido || activeSido || "";
        var content = '<div class="map-info-window" style="position:relative;">'
          + '<button class="map-info-close" onclick="this.parentElement.parentElement.parentElement.style.display=\'none\'">\u2715</button>'
          + '<div class="map-info-name">' + escapeHTML(r.apt_name) + '</div>'
          + '<div class="map-info-loc">' + escapeHTML(r.sigungu + " " + r.dong_name) + '</div>'
          + '<div class="map-info-price">' + fmt(r.prev_price) + ' \u2192 ' + fmt(r.latest_price) + '\uB9CC</div>'
          + pctHtml
          + '<a class="map-info-link" href="apt.html?id=' + encodeURIComponent(r.id) + '&s=' + encodeURIComponent(sido) + '">\uC0C1\uC138\uBCF4\uAE30 \u2192</a>'
          + '</div>';

        activeOverlay = new kakao.maps.CustomOverlay({
          content: content,
          position: pos,
          yAnchor: 1.3
        });
        activeOverlay.setMap(mapObj);
      });

      mapMarkers.push(marker);
      bounds.extend(pos);
      hasAny = true;
    })(reps[j]);
  }

  mapClusterer.addMarkers(mapMarkers);
  if (hasAny) {
    mapObj.setBounds(bounds);
  }
}

function toggleView(mode) {
  if (mode === "map") {
    viewListBtn.classList.remove("active");
    viewListBtn.setAttribute("aria-pressed", "false");
    viewMapBtn.classList.add("active");
    viewMapBtn.setAttribute("aria-pressed", "true");
    resultsEl.style.display = "none";
    mapContainer.style.display = "block";

    Promise.all([loadCoords(), initMap()]).then(function () {
      mapObj.relayout();
      refreshMapMarkers();
    }).catch(function () {
      mapContainer.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);">\uC9C0\uB3C4\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uCE74\uCE74\uC624\uB9F5 SDK \uC124\uC815\uC744 \uD655\uC778\uD574\uC8FC\uC138\uC694.</div>';
    });
  } else {
    viewMapBtn.classList.remove("active");
    viewMapBtn.setAttribute("aria-pressed", "false");
    viewListBtn.classList.add("active");
    viewListBtn.setAttribute("aria-pressed", "true");
    resultsEl.style.display = "";
    mapContainer.style.display = "none";
  }
}

function refreshMapMarkers() {
  if (mapContainer.style.display === "none") return;
  if (!mapObj || !coordsData) return;

  var q = searchInput.value.trim().toLowerCase();
  var _rqt = q.split(/\s+/).filter(Boolean);
  var items;
  if (_rqt.length > 0 && _rqt[0].length >= 2) {
    items = [];
    var sidoKeys = Object.keys(sidoCache);
    for (var si = 0; si < sidoKeys.length; si++) {
      var sido = sidoKeys[si];
      var data = sidoCache[sido];
      if (!data || !data.items) continue;
      var srcItems = data.items;
      if (sido === activeSido) {
        if (activeDistrict) srcItems = srcItems.filter(function (r) { return r.district === activeDistrict; });
        if (activeSubDistrict) srcItems = srcItems.filter(function (r) { return r.sigungu === activeSubDistrict; });
        if (activeDong) srcItems = srcItems.filter(function (r) { return r.dong_name === activeDong; });
      }
      if (activeArea) {
        var range = AREA_RANGES[activeArea];
        srcItems = srcItems.filter(function (r) { return r.area_m2 >= range.min && r.area_m2 < range.max; });
      }
      for (var j = 0; j < srcItems.length; j++) {
        if (matchQuery(srcItems[j].apt_name, q)) {
          var item = srcItems[j];
          if (!item._sido) item._sido = sido;
          items.push(item);
        }
      }
    }
  } else {
    items = getFilteredItems();
  }
  showMapMarkers(items);
}

if (viewListBtn && viewMapBtn) {
  viewListBtn.addEventListener("click", function () { toggleView("list"); });
  viewMapBtn.addEventListener("click", function () { toggleView("map"); });
}

/* ── doSearch 후 지도 마커도 갱신 ── */
var _origDoSearch = doSearch;
doSearch = async function (query) {
  await _origDoSearch(query);
  if (mapContainer.style.display !== "none" && coordsData) {
    refreshMapMarkers();
  }
};

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

    // URL에서 검색어 복원 또는 기본 검색
    var defaultQuery = urlState.query || "래미안원베일리";
    searchInput.value = defaultQuery;
    doSearch(defaultQuery);
    if (!urlState.query) updateURL();

    statusEl.innerHTML = "";
  } catch (e) {
    statusEl.textContent = "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
  }
}

init();

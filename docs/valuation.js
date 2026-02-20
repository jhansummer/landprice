/* APT Mine — 단지분석 (valuation search) */
(function () {
  var INDEX_PATH = "data/apt_trade/valuation/index.json";
  var BY_APT_BASE = "data/apt_trade/by_apt/";
  var LOCATION_SCORES_PATH = "data/apt_trade/location_scores.json";
  var APT_META_PATH = "data/apt_trade/apt_meta.json";
  var CHART_COLORS = ["#2563eb", "#ef4444", "#f59e0b"];
  var STATUS_LABELS = {
    undervalued: "저평가",
    leading: "리딩단지"
  };

  var statusEl = document.getElementById("status");
  var resultsEl = document.getElementById("results");
  var searchInput = document.getElementById("searchInput");
  var searchBtn = document.getElementById("searchBtn");
  var globalIndex = null;
  var sidoCache = {};
  var acDropdown = null;
  var acTimeout = null;
  var txnCache = {};
  var locationScores = null;
  var aptMeta = null;
  var pricePerM2Cache = null;

  /* ── helpers ── */
  function fmt(v) { return new Intl.NumberFormat("ko-KR").format(Math.round(v)); }
  function fmtEok(v) { return (v / 10000).toFixed(1) + "\uC5B5"; }
  function fmtPerM2(price, area) { return (price / area / 1000).toFixed(1) + "\uCC9C\uB9CC/m\u00B2"; }
  function escapeHTML(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  /* ── URL state ── */
  function updateURL() {
    var q = searchInput.value.trim();
    if (q) history.replaceState(null, "", "#?q=" + encodeURIComponent(q));
  }
  function parseURL() {
    var hash = decodeURIComponent(location.hash.replace("#", ""));
    if (!hash) return {};
    var parts = hash.split("?q=");
    return { query: parts[1] || "" };
  }

  /* ── data loading ── */
  function loadSido(sido) {
    if (sidoCache[sido]) return Promise.resolve(sidoCache[sido]);
    var path = "data/apt_trade/valuation/" + sido + ".json?t=" + Date.now();
    return fetch(path).then(function (r) { return r.json(); }).then(function (data) {
      sidoCache[sido] = data;
      return data;
    });
  }

  function loadAllSidos() {
    if (!globalIndex) return Promise.resolve();
    var promises = globalIndex.sido_order.map(function (sido) { return loadSido(sido); });
    return Promise.all(promises);
  }

  function getAllItems() {
    var all = [];
    globalIndex.sido_order.forEach(function (sido) {
      var data = sidoCache[sido];
      if (data && data.items) {
        data.items.forEach(function (item) { all.push(item); });
      }
    });
    return all;
  }

  function loadTxn(aptId) {
    if (txnCache[aptId]) return Promise.resolve(txnCache[aptId]);
    return fetch(BY_APT_BASE + aptId + ".json").then(function (r) { return r.json(); }).then(function (data) {
      txnCache[aptId] = data;
      return data;
    }).catch(function () { return []; });
  }

  /* ── value scoring data ── */
  function loadLocationScores() {
    return fetch(LOCATION_SCORES_PATH + "?t=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) { locationScores = data; })
      .catch(function () { locationScores = null; });
  }
  function loadAptMeta() {
    return fetch(APT_META_PATH + "?t=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) { aptMeta = data; })
      .catch(function () { aptMeta = null; });
  }

  function buildPricePerM2Percentiles() {
    var allItems = getAllItems();
    var vals = [];
    allItems.forEach(function (item) {
      if (item.current_price && item.area_m2) {
        vals.push(item.current_price / item.area_m2);
      }
    });
    vals.sort(function (a, b) { return a - b; });
    pricePerM2Cache = vals;
  }

  function getPercentile(value) {
    if (!pricePerM2Cache || !pricePerM2Cache.length) return 50;
    var idx = 0;
    for (var i = 0; i < pricePerM2Cache.length; i++) {
      if (pricePerM2Cache[i] <= value) idx = i;
      else break;
    }
    return Math.round((idx / (pricePerM2Cache.length - 1)) * 100);
  }

  /**
   * 종합 가치평가 점수 계산
   * @returns {{ transport, school, livability, rebuild, total, transportDetail, buildYear, hasData }} | null
   */
  function calcValueScore(item) {
    if (!locationScores) return null;
    var sigungu = item.sigungu;
    var dongName = item.dong_name;

    // Find sido for this sigungu
    var sido = null;
    var guData = null;
    var sidos = Object.keys(locationScores);
    for (var i = 0; i < sidos.length; i++) {
      if (locationScores[sidos[i]][sigungu]) {
        sido = sidos[i];
        guData = locationScores[sidos[i]][sigungu];
        break;
      }
    }
    if (!guData) return null;

    // 교통접근성: 강남 50% + 광화문 25% + 여의도 25%
    var t = guData.transport;
    var transportScore = t.gangnam * 0.5 + t.gwanghwamun * 0.25 + t.yeouido * 0.25;

    // 학군: 동 보정 or 구 기본
    var schoolScore = guData.school_base;
    if (guData.school_dong && guData.school_dong[dongName] !== undefined) {
      schoolScore = guData.school_dong[dongName];
    }

    // 건물연한/재건축
    var buildYear = aptMeta ? aptMeta[item.id] : null;
    var rebuildScore = 0;
    var currentYear = new Date().getFullYear();
    if (buildYear) {
      var age = currentYear - buildYear;
      if (age >= 30) rebuildScore = 90;
      else if (age >= 20) rebuildScore = 60;
      else if (age >= 10) rebuildScore = 30;
      else rebuildScore = 10;
    }

    // 거주가치: 단가 백분위(70%) + 건물연한 보정(30%)
    var livabilityScore = 50;
    if (item.current_price && item.area_m2) {
      var ppm2 = item.current_price / item.area_m2;
      var pctile = getPercentile(ppm2);
      var ageBonus = 0;
      if (buildYear) {
        var age2 = currentYear - buildYear;
        if (age2 <= 5) ageBonus = 15;
        else if (age2 <= 10) ageBonus = 10;
        else if (age2 <= 20) ageBonus = 0;
        else ageBonus = -10;
      }
      livabilityScore = Math.max(0, Math.min(100, pctile * 0.7 + 50 * 0.3 + ageBonus));
    }

    var total = (transportScore + schoolScore + livabilityScore + rebuildScore) / 4;

    return {
      transport: Math.round(transportScore),
      school: Math.round(schoolScore),
      livability: Math.round(livabilityScore),
      rebuild: Math.round(rebuildScore),
      total: Math.round(total),
      transportDetail: { gangnam: t.gangnam, gwanghwamun: t.gwanghwamun, yeouido: t.yeouido },
      buildYear: buildYear,
      hasData: true
    };
  }

  /* ── value score UI ── */
  function renderValueSection(entry) {
    var scores = calcValueScore(entry);
    if (!scores) return null;

    var section = document.createElement("div");
    section.className = "vs-section";

    // Title
    var title = document.createElement("div");
    title.className = "vs-title";
    title.textContent = "\uC885\uD569 \uAC00\uCE58\uD3C9\uAC00";
    section.appendChild(title);

    var body = document.createElement("div");
    body.className = "vs-body";

    // Left: radar chart
    var chartCol = document.createElement("div");
    chartCol.className = "vs-chart-col";
    var canvas = document.createElement("canvas");
    canvas.style.width = "140px";
    canvas.style.height = "140px";
    chartCol.appendChild(canvas);
    // Total score
    var totalEl = document.createElement("div");
    totalEl.className = "vs-total";
    totalEl.innerHTML = '<span class="vs-total-num">' + scores.total + '</span><span class="vs-total-label">\uC810</span>';
    chartCol.appendChild(totalEl);
    body.appendChild(chartCol);

    // Right: bar gauges
    var barsCol = document.createElement("div");
    barsCol.className = "vs-bars-col";
    var items = [
      { label: "\uAD50\uD1B5\uC811\uADFC\uC131", key: "transport", score: scores.transport },
      { label: "\uD559\uAD70", key: "school", score: scores.school },
      { label: "\uAC70\uC8FC\uAC00\uCE58", key: "livability", score: scores.livability },
      { label: "\uC7AC\uAC74\uCD95\uAC00\uB2A5\uC131", key: "rebuild", score: scores.rebuild }
    ];
    items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "vs-bar-row";
      var lbl = document.createElement("span");
      lbl.className = "vs-bar-label";
      lbl.textContent = it.label;
      row.appendChild(lbl);
      var track = document.createElement("div");
      track.className = "vs-bar-track";
      var fill = document.createElement("div");
      fill.className = "vs-bar-fill";
      fill.style.width = it.score + "%";
      if (it.score >= 70) fill.classList.add("vs-bar-high");
      else if (it.score >= 40) fill.classList.add("vs-bar-mid");
      else fill.classList.add("vs-bar-low");
      track.appendChild(fill);
      row.appendChild(track);
      var val = document.createElement("span");
      val.className = "vs-bar-val";
      val.textContent = it.score;
      row.appendChild(val);
      barsCol.appendChild(row);
    });

    // Transport detail (collapsible)
    var detailBtn = document.createElement("button");
    detailBtn.className = "vs-detail-btn";
    detailBtn.textContent = "\uAD50\uD1B5 \uC138\uBD80";
    var detailDiv = document.createElement("div");
    detailDiv.className = "vs-detail";
    detailDiv.style.display = "none";
    var td = scores.transportDetail;
    detailDiv.innerHTML = '<span>\uAC15\uB0A8 ' + td.gangnam + '</span>'
      + '<span>\uAD11\uD654\uBB38 ' + td.gwanghwamun + '</span>'
      + '<span>\uC5EC\uC758\uB3C4 ' + td.yeouido + '</span>'
      + '<span class="vs-detail-note">\uAC00\uC911: \uAC15\uB0A8 50% / \uAD11\uD654\uBB38 25% / \uC5EC\uC758\uB3C4 25%</span>';
    detailBtn.addEventListener("click", function () {
      var visible = detailDiv.style.display !== "none";
      detailDiv.style.display = visible ? "none" : "flex";
      detailBtn.textContent = visible ? "\uAD50\uD1B5 \uC138\uBD80" : "\uAD50\uD1B5 \uC138\uBD80 \uC811\uAE30";
    });
    barsCol.appendChild(detailBtn);
    barsCol.appendChild(detailDiv);

    // Build year info
    if (scores.buildYear) {
      var byInfo = document.createElement("div");
      byInfo.className = "vs-build-year";
      byInfo.textContent = "\uC900\uACF5 " + scores.buildYear + "\uB144 (" + (new Date().getFullYear() - scores.buildYear) + "\uB144\uCC28)";
      barsCol.appendChild(byInfo);
    }

    body.appendChild(barsCol);
    section.appendChild(body);

    // Draw radar after DOM insertion
    setTimeout(function () {
      if (typeof drawRadarChart === "function") {
        drawRadarChart(canvas, scores);
      }
    }, 0);

    return section;
  }

  /* ── tabs (removed — search is now cross-region) ── */

  /* ── autocomplete ── */
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
    var allItems = getAllItems();
    if (!allItems.length) return;
    var q = query.toLowerCase();
    var seen = {};
    var results = [];
    for (var i = 0; i < allItems.length && results.length < 10; i++) {
      var r = allItems[i];
      if (r.apt_name.toLowerCase().indexOf(q) < 0) continue;
      var key = r.apt_name + "\t" + r.sigungu + "\t" + r.dong_name;
      if (seen[key]) continue;
      seen[key] = true;
      results.push({ apt_name: r.apt_name, sigungu: r.sigungu, dong_name: r.dong_name });
    }
    if (!results.length) { acDropdown.style.display = "none"; return; }
    acDropdown.innerHTML = "";
    results.forEach(function (r) {
      var item = document.createElement("div");
      item.className = "ac-item";
      item.innerHTML = '<span class="ac-name">' + escapeHTML(r.apt_name) + '</span>'
        + '<span class="ac-loc">' + escapeHTML(r.sigungu + " " + r.dong_name) + '</span>';
      item.addEventListener("mousedown", function (e) {
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

  /* ── search ── */
  function doSearch(query) {
    if (!query || query.length < 2) return;
    var allItems = getAllItems();
    if (!allItems.length) { resultsEl.innerHTML = '<div class="val-empty">데이터가 없습니다.</div>'; return; }

    var q = query.toLowerCase();
    var matches = allItems.filter(function (item) {
      return item.apt_name.toLowerCase().indexOf(q) >= 0;
    });

    if (!matches.length) {
      resultsEl.innerHTML = '<div class="val-empty">"' + escapeHTML(query) + '" 검색 결과가 없습니다.<br><span style="font-size:12px;color:var(--muted)">분석 대상: 36개월간 거래 15건 이상 단지</span></div>';
      return;
    }

    // Group by apt_name + sigungu + dong_name
    var groups = {};
    matches.forEach(function (m) {
      var key = m.apt_name + "\t" + m.sigungu + "\t" + m.dong_name;
      if (!groups[key]) groups[key] = { apt_name: m.apt_name, sigungu: m.sigungu, dong_name: m.dong_name, items: [] };
      groups[key].items.push(m);
    });

    resultsEl.innerHTML = "";
    var count = document.createElement("div");
    count.className = "result-count";
    count.textContent = Object.keys(groups).length + "\uAC1C \uB2E8\uC9C0 \u00B7 " + matches.length + "\uAC1C \uBA74\uC801";
    resultsEl.appendChild(count);

    // info card
    var infoCard = document.createElement("div");
    infoCard.className = "val-guide-card";
    infoCard.innerHTML = '<div class="val-guide-title">\uD310\uC815 \uAE30\uC900</div>'
      + '<div class="val-guide-grid">'
      + '<div class="val-guide-item">'
      + '<span class="val-badge val-badge-undervalued">\uC800\uD3C9\uAC00</span>'
      + '<span class="val-guide-desc">\uC720\uC0AC\uB2E8\uC9C0\uC640 3\uB144\uAC04 \uBE44\uC2B7\uD588\uC9C0\uB9CC<br>\uCD5C\uADFC 6\uAC1C\uC6D4 \uACA9\uCC28\uAC00 \uBC8C\uC5B4\uC838 \uC0C1\uB300\uC801\uC73C\uB85C \uC2FC \uB2E8\uC9C0</span>'
      + '</div>'
      + '<div class="val-guide-item">'
      + '<span class="val-badge val-badge-leading">\uB9AC\uB529\uB2E8\uC9C0</span>'
      + '<span class="val-guide-desc">\uC720\uC0AC\uB2E8\uC9C0 \uB300\uBE44<br>\uCD5C\uADFC 6\uAC1C\uC6D4 \uACA9\uCC28\uAC00 \uBC8C\uC5B4\uC838 \uC0C1\uB300\uC801\uC73C\uB85C \uC2DC\uC7A5\uC744 \uC120\uB3C4\uD558\uB294 \uB2E8\uC9C0</span>'
      + '</div>'
      + '</div>'
      + '<div class="val-guide-footer">\uBE44\uAD50 \uB300\uC0C1: \uAC19\uC740 \uAD6C+\uC778\uC811 \uAD6C \u00B7 \uBA74\uC801 30% \uC774\uB0B4 \u00B7 \uAC00\uACA9\uD750\uB984 \uC0C1\uAD00\uACC4\uC218 0.93\uC774\uC0C1</div>'
      + '<div class="val-guide-footer" style="margin-top:4px;font-size:11px;color:var(--muted)">\u203B \uC800\uD3C9\uAC00/\uB9AC\uB529\uC740 \uC2E4\uAC70\uB798\uAC00 \uAE30\uC900, \uC885\uD569 \uAC00\uCE58\uD3C9\uAC00\uB294 \uAD50\uD1B5\u00B7\uD559\uAD70\u00B7\uAC70\uC8FC\uAC00\uCE58\u00B7\uC7AC\uAC74\uCD95\uC744 \uBC18\uC601\uD569\uB2C8\uB2E4 (\uC11C\uC6B8 \uD55C\uC815).</div>';
    resultsEl.appendChild(infoCard);

    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      var groupEl = document.createElement("div");
      groupEl.style.marginBottom = "8px";

      // If multiple areas, show area tabs
      if (g.items.length > 1) {
        g.items.sort(function (a, b) { return a.area_m2 - b.area_m2; });
        var areaTabs = document.createElement("div");
        areaTabs.className = "val-area-tabs";
        var cardContainer = document.createElement("div");

        g.items.forEach(function (item, idx) {
          var btn = document.createElement("button");
          btn.className = "val-area-btn" + (idx === 0 ? " active" : "");
          btn.textContent = item.area_m2 + "m\u00B2";
          btn.addEventListener("click", function () {
            areaTabs.querySelectorAll(".val-area-btn").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            cardContainer.innerHTML = "";
            cardContainer.appendChild(renderValuationCard(item));
          });
          areaTabs.appendChild(btn);
        });
        groupEl.appendChild(areaTabs);
        cardContainer.appendChild(renderValuationCard(g.items[0]));
        groupEl.appendChild(cardContainer);
      } else {
        groupEl.appendChild(renderValuationCard(g.items[0]));
      }
      resultsEl.appendChild(groupEl);
    });
  }

  /* ── valuation card ── */
  function renderValuationCard(entry) {
    var card = document.createElement("div");
    card.className = "val-card";

    // Header: badge + gap
    var header = document.createElement("div");
    header.className = "val-header";
    var badge = document.createElement("span");
    badge.className = "val-badge val-badge-" + entry.status;
    badge.textContent = STATUS_LABELS[entry.status] || entry.status;
    if (entry.status !== "market") header.appendChild(badge);
    var gap = document.createElement("span");
    gap.className = "val-gap " + (entry.gap_pct < 0 ? "negative" : entry.gap_pct > 0 ? "positive" : "");
    gap.textContent = (entry.gap_pct > 0 ? "+" : "") + entry.gap_pct.toFixed(1) + "%";
    header.appendChild(gap);
    card.appendChild(header);

    // Name
    var name = document.createElement("div");
    name.className = "val-name";
    name.textContent = entry.apt_name;
    card.appendChild(name);

    // Info line
    var info = document.createElement("div");
    info.className = "val-info";
    info.textContent = entry.sigungu + " " + entry.dong_name + " \u00B7 "
      + entry.area_m2 + "m\u00B2 \u00B7 \uD604\uC7AC " + fmtEok(entry.current_price)
      + "(" + fmtPerM2(entry.current_price, entry.area_m2) + ")"
      + " \u00B7 \uBE44\uAD50\uB2E8\uC9C0 " + (entry.compare ? entry.compare.length : 0) + "\uAC1C";
    card.appendChild(info);

    // Gauge bar
    card.appendChild(createGauge(entry.gap_pct));

    // Comparison table
    if (entry.compare && entry.compare.length) {
      card.appendChild(createCompareTable(entry));
    }

    // Value score section
    var valueSec = renderValueSection(entry);
    if (valueSec) card.appendChild(valueSec);

    // CTA buttons
    var cta = document.createElement("div");
    cta.className = "val-cta";

    // Chart — auto load
    var chartPlaceholder = document.createElement("div");
    card.appendChild(chartPlaceholder);
    var ids = [entry.id];
    entry.compare.forEach(function (c) { ids.push(c.id); });
    Promise.all(ids.map(loadTxn)).then(function (txns) {
      var chartWrap = document.createElement("div");

      var canvasWrap = document.createElement("div");
      canvasWrap.className = "val-chart-wrap";
      var canvas = document.createElement("canvas");
      canvasWrap.appendChild(canvas);
      chartWrap.appendChild(canvasWrap);

      var seriesList = [];
      seriesList.push({ label: entry.apt_name, color: CHART_COLORS[0], history: txns[0] });
      entry.compare.forEach(function (c, i) {
        seriesList.push({ label: c.apt_name, color: CHART_COLORS[i + 1] || "#94a3b8", history: txns[i + 1] });
      });

      var legend = document.createElement("div");
      legend.className = "val-legend";
      seriesList.forEach(function (s) {
        var item = document.createElement("span");
        item.className = "val-legend-item";
        item.innerHTML = '<span class="val-legend-dot" style="background:' + s.color + '"></span>'
          + escapeHTML(s.label);
        legend.appendChild(item);
      });
      chartWrap.appendChild(legend);

      chartPlaceholder.replaceWith(chartWrap);
      drawMultiScatter(canvas, seriesList);
    });

    // Watchlist button
    if (typeof APTWatchlist !== "undefined") {
      var wlBtn = document.createElement("button");
      wlBtn.className = "detail-btn";
      var isWl = APTWatchlist.has(entry.id);
      wlBtn.textContent = isWl ? "\uAD00\uC2EC \uC81C\uAC70" : "\uAD00\uC2EC \uCD94\uAC00";
      wlBtn.addEventListener("click", function () {
        if (APTWatchlist.has(entry.id)) {
          APTWatchlist.remove(entry.id);
          wlBtn.textContent = "\uAD00\uC2EC \uCD94\uAC00";
        } else {
          APTWatchlist.add({
            id: entry.id,
            apt_name: entry.apt_name,
            sigungu: entry.sigungu,
            dong_name: entry.dong_name,
            area_m2: entry.area_m2,
            latest_price: entry.current_price,
            chg_pct: entry.gap_pct
          });
          wlBtn.textContent = "\uAD00\uC2EC \uC81C\uAC70";
        }
        APTWatchlist.track("watchlist_toggle", { apt_name: entry.apt_name, source: "valuation" });
      });
      cta.appendChild(wlBtn);
    }
    card.appendChild(cta);

    return card;
  }

  /* ── gauge bar ── */
  function createGauge(gapPct) {
    var wrap = document.createElement("div");
    wrap.className = "val-gauge-wrap";
    var labels = document.createElement("div");
    labels.className = "val-gauge-labels";
    labels.innerHTML = "<span>\uC800\uD3C9\uAC00</span><span>\uB9AC\uB529</span>";
    wrap.appendChild(labels);
    var track = document.createElement("div");
    track.className = "val-gauge-track";
    // Map gap_pct from [-30, +30] → [0%, 100%]
    var pct = Math.max(0, Math.min(100, ((gapPct + 30) / 60) * 100));
    var marker = document.createElement("div");
    marker.className = "val-gauge-marker";
    marker.style.left = pct + "%";
    track.appendChild(marker);
    wrap.appendChild(track);
    return wrap;
  }

  /* ── comparison table ── */
  function createCompareTable(entry) {
    var wrap = document.createElement("div");
    wrap.className = "val-compare-wrap";
    var title = document.createElement("div");
    title.className = "val-compare-title";
    title.textContent = "\uC720\uC0AC\uB2E8\uC9C0 \uBE44\uAD50";
    wrap.appendChild(title);

    var table = document.createElement("table");
    table.className = "val-compare-table";

    // thead
    var thead = document.createElement("thead");
    var htr = document.createElement("tr");
    htr.innerHTML = "<th>\uC9C0\uD45C</th><th class=\"val-me\">" + escapeHTML(entry.apt_name) + "</th>";
    entry.compare.forEach(function (c) {
      htr.innerHTML += "<th>" + escapeHTML(c.apt_name) + "</th>";
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    // tbody
    var tbody = document.createElement("tbody");
    var e6 = entry.recent_avg, e36 = entry.avg_36, eArea = entry.area_m2;
    var rows = [
      ["\uC704\uCE58", entry.sigungu + " " + entry.dong_name],
      ["\uBA74\uC801", entry.area_m2 + "m\u00B2"],
      ["\uD604\uC7AC\uAC00", fmtEok(entry.current_price)],
      ["\uBA74\uC801\uB2F9\uAC00", eArea ? fmtPerM2(entry.current_price, eArea) : "-"],
      ["6\uAC1C\uC6D4 \uD3C9\uADE0", e6 ? fmtEok(e6) : "-"],
      ["3\uB144 \uD3C9\uADE0", e36 ? fmtEok(e36) : "-"],
      ["\uAC70\uB798\uB7C9", entry.trade_count + "\uAC74"]
    ];
    rows.forEach(function (r, ri) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + r[0] + "</td><td class=\"val-me\">" + r[1] + "</td>";
      entry.compare.forEach(function (c) {
        var val = "-";
        var c6 = c.recent_avg, c36 = c.avg_36, cArea = c.area_m2;
        if (ri === 0) val = (c.sigungu || "") + " " + (c.dong_name || "");
        else if (ri === 1) val = cArea + "m\u00B2";
        else if (ri === 2) val = c.current_price ? fmtEok(c.current_price) : "-";
        else if (ri === 3) val = (c.current_price && cArea) ? fmtPerM2(c.current_price, cArea) : "-";
        else if (ri === 4) val = c6 ? fmtEok(c6) : "-";
        else if (ri === 5) val = c36 ? fmtEok(c36) : "-";
        else if (ri === 6) val = c.trade_count ? c.trade_count + "\uAC74" : "-";
        tr.innerHTML += "<td>" + val + "</td>";
      });
      tbody.appendChild(tr);
    });
    // Correlation row
    var corrTr = document.createElement("tr");
    corrTr.innerHTML = "<td>\uC0C1\uAD00\uACC4\uC218</td><td class=\"val-me\">-</td>";
    entry.compare.forEach(function (c) {
      corrTr.innerHTML += "<td>" + (c.corr ? c.corr.toFixed(3) : "-") + "</td>";
    });
    tbody.appendChild(corrTr);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  /* ── hint ── */
  function showHint() {
    var totalCount = 0;
    globalIndex.sido_order.forEach(function (s) { var d = sidoCache[s]; if (d) totalCount += (d.count || 0); });
    resultsEl.innerHTML = '<div class="val-hint">\uC804\uAD6D ' + totalCount.toLocaleString()
      + '\uAC1C \uB2E8\uC9C0 \uBD84\uC11D \uAC00\uB2A5<br><span style="font-size:11px">\uB2E8\uC9C0\uBA85\uC744 \uAC80\uC0C9\uD558\uBA74 \uC720\uC0AC\uB2E8\uC9C0 \uB300\uBE44 \uC800\uD3C9\uAC00/\uB9AC\uB529 \uC5EC\uBD80\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</span></div>';
  }

  /* ── init ── */
  function init() {
    fetch(INDEX_PATH + "?t=" + Date.now())
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (index) {
        globalIndex = index;
        var sidoOrder = index.sido_order || [];
        if (!sidoOrder.length) { statusEl.textContent = "\uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."; return; }

        var parsed = parseURL();

        return Promise.all([
          loadAllSidos(),
          loadLocationScores(),
          loadAptMeta()
        ]).then(function () {
          statusEl.innerHTML = "";
          buildPricePerM2Percentiles();
          createAutocomplete();
          var defaultQuery = parsed.query || "\uC815\uB4E0\uB9C8\uC744";
          searchInput.value = defaultQuery;
          doSearch(defaultQuery);
          if (!parsed.query) updateURL();
        });
      })
      .catch(function () {
        statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
      });
  }

  /* ── event listeners ── */
  searchInput.addEventListener("input", function () {
    clearTimeout(acTimeout);
    acTimeout = setTimeout(function () { showAutocomplete(searchInput.value.trim()); }, 200);
  });
  searchInput.addEventListener("blur", function () {
    setTimeout(function () { if (acDropdown) acDropdown.style.display = "none"; }, 150);
  });
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      if (acDropdown) acDropdown.style.display = "none";
      doSearch(searchInput.value.trim());
      updateURL();
    }
  });
  searchBtn.addEventListener("click", function () {
    if (acDropdown) acDropdown.style.display = "none";
    doSearch(searchInput.value.trim());
    updateURL();
  });
  window.addEventListener("hashchange", function () {
    var parsed = parseURL();
    if (parsed.query) {
      searchInput.value = parsed.query;
      doSearch(parsed.query);
    }
  });

  init();
})();

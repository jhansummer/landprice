/* APT Mine — 단지분석 (valuation search) */
(function () {
  var INDEX_PATH = "data/apt_trade/valuation/index.json";
  var BY_APT_BASE = "data/apt_trade/by_apt/";
  var CHART_COLORS = ["#2563eb", "#ef4444", "#f59e0b"];
  var STATUS_LABELS = {
    undervalued: "저평가",
    market: "적정가",
    leading: "리딩단지"
  };

  var statusEl = document.getElementById("status");
  var resultsEl = document.getElementById("results");
  var searchInput = document.getElementById("searchInput");
  var searchBtn = document.getElementById("searchBtn");
  var tabsEl = document.getElementById("tabs");

  var globalIndex = null;
  var sidoCache = {};
  var activeSido = null;
  var acDropdown = null;
  var acTimeout = null;
  var txnCache = {};

  /* ── helpers ── */
  function fmt(v) { return new Intl.NumberFormat("ko-KR").format(Math.round(v)); }
  function fmtEok(v) { return (v / 10000).toFixed(1) + "\uC5B5"; }
  function fmtPerM2(price, area) { return (price / area / 1000).toFixed(1) + "\uCC9C\uB9CC/m\u00B2"; }
  function escapeHTML(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  /* ── URL state ── */
  function updateURL() {
    var parts = [];
    if (activeSido) parts.push(activeSido);
    var q = searchInput.value.trim();
    var hash = parts.join("/");
    if (q) hash += "?q=" + encodeURIComponent(q);
    if (hash) history.replaceState(null, "", "#" + hash);
  }
  function parseURL() {
    var hash = decodeURIComponent(location.hash.replace("#", ""));
    if (!hash) return {};
    var parts = hash.split("?q=");
    return { sido: parts[0] || "", query: parts[1] || "" };
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

  function loadTxn(aptId) {
    if (txnCache[aptId]) return Promise.resolve(txnCache[aptId]);
    return fetch(BY_APT_BASE + aptId + ".json").then(function (r) { return r.json(); }).then(function (data) {
      txnCache[aptId] = data;
      return data;
    }).catch(function () { return []; });
  }

  /* ── tabs ── */
  function renderTabs(sidoOrder) {
    tabsEl.innerHTML = "";
    var label = document.createElement("span");
    label.className = "region-label";
    label.textContent = "지역";
    tabsEl.appendChild(label);
    sidoOrder.forEach(function (sido) {
      var btn = document.createElement("button");
      btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
      btn.textContent = sido;
      btn.addEventListener("click", function () {
        if (sido === activeSido) return;
        activeSido = sido;
        tabsEl.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        resultsEl.innerHTML = "";
        searchInput.value = "";
        statusEl.innerHTML = '<span class="spinner"></span>데이터 로딩 중...';
        loadSido(sido).then(function () {
          statusEl.innerHTML = "";
          showHint();
          updateURL();
        });
      });
      tabsEl.appendChild(btn);
    });
  }

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
    var data = sidoCache[activeSido];
    if (!data || !data.items) return;
    var q = query.toLowerCase();
    var seen = {};
    var results = [];
    for (var i = 0; i < data.items.length && results.length < 10; i++) {
      var r = data.items[i];
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
    var data = sidoCache[activeSido];
    if (!data || !data.items) { resultsEl.innerHTML = '<div class="val-empty">데이터가 없습니다.</div>'; return; }

    var q = query.toLowerCase();
    var matches = data.items.filter(function (item) {
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
    count.textContent = Object.keys(groups).length + "개 단지 · " + matches.length + "개 면적";
    resultsEl.appendChild(count);

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
      + " \u00B7 \uD074\uB7EC\uC2A4\uD130 " + entry.cluster_size + "\uAC1C \uB2E8\uC9C0";
    card.appendChild(info);

    // Gauge bar
    card.appendChild(createGauge(entry.gap_pct));

    // Comparison table
    if (entry.compare && entry.compare.length) {
      card.appendChild(createCompareTable(entry));
    }

    // CTA buttons
    var cta = document.createElement("div");
    cta.className = "val-cta";

    // Chart toggle
    var chartBtn = document.createElement("button");
    chartBtn.className = "detail-btn";
    chartBtn.textContent = "\uCC28\uD2B8 \uBCF4\uAE30";
    var chartOpen = false;
    var chartWrap = null;
    chartBtn.addEventListener("click", function () {
      if (chartOpen && chartWrap) {
        chartWrap.remove();
        chartWrap = null;
        chartOpen = false;
        chartBtn.textContent = "\uCC28\uD2B8 \uBCF4\uAE30";
        return;
      }
      chartBtn.textContent = "\uB85C\uB529...";
      var ids = [entry.id];
      entry.compare.forEach(function (c) { ids.push(c.id); });
      Promise.all(ids.map(loadTxn)).then(function (txns) {
        chartWrap = document.createElement("div");

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

        // Legend
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

        card.insertBefore(chartWrap, cta);
        drawMultiScatter(canvas, seriesList);
        chartBtn.textContent = "\uCC28\uD2B8 \uC811\uAE30";
        chartOpen = true;
      });
    });
    cta.appendChild(chartBtn);

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
    var eDiff = (e6 && e36 && e36 > 0) ? ((e6 / e36 - 1) * 100).toFixed(1) + "%" : "-";
    var rows = [
      ["\uC704\uCE58", entry.sigungu + " " + entry.dong_name],
      ["\uBA74\uC801", entry.area_m2 + "m\u00B2"],
      ["\uD604\uC7AC\uAC00", fmtEok(entry.current_price)],
      ["\uBA74\uC801\uB2F9\uAC00", eArea ? fmtPerM2(entry.current_price, eArea) : "-"],
      ["6\uAC1C\uC6D4 \uD3C9\uADE0", e6 ? fmtEok(e6) : "-"],
      ["3\uB144 \uD3C9\uADE0", e36 ? fmtEok(e36) : "-"],
      ["3\uB144\u21926\uAC1C\uC6D4", eDiff],
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
        else if (ri === 6) val = (c6 && c36 && c36 > 0) ? ((c6 / c36 - 1) * 100).toFixed(1) + "%" : "-";
        else if (ri === 7) val = c.trade_count ? c.trade_count + "\uAC74" : "-";
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
    var data = sidoCache[activeSido];
    if (!data) return;
    resultsEl.innerHTML = '<div class="val-hint">' + activeSido + ' ' + (data.count || 0).toLocaleString()
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
        activeSido = sidoOrder.indexOf(parsed.sido) >= 0 ? parsed.sido : sidoOrder[0];
        renderTabs(sidoOrder);

        return loadSido(activeSido).then(function () {
          statusEl.innerHTML = "";
          createAutocomplete();
          if (parsed.query) {
            searchInput.value = parsed.query;
            doSearch(parsed.query);
          } else {
            showHint();
          }
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
    if (parsed.sido && parsed.sido !== activeSido) {
      activeSido = parsed.sido;
      tabsEl.querySelectorAll(".tab-btn").forEach(function (b) {
        b.classList.toggle("active", b.textContent === activeSido);
      });
      loadSido(activeSido).then(function () {
        if (parsed.query) { searchInput.value = parsed.query; doSearch(parsed.query); }
      });
    } else if (parsed.query) {
      searchInput.value = parsed.query;
      doSearch(parsed.query);
    }
  });

  init();
})();

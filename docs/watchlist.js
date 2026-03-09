/* APT Mine - 관심목록 / 비교 공통 모듈 v2 */
var APTWatchlist = (function () {
  var WL_KEY = "aptmine_watchlist";
  var CMP_KEY = "aptmine_compare";
  var MAX_WL = 50;
  var MAX_CMP = 5;
  var CMP_COLORS = ["#2563eb", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"];

  /* ── 관심목록 (localStorage, 영구) ── */
  function getList() {
    try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveList(list) {
    localStorage.setItem(WL_KEY, JSON.stringify(list));
    document.dispatchEvent(new CustomEvent("watchlist-change", { detail: list }));
  }
  function add(item) {
    var list = getList();
    if (list.some(function (x) { return x.id === item.id; })) return false;
    item.added_at = new Date().toISOString();
    list.unshift(item);
    if (list.length > MAX_WL) list = list.slice(0, MAX_WL);
    saveList(list);
    return true;
  }
  function remove(id) {
    saveList(getList().filter(function (x) { return x.id !== id; }));
  }
  function has(id) {
    return getList().some(function (x) { return x.id === id; });
  }
  function count() { return getList().length; }

  /* ── 비교 리스트 (sessionStorage, 세션 한정) ── */
  function getCompare() {
    try { return JSON.parse(sessionStorage.getItem(CMP_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveCompare(list) {
    sessionStorage.setItem(CMP_KEY, JSON.stringify(list));
    document.dispatchEvent(new CustomEvent("compare-change", { detail: list }));
  }
  function addCompare(item) {
    var list = getCompare();
    if (list.length >= MAX_CMP) return false;
    if (list.some(function (x) { return x.id === item.id; })) return false;
    list.push(item);
    saveCompare(list);
    return true;
  }
  function removeCompare(id) {
    saveCompare(getCompare().filter(function (x) { return x.id !== id; }));
  }
  function clearCompare() {
    sessionStorage.removeItem(CMP_KEY);
    document.dispatchEvent(new CustomEvent("compare-change", { detail: [] }));
  }
  function hasCompare(id) {
    return getCompare().some(function (x) { return x.id === id; });
  }

  /* ── 공통 GA4 헬퍼 ── */
  function track(name, params) {
    if (typeof gtag === "function") gtag("event", name, params || {});
  }

  /* ── 관심목록 nav 배지 업데이트 ── */
  function updateBadge() {
    var el = document.getElementById("wl-badge");
    if (!el) return;
    var c = count();
    el.textContent = c > 0 ? c : "";
    el.style.display = c > 0 ? "flex" : "none";
  }

  /* ── 비교 플로팅 바 ── */
  function renderCompareBar() {
    var old = document.getElementById("compare-float-bar");
    if (old) old.remove();
    var list = getCompare();
    if (!list.length) return;

    var bar = document.createElement("div");
    bar.id = "compare-float-bar";
    bar.className = "compare-float-bar";

    var label = document.createElement("span");
    label.className = "cfb-label";
    label.textContent = "\uBE44\uAD50 (" + list.length + "/" + MAX_CMP + ")";
    bar.appendChild(label);

    list.forEach(function (item) {
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = item.apt_name + " " + item.area_m2 + "m\u00B2";
      var rm = document.createElement("span");
      rm.className = "remove";
      rm.textContent = "\u2715";
      rm.addEventListener("click", function () { removeCompare(item.id); renderCompareBar(); });
      chip.appendChild(rm);
      bar.appendChild(chip);
    });

    if (list.length >= 2) {
      var goBtn = document.createElement("button");
      goBtn.className = "go-btn";
      goBtn.textContent = list.length + "\uAC1C \uBE44\uAD50\uD558\uAE30";
      goBtn.addEventListener("click", function () {
        showCompareModal(list);
      });
      bar.appendChild(goBtn);
    } else {
      var hint = document.createElement("span");
      hint.className = "cfb-hint";
      hint.textContent = "1\uAC1C \uB354 \uC120\uD0DD\uD558\uC138\uC694";
      bar.appendChild(hint);
    }

    var clearBtn = document.createElement("button");
    clearBtn.className = "cfb-clear";
    clearBtn.textContent = "\uCD08\uAE30\uD654";
    clearBtn.addEventListener("click", function () { clearCompare(); renderCompareBar(); });
    bar.appendChild(clearBtn);

    document.body.appendChild(bar);
  }

  /* ── 비교 모달 (2~5개 단지) ── */
  function showCompareModal(items) {
    if (!items || items.length < 2) return;

    var old = document.getElementById("detail-modal");
    if (old) old.remove();

    var overlay = document.createElement("div");
    overlay.id = "detail-modal";
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });

    var modal = document.createElement("div");
    modal.className = "modal-content";
    modal.style.maxWidth = "800px";

    var closeBtn = document.createElement("button");
    closeBtn.className = "modal-close";
    closeBtn.textContent = "\u2715";
    closeBtn.addEventListener("click", function () { overlay.remove(); });
    modal.appendChild(closeBtn);

    var title = document.createElement("h2");
    title.className = "modal-title";
    title.textContent = items.length + "\uAC1C \uB2E8\uC9C0 \uBE44\uAD50";
    modal.appendChild(title);

    var body = document.createElement("div");
    body.className = "modal-body";
    body.textContent = "\uB85C\uB529 \uC911...";
    modal.appendChild(body);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var colors = CMP_COLORS.slice(0, items.length);
    Promise.all(items.map(function (c) {
      return fetch("data/apt_trade/by_apt/" + c.id + ".json")
        .then(function (res) { return res.ok ? res.json() : []; })
        .then(function (raw) { return Array.isArray(raw) ? raw : (raw && raw.trades ? raw.trades : []); })
        .then(function (history) {
          return { name: c.apt_name, history: history, region: c.sigungu + " " + c.dong_name };
        });
    }))
    .then(function (seriesList) {
      body.innerHTML = "";

      /* 범례 (차트 위) */
      var legend = document.createElement("div");
      legend.className = "compare-legend";
      legend.style.marginBottom = "12px";
      seriesList.forEach(function (s, idx) {
        var item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = '<span class="legend-color" style="background:' + colors[idx] + '"></span>'
          + s.name + " \u00B7 " + s.region;
        legend.appendChild(item);
      });
      body.appendChild(legend);

      /* 차트 */
      if (seriesList.some(function (s) { return s.history.length > 1; })) {
        var chartDiv = document.createElement("div");
        chartDiv.className = "scatter-chart modal-chart";
        var canvas = document.createElement("canvas");
        chartDiv.appendChild(canvas);
        body.appendChild(chartDiv);
        requestAnimationFrame(function () {
          if (typeof drawMultiScatter === "function") drawMultiScatter(canvas, seriesList);
        });
      }

      /* 지표 비교 테이블 */
      seriesList.forEach(function (s) {
        if (!s.history.length) { s._stats = {}; return; }
        var ps = s.history.map(function (h) { return h[1]; });
        s._stats = {
          last: s.history[s.history.length - 1][1],
          lastDate: s.history[s.history.length - 1][0],
          max: Math.max.apply(null, ps),
          min: Math.min.apply(null, ps),
          count: s.history.length,
          vsPeak: ((s.history[s.history.length - 1][1] / Math.max.apply(null, ps) - 1) * 100).toFixed(1)
        };
      });

      function fmtN(v) { return new Intl.NumberFormat("ko-KR").format(v); }

      var tableWrap = document.createElement("div");
      tableWrap.style.cssText = "overflow-x:auto;margin-top:16px;-webkit-overflow-scrolling:touch";
      var table = document.createElement("table");
      table.className = "modal-table";

      /* thead */
      var thead = document.createElement("thead");
      var headTr = document.createElement("tr");
      headTr.innerHTML = "<th>\uC9C0\uD45C</th>";
      seriesList.forEach(function (s, idx) {
        var th = document.createElement("th");
        th.style.color = colors[idx];
        th.textContent = s.name;
        headTr.appendChild(th);
      });
      thead.appendChild(headTr);
      table.appendChild(thead);

      /* tbody */
      var tbody = document.createElement("tbody");
      var metrics = [
        ["\uCD5C\uADFC \uAC70\uB798\uAC00", function (s) { return s._stats.last ? fmtN(s._stats.last) + "\uB9CC" : "-"; }],
        ["\uCD5C\uADFC \uAC70\uB798\uC77C", function (s) { return s._stats.lastDate || "-"; }],
        ["\uCD5C\uACE0\uAC00", function (s) { return s._stats.max ? fmtN(s._stats.max) + "\uB9CC" : "-"; }],
        ["\uCD5C\uC800\uAC00", function (s) { return s._stats.min ? fmtN(s._stats.min) + "\uB9CC" : "-"; }],
        ["\uACE0\uC810 \uB300\uBE44", function (s) { return s._stats.vsPeak ? s._stats.vsPeak + "%" : "-"; }],
        ["\uAC70\uB798\uAC74\uC218", function (s) { return s._stats.count ? s._stats.count + "\uAC74" : "-"; }]
      ];
      metrics.forEach(function (m) {
        var tr = document.createElement("tr");
        var td0 = document.createElement("td");
        td0.textContent = m[0];
        tr.appendChild(td0);
        seriesList.forEach(function (s) {
          var td = document.createElement("td");
          td.textContent = m[1](s);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      body.appendChild(tableWrap);

      track("compare_view", { count: items.length, apts: items.map(function (i) { return i.apt_name; }).join(",") });
    })
    .catch(function () {
      body.textContent = "\uC774\uB825 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
    });
  }

  /* ── init ── */
  document.addEventListener("DOMContentLoaded", function () {
    updateBadge();
    renderCompareBar();
  });
  document.addEventListener("watchlist-change", updateBadge);
  document.addEventListener("compare-change", renderCompareBar);

  return {
    getList: getList, add: add, remove: remove, has: has, count: count,
    getCompare: getCompare, addCompare: addCompare,
    removeCompare: removeCompare, clearCompare: clearCompare,
    hasCompare: hasCompare,
    renderCompareBar: renderCompareBar,
    showCompareModal: showCompareModal,
    updateBadge: updateBadge,
    track: track
  };
})();

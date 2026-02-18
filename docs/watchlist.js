/* APT Mine - 관심목록 / 비교 공통 모듈 v1 */
var APTWatchlist = (function () {
  var WL_KEY = "aptmine_watchlist";
  var CMP_KEY = "aptmine_compare";
  var MAX_WL = 50;
  var MAX_CMP = 2;

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
    label.textContent = "\uBE44\uAD50 (" + list.length + "/2)";
    bar.appendChild(label);

    list.forEach(function (item, idx) {
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

    if (list.length === MAX_CMP) {
      var goBtn = document.createElement("button");
      goBtn.className = "go-btn";
      goBtn.textContent = "\uBE44\uAD50 \uCC28\uD2B8 \uBCF4\uAE30";
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

  /* ── 비교 모달 (어디서든 호출 가능) ── */
  function showCompareModal(items) {
    if (!items || items.length !== 2) return;

    var old = document.getElementById("detail-modal");
    if (old) old.remove();

    var overlay = document.createElement("div");
    overlay.id = "detail-modal";
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });

    var modal = document.createElement("div");
    modal.className = "modal-content";

    var closeBtn = document.createElement("button");
    closeBtn.className = "modal-close";
    closeBtn.textContent = "\u2715";
    closeBtn.addEventListener("click", function () { overlay.remove(); });
    modal.appendChild(closeBtn);

    var title = document.createElement("h2");
    title.className = "modal-title";
    title.textContent = "A vs B \uBE44\uAD50";
    modal.appendChild(title);

    var sub = document.createElement("p");
    sub.className = "modal-sub";
    sub.textContent = items[0].apt_name + " vs " + items[1].apt_name;
    modal.appendChild(sub);

    var body = document.createElement("div");
    body.className = "modal-body";
    body.textContent = "\uB85C\uB529 \uC911...";
    modal.appendChild(body);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var colors = ["#2563eb", "#ef4444"];
    Promise.all(items.map(function (c) {
      return fetch("data/apt_trade/by_apt/" + c.id + ".json")
        .then(function (res) { return res.ok ? res.json() : []; })
        .then(function (history) {
          return { name: c.apt_name, history: history, region: c.sigungu + " " + c.dong_name };
        });
    }))
    .then(function (seriesList) {
      body.innerHTML = "";

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

      var legend = document.createElement("div");
      legend.className = "compare-legend";
      legend.style.marginBottom = "16px";
      seriesList.forEach(function (s, idx) {
        var item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = '<span class="legend-color" style="background:' + colors[idx] + '"></span>'
          + s.name + " \u00B7 " + s.region;
        legend.appendChild(item);
      });
      body.appendChild(legend);

      /* 지표 비교 테이블 */
      var rows = [];
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

      var table = document.createElement("table");
      table.className = "modal-table";
      table.innerHTML = "<thead><tr><th>\uC9C0\uD45C</th><th>" + seriesList[0].name + "</th><th>" + seriesList[1].name + "</th></tr></thead>";
      var tbody = document.createElement("tbody");

      var metrics = [
        ["\uCD5C\uADFC \uAC70\uB798\uAC00", function (s) { return fmtN(s._stats.last) + "\uB9CC"; }],
        ["\uCD5C\uADFC \uAC70\uB798\uC77C", function (s) { return s._stats.lastDate || "-"; }],
        ["\uCD5C\uACE0\uAC00", function (s) { return fmtN(s._stats.max) + "\uB9CC"; }],
        ["\uCD5C\uC800\uAC00", function (s) { return fmtN(s._stats.min) + "\uB9CC"; }],
        ["\uACE0\uC810 \uB300\uBE44", function (s) { return s._stats.vsPeak + "%"; }],
        ["\uAC70\uB798\uAC74\uC218", function (s) { return s._stats.count + "\uAC74"; }]
      ];
      metrics.forEach(function (m) {
        var tr = document.createElement("tr");
        tr.innerHTML = "<td>" + m[0] + "</td><td>" + m[1](seriesList[0]) + "</td><td>" + m[1](seriesList[1]) + "</td>";
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);

      track("compare_view", { apt_a: items[0].apt_name, apt_b: items[1].apt_name });
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

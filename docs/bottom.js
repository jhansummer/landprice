/* APT Mine - 바닥 근처 단지 찾기 */
var bottomIndexPath = "data/apt_trade/bottom/index.json";
var bottomBase = "data/apt_trade/bottom/";
var byAptBase = "data/apt_trade/by_apt/";

var tabsEl = document.getElementById("tabs");
var contentEl = document.getElementById("content");
var statusEl = document.getElementById("status");

var globalIndex = null;
var sidoCache = {};
var activeSido = null;
var activeDistrict = null;
var activeView = "bottom";
var activeSort = "vs_peak";
var txnCache = {};

var RECOVERY_STATUS = {
  recovered: { label: "상승", color: "#2563eb", bgColor: "#dbeafe", textColor: "#1e40af" },
  rising:    { label: "회복", color: "#16a34a", bgColor: "#dcfce7", textColor: "#166534" },
  flat:      { label: "횡보", color: "#94a3b8", bgColor: "#f1f5f9", textColor: "#64748b" },
  falling:   { label: "하락", color: "#ef4444", bgColor: "#fef2f2", textColor: "#dc2626" }
};

function fmt(v) { return new Intl.NumberFormat("ko-KR").format(v); }

function fmtEok(v) {
  if (v >= 10000) return (v / 10000).toFixed(1) + "\uC5B5";
  return fmt(Math.round(v)) + "\uB9CC";
}

function escapeHTML(s) {
  var d = document.createElement("div");
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}

/* ── 시도 탭 ── */
function renderTabs(sidoOrder) {
  tabsEl.innerHTML = "";
  tabsEl.setAttribute("role", "tablist");
  var label = document.createElement("span");
  label.className = "region-label";
  label.textContent = "\uC9C0\uC5ED";
  tabsEl.appendChild(label);
  sidoOrder.forEach(function (sido) {
    var btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", sido === activeSido ? "true" : "false");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      activeDistrict = null;
      renderTabs(sidoOrder);
      loadAndRender();
      history.replaceState(null, "", "#" + sido);
      APTWatchlist.track("tab_switch", { sido: sido, page: "bottom" });
    });
    tabsEl.appendChild(btn);
  });
}

/* ── 구/시 드롭다운 + 뷰 토글 ── */
function renderControls() {
  var wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:center;gap:12px;padding:12px 24px;flex-wrap:wrap";

  var data = sidoCache[activeSido];
  if (data && data.district_order && data.district_order.length > 1) {
    var sel = document.createElement("select");
    sel.className = "district-select";
    var allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "\uC804\uCCB4";
    sel.appendChild(allOpt);
    data.district_order.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      if (d === activeDistrict) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
      activeDistrict = sel.value || null;
      renderSections();
    });
    wrap.appendChild(sel);
  }

  // 뷰 토글
  var viewWrap = document.createElement("div");
  viewWrap.className = "sort-btns";
  [["bottom", "\uBC14\uB2E5 \uADFC\uCC98"], ["turning", "\uBC18\uB4F1 \uC870\uC9D0"]].forEach(function (pair) {
    var btn = document.createElement("button");
    btn.className = "sort-btn" + (activeView === pair[0] ? " active" : "");
    btn.textContent = pair[1];
    btn.addEventListener("click", function () {
      activeView = pair[0];
      renderSections();
    });
    viewWrap.appendChild(btn);
  });
  wrap.appendChild(viewWrap);

  return wrap;
}

/* ── 정렬 버튼 ── */
function renderSortBar() {
  var wrap = document.createElement("div");
  wrap.className = "sort-btns";
  wrap.style.marginBottom = "12px";
  var sorts = [
    ["vs_peak", "\uACE0\uC810\uB300\uBE44\uC21C"],
    ["chg3m", "3\uAC1C\uC6D4\uBCC0\uB3D9\uC21C"],
    ["chg6m", "6\uAC1C\uC6D4\uBCC0\uB3D9\uC21C"],
    ["trades", "\uAC70\uB798\uB7C9\uC21C"]
  ];
  sorts.forEach(function (pair) {
    var btn = document.createElement("button");
    btn.className = "sort-btn" + (activeSort === pair[0] ? " active" : "");
    btn.textContent = pair[1];
    btn.addEventListener("click", function () {
      activeSort = pair[0];
      renderSections();
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

/* ── 아파트 카드 ── */
function renderCard(apt, idx) {
  var card = document.createElement("div");
  card.className = "rank-card";
  card.style.cursor = "pointer";

  // 순위
  var num = document.createElement("div");
  num.className = "rank-num" + (idx < 3 ? " n" + (idx + 1) : "");
  num.textContent = idx + 1;
  card.appendChild(num);

  var body = document.createElement("div");
  body.style.flex = "1";

  var top = document.createElement("div");
  top.className = "rank-top";

  // 왼쪽: 단지 정보
  var info = document.createElement("div");
  info.style.flex = "1";
  var nameDiv = document.createElement("div");
  nameDiv.className = "rank-apt";
  nameDiv.textContent = apt.apt_name;
  info.appendChild(nameDiv);

  var detail = document.createElement("div");
  detail.className = "rank-detail";
  detail.textContent = apt.sigungu + " " + apt.dong_name + " \u00B7 " + apt.area_m2 + "m\u00B2 \u00B7 " + apt.trades + "\uAC74";
  var st = RECOVERY_STATUS[apt.status] || RECOVERY_STATUS.flat;
  var badge = document.createElement("span");
  badge.className = "tag";
  badge.style.cssText = "background:" + st.bgColor + ";color:" + st.textColor;
  badge.textContent = st.label;
  detail.appendChild(badge);
  info.appendChild(detail);
  top.appendChild(info);

  // 오른쪽: 지표
  var metrics = document.createElement("div");
  metrics.className = "rank-change";
  var pctDiv = document.createElement("div");
  pctDiv.className = "rank-pct";
  pctDiv.style.color = apt.vs_peak >= 0 ? "#2563eb" : "#ef4444";
  pctDiv.textContent = "\uACE0\uC810\uB300\uBE44 " + apt.vs_peak + "%";
  metrics.appendChild(pctDiv);
  var diffDiv = document.createElement("div");
  diffDiv.className = "rank-diff";
  diffDiv.textContent = "3\uAC1C\uC6D4 " + (apt.chg3m >= 0 ? "+" : "") + apt.chg3m + "% \u00B7 6\uAC1C\uC6D4 " + (apt.chg6m >= 0 ? "+" : "") + apt.chg6m + "%";
  metrics.appendChild(diffDiv);

  // 관심 버튼
  var wlBtn = document.createElement("button");
  wlBtn.className = "sort-btn";
  wlBtn.style.cssText = "margin-top:4px;font-size:10px";
  wlBtn.textContent = APTWatchlist.has(apt.id) ? "\u2605 \uAD00\uC2EC" : "\u2606 \uAD00\uC2EC";
  wlBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (APTWatchlist.has(apt.id)) {
      APTWatchlist.remove(apt.id);
      wlBtn.textContent = "\u2606 \uAD00\uC2EC";
    } else {
      APTWatchlist.add({ id: apt.id, apt_name: apt.apt_name, sigungu: apt.sigungu, dong_name: apt.dong_name, area_m2: apt.area_m2 });
      wlBtn.textContent = "\u2605 \uAD00\uC2EC";
    }
  });
  metrics.appendChild(wlBtn);
  top.appendChild(metrics);
  body.appendChild(top);

  // 가격 바
  var barWrap = document.createElement("div");
  barWrap.style.cssText = "margin-top:8px;background:#f1f5f9;border-radius:4px;height:6px;position:relative";
  var ratio = apt.peak > 0 ? Math.min(apt.price / apt.peak * 100, 100) : 0;
  var bar = document.createElement("div");
  bar.style.cssText = "height:100%;border-radius:4px;background:" + st.color + ";width:" + ratio + "%";
  barWrap.appendChild(bar);
  body.appendChild(barWrap);
  var barLabel = document.createElement("div");
  barLabel.style.cssText = "display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:2px";
  barLabel.innerHTML = "<span>\uD604\uC7AC " + apt.price.toFixed(0) + "\uB9CC/m\u00B2</span><span>\uACE0\uC810 " + apt.peak.toFixed(0) + "\uB9CC/m\u00B2 (" + apt.peak_ym.slice(0,4) + "." + apt.peak_ym.slice(4) + ")</span>";
  body.appendChild(barLabel);

  card.appendChild(body);

  // 클릭시 차트 토글
  card.addEventListener("click", function () {
    toggleChart(card, apt.id);
  });

  return card;
}

/* ── 차트 토글 ── */
async function toggleChart(card, aptId) {
  var existing = card.querySelector(".bottom-chart-panel");
  if (existing) { existing.remove(); return; }

  var panel = document.createElement("div");
  panel.className = "bottom-chart-panel";
  panel.style.cssText = "margin-top:12px;padding:12px;background:var(--bg);border-radius:var(--radius-sm)";
  panel.addEventListener("click", function (e) { e.stopPropagation(); });

  var loading = document.createElement("div");
  loading.style.cssText = "text-align:center;color:var(--muted);font-size:12px;padding:20px";
  loading.textContent = "\uCC28\uD2B8 \uB85C\uB529 \uC911...";
  panel.appendChild(loading);
  card.appendChild(panel);

  try {
    if (!txnCache[aptId]) {
      var res = await fetch(byAptBase + aptId + ".json?t=" + Date.now());
      txnCache[aptId] = res.ok ? await res.json() : [];
    }
    var txns = txnCache[aptId];
    if (!txns.length) {
      loading.textContent = "\uAC70\uB798 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
      return;
    }
    txns.sort(function (a, b) { return new Date(a[0]).getTime() - new Date(b[0]).getTime(); });
    loading.remove();
    var chartDiv = document.createElement("div");
    chartDiv.className = "scatter-chart";
    chartDiv.style.height = "180px";
    var canvas = document.createElement("canvas");
    chartDiv.appendChild(canvas);
    panel.appendChild(chartDiv);
    requestAnimationFrame(function () {
      if (typeof drawScatter === "function") {
        drawScatter(canvas, txns);
      }
    });

    // 단지분석 링크
    var link = document.createElement("a");
    link.href = "valuation.html#?q=" + encodeURIComponent(card.querySelector(".rank-apt").textContent);
    link.style.cssText = "display:block;text-align:center;margin-top:8px;font-size:12px;color:var(--accent)";
    link.textContent = "\uB2E8\uC9C0\uBD84\uC11D\uC5D0\uC11C \uC790\uC138\uD788 \uBCF4\uAE30 \u2192";
    panel.appendChild(link);
  } catch (e) {
    loading.textContent = "\uCC28\uD2B8\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
  }
}

/* ── 메인 렌더 ── */
function renderSections() {
  contentEl.innerHTML = "";
  if (!activeSido || !sidoCache[activeSido]) return;
  var data = sidoCache[activeSido];

  // 컨트롤바
  contentEl.appendChild(renderControls());

  var items;
  var title, subtitle;
  if (activeView === "turning") {
    items = (data.turning || []).slice();
    title = activeSido + " \uBC18\uB4F1 \uC870\uC9D0 \uB2E8\uC9C0";
    subtitle = "\uACE0\uC810 \uB300\uBE44 -10% \uC774\uC0C1 \uD558\uB77D + \uCD5C\uADFC 3\uAC1C\uC6D4 \uC0C1\uC2B9 \uC804\uD658";
  } else {
    items = (data.items || []).slice();
    title = activeSido + " \uBC14\uB2E5 \uADFC\uCC98 \uB2E8\uC9C0";
    subtitle = "2021~2022 \uC804\uACE0\uC810 \uB300\uBE44 \uAC00\uC7A5 \uB9CE\uC774 \uD558\uB77D\uD55C \uB2E8\uC9C0 \u00B7 \uAC70\uB798 15\uAC74 \uC774\uC0C1 \u00B7 \uAC19\uC740 \uB2E8\uC9C0 \uAC19\uC740 \uD3C9\uC218 \uAE30\uC900";
  }

  // 구 필터
  if (activeDistrict) {
    items = items.filter(function (a) { return a.district === activeDistrict; });
  }

  // 정렬
  if (activeSort === "vs_peak") items.sort(function (a, b) { return a.vs_peak - b.vs_peak; });
  else if (activeSort === "chg3m") items.sort(function (a, b) { return b.chg3m - a.chg3m; });
  else if (activeSort === "chg6m") items.sort(function (a, b) { return b.chg6m - a.chg6m; });
  else if (activeSort === "trades") items.sort(function (a, b) { return b.trades - a.trades; });

  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = subtitle;
  sec.appendChild(sub);

  sec.appendChild(renderSortBar());

  if (!items.length) {
    var empty = document.createElement("p");
    empty.style.cssText = "text-align:center;color:var(--muted);padding:40px 0";
    empty.textContent = "\uD574\uB2F9\uD558\uB294 \uB2E8\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
    sec.appendChild(empty);
    contentEl.appendChild(sec);
    return;
  }

  var count = document.createElement("p");
  count.style.cssText = "font-size:12px;color:var(--muted);margin-bottom:8px";
  count.textContent = "\uCD1D " + items.length + "\uAC1C \uB2E8\uC9C0";
  sec.appendChild(count);

  var list = document.createElement("div");
  var INITIAL = 20;
  items.slice(0, INITIAL).forEach(function (apt, i) {
    list.appendChild(renderCard(apt, i));
  });
  sec.appendChild(list);

  if (items.length > INITIAL) {
    var moreBtn = document.createElement("button");
    moreBtn.className = "sort-btn";
    moreBtn.style.cssText = "display:block;margin:12px auto 0;padding:8px 24px";
    moreBtn.textContent = "\uB354\uBCF4\uAE30 (" + items.length + "\uAC1C \uC804\uCCB4)";
    moreBtn.addEventListener("click", function () {
      var h = list.offsetHeight;
      items.slice(INITIAL).forEach(function (apt, i) {
        list.appendChild(renderCard(apt, INITIAL + i));
      });
      list.style.maxHeight = (h + 80) + "px";
      list.style.overflowY = "auto";
      moreBtn.remove();
    });
    sec.appendChild(moreBtn);
  }

  contentEl.appendChild(sec);
}

/* ── 데이터 로드 ── */
async function loadAndRender() {
  if (!activeSido) return;
  if (sidoCache[activeSido]) {
    renderSections();
    return;
  }
  statusEl.innerHTML = '<span class="spinner"></span> \uB370\uC774\uD130 \uB85C\uB529 \uC911...';
  try {
    var res = await fetch(bottomBase + activeSido + ".json?t=" + Date.now());
    if (!res.ok) throw new Error("fetch failed");
    sidoCache[activeSido] = await res.json();
    statusEl.innerHTML = "";
    renderSections();
  } catch (e) {
    statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
  }
}

/* ── 초기화 ── */
async function init() {
  try {
    var res = await fetch(bottomIndexPath + "?t=" + Date.now());
    if (!res.ok) throw new Error("fetch failed");
    globalIndex = await res.json();
    var sidoOrder = globalIndex.sido_order || [];
    if (!sidoOrder.length) {
      statusEl.textContent = "\uB370\uC774\uD130\uAC00 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4.";
      return;
    }
    var hash = decodeURIComponent(location.hash.replace("#", ""));
    activeSido = sidoOrder.indexOf(hash) >= 0 ? hash : sidoOrder[0];
    renderTabs(sidoOrder);
    loadAndRender();
  } catch (e) {
    statusEl.textContent = "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
  }
}

init();

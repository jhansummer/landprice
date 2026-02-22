const summaryPath = "data/apt_trade/summary.json";
const GEO_PATH = "data/apt_trade/valuation_geo.json";

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const tabsEl = document.getElementById("tabs");
const subtabsEl = document.getElementById("subtabs");
// filtersEl removed - nav is now hardcoded in HTML

let globalData = null;
let activeSido = null;
let activeDistrict = null;
let activeDong = null;
var geoCache = null;

var fmt = APTCommon.fmt;

function calcChangeBadge(history, latestPrice) {
  if (!history || history.length < 2 || !latestPrice) return null;
  var prevPrice = history[history.length - 2][1];
  if (!prevPrice) return null;
  return ((latestPrice / prevPrice) - 1) * 100;
}

function renderTabs(sidoOrder) {
  APTCommon.renderTabs(tabsEl, sidoOrder, activeSido, function (sido) {
    activeSido = sido;
    activeDistrict = null;
    activeDong = null;
    renderTabs(sidoOrder);
    renderSubTabs();
    renderSections();
    history.replaceState(null, "", "#" + sido);
    APTWatchlist.track("tab_switch", { sido: sido, page: "main" });
  });
}

function renderRankedItem(r, idx) {
  var card = document.createElement("div");
  card.className = "rank-card";

  // Rank number
  var num = document.createElement("span");
  var nClass = idx < 3 ? " n" + (idx + 1) : "";
  num.className = "rank-num" + nClass;
  num.textContent = idx + 1;
  card.appendChild(num);

  // Content area
  var content = document.createElement("div");

  // Top row: info + change
  var top = document.createElement("div");
  top.className = "rank-top";

  var info = document.createElement("div");
  info.className = "rank-info";
  var aptEl = document.createElement("a");
  aptEl.className = "rank-apt";
  aptEl.textContent = r.apt_name;
  aptEl.href = "https://map.kakao.com/?q=" + encodeURIComponent(r.sigungu + " " + r.dong_name + " " + r.apt_name);
  aptEl.target = "_blank";
  aptEl.rel = "noopener";
  aptEl.addEventListener("click", function (e) { e.stopPropagation(); });
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
  // 직거래 / 저층 태그
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
  // 직전 거래 대비 등락률 뱃지
  var prevChg = calcChangeBadge(r.history, r.latest_price);
  if (prevChg !== null) {
    var chgTag = document.createElement("span");
    chgTag.className = "tag " + (prevChg >= 0 ? "tag-change-up" : "tag-change-down");
    chgTag.textContent = "\uC9C1\uC804 " + (prevChg >= 0 ? "+" : "") + prevChg.toFixed(1) + "%";
    detail.appendChild(chgTag);
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
  // CTA 버튼 그룹
  var ctaGroup = document.createElement("div");
  ctaGroup.className = "cta-group";

  if (r.id) {
    var aptLink = document.createElement("a");
    aptLink.className = "apt-detail-link";
    aptLink.href = "apt.html?id=" + encodeURIComponent(r.id) + "&s=" + encodeURIComponent(activeSido || "");
    aptLink.textContent = "\uC0C1\uC138";
    aptLink.addEventListener("click", function (e) { e.stopPropagation(); });
    ctaGroup.appendChild(aptLink);

    var cmpBtn = document.createElement("button");
    cmpBtn.className = "detail-btn";
    cmpBtn.textContent = APTWatchlist.hasCompare(r.id) ? "\uCD94\uAC00\uB428" : "\uBE44\uAD50\uCD94\uAC00";
    if (APTWatchlist.hasCompare(r.id)) { cmpBtn.style.borderColor = "var(--accent)"; cmpBtn.style.color = "var(--accent)"; }
    cmpBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var added = APTWatchlist.addCompare({ id: r.id, apt_name: r.apt_name, area_m2: r.area_m2, sigungu: r.sigungu, dong_name: r.dong_name });
      if (added) { cmpBtn.textContent = "\uCD94\uAC00\uB428"; cmpBtn.style.borderColor = "var(--accent)"; cmpBtn.style.color = "var(--accent)"; }
      else if (!APTWatchlist.hasCompare(r.id)) { alert("\uBE44\uAD50\uB294 \uCD5C\uB300 5\uAC1C\uAE4C\uC9C0 \uAC00\uB2A5\uD569\uB2C8\uB2E4."); }
      APTWatchlist.track("add_to_compare", { apt_name: r.apt_name, page: "main" });
    });
    ctaGroup.appendChild(cmpBtn);

    var watchBtn = document.createElement("button");
    watchBtn.className = "detail-btn";
    var isW = APTWatchlist.has(r.id);
    watchBtn.textContent = isW ? "\uAD00\uC2EC\uD574\uC81C" : "\uAD00\uC2EC";
    if (isW) { watchBtn.style.background = "var(--accent-soft)"; watchBtn.style.color = "var(--accent)"; watchBtn.style.borderColor = "var(--accent)"; }
    watchBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (APTWatchlist.has(r.id)) {
        APTWatchlist.remove(r.id);
        watchBtn.textContent = "\uAD00\uC2EC";
        watchBtn.style.background = ""; watchBtn.style.color = ""; watchBtn.style.borderColor = "";
      } else {
        APTWatchlist.add({ id: r.id, apt_name: r.apt_name, area_m2: r.area_m2, sigungu: r.sigungu, dong_name: r.dong_name, latest_price: r.latest_price, pct: r.pct });
        watchBtn.textContent = "\uAD00\uC2EC\uD574\uC81C";
        watchBtn.style.background = "var(--accent-soft)"; watchBtn.style.color = "var(--accent)"; watchBtn.style.borderColor = "var(--accent)";
      }
      APTWatchlist.track("add_to_watchlist", { apt_name: r.apt_name, page: "main" });
    });
    ctaGroup.appendChild(watchBtn);
  }

  changeEl.appendChild(ctaGroup);
  top.appendChild(changeEl);

  content.appendChild(top);

  // Scatter chart
  if (r.history && r.history.length > 1) {
    var chartDiv = document.createElement("div");
    chartDiv.className = "scatter-chart";
    var canvas = document.createElement("canvas");
    chartDiv.appendChild(canvas);
    content.appendChild(chartDiv);

    // Draw after DOM insertion
    requestAnimationFrame(function () {
      drawScatter(canvas, r.history);
    });
  }

  card.appendChild(content);

  // section3 항목 (id 있음): 클릭 시 상세 이력 팝업
  if (r.id) {
    card.style.cursor = "pointer";
    card.addEventListener("click", function () {
      showDetail(r);
    });
  }

  return card;
}


function renderSection(sectionData) {
  var sec = document.createElement("div");
  sec.className = "section";

  var title = document.createElement("h2");
  title.className = "section-title";
  title.textContent = sectionData.title;
  sec.appendChild(title);

  if (sectionData.month) {
    var sub = document.createElement("p");
    sub.className = "section-sub";
    sub.textContent = sectionData.month.slice(0, 4) + "\uB144 " + parseInt(sectionData.month.slice(4), 10) + "\uC6D4 \uAE30\uC900";
    sec.appendChild(sub);
  }
  if (sectionData.date) {
    var sub = document.createElement("p");
    sub.className = "section-sub";
    sub.textContent = sectionData.date + " \uAE30\uC900";
    sec.appendChild(sub);
  }

  var top3 = sectionData.top3 || [];
  if (!top3.length) {
    var p = document.createElement("p");
    p.className = "no-data";
    p.textContent = "\uBE44\uAD50 \uAC00\uB2A5\uD55C \uC0C1\uC2B9 \uAC70\uB798 \uC5C6\uC74C";
    sec.appendChild(p);
    return sec;
  }

  top3.forEach(function (r, i) {
    sec.appendChild(renderRankedItem(r, i));
  });

  return sec;
}

function renderSubTabs() {
  if (!globalData || !activeSido) { subtabsEl.innerHTML = ""; return; }
  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) { subtabsEl.innerHTML = ""; return; }
  APTCommon.renderSubTabs(subtabsEl, sidoData.district_order, activeSido, activeDistrict, function (district) {
    activeDistrict = district;
    activeDong = null;
    renderSections();
    var hash = activeSido;
    if (activeDistrict) hash += "/" + activeDistrict;
    history.replaceState(null, "", "#" + hash);
    APTWatchlist.track("district_select", { sido: activeSido, district: activeDistrict || "all", page: "main" });
  });
}

// renderFilters removed - nav is now hardcoded in HTML

/* ── 저평가 / 바닥찾기 데이터 캐시 ── */
var undervaluedCache = null;
var bottomCache = {};

function fetchUndervalued() {
  if (undervaluedCache) return Promise.resolve(undervaluedCache);
  return fetch("data/apt_trade/undervalued.json?t=" + Date.now())
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) { undervaluedCache = d; return d; })
    .catch(function() { return null; });
}

function fmtEok(v) {
  return (v / 10000).toFixed(2) + "\uC5B5";
}

function fetchBottom(sido) {
  if (bottomCache[sido]) return Promise.resolve(bottomCache[sido]);
  return fetch("data/apt_trade/bottom/" + encodeURIComponent(sido) + ".json?t=" + Date.now())
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) { bottomCache[sido] = d; return d; })
    .catch(function() { return null; });
}

function renderAnalysisCard(item, idx, type) {
  var card = document.createElement("div");
  card.className = "analysis-card";

  var head = document.createElement("div");
  head.className = "analysis-card-head";
  var rank = document.createElement("span");
  rank.className = "analysis-card-rank" + (idx < 3 ? " n" + (idx + 1) : "");
  rank.textContent = "#" + (idx + 1);
  head.appendChild(rank);
  var name = document.createElement("a");
  name.className = "analysis-card-name";
  name.textContent = item.apt_name;
  if (item.id) {
    name.href = "apt.html?id=" + encodeURIComponent(item.id) + "&s=" + encodeURIComponent(activeSido || "");
  }
  head.appendChild(name);

  var statusMap = { rising: "\uBC18\uB4F1", flat: "\uD69F\uBCF4", falling: "\uD558\uB77D" };
  var statusClass = item.status || "flat";
  var badge = document.createElement("span");
  badge.className = "analysis-badge badge-" + statusClass;
  badge.textContent = statusMap[statusClass] || statusClass;
  head.appendChild(badge);
  card.appendChild(head);

  var detail = document.createElement("div");
  detail.className = "analysis-card-detail";
  var priceVal = item.price || 0;
  var priceText = priceVal >= 10000 ? (priceVal / 10000).toFixed(1) + "\uC5B5" : Math.round(priceVal).toLocaleString() + "\uB9CC";
  detail.textContent = item.sigungu + " " + item.dong_name + " \u00B7 " + item.area_m2 + "m\u00B2 \u00B7 " + priceText;
  card.appendChild(detail);

  var metrics = document.createElement("div");
  metrics.className = "analysis-card-metrics";
  var vsPeak = item.vs_peak != null ? "\uACE0\uC810\uB300\uBE44 " + item.vs_peak.toFixed(0) + "%" : "";
  var chg3m = item.chg3m != null ? "3\uAC1C\uC6D4 " + (item.chg3m >= 0 ? "+" : "") + item.chg3m.toFixed(1) + "%" : "";
  metrics.innerHTML = '<span>' + vsPeak + '</span><span class="metric-sep">|</span><span>' + chg3m + '</span>';
  card.appendChild(metrics);

  // 바닥찾기 차트 (by_apt 데이터 로드 → drawPeakChart)
  if (item.id) {
    var chartWrap = document.createElement("div");
    chartWrap.style.cssText = "margin-top:8px";
    var canvas = document.createElement("canvas");
    canvas.className = "compare-chart";
    chartWrap.appendChild(canvas);
    card.appendChild(chartWrap);

    fetch("data/apt_trade/by_apt/" + item.id + ".json")
      .then(function(res) { return res.ok ? res.json() : []; })
      .then(function(txns) {
        if (txns.length > 1) {
          requestAnimationFrame(function() {
            drawPeakChart(canvas, txns, item);
          });
        }
      })
      .catch(function() {});
  }

  return card;
}

function renderUndervaluedCard(r, idx) {
  var card = document.createElement("div");
  card.className = "analysis-card";
  card.style.cursor = "pointer";

  var head = document.createElement("div");
  head.className = "analysis-card-head";
  var rank = document.createElement("span");
  rank.className = "analysis-card-rank" + (idx < 3 ? " n" + (idx + 1) : "");
  rank.textContent = "#" + (idx + 1);
  head.appendChild(rank);
  var name = document.createElement("a");
  name.className = "analysis-card-name";
  name.textContent = r.apt_name;
  if (r.id) {
    name.href = "apt.html?id=" + encodeURIComponent(r.id) + "&s=" + encodeURIComponent(activeSido || "");
  }
  name.addEventListener("click", function(e) { e.stopPropagation(); });
  head.appendChild(name);
  card.appendChild(head);

  var detail = document.createElement("div");
  detail.className = "analysis-card-detail";
  detail.textContent = r.sigungu + " " + r.dong_name + " \u00B7 " + r.area_m2 + "m\u00B2";
  card.appendChild(detail);

  var metrics = document.createElement("div");
  metrics.className = "analysis-card-metrics";
  var ratio6 = (r.recent_avg && r.compare_avg_recent)
    ? ((r.recent_avg / r.compare_avg_recent - 1) * 100)
    : null;
  var metricsHtml = "\uCD5C\uADFC6\uAC1C\uC6D4 " + fmtEok(r.recent_avg) + " \u00B7 \uBE44\uAD50\uD3C9\uADE0 " + fmtEok(r.compare_avg_recent);
  if (ratio6 !== null) {
    metricsHtml += ' <span class="pct-value">' + ratio6.toFixed(1) + '%</span>';
  }
  metrics.innerHTML = metricsHtml;
  card.appendChild(metrics);

  // 비교 차트 영역
  var chartWrap = document.createElement("div");
  chartWrap.style.cssText = "margin-top:8px";
  var canvas = document.createElement("canvas");
  canvas.className = "compare-chart";
  chartWrap.appendChild(canvas);
  var legend = document.createElement("div");
  legend.className = "compare-legend";
  chartWrap.appendChild(legend);
  card.appendChild(chartWrap);

  // 비교 차트 데이터 로드 및 렌더
  var ids = [r.id].concat((r.compare || []).map(function(c) { return c.id; }));
  var colors = ["#2563eb", "#ef4444", "#16a34a", "#f59e0b"];
  Promise.all(ids.map(function(id) {
    return fetch("data/apt_trade/by_apt/" + id + ".json")
      .then(function(res) { return res.ok ? res.json() : []; })
      .catch(function() { return []; });
  })).then(function(txnsList) {
    var seriesList = ids.map(function(id, i) {
      var meta = (i === 0) ? r : (r.compare || [])[i - 1];
      var txns = (txnsList[i] || []).slice().sort(function(a, b) {
        return new Date(a[0]).getTime() - new Date(b[0]).getTime();
      });
      var last = txns[txns.length - 1];
      return {
        name: meta ? meta.apt_name : id,
        history: txns,
        price: last ? last[1] : null,
        region: meta ? (meta.sigungu + " " + meta.dong_name) : ""
      };
    });
    requestAnimationFrame(function() {
      drawMultiScatter(canvas, seriesList);
    });
    seriesList.forEach(function(s, si) {
      var item = document.createElement("div");
      item.className = "legend-item";
      var dot = document.createElement("span");
      dot.className = "legend-color";
      dot.style.background = colors[si % colors.length];
      item.appendChild(dot);
      var label = document.createElement("span");
      var priceText = s.price ? fmtEok(s.price) : "-";
      label.textContent = s.name + " \u00B7 " + s.region + " \u00B7 \uCD5C\uADFC " + priceText;
      item.appendChild(label);
      legend.appendChild(item);
    });
  });

  return card;
}

function toggleCompareMain(card, r) {
  var existing = card.querySelector(".compare-panel");
  if (existing) { existing.remove(); return; }

  var panel = document.createElement("div");
  panel.className = "compare-panel";
  panel.addEventListener("click", function(e) { e.stopPropagation(); });

  var header = document.createElement("div");
  header.className = "compare-header";
  var title = document.createElement("div");
  title.className = "compare-title";
  title.textContent = "\uB2E8\uC9C0\uBCC4 \uC2DC\uC138 \uBE44\uAD50";
  header.appendChild(title);
  var closeBtn = document.createElement("button");
  closeBtn.className = "compare-close";
  closeBtn.textContent = "\uB2EB\uAE30";
  closeBtn.addEventListener("click", function(e) { e.stopPropagation(); panel.remove(); });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  var canvas = document.createElement("canvas");
  canvas.className = "compare-chart";
  panel.appendChild(canvas);

  var legend = document.createElement("div");
  legend.className = "compare-legend";
  panel.appendChild(legend);

  var loading = document.createElement("div");
  loading.className = "rank-detail";
  loading.textContent = "\uB85C\uB529 \uC911...";
  panel.appendChild(loading);

  card.appendChild(panel);

  var ids = [r.id].concat((r.compare || []).map(function(c) { return c.id; }));
  var colors = ["#2563eb", "#ef4444", "#16a34a", "#f59e0b"];

  Promise.all(ids.map(function(id) {
    return fetch("data/apt_trade/by_apt/" + id + ".json")
      .then(function(res) { return res.ok ? res.json() : []; })
      .catch(function() { return []; });
  })).then(function(txnsList) {
    loading.remove();
    var seriesList = ids.map(function(id, i) {
      var meta = (i === 0) ? r : (r.compare || [])[i - 1];
      var txns = (txnsList[i] || []).slice().sort(function(a, b) {
        return new Date(a[0]).getTime() - new Date(b[0]).getTime();
      });
      var last = txns[txns.length - 1];
      return {
        name: meta ? meta.apt_name : id,
        history: txns,
        price: last ? last[1] : null,
        region: meta ? (meta.sigungu + " " + meta.dong_name) : ""
      };
    });
    requestAnimationFrame(function() {
      drawMultiScatter(canvas, seriesList);
    });
    seriesList.forEach(function(s, idx) {
      var item = document.createElement("div");
      item.className = "legend-item";
      var dot = document.createElement("span");
      dot.className = "legend-color";
      dot.style.background = colors[idx % colors.length];
      item.appendChild(dot);
      var label = document.createElement("span");
      var priceText = s.price ? fmtEok(s.price) : "-";
      label.textContent = s.name + " \u00B7 " + s.region + " \u00B7 \uCD5C\uADFC " + priceText;
      item.appendChild(label);
      legend.appendChild(item);
    });
  });
}

/* ── 대시보드 (저평가 + 바닥찾기) ── */
function renderDashboard() {
  if (!activeSido) return;

  var grid = document.createElement("div");
  grid.className = "analysis-grid";

  // 저평가 섹션
  var uvSec = document.createElement("div");
  uvSec.className = "analysis-section";
  var uvTitle = document.createElement("a");
  uvTitle.className = "analysis-title";
  uvTitle.href = "undervalued.html#" + activeSido;
  uvTitle.innerHTML = '\uC800\uD3C9\uAC00 TOP3 <span class="analysis-arrow">\u203A</span>';
  uvSec.appendChild(uvTitle);
  var uvBody = document.createElement("div");
  uvBody.className = "analysis-body";
  uvBody.innerHTML = '<span class="spinner"></span>';
  uvSec.appendChild(uvBody);
  grid.appendChild(uvSec);

  // 바닥찾기 섹션
  var btSec = document.createElement("div");
  btSec.className = "analysis-section";
  var btTitle = document.createElement("a");
  btTitle.className = "analysis-title";
  btTitle.href = "bottom.html#" + activeSido;
  btTitle.innerHTML = '\uBC14\uB2E5\uCC3E\uAE30 TOP3 <span class="analysis-arrow">\u203A</span>';
  btSec.appendChild(btTitle);
  var btBody = document.createElement("div");
  btBody.className = "analysis-body";
  btBody.innerHTML = '<span class="spinner"></span>';
  btSec.appendChild(btBody);
  grid.appendChild(btSec);

  gridEl.appendChild(grid);

  // 데이터 로드
  fetchUndervalued().then(function(data) {
    uvBody.innerHTML = "";
    if (!data || !data.sidos || !data.sidos[activeSido]) {
      uvBody.innerHTML = '<p class="no-data">\uB370\uC774\uD130 \uC5C6\uC74C</p>';
      return;
    }
    var items = (data.sidos[activeSido].undervalued || []).slice(0, 3);
    if (!items.length) {
      uvBody.innerHTML = '<p class="no-data">\uB370\uC774\uD130 \uC5C6\uC74C</p>';
      return;
    }
    items.forEach(function(item, i) {
      uvBody.appendChild(renderUndervaluedCard(item, i));
    });
  });

  fetchBottom(activeSido).then(function(data) {
    btBody.innerHTML = "";
    if (!data || !data.items) {
      btBody.innerHTML = '<p class="no-data">\uB370\uC774\uD130 \uC5C6\uC74C</p>';
      return;
    }
    // 반등 신호 상위 3개: rising 우선, chg3m 높은 순
    var sorted = data.items.slice().sort(function(a, b) {
      var sa = a.status === "rising" ? 0 : 1;
      var sb = b.status === "rising" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (b.chg3m || 0) - (a.chg3m || 0);
    });
    var top3 = sorted.slice(0, 3);
    if (!top3.length) {
      btBody.innerHTML = '<p class="no-data">\uB370\uC774\uD130 \uC5C6\uC74C</p>';
      return;
    }
    top3.forEach(function(item, i) {
      btBody.appendChild(renderAnalysisCard(item, i, "bottom"));
    });
  });
}

/* ── 인기 지역 렌더링 ── */
function renderPopularDistricts() {
  if (!globalData || !activeSido) return null;
  var sidoData = globalData.sidos[activeSido];
  if (!sidoData || !sidoData.districts) return null;

  var distOrder = sidoData.district_order || Object.keys(sidoData.districts);
  var distStats = [];
  distOrder.forEach(function(distName) {
    var dist = sidoData.districts[distName];
    if (!dist || !dist.dong_stats) return;
    var totalCount = 0, totalPrice = 0;
    dist.dong_stats.forEach(function(d) {
      totalCount += d.txn_count;
      totalPrice += d.avg_per_m2 * d.txn_count;
    });
    if (totalCount === 0) return;
    distStats.push({ name: distName, avg_per_m2: Math.round(totalPrice / totalCount), txn_count: totalCount });
  });
  distStats.sort(function(a, b) { return b.txn_count - a.txn_count; });
  var top5 = distStats.slice(0, 5);

  if (!top5.length) return null;

  var popularSec = document.createElement("div");
  popularSec.className = "section";
  var ptitle = document.createElement("h2");
  ptitle.className = "section-title";
  ptitle.textContent = "\uC778\uAE30 \uC9C0\uC5ED";
  popularSec.appendChild(ptitle);
  var plist = document.createElement("div");
  plist.className = "popular-list";
  top5.forEach(function(d) {
    var item = document.createElement("a");
    item.className = "popular-item";
    item.href = "regional.html#" + activeSido + "/" + d.name;
    item.innerHTML = '<span class="popular-name">' + d.name + '</span>'
      + '<span class="popular-meta">' + d.txn_count + '\uAC74 \u00B7 m\u00B2\uB2F9 ' + d.avg_per_m2.toLocaleString() + '\uB9CC</span>';
    plist.appendChild(item);
  });
  popularSec.appendChild(plist);
  return popularSec;
}

function renderSections() {
  gridEl.innerHTML = "";
  var dashEl = document.getElementById("dashboard");
  if (dashEl) dashEl.innerHTML = "";
  if (!globalData || !activeSido) return;

  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;

  var data = sidoData;
  if (activeDistrict && sidoData.districts && sidoData.districts[activeDistrict]) {
    data = sidoData.districts[activeDistrict];
  }

  if (data.section2) {
    gridEl.appendChild(renderSection(data.section2));
  }
  if (data.section1) {
    gridEl.appendChild(renderSection(data.section1));
  }

  // 저평가 + 바닥찾기 분석 그리드
  renderDashboard();

  // "다음 행동" 섹션
  var distParam = activeDistrict ? "/" + activeDistrict : "";
  var nextAction = document.createElement("div");
  nextAction.className = "section next-action";
  nextAction.innerHTML = '<h2 class="section-title">\uB354 \uC54C\uC544\uBCF4\uAE30</h2>'
    + '<div class="popular-list">'
    + '<a class="popular-item" href="undervalued.html#' + activeSido + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'main\',target:\'undervalued\'})">'
    + '<span class="popular-name">\uC800\uD3C9\uAC00 TOP3</span>'
    + '<span class="popular-meta">' + activeSido + ' \uC800\uD3C9\uAC00 \uC544\uD30C\uD2B8 \uBD84\uC11D</span></a>'
    + '<a class="popular-item" href="regional.html#' + activeSido + distParam + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'main\',target:\'regional\'})">'
    + '<span class="popular-name">\uC9C0\uC5ED \uC2DC\uC138</span>'
    + '<span class="popular-meta">\uD788\uD2B8\uB9F5 \u00B7 \uCD94\uC774 \u00B7 \uB3D9\uBCC4 \uBE44\uAD50</span></a>'
    + '<a class="popular-item" href="regional.html#' + activeSido + '/\uC804\uC138" onclick="APTWatchlist.track(\'next_action_click\',{source:\'main\',target:\'jeonse\'})">'
    + '<span class="popular-name">\uC804\uC138 \uC2DC\uC138</span>'
    + '<span class="popular-meta">\uC804\uC138\uAC00\uC728 \u00B7 \uAC2D\uD22C\uC790 \uBD84\uC11D</span></a>'
    + '<a class="popular-item" href="search.html#' + activeSido + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'main\',target:\'search\'})">'
    + '<span class="popular-name">\uB2E8\uC9C0 \uAC80\uC0C9</span>'
    + '<span class="popular-meta">\uB2E8\uC9C0\uBA85\uC73C\uB85C \uC2E4\uAC70\uB798 \uC870\uD68C</span></a>'
    + '</div>';
  gridEl.appendChild(nextAction);
}

function showDetail(r) {
  APTWatchlist.track("view_detail", { apt_name: r.apt_name, sigungu: r.sigungu, area_m2: r.area_m2, page: "main" });
  // 기존 모달 제거
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

  // 닫기 버튼
  var closeBtn = document.createElement("button");
  closeBtn.className = "modal-close";
  closeBtn.setAttribute("aria-label", "닫기");
  closeBtn.textContent = "\u2715";
  closeBtn.addEventListener("click", function () { overlay.remove(); });
  modal.appendChild(closeBtn);

  // 헤더
  var title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = r.apt_name;
  modal.appendChild(title);

  var sub = document.createElement("p");
  sub.className = "modal-sub";
  sub.textContent = r.sigungu + " " + r.dong_name + " \u00B7 " + r.area_m2 + "m\u00B2";
  modal.appendChild(sub);

  // 로딩
  var body = document.createElement("div");
  body.className = "modal-body";
  body.textContent = "\uB85C\uB529 \uC911...";
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  var compare = (r.compare || []).slice(0, 2);
  var targets = [{ id: r.id, name: r.apt_name, price: r.current_price, region: r.sigungu + " " + r.dong_name }].concat(compare.map(function (c) {
    return { id: c.id, name: c.apt_name, price: c.current_price, region: c.sigungu + " " + c.dong_name };
  }));

  // geo 데이터 로드 (캐시)
  var geoPromise = geoCache
    ? Promise.resolve(geoCache)
    : fetch(GEO_PATH + "?t=" + Date.now()).then(function (res) {
        return res.ok ? res.json() : null;
      }).then(function (d) { geoCache = d; return d; }).catch(function () { return null; });

  Promise.all([
    geoPromise,
    Promise.all(targets.map(function (t) {
      return fetch("data/apt_trade/by_apt/" + t.id + ".json")
        .then(function (res) {
          if (!res.ok) throw new Error("not found");
          return res.json();
        })
        .then(function (history) { return { name: t.name, history: history, price: t.price, region: t.region }; });
    }))
  ])
    .then(function (results) {
      var geoAll = results[0];
      var seriesList = results[1];
      body.innerHTML = "";

      // 차트
      var baseHistory = seriesList[0] ? seriesList[0].history : [];
      if (baseHistory.length > 1) {
        var chartDiv = document.createElement("div");
        chartDiv.className = "scatter-chart modal-chart";
        var canvas = document.createElement("canvas");
        chartDiv.appendChild(canvas);
        body.appendChild(chartDiv);
        requestAnimationFrame(function () { drawMultiScatter(canvas, seriesList); });
      }

      // 범례
      if (seriesList.length > 1) {
        var legend = document.createElement("div");
        legend.className = "rank-detail";
        var colors = ["#2563eb", "#94a3b8", "#ef4444"];
        seriesList.forEach(function (s, idx) {
          var wrap = document.createElement("span");
          wrap.style.display = "inline-flex";
          wrap.style.alignItems = "center";
          wrap.style.gap = "6px";
          wrap.style.marginRight = "10px";

          var dot = document.createElement("span");
          dot.style.display = "inline-block";
          dot.style.width = "8px";
          dot.style.height = "8px";
          dot.style.borderRadius = "50%";
          dot.style.background = colors[idx % colors.length];
          wrap.appendChild(dot);

          var label = document.createElement("span");
          var priceText = (s.price != null) ? (" (현재 " + (s.price / 10000).toFixed(1) + "억)") : "";
          var regionText = s.region ? (" \u00B7 " + s.region) : "";
          label.textContent = s.name + regionText + priceText;
          wrap.appendChild(label);

          legend.appendChild(wrap);
        });
        body.appendChild(legend);
      }

      // 입지점수 레이더 차트
      if (geoAll && r.id && geoAll[r.id]) {
        var geo = geoAll[r.id];
        var transport = geo.subway_dist != null ? Math.max(5, Math.round(100 - geo.subway_dist * 1000 / 30)) : 0;
        var radarScores = {
          transport: transport,
          school: geo.academy_score || 0,
          livability: geo.livability_score || geo.infra_score || 0
        };
        if (radarScores.transport || radarScores.school || radarScores.livability) {
          var radarSec = document.createElement("div");
          radarSec.style.cssText = "margin:12px 0;text-align:center";
          var radarTitle = document.createElement("div");
          radarTitle.style.cssText = "font-size:12px;font-weight:700;color:var(--ink);margin-bottom:4px";
          radarTitle.textContent = "입지점수";
          if (geo.loc_score != null) {
            var totalColor = geo.loc_score >= 70 ? "#2563eb" : geo.loc_score >= 40 ? "#f59e0b" : "#94a3b8";
            radarTitle.innerHTML += ' <span style="color:' + totalColor + '">종합 ' + geo.loc_score + '</span>';
          }
          radarSec.appendChild(radarTitle);
          var radarCanvas = document.createElement("canvas");
          radarCanvas.style.cssText = "width:180px;height:180px;margin:0 auto;display:block";
          radarSec.appendChild(radarCanvas);
          body.appendChild(radarSec);
          requestAnimationFrame(function () {
            drawRadarChart(radarCanvas, radarScores);
          });
        }
      }

      // 거래 테이블
      var table = document.createElement("table");
      table.className = "modal-table";
      var thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>\uB0A0\uC9DC</th><th>\uAC00\uACA9(\uC5B5)</th></tr>";
      table.appendChild(thead);
      var tbody = document.createElement("tbody");
      for (var i = baseHistory.length - 1; i >= 0; i--) {
        var tr = document.createElement("tr");
        var tdDate = document.createElement("td");
        tdDate.textContent = baseHistory[i][0];
        var tdPrice = document.createElement("td");
        tdPrice.textContent = (baseHistory[i][1] / 10000).toFixed(1) + "\uC5B5";
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

/* ── Hero Search ── */
function initHeroSearch(sidoOrder) {
  var heroInput = document.getElementById("heroSearchInput");
  var heroBtn = document.getElementById("heroSearchBtn");
  if (!heroInput || !heroBtn) return;

  var heroDropdown = null;
  var heroSidoCache = {};
  var heroTimeout = null;

  function ensureDropdown() {
    if (heroDropdown) return;
    heroDropdown = document.createElement("div");
    heroDropdown.className = "autocomplete-dropdown";
    heroDropdown.style.display = "none";
    heroInput.parentElement.appendChild(heroDropdown);
  }

  function loadHeroSido(sido) {
    if (heroSidoCache[sido]) return Promise.resolve(heroSidoCache[sido]);
    return fetch("data/apt_trade/search/" + encodeURIComponent(sido) + ".json?t=" + Date.now())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) heroSidoCache[sido] = d; return d; })
      .catch(function () { return null; });
  }

  function doHeroSearch(query) {
    if (!query || query.length < 2) {
      if (heroDropdown) heroDropdown.style.display = "none";
      return;
    }
    ensureDropdown();
    var q = query.toLowerCase();

    // 현재 활성 시도 데이터만 로드 (경량)
    var targetSido = activeSido || sidoOrder[0];
    if (!targetSido) return;

    loadHeroSido(targetSido).then(function (data) {
      if (!data || !data.items) {
        heroDropdown.style.display = "none";
        return;
      }

      var matches = [];
      var seen = {};
      for (var i = 0; i < data.items.length && matches.length < 10; i++) {
        var r = data.items[i];
        if (r.apt_name.toLowerCase().indexOf(q) < 0) continue;
        var key = r.apt_name + "\t" + (r.district || r.sigungu) + "\t" + r.dong_name;
        if (seen[key]) continue;
        seen[key] = true;
        matches.push({ apt_name: r.apt_name, district: r.district || r.sigungu, dong_name: r.dong_name, sido: targetSido });
      }

      if (!matches.length) {
        heroDropdown.style.display = "none";
        if (typeof gtag === "function") {
          gtag("event", "empty_result", { query: query, page: "hero" });
        }
        return;
      }

      heroDropdown.innerHTML = "";
      matches.forEach(function (m) {
        var item = document.createElement("div");
        item.className = "ac-item";
        item.innerHTML = '<span class="ac-name">' + APTCommon.escapeHTML(m.apt_name) + '</span>'
          + '<span class="ac-loc">' + APTCommon.escapeHTML(m.district + " " + m.dong_name) + '</span>';
        item.addEventListener("mousedown", function (e) {
          e.preventDefault();
          heroDropdown.style.display = "none";
          location.href = "search.html#" + encodeURIComponent(m.sido) + "?q=" + encodeURIComponent(m.apt_name);
        });
        heroDropdown.appendChild(item);
      });
      heroDropdown.style.display = "block";
    });
  }

  heroInput.addEventListener("input", function () {
    clearTimeout(heroTimeout);
    heroTimeout = setTimeout(function () {
      doHeroSearch(heroInput.value.trim());
    }, 300);
  });

  heroInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      if (heroDropdown) heroDropdown.style.display = "none";
      var q = heroInput.value.trim();
      if (q.length >= 2) {
        if (typeof gtag === "function") {
          gtag("event", "hero_search", { query: q });
        }
        location.href = "search.html#" + encodeURIComponent(activeSido || sidoOrder[0] || "") + "?q=" + encodeURIComponent(q);
      }
    }
  });

  heroBtn.addEventListener("click", function () {
    if (heroDropdown) heroDropdown.style.display = "none";
    var q = heroInput.value.trim();
    if (q.length >= 2) {
      if (typeof gtag === "function") {
        gtag("event", "hero_search", { query: q });
      }
      location.href = "search.html#" + encodeURIComponent(activeSido || sidoOrder[0] || "") + "?q=" + encodeURIComponent(q);
    }
  });

  heroInput.addEventListener("blur", function () {
    setTimeout(function () {
      if (heroDropdown) heroDropdown.style.display = "none";
    }, 150);
  });

  // Scenario card click tracking
  document.querySelectorAll(".scenario-card").forEach(function (card) {
    card.addEventListener("click", function () {
      if (typeof gtag === "function") {
        gtag("event", "scenario_click", { type: card.getAttribute("data-type") });
      }
    });
  });
}

async function init() {
  try {
    var response = await fetch(summaryPath + "?t=" + Date.now());
    if (!response.ok) {
      statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
      return;
    }
    globalData = await response.json();

    var sidoOrder = globalData.sido_order || [];
    var hash = decodeURIComponent(location.hash.replace("#", ""));
    var parts = hash.split("/");
    activeSido = sidoOrder.indexOf(parts[0]) >= 0 ? parts[0] : sidoOrder[0] || null;
    if (parts[1] && activeSido && globalData.sidos[activeSido]) {
      var dOrder = globalData.sidos[activeSido].district_order || [];
      if (dOrder.indexOf(parts[1]) >= 0) activeDistrict = parts[1];
    }

    renderTabs(sidoOrder);
    renderSubTabs();
    renderSections();

    statusEl.innerHTML = "";
    var dateOnly = globalData.updated_at ? globalData.updated_at.slice(0, 10) : "";
    metaEl.textContent = "\uC5C5\uB370\uC774\uD2B8: " + dateOnly;

    initHeroSearch(sidoOrder);
  } catch (e) {
    statusEl.textContent = "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
  }
}

init();

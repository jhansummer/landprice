/* APT Mine - 전세시세 페이지 */
var summaryPath = "data/apt_trade/summary.json";

var gridEl = document.getElementById("grid");
var statusEl = document.getElementById("status");
var metaEl = document.getElementById("meta");
var tabsEl = document.getElementById("tabs");
var subtabsEl = document.getElementById("subtabs");

var globalData = null;
var activeSido = null;
var activeDistrict = null;

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

/* ── 탭 ── */
function renderTabs(sidoOrder) {
  tabsEl.innerHTML = "";
  tabsEl.setAttribute("role", "tablist");
  var label = document.createElement("span");
  label.className = "region-label";
  label.textContent = "지역";
  tabsEl.appendChild(label);
  sidoOrder.forEach(function(sido) {
    var btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", sido === activeSido ? "true" : "false");
    btn.textContent = sido;
    btn.addEventListener("click", function() {
      activeSido = sido;
      activeDistrict = null;
      renderTabs(sidoOrder);
      renderSubTabs();
      renderSections();
      history.replaceState(null, "", "#" + sido);
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

  sidoData.district_order.forEach(function(dist) {
    var opt = document.createElement("option");
    opt.value = dist;
    opt.textContent = dist;
    if (dist === activeDistrict) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", function() {
    activeDistrict = select.value || null;
    renderSections();
  });

  subtabsEl.appendChild(select);
}

/* ── 전세가율 현황 카드 ── */
function renderJeonseRatio(jeonse) {
  if (!jeonse || !jeonse.avg_ratio) return null;
  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "전세가율 현황";
  sec.appendChild(h2);

  var ratioDiv = document.createElement("div");
  ratioDiv.className = "jeonse-ratio-big";
  ratioDiv.textContent = jeonse.avg_ratio.toFixed(1) + "%";
  sec.appendChild(ratioDiv);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "평균 전세가율 (" + jeonse.count + "개 단지 기준)";
  sec.appendChild(sub);

  if (jeonse.sample_apts && jeonse.sample_apts.length) {
    var list = document.createElement("div");
    list.className = "dong-stats-list";
    jeonse.sample_apts.forEach(function(a) {
      var row = document.createElement("div");
      row.className = "dong-stat-row";
      var nameEl = document.createElement("span");
      nameEl.className = "dong-stat-name";
      nameEl.textContent = a.apt_name + " " + a.area_m2 + "m\u00B2";
      row.appendChild(nameEl);
      var valEl = document.createElement("span");
      valEl.className = "dong-stat-val";
      valEl.textContent = fmt(a.jeonse_price) + "/" + fmt(a.sale_price) + "만 = " + a.ratio + "%";
      row.appendChild(valEl);
      list.appendChild(row);
    });
    sec.appendChild(list);
  }
  return sec;
}

/* ── 전세가율 추이 ── */
function renderJeonseTrend(trendData) {
  if (!trendData || trendData.length < 2) return null;
  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "전세가율 추이";
  sec.appendChild(h2);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "월별 평균 전세가율 추이";
  sec.appendChild(sub);

  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "220px";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);
  sec.appendChild(chartDiv);
  requestAnimationFrame(function() { drawJeonseTrendChart(canvas, trendData); });
  return sec;
}

/* ── 전세 실거래 TOP3 ── */
function renderJeonseTop3(top3) {
  if (!top3 || !top3.length) return null;
  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "전세 상승 TOP3";
  sec.appendChild(h2);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "최근 전세가 가장 많이 오른 아파트";
  sec.appendChild(sub);

  top3.forEach(function(item, idx) {
    var card = document.createElement("div");
    card.className = "rank-card";

    var num = document.createElement("span");
    var nClass = idx < 3 ? " n" + (idx + 1) : "";
    num.className = "rank-num" + nClass;
    num.textContent = idx + 1;
    card.appendChild(num);

    var content = document.createElement("div");
    var top = document.createElement("div");
    top.className = "rank-top";

    var info = document.createElement("div");
    info.className = "rank-info";
    var aptEl = document.createElement("div");
    aptEl.className = "rank-apt";
    aptEl.textContent = item.apt_name;
    info.appendChild(aptEl);
    var detail = document.createElement("div");
    detail.className = "rank-detail";
    detail.textContent = (item.dong_name || "") + " \u00B7 " + item.area_m2 + "m\u00B2 \u00B7 " + item.latest_date;
    info.appendChild(detail);
    top.appendChild(info);

    var changeEl = document.createElement("div");
    changeEl.className = "rank-change";
    var pctEl = document.createElement("div");
    pctEl.className = "rank-pct";
    pctEl.textContent = "+" + item.chg_pct.toFixed(1) + "%";
    pctEl.style.color = "var(--up)";
    changeEl.appendChild(pctEl);
    var diffEl = document.createElement("div");
    diffEl.className = "rank-diff";
    diffEl.textContent = fmt(item.prev_deposit) + " \u2192 " + fmt(item.latest_deposit) + "만";
    changeEl.appendChild(diffEl);
    top.appendChild(changeEl);

    content.appendChild(top);
    card.appendChild(content);
    sec.appendChild(card);
  });

  return sec;
}

/* ── 전세 거래량 추이 ── */
function renderJeonseVolume(volumeData) {
  if (!volumeData || volumeData.length < 2) return null;
  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "전세 거래량 추이";
  sec.appendChild(h2);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "월별 전세 거래 건수";
  sec.appendChild(sub);

  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "200px";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);
  sec.appendChild(chartDiv);
  requestAnimationFrame(function() { drawJeonseVolumeChart(canvas, volumeData); });
  return sec;
}

/* ── 전세 동별 통계 히트맵 ── */
function renderJeonseDongStats(dongStats) {
  if (!dongStats || dongStats.length < 2) return null;
  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "동별 전세 시세";
  sec.appendChild(h2);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "m\u00B2당 평균 전세가 (최근 6개월)";
  sec.appendChild(sub);

  // 가격 범위 계산
  var prices = dongStats.map(function(d) { return d.avg_per_m2; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;

  var grid = document.createElement("div");
  grid.className = "heatmap-grid";
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(100px, 1fr))";
  grid.style.gap = "6px";
  grid.style.marginTop = "12px";

  dongStats.forEach(function(d) {
    var cell = document.createElement("div");
    cell.className = "heatmap-cell";
    var ratio = (d.avg_per_m2 - minP) / pRange;
    var hue = Math.round(200 - ratio * 160); // 200(cyan) → 40(orange)
    var sat = 60 + ratio * 30;
    cell.style.background = "hsl(" + hue + "," + sat + "%,92%)";
    cell.style.borderLeft = "3px solid hsl(" + hue + "," + sat + "%,55%)";
    cell.style.padding = "8px 10px";
    cell.style.borderRadius = "8px";
    cell.style.cursor = "default";

    var name = document.createElement("div");
    name.style.fontWeight = "700";
    name.style.fontSize = "13px";
    name.style.color = "var(--ink)";
    name.textContent = d.dong_name;
    cell.appendChild(name);

    var val = document.createElement("div");
    val.style.fontSize = "12px";
    val.style.color = "var(--muted)";
    val.style.marginTop = "2px";
    val.textContent = Math.round(d.avg_per_m2).toLocaleString() + "만/m\u00B2 \u00B7 " + d.txn_count + "건";
    cell.appendChild(val);

    grid.appendChild(cell);
  });

  sec.appendChild(grid);
  return sec;
}

/* ── 갭투자 분석 ── */
function renderGapAnalysis(gap) {
  if (!gap || !gap.avg_gap) return null;
  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "갭투자 분석";
  sec.appendChild(h2);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "매매가 - 전세가 차이 (갭) · " + gap.count + "개 단지 기준";
  sec.appendChild(sub);

  // 평균 갭 큰 숫자
  var bigNum = document.createElement("div");
  bigNum.className = "jeonse-ratio-big";
  bigNum.style.color = "#f97316";
  var avgGap = gap.avg_gap;
  bigNum.textContent = avgGap >= 10000
    ? (avgGap / 10000).toFixed(1) + "\uc5b5"
    : fmt(avgGap) + "만";
  sec.appendChild(bigNum);

  var avgLabel = document.createElement("p");
  avgLabel.className = "section-sub";
  avgLabel.textContent = "평균 갭 (매매가 - 전세가)";
  sec.appendChild(avgLabel);

  // 갭 추이 차트
  if (gap.gap_trend && gap.gap_trend.length >= 2) {
    var chartTitle = document.createElement("h3");
    chartTitle.style.cssText = "font-size:14px;font-weight:700;margin:20px 0 8px;color:var(--ink)";
    chartTitle.textContent = "월별 평균 갭 추이";
    sec.appendChild(chartTitle);
    var chartDiv = document.createElement("div");
    chartDiv.className = "scatter-chart";
    chartDiv.style.height = "200px";
    var canvas = document.createElement("canvas");
    chartDiv.appendChild(canvas);
    sec.appendChild(chartDiv);
    requestAnimationFrame(function() { drawGapTrendChart(canvas, gap.gap_trend); });
  }

  // 갭 최소 TOP5
  if (gap.top5_low_gap && gap.top5_low_gap.length) {
    var listTitle = document.createElement("h3");
    listTitle.style.cssText = "font-size:14px;font-weight:700;margin:20px 0 8px;color:var(--ink)";
    listTitle.textContent = "갭 최소 아파트 (투자 진입가 낮은 순)";
    sec.appendChild(listTitle);

    var list = document.createElement("div");
    list.className = "dong-stats-list";
    gap.top5_low_gap.forEach(function(item) {
      var row = document.createElement("div");
      row.className = "dong-stat-row";
      var nameEl = document.createElement("span");
      nameEl.className = "dong-stat-name";
      nameEl.textContent = item.apt_name + " " + item.area_m2 + "m\u00B2";
      row.appendChild(nameEl);
      var valEl = document.createElement("span");
      valEl.className = "dong-stat-val";
      var gapVal = item.gap >= 10000
        ? (item.gap / 10000).toFixed(1) + "\uc5b5"
        : fmt(item.gap) + "만";
      valEl.textContent = "갭 " + gapVal + " (전세가율 " + item.ratio + "%)";
      row.appendChild(valEl);
      list.appendChild(row);
    });
    sec.appendChild(list);
  }

  return sec;
}

/* ── 메인 렌더 ── */
function renderSections() {
  gridEl.innerHTML = "";
  if (!globalData || !activeSido) return;

  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;

  var data = sidoData;
  if (activeDistrict && sidoData.districts && sidoData.districts[activeDistrict]) {
    data = sidoData.districts[activeDistrict];
  }

  // 전세 데이터가 없는 경우
  if (!data.jeonse && !data.jeonse_trend && !data.jeonse_top3 && !data.jeonse_volume) {
    var noData = document.createElement("div");
    noData.className = "section";
    var p = document.createElement("p");
    p.className = "no-data";
    p.textContent = "전세 데이터가 아직 수집되지 않았습니다.";
    noData.appendChild(p);
    gridEl.appendChild(noData);
    return;
  }

  // 1. 전세가율 현황
  var ratioSec = renderJeonseRatio(data.jeonse);
  if (ratioSec) gridEl.appendChild(ratioSec);

  // 2. 전세가율 추이 차트
  var trendSec = renderJeonseTrend(data.jeonse_trend);
  if (trendSec) gridEl.appendChild(trendSec);

  // 3. 전세 상승 TOP3
  var top3Sec = renderJeonseTop3(data.jeonse_top3);
  if (top3Sec) gridEl.appendChild(top3Sec);

  // 4. 갭투자 분석
  var gapSec = renderGapAnalysis(data.gap_analysis);
  if (gapSec) gridEl.appendChild(gapSec);

  // 5. 전세 거래량 추이
  var volSec = renderJeonseVolume(data.jeonse_volume);
  if (volSec) gridEl.appendChild(volSec);

  // 6. 동별 전세 시세 (구 선택시만)
  if (activeDistrict && data.jeonse_dong_stats) {
    var dongSec = renderJeonseDongStats(data.jeonse_dong_stats);
    if (dongSec) gridEl.appendChild(dongSec);
  }
}

/* ── 초기화 ── */
async function init() {
  try {
    var response = await fetch(summaryPath + "?t=" + Date.now());
    if (!response.ok) {
      statusEl.textContent = "데이터를 불러오지 못했습니다.";
      return;
    }
    globalData = await response.json();

    var sidoOrder = globalData.sido_order || [];
    var hash = decodeURIComponent(location.hash.replace("#", ""));
    var parts = hash.split("/");
    activeSido = sidoOrder.indexOf(parts[0]) >= 0 ? parts[0] : sidoOrder[0] || null;
    if (parts[1]) activeDistrict = parts[1];

    renderTabs(sidoOrder);
    renderSubTabs();
    renderSections();

    statusEl.innerHTML = "";
    var dateOnly = globalData.updated_at ? globalData.updated_at.slice(0, 10) : "";
    metaEl.textContent = "업데이트: " + dateOnly;
  } catch (e) {
    statusEl.textContent = "네트워크 오류가 발생했습니다. 새로고침해주세요.";
  }
}

init();

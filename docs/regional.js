/* APT Mine - 지역별 시세 분석 페이지 */
const summaryPath = "data/apt_trade/summary.json";

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const tabsEl = document.getElementById("tabs");
const subtabsEl = document.getElementById("subtabs");

let globalData = null;
let activeSido = null;
let activeDistrict = null;

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

/* ── 시도 탭 ── */
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

/* ── 구/군 선택 ── */
function renderSubTabs() {
  subtabsEl.innerHTML = "";
  if (!globalData || !activeSido) return;
  var sidoData = globalData.sidos[activeSido];
  if (!sidoData || !sidoData.district_order || !sidoData.district_order.length) return;

  var select = document.createElement("select");
  select.className = "district-select";

  var allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = activeSido + " 전체";
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
    renderSections();
  });

  subtabsEl.appendChild(select);
}

/* ── 차트: 시세 추이 + 거래량 ── */
function drawTrendChart(canvas, trendData) {
  if (!trendData || trendData.length < 2) return;
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  var w = rect.width * dpr;
  var h = rect.height * dpr;
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width;
  var ch = rect.height;
  var pad = { top: 10, right: 40, bottom: 24, left: 48 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var prices = trendData.map(function (d) { return d[1]; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var pRange = maxP - minP || 1;
  minP -= pRange * 0.05;
  maxP += pRange * 0.05;

  // 거래량
  var volumes = trendData.map(function (d) { return d[2] || 0; });
  var maxVol = Math.max.apply(null, volumes) || 1;
  var volMaxH = plotH * 0.30; // 하단 30% 영역에 막대

  function xPos(i) { return pad.left + (i / (trendData.length - 1)) * plotW; }
  function yPos(p) { return pad.top + (1 - (p - minP) / (maxP - minP)) * plotH; }

  // 거래량 막대 (시세 라인보다 먼저 그려서 뒤에 깔림)
  var barW = Math.max(2, plotW / trendData.length * 0.6);
  for (var i = 0; i < trendData.length; i++) {
    var vol = volumes[i];
    if (vol <= 0) continue;
    var barH = (vol / maxVol) * volMaxH;
    var bx = xPos(i) - barW / 2;
    var by = pad.top + plotH - barH;
    ctx.fillStyle = "rgba(26,111,90,0.13)";
    ctx.fillRect(bx, by, barW, barH);
  }

  // 그리드
  ctx.strokeStyle = "#e8e0d4";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  // Y축 라벨 (시세 — 왼쪽)
  ctx.fillStyle = "#9a9590"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minP + ((maxP - minP) / 4) * (4 - g);
    ctx.fillText(Math.round(val).toLocaleString(), pad.left - 4, pad.top + (plotH / 4) * g);
  }
  // Y축 라벨 (거래량 — 오른쪽)
  ctx.fillStyle = "#b5b0a8"; ctx.textAlign = "left";
  for (var g = 0; g <= 2; g++) {
    var vVal = Math.round(maxVol / 2 * (2 - g));
    var vy = pad.top + plotH - (volMaxH / 2) * (2 - g);
    ctx.fillText(vVal.toLocaleString(), pad.left + plotW + 4, vy);
  }
  // X축 라벨 (연도)
  ctx.fillStyle = "#9a9590";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  var seenYear = {};
  for (var i = 0; i < trendData.length; i++) {
    var ym = trendData[i][0];
    var yr = ym.slice(0, 4);
    if (ym.slice(4) === "01" && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  }
  // 영역 채우기
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.lineTo(xPos(trendData.length - 1), pad.top + plotH);
  ctx.lineTo(xPos(0), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(26,111,90,0.1)";
  ctx.fill();
  // 라인
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.strokeStyle = "#1a6f5a"; ctx.lineWidth = 1.5; ctx.stroke();
  // 최신 포인트
  var lastIdx = trendData.length - 1;
  ctx.fillStyle = "#d63a3a";
  ctx.beginPath(); ctx.arc(xPos(lastIdx), yPos(trendData[lastIdx][1]), 4, 0, Math.PI * 2); ctx.fill();
  // 최신값 라벨
  ctx.fillStyle = "#d63a3a"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(Math.round(trendData[lastIdx][1]).toLocaleString() + "\uB9CC/m\u00B2", xPos(lastIdx) - 6, yPos(trendData[lastIdx][1]) - 6);
}

function renderTrendSection(trendData, title) {
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uC6D4\uBCC4 \uD3C9\uADE0 m\u00B2\uB2F9 \uAC00\uACA9 + \uAC70\uB798\uB7C9";
  sec.appendChild(sub);
  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "250px";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);
  sec.appendChild(chartDiv);
  requestAnimationFrame(function () { drawTrendChart(canvas, trendData); });
  return sec;
}

/* ── 구별 색상 팔레트 (사이트 톤에 맞춘 어스톤) ── */
var DIST_COLORS = [
  "#1a6f5a", "#b07d4f", "#8b6b4a", "#5a7f6e", "#a0522d",
  "#6b8e6b", "#c08552", "#3d6b5e", "#d4956a", "#4e7a5e",
  "#8c7051", "#537d6d", "#bf7b3f", "#728a6e", "#9e6b42",
  "#5f8a72", "#c47d5a", "#4a6e56", "#a87d52", "#6d8b66",
  "#b5885a", "#3f7a6a", "#ca9060", "#588068", "#9c7a55"
];

function getDistColor(idx) {
  return DIST_COLORS[idx % DIST_COLORS.length];
}

/* ── 동네별 시세 비교 (단일 구) ── */
function renderDongStats(dongStats, title) {
  if (!dongStats || !dongStats.length) return null;
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uCD5C\uADFC 3\uAC1C\uC6D4 \uAC70\uB798 \uAE30\uC900 \u00B7 m\u00B2\uB2F9 \uD3C9\uADE0\uAC00 (\uB9CC\uC6D0)";
  sec.appendChild(sub);

  var maxVal = dongStats[0].avg_per_m2;
  var table = document.createElement("div");
  table.className = "dong-stats-list";
  dongStats.slice(0, 20).forEach(function (d) {
    var row = document.createElement("div");
    row.className = "dong-stat-row";
    var nameEl = document.createElement("span");
    nameEl.className = "dong-stat-name";
    nameEl.textContent = d.dong_name;
    row.appendChild(nameEl);
    var barWrap = document.createElement("div");
    barWrap.className = "dong-stat-bar-wrap";
    var bar = document.createElement("div");
    bar.className = "dong-stat-bar";
    bar.style.width = (d.avg_per_m2 / maxVal * 100) + "%";
    barWrap.appendChild(bar);
    row.appendChild(barWrap);
    var valEl = document.createElement("span");
    valEl.className = "dong-stat-val";
    valEl.textContent = Math.round(d.avg_per_m2).toLocaleString() + " (" + d.txn_count + "\uAC74)";
    row.appendChild(valEl);
    table.appendChild(row);
  });
  sec.appendChild(table);
  return sec;
}

/* ── 동네별 시세 비교 (시도 전체 — 모든 구의 동을 합쳐서 구별 색상 구분) ── */
function renderAllDongStats(sidoData, title) {
  if (!sidoData || !sidoData.districts) return null;
  var distOrder = sidoData.district_order || Object.keys(sidoData.districts);

  // 구별 색상 매핑 + 전체 동 데이터 합치기
  var distColorMap = {};
  var allDongs = [];
  distOrder.forEach(function (distName, idx) {
    var dist = sidoData.districts[distName];
    if (!dist || !dist.dong_stats) return;
    distColorMap[distName] = getDistColor(idx);
    dist.dong_stats.forEach(function (d) {
      allDongs.push({
        dong_name: d.dong_name,
        avg_per_m2: d.avg_per_m2,
        txn_count: d.txn_count,
        district: distName,
        color: getDistColor(idx)
      });
    });
  });

  if (!allDongs.length) return null;

  // 가격 내림차순 정렬
  allDongs.sort(function (a, b) { return b.avg_per_m2 - a.avg_per_m2; });

  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uCD5C\uADFC 3\uAC1C\uC6D4 \uAC70\uB798 \uAE30\uC900 \u00B7 m\u00B2\uB2F9 \uD3C9\uADE0\uAC00 (\uB9CC\uC6D0) \u00B7 \uAD6C\uBCC4 \uC0C9\uC0C1 \uAD6C\uBD84";
  sec.appendChild(sub);

  var maxVal = allDongs[0].avg_per_m2;
  var table = document.createElement("div");
  table.className = "dong-stats-list";
  allDongs.slice(0, 50).forEach(function (d) {
    var row = document.createElement("div");
    row.className = "dong-stat-row dong-stat-row-wide";
    // 구 라벨
    var distLabel = document.createElement("span");
    distLabel.className = "dong-stat-district";
    distLabel.textContent = d.district;
    distLabel.style.color = d.color;
    row.appendChild(distLabel);
    // 동 이름
    var nameEl = document.createElement("span");
    nameEl.className = "dong-stat-name";
    nameEl.textContent = d.dong_name;
    row.appendChild(nameEl);
    // 바
    var barWrap = document.createElement("div");
    barWrap.className = "dong-stat-bar-wrap";
    var bar = document.createElement("div");
    bar.className = "dong-stat-bar";
    bar.style.width = (d.avg_per_m2 / maxVal * 100) + "%";
    bar.style.background = d.color;
    barWrap.appendChild(bar);
    row.appendChild(barWrap);
    // 값
    var valEl = document.createElement("span");
    valEl.className = "dong-stat-val";
    valEl.textContent = Math.round(d.avg_per_m2).toLocaleString() + " (" + d.txn_count + "\uAC74)";
    row.appendChild(valEl);
    table.appendChild(row);
  });
  sec.appendChild(table);
  return sec;
}

/* ── 전세가율 ── */
function renderJeonseSection(jeonse) {
  if (!jeonse || !jeonse.avg_ratio) return null;
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "\uC804\uC138\uAC00\uC728";
  sec.appendChild(h2);

  var ratioDiv = document.createElement("div");
  ratioDiv.className = "jeonse-ratio-big";
  ratioDiv.textContent = jeonse.avg_ratio.toFixed(1) + "%";
  sec.appendChild(ratioDiv);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uD3C9\uADE0 \uC804\uC138\uAC00\uC728 (" + jeonse.count + "\uAC1C \uB2E8\uC9C0 \uAE30\uC900)";
  sec.appendChild(sub);

  if (jeonse.sample_apts && jeonse.sample_apts.length) {
    var list = document.createElement("div");
    list.className = "dong-stats-list";
    jeonse.sample_apts.forEach(function (a) {
      var row = document.createElement("div");
      row.className = "dong-stat-row";
      var nameEl = document.createElement("span");
      nameEl.className = "dong-stat-name";
      nameEl.textContent = a.apt_name + " " + a.area_m2 + "m\u00B2";
      row.appendChild(nameEl);
      var valEl = document.createElement("span");
      valEl.className = "dong-stat-val";
      valEl.textContent = fmt(a.jeonse_price) + "/" + fmt(a.sale_price) + "\uB9CC = " + a.ratio + "%";
      row.appendChild(valEl);
      list.appendChild(row);
    });
    sec.appendChild(list);
  }
  return sec;
}

/* ── 차트: 전세가율 추이 ── */
function drawJeonseTrendChart(canvas, trendData) {
  if (!trendData || trendData.length < 2) return;
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  var w = rect.width * dpr;
  var h = rect.height * dpr;
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var cw = rect.width;
  var ch = rect.height;
  var pad = { top: 10, right: 12, bottom: 24, left: 42 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var ratios = trendData.map(function (d) { return d[1]; });
  var minR = Math.min.apply(null, ratios);
  var maxR = Math.max.apply(null, ratios);
  var rRange = maxR - minR || 1;
  minR -= rRange * 0.05;
  maxR += rRange * 0.05;

  function xPos(i) { return pad.left + (i / (trendData.length - 1)) * plotW; }
  function yPos(r) { return pad.top + (1 - (r - minR) / (maxR - minR)) * plotH; }

  // 그리드
  ctx.strokeStyle = "#e8e0d4";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  // Y축 라벨
  ctx.fillStyle = "#9a9590"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minR + ((maxR - minR) / 4) * (4 - g);
    ctx.fillText(val.toFixed(0) + "%", pad.left - 4, pad.top + (plotH / 4) * g);
  }
  // X축 라벨 (연도)
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  var seenYear = {};
  for (var i = 0; i < trendData.length; i++) {
    var ym = trendData[i][0];
    var yr = ym.slice(0, 4);
    if (ym.slice(4) === "01" && !seenYear[yr]) {
      seenYear[yr] = true;
      ctx.fillText(yr, xPos(i), pad.top + plotH + 6);
    }
  }
  // 영역 채우기
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.lineTo(xPos(trendData.length - 1), pad.top + plotH);
  ctx.lineTo(xPos(0), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(37,99,235,0.08)";
  ctx.fill();
  // 라인
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.5; ctx.stroke();
  // 최신 포인트
  var lastIdx = trendData.length - 1;
  ctx.fillStyle = "#d63a3a";
  ctx.beginPath(); ctx.arc(xPos(lastIdx), yPos(trendData[lastIdx][1]), 4, 0, Math.PI * 2); ctx.fill();
  // 최신값 라벨
  ctx.fillStyle = "#d63a3a"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(trendData[lastIdx][1].toFixed(1) + "%", xPos(lastIdx) - 6, yPos(trendData[lastIdx][1]) - 6);
}

function renderJeonseTrendSection(jeonseTrend, title) {
  if (!jeonseTrend || jeonseTrend.length < 2) return null;
  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uC6D4\uBCC4 \uD3C9\uADE0 \uC804\uC138\uAC00\uC728 \uCD94\uC774";
  sec.appendChild(sub);
  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "220px";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);
  sec.appendChild(chartDiv);
  requestAnimationFrame(function () { drawJeonseTrendChart(canvas, jeonseTrend); });
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

  var regionName = activeDistrict || activeSido;

  // 시세 추이 차트
  if (data.trend && data.trend.length > 1) {
    gridEl.appendChild(renderTrendSection(data.trend, regionName + " \uC2DC\uC138 \uCD94\uC774"));
  }

  // 동네별 시세 비교
  if (activeDistrict && data.dong_stats && data.dong_stats.length > 1) {
    // 구 선택: 해당 구의 동만 표시
    var dongSec = renderDongStats(data.dong_stats, activeDistrict + " \uB3D9\uBCC4 \uC2DC\uC138 \uBE44\uAD50");
    if (dongSec) gridEl.appendChild(dongSec);
  } else if (!activeDistrict && sidoData.districts) {
    // 시도 전체: 모든 구의 동을 합쳐서 구별 색상 구분
    var allDongSec = renderAllDongStats(sidoData, activeSido + " \uB3D9\uBCC4 \uC2DC\uC138 \uBE44\uAD50");
    if (allDongSec) gridEl.appendChild(allDongSec);
  }

  // 전세가율
  if (data.jeonse) {
    var jeonseSec = renderJeonseSection(data.jeonse);
    if (jeonseSec) gridEl.appendChild(jeonseSec);
  }

  // 전세가율 추이
  if (data.jeonse_trend && data.jeonse_trend.length > 1) {
    var jtSec = renderJeonseTrendSection(data.jeonse_trend, regionName + " \uC804\uC138\uAC00\uC728 \uCD94\uC774");
    if (jtSec) gridEl.appendChild(jtSec);
  }

  // 데이터 없을 때
  if (!gridEl.children.length) {
    var empty = document.createElement("p");
    empty.className = "no-data";
    empty.style.textAlign = "center";
    empty.style.padding = "40px 0";
    empty.textContent = regionName + "\uC758 \uC2DC\uC138 \uB370\uC774\uD130\uAC00 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4.";
    gridEl.appendChild(empty);
  }
}

/* ── 초기화 ── */
async function init() {
  var response = await fetch(summaryPath + "?t=" + Date.now());
  if (!response.ok) {
    statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
    return;
  }
  globalData = await response.json();

  var sidoOrder = globalData.sido_order || [];
  var hash = decodeURIComponent(location.hash.replace("#", ""));
  activeSido = sidoOrder.indexOf(hash) >= 0 ? hash : sidoOrder[0] || null;

  renderTabs(sidoOrder);
  renderSubTabs();
  renderSections();

  statusEl.textContent = "";
  var dateOnly = globalData.updated_at ? globalData.updated_at.slice(0, 10) : "";
  metaEl.textContent = "\uC5C5\uB370\uC774\uD2B8: " + dateOnly;
}

init();

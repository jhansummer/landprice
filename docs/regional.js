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
  tabsEl.setAttribute("role", "tablist");
  var label = document.createElement("span");
  label.className = "region-label";
  label.textContent = "지역";
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
  var volMaxH = plotH * 0.75; // 하단 75% 영역에 막대

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
    ctx.fillStyle = "rgba(37,99,235,0.1)";
    ctx.fillRect(bx, by, barW, barH);
  }

  // 그리드
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  // Y축 라벨 (시세 — 왼쪽)
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var g = 0; g <= 4; g++) {
    var val = minP + ((maxP - minP) / 4) * (4 - g);
    ctx.fillText(Math.round(val).toLocaleString(), pad.left - 4, pad.top + (plotH / 4) * g);
  }
  // Y축 라벨 (거래량 — 오른쪽)
  ctx.fillStyle = "#94a3b8"; ctx.textAlign = "left";
  for (var g = 0; g <= 3; g++) {
    var vVal = Math.round(maxVol / 3 * (3 - g));
    var vy = pad.top + plotH - (volMaxH / 3) * (3 - g);
    ctx.fillText(vVal.toLocaleString(), pad.left + plotW + 4, vy);
  }
  // X축 라벨 (연도)
  ctx.fillStyle = "#94a3b8";
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
  ctx.fillStyle = "rgba(37,99,235,0.06)";
  ctx.fill();
  // 라인
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.5; ctx.stroke();
  // 최신 포인트
  var lastIdx = trendData.length - 1;
  ctx.fillStyle = "#ef4444";
  ctx.beginPath(); ctx.arc(xPos(lastIdx), yPos(trendData[lastIdx][1]), 4, 0, Math.PI * 2); ctx.fill();
  // 최신값 라벨
  ctx.fillStyle = "#ef4444"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
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

/* ── 구별 색상 팔레트 (블루/슬레이트 테마) ── */
var DIST_COLORS = [
  "#2563eb", "#7c3aed", "#0891b2", "#4f46e5", "#0d9488",
  "#6366f1", "#0284c7", "#8b5cf6", "#0e7490", "#3b82f6",
  "#6d28d9", "#0369a1", "#7e22ce", "#0c4a6e", "#4338ca",
  "#155e75", "#5b21b6", "#1e40af", "#0f766e", "#1d4ed8",
  "#059669", "#475569", "#9333ea", "#1e3a5f", "#334155"
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
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (var g = 0; g <= 4; g++) {
    var gy = pad.top + (plotH / 4) * g;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }
  // Y축 라벨
  ctx.fillStyle = "#94a3b8"; ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
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
  ctx.fillStyle = "rgba(37,99,235,0.06)";
  ctx.fill();
  // 라인
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(trendData[0][1]));
  for (var i = 1; i < trendData.length; i++) ctx.lineTo(xPos(i), yPos(trendData[i][1]));
  ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.5; ctx.stroke();
  // 최신 포인트
  var lastIdx = trendData.length - 1;
  ctx.fillStyle = "#ef4444";
  ctx.beginPath(); ctx.arc(xPos(lastIdx), yPos(trendData[lastIdx][1]), 4, 0, Math.PI * 2); ctx.fill();
  // 최신값 라벨
  ctx.fillStyle = "#ef4444"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
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

/* ── 시세 회복 지도 ── */
var RECOVERY_STATUS = {
  recovered: { label: "\uD68C\uBCF5", color: "#2563eb", barColor: "#2563eb", bgColor: "#dbeafe", textColor: "#1e40af" },
  rising:    { label: "\uC0C1\uC2B9\uC911", color: "#16a34a", barColor: "#16a34a", bgColor: "#dcfce7", textColor: "#166534" },
  flat:      { label: "\uD6A1\uBCF4", color: "#94a3b8", barColor: "#94a3b8", bgColor: "#f1f5f9", textColor: "#64748b" },
  falling:   { label: "\uD558\uB77D", color: "#ef4444", barColor: "#ef4444", bgColor: "#fef2f2", textColor: "#dc2626" }
};

function renderRecoverySection(items, title, isDong) {
  if (!items || !items.length) return null;

  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "2021~2022 \uC804\uACE0\uC810 \uB300\uBE44 \uD68C\uBCF5\uB960 \u00B7 \uAC19\uC740 \uB2E8\uC9C0 \uAC19\uC740 \uD3C9\uC218 \uAE30\uC900 \uC911\uC559\uAC12 \u00B7 \uD074\uB9AD\uC2DC \uB2E8\uC9C0\uBCC4 \uC0C1\uC138";
  sec.appendChild(sub);

  var list = document.createElement("div");
  list.className = "dong-stats-list";

  var displayItems = items.slice(0, 20);
  displayItems.forEach(function (item) {
    var st = RECOVERY_STATUS[item.status] || RECOVERY_STATUS.flat;
    var ratio = item.peak > 0 ? Math.min(item.price / item.peak * 100, 120) : 0;

    var rowWrap = document.createElement("div");

    var row = document.createElement("div");
    row.className = "recovery-row";
    row.style.cursor = item.apt_details && item.apt_details.length ? "pointer" : "default";

    // 이름
    var nameEl = document.createElement("span");
    nameEl.className = "dong-stat-name";
    nameEl.textContent = item.name;
    if (item.apt_details && item.apt_details.length) {
      nameEl.innerHTML = item.name + ' <span style="font-size:9px;color:var(--muted);">\u25BC</span>';
    }
    row.appendChild(nameEl);

    // 바
    var barWrap = document.createElement("div");
    barWrap.className = "recovery-bar-wrap";
    var bar = document.createElement("div");
    bar.className = "recovery-bar " + item.status;
    bar.style.width = Math.min(ratio, 100) + "%";
    barWrap.appendChild(bar);
    if (ratio < 100) {
      var peakLine = document.createElement("div");
      peakLine.className = "recovery-peak-line";
      barWrap.appendChild(peakLine);
    }
    row.appendChild(barWrap);

    // 수치 + 배지
    var valEl = document.createElement("span");
    valEl.className = "recovery-val";
    var vsPeakStr = (item.vs_peak >= 0 ? "+" : "") + item.vs_peak + "%";
    var chg6mStr = (item.chg6m >= 0 ? "+" : "") + item.chg6m + "%";
    var badge = document.createElement("span");
    badge.className = "recovery-badge " + item.status;
    badge.textContent = st.label;
    valEl.innerHTML = "<span style='font-weight:700;color:" + st.textColor + ";'>" + vsPeakStr + "</span>"
      + " <span style='color:#9a9590;font-size:10px;'>6m " + chg6mStr + "</span> ";
    valEl.appendChild(badge);
    row.appendChild(valEl);

    rowWrap.appendChild(row);

    // 클릭 시 단지별 회복률 펼침
    if (item.apt_details && item.apt_details.length) {
      row.addEventListener("click", function() {
        var existing = rowWrap.querySelector(".apt-detail-list");
        if (existing) {
          existing.remove();
          nameEl.innerHTML = item.name + ' <span style="font-size:9px;color:var(--muted);">\u25BC</span>';
          return;
        }
        nameEl.innerHTML = item.name + ' <span style="font-size:9px;color:var(--muted);">\u25B2</span>';
        var detailList = document.createElement("div");
        detailList.className = "apt-detail-list";
        var header = document.createElement("div");
        header.className = "apt-detail-header";
        header.textContent = item.name + " \uB2E8\uC9C0\uBCC4 \uD68C\uBCF5\uB960 (\uAC19\uC740 \uD3C9\uC218 \uAE30\uC900)";
        detailList.appendChild(header);
        item.apt_details.forEach(function(a) {
          var ast = RECOVERY_STATUS[a.status] || RECOVERY_STATUS.flat;
          var avp = (a.vs_peak >= 0 ? "+" : "") + a.vs_peak + "%";
          var aRow = document.createElement("div");
          aRow.className = "apt-detail-row";
          aRow.innerHTML = '<span class="apt-detail-name">' + a.apt_name
            + ' <span style="color:var(--muted);font-weight:400;">' + a.area_m2 + 'm\u00B2</span></span>'
            + '<span class="apt-detail-val">'
            + '<span style="color:' + ast.textColor + ';font-weight:700;">' + avp + '</span>'
            + ' <span class="recovery-badge ' + a.status + '" style="font-size:9px;padding:1px 6px;">' + ast.label + '</span>'
            + '</span>';
          detailList.appendChild(aRow);
        });
        rowWrap.appendChild(detailList);
      });
    }

    list.appendChild(rowWrap);
  });
  sec.appendChild(list);
  return sec;
}

/* ── 카카오 지도 기반 회복 지도 ── */
var SIDO_CENTERS = {
  "\uC11C\uC6B8": { lat: 37.5665, lng: 126.9780, level: 8 },
  "\uACBD\uAE30": { lat: 37.4138, lng: 127.0183, level: 10 },
  "\uBD80\uC0B0": { lat: 35.1796, lng: 129.0756, level: 8 },
  "\uB300\uAD6C": { lat: 35.8714, lng: 128.6014, level: 8 },
  "\uC778\uCC9C": { lat: 37.4563, lng: 126.7052, level: 8 },
  "\uAD11\uC8FC": { lat: 35.1595, lng: 126.8526, level: 7 },
  "\uB300\uC804": { lat: 36.3504, lng: 127.3845, level: 7 },
  "\uC6B8\uC0B0": { lat: 35.5384, lng: 129.3114, level: 8 },
  "\uC138\uC885": { lat: 36.4800, lng: 127.0000, level: 7 }
};

var coordCache = {};
try { coordCache = JSON.parse(localStorage.getItem("aptmine_geo") || "{}"); } catch(e) {}

function geocodeAddr(addr) {
  return new Promise(function(resolve) {
    if (coordCache[addr]) { resolve(coordCache[addr]); return; }
    if (typeof kakao === "undefined" || !kakao.maps || !kakao.maps.services) { resolve(null); return; }
    var gc = new kakao.maps.services.Geocoder();
    gc.addressSearch(addr, function(result, status) {
      if (status === kakao.maps.services.Status.OK && result.length) {
        var c = { lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) };
        coordCache[addr] = c;
        try { localStorage.setItem("aptmine_geo", JSON.stringify(coordCache)); } catch(e) {}
        resolve(c);
      } else { resolve(null); }
    });
  });
}

function renderRecoveryMap(items, title, sido, district) {
  if (!items || !items.length) return null;
  if (typeof kakao === "undefined" || !kakao.maps) {
    return renderRecoverySection(items, title, !!district);
  }

  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "2021~2022 \uC804\uACE0\uC810 \uB300\uBE44 \uD68C\uBCF5\uB960 \u00B7 \uAC19\uC740 \uB2E8\uC9C0 \uAC19\uC740 \uD3C9\uC218 \uAE30\uC900 \uC911\uC559\uAC12";
  sec.appendChild(sub);

  var mapDiv = document.createElement("div");
  mapDiv.className = "map-container";
  sec.appendChild(mapDiv);

  var legend = document.createElement("div");
  legend.className = "map-legend";
  legend.innerHTML = '<span class="map-legend-item"><span class="map-legend-dot" style="background:#2563eb"></span>\uD68C\uBCF5</span>'
    + '<span class="map-legend-item"><span class="map-legend-dot" style="background:#16a34a"></span>\uC0C1\uC2B9\uC911</span>'
    + '<span class="map-legend-item"><span class="map-legend-dot" style="background:#94a3b8"></span>\uD6A1\uBCF4</span>'
    + '<span class="map-legend-item"><span class="map-legend-dot" style="background:#ef4444"></span>\uD558\uB77D</span>';
  sec.appendChild(legend);

  var infoPanel = document.createElement("div");
  infoPanel.className = "map-info-panel";
  infoPanel.style.display = "none";
  sec.appendChild(infoPanel);

  requestAnimationFrame(function() {
    var center = SIDO_CENTERS[sido] || { lat: 37.5665, lng: 126.9780, level: 8 };
    var level = district ? 5 : center.level;

    var map = new kakao.maps.Map(mapDiv, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level: level
    });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);

    if (district) {
      geocodeAddr(sido + " " + district).then(function(c) {
        if (c) map.setCenter(new kakao.maps.LatLng(c.lat, c.lng));
      });
    }

    items.forEach(function(item) {
      var addr = district ? (sido + " " + district + " " + item.name) : (sido + " " + item.name);
      geocodeAddr(addr).then(function(c) {
        if (!c) return;
        var st = RECOVERY_STATUS[item.status] || RECOVERY_STATUS.flat;
        var vsPeakStr = (item.vs_peak >= 0 ? "+" : "") + item.vs_peak + "%";

        var el = document.createElement("div");
        el.className = "map-marker";
        el.style.background = st.color;
        el.innerHTML = '<div class="map-marker-name">' + item.name + '</div><div class="map-marker-value">' + vsPeakStr + '</div>';

        var overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(c.lat, c.lng),
          content: el,
          yAnchor: 0.5,
          xAnchor: 0.5
        });
        overlay.setMap(map);

        el.addEventListener("click", function() {
          var chg6mStr = (item.chg6m >= 0 ? "+" : "") + item.chg6m + "%";
          var chg3mStr = (item.chg3m >= 0 ? "+" : "") + item.chg3m + "%";
          infoPanel.style.display = "block";
          infoPanel.innerHTML = '<div class="map-info-header">'
            + '<span class="map-info-name">' + item.name + '</span>'
            + '<span class="recovery-badge ' + item.status + '">' + st.label + '</span></div>'
            + '<div class="map-info-stats">'
            + '<div class="map-info-stat"><span class="map-info-label">\uC804\uACE0\uC810 \uB300\uBE44</span><span class="map-info-val" style="color:' + st.textColor + '">' + vsPeakStr + '</span></div>'
            + '<div class="map-info-stat"><span class="map-info-label">6\uAC1C\uC6D4 \uBCC0\uD654</span><span class="map-info-val">' + chg6mStr + '</span></div>'
            + '<div class="map-info-stat"><span class="map-info-label">\uD604\uC7AC m\u00B2\uB2F9</span><span class="map-info-val">' + Math.round(item.price).toLocaleString() + '\uB9CC</span></div>'
            + '<div class="map-info-stat"><span class="map-info-label">\uC804\uACE0\uC810 m\u00B2\uB2F9</span><span class="map-info-val">' + Math.round(item.peak).toLocaleString() + '\uB9CC</span></div></div>';
          infoPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
    });
  });

  return sec;
}

/* ── 통합 지도: 동별 시세 + 회복률 ── */
function priceColor(price, minP, maxP) {
  var t = maxP > minP ? (price - minP) / (maxP - minP) : 0.5;
  t = Math.max(0, Math.min(1, t));
  // 저가(cyan) → 중가(blue) → 고가(violet)
  var r, g, b;
  if (t < 0.5) {
    var s = t / 0.5;
    r = Math.round(6 + (37 - 6) * s);
    g = Math.round(182 + (99 - 182) * s);
    b = Math.round(212 + (235 - 212) * s);
  } else {
    var s = (t - 0.5) / 0.5;
    r = Math.round(37 + (124 - 37) * s);
    g = Math.round(99 + (58 - 99) * s);
    b = Math.round(235 + (237 - 235) * s);
  }
  return "rgb(" + r + "," + g + "," + b + ")";
}

function renderCombinedMap(dongStats, dongRecovery, title, sido, district) {
  if (!dongStats || !dongStats.length) return null;
  if (typeof kakao === "undefined" || !kakao.maps) return null;

  // dong_recovery를 name으로 매핑
  var recoveryMap = {};
  if (dongRecovery && dongRecovery.items) {
    dongRecovery.items.forEach(function(item) {
      recoveryMap[item.name] = item;
    });
  }

  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "m\u00B2\uB2F9 \uD3C9\uADE0\uAC00 \u00B7 \uB9C8\uCEE4 \uD06C\uAE30=\uAC70\uB798\uB7C9, \uC0C9\uC0C1=\uAC00\uACA9\uB300 \u00B7 \uD074\uB9AD\uC2DC \uC0C1\uC138 \uC815\uBCF4";
  sec.appendChild(sub);

  var mapDiv = document.createElement("div");
  mapDiv.className = "map-container";
  sec.appendChild(mapDiv);

  // 범례: 가격대 그라데이션
  var legend = document.createElement("div");
  legend.className = "map-legend";
  legend.style.gap = "8px";
  legend.innerHTML = '<span style="font-size:11px;color:var(--muted);">\uC800\uAC00</span>'
    + '<span style="display:inline-block;width:120px;height:10px;border-radius:5px;background:linear-gradient(90deg,#06b6d4,#2563eb,#7c3aed);"></span>'
    + '<span style="font-size:11px;color:var(--muted);">\uACE0\uAC00</span>'
    + '<span style="margin-left:16px;font-size:11px;color:var(--muted);">\u25CF \uD06C\uAE30 = \uAC70\uB798\uB7C9</span>';
  sec.appendChild(legend);

  var infoPanel = document.createElement("div");
  infoPanel.className = "map-info-panel";
  infoPanel.style.display = "none";
  sec.appendChild(infoPanel);

  var prices = dongStats.map(function(d) { return d.avg_per_m2; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var volumes = dongStats.map(function(d) { return d.txn_count; });
  var maxVol = Math.max.apply(null, volumes) || 1;

  requestAnimationFrame(function() {
    var center = SIDO_CENTERS[sido] || { lat: 37.5665, lng: 126.9780, level: 8 };
    var level = district ? 5 : center.level;

    var map = new kakao.maps.Map(mapDiv, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level: level
    });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);

    if (district) {
      geocodeAddr(sido + " " + district).then(function(c) {
        if (c) map.setCenter(new kakao.maps.LatLng(c.lat, c.lng));
      });
    }

    dongStats.forEach(function(dong) {
      var addr = district
        ? (sido + " " + district + " " + dong.dong_name)
        : (sido + " " + dong.dong_name);

      geocodeAddr(addr).then(function(c) {
        if (!c) return;
        var color = priceColor(dong.avg_per_m2, minP, maxP);
        var volRatio = dong.txn_count / maxVol;
        var size = Math.round(28 + volRatio * 28);
        var rec = recoveryMap[dong.dong_name];
        var recBadge = "";
        if (rec) {
          var st = RECOVERY_STATUS[rec.status] || RECOVERY_STATUS.flat;
          recBadge = '<div style="font-size:8px;margin-top:1px;opacity:.85;">' + st.label + '</div>';
        }

        var el = document.createElement("div");
        el.className = "map-marker";
        el.style.background = color;
        el.style.minWidth = size + "px";
        el.style.padding = "4px 8px";
        el.style.fontSize = "10px";
        el.innerHTML = '<div style="font-size:9px;opacity:.85;">' + dong.dong_name + '</div>'
          + '<div style="font-size:12px;font-weight:800;">' + Math.round(dong.avg_per_m2).toLocaleString() + '</div>'
          + recBadge;

        var overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(c.lat, c.lng),
          content: el,
          yAnchor: 0.5,
          xAnchor: 0.5
        });
        overlay.setMap(map);

        el.addEventListener("click", function() {
          var html = '<div class="map-info-header">'
            + '<span class="map-info-name">' + dong.dong_name + '</span>';
          if (rec) {
            var st2 = RECOVERY_STATUS[rec.status] || RECOVERY_STATUS.flat;
            html += '<span class="recovery-badge ' + rec.status + '">' + st2.label + '</span>';
          }
          html += '</div><div class="map-info-stats">'
            + '<div class="map-info-stat"><span class="map-info-label">m\u00B2\uB2F9 \uD3C9\uADE0</span><span class="map-info-val">' + Math.round(dong.avg_per_m2).toLocaleString() + '\uB9CC</span></div>'
            + '<div class="map-info-stat"><span class="map-info-label">\uAC70\uB798\uAC74\uC218</span><span class="map-info-val">' + dong.txn_count + '\uAC74</span></div>';
          if (dong.median_price) {
            html += '<div class="map-info-stat"><span class="map-info-label">\uC911\uC704 \uB9E4\uB9E4\uAC00</span><span class="map-info-val">' + (dong.median_price / 10000).toFixed(1) + '\uC5B5</span></div>';
          }
          if (rec) {
            var vsPeakStr = (rec.vs_peak >= 0 ? "+" : "") + rec.vs_peak + "%";
            var chg6mStr = (rec.chg6m >= 0 ? "+" : "") + rec.chg6m + "%";
            var st3 = RECOVERY_STATUS[rec.status] || RECOVERY_STATUS.flat;
            html += '<div class="map-info-stat"><span class="map-info-label">\uC804\uACE0\uC810 \uB300\uBE44</span><span class="map-info-val" style="color:' + st3.textColor + '">' + vsPeakStr + '</span></div>'
              + '<div class="map-info-stat"><span class="map-info-label">6\uAC1C\uC6D4 \uBCC0\uD654</span><span class="map-info-val">' + chg6mStr + '</span></div>';
          }
          html += '</div>';
          // 개별 단지 회복률 리스트
          if (rec && rec.apt_details && rec.apt_details.length) {
            html += '<div class="apt-detail-list">'
              + '<div class="apt-detail-header">\uB2E8\uC9C0\uBCC4 \uD68C\uBCF5\uB960 (\uAC19\uC740 \uD3C9\uC218 \uAE30\uC900)</div>';
            rec.apt_details.forEach(function(a) {
              var ast = RECOVERY_STATUS[a.status] || RECOVERY_STATUS.flat;
              var avp = (a.vs_peak >= 0 ? "+" : "") + a.vs_peak + "%";
              html += '<div class="apt-detail-row">'
                + '<span class="apt-detail-name">' + a.apt_name + ' <span style="color:var(--muted);font-weight:400;">' + a.area_m2 + 'm\u00B2</span></span>'
                + '<span class="apt-detail-val">'
                + '<span style="color:' + ast.textColor + ';font-weight:700;">' + avp + '</span>'
                + ' <span class="recovery-badge ' + a.status + '" style="font-size:9px;padding:1px 6px;">' + ast.label + '</span>'
                + '</span></div>';
            });
            html += '</div>';
          }
          infoPanel.innerHTML = html;
          infoPanel.style.display = "block";
          infoPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
    });
  });

  return sec;
}

/* ── 시도 전체: 구별 시세 지도 ── */
function renderDistrictMap(sidoData, title, sido) {
  if (!sidoData || !sidoData.districts) return null;
  if (typeof kakao === "undefined" || !kakao.maps) return null;

  var distOrder = sidoData.district_order || Object.keys(sidoData.districts);
  var distStats = [];
  distOrder.forEach(function(distName) {
    var dist = sidoData.districts[distName];
    if (!dist || !dist.dong_stats || !dist.dong_stats.length) return;
    var totalPrice = 0, totalCount = 0;
    dist.dong_stats.forEach(function(d) {
      totalPrice += d.avg_per_m2 * d.txn_count;
      totalCount += d.txn_count;
    });
    if (totalCount === 0) return;
    var rec = null;
    if (sidoData.recovery && sidoData.recovery.items) {
      sidoData.recovery.items.forEach(function(r) {
        if (r.name === distName) rec = r;
      });
    }
    distStats.push({
      name: distName,
      avg_per_m2: Math.round(totalPrice / totalCount),
      txn_count: totalCount,
      dong_count: dist.dong_stats.length,
      recovery: rec
    });
  });

  if (!distStats.length) return null;

  var sec = document.createElement("div");
  sec.className = "section";
  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uAD6C\uBCC4 m\u00B2\uB2F9 \uD3C9\uADE0\uAC00 + \uD68C\uBCF5\uB960 \u00B7 \uD074\uB9AD\uC2DC \uC0C1\uC138 \uC815\uBCF4";
  sec.appendChild(sub);

  var mapDiv = document.createElement("div");
  mapDiv.className = "map-container";
  sec.appendChild(mapDiv);

  var legend = document.createElement("div");
  legend.className = "map-legend";
  legend.style.gap = "8px";
  legend.innerHTML = '<span style="font-size:11px;color:var(--muted);">\uC800\uAC00</span>'
    + '<span style="display:inline-block;width:120px;height:10px;border-radius:5px;background:linear-gradient(90deg,#06b6d4,#2563eb,#7c3aed);"></span>'
    + '<span style="font-size:11px;color:var(--muted);">\uACE0\uAC00</span>'
    + '<span style="margin-left:12px;font-size:11px;color:var(--muted);">\u25CF \uD06C\uAE30 = \uAC70\uB798\uB7C9</span>';
  sec.appendChild(legend);

  var infoPanel = document.createElement("div");
  infoPanel.className = "map-info-panel";
  infoPanel.style.display = "none";
  sec.appendChild(infoPanel);

  var prices = distStats.map(function(d) { return d.avg_per_m2; });
  var minP = Math.min.apply(null, prices);
  var maxP = Math.max.apply(null, prices);
  var volumes = distStats.map(function(d) { return d.txn_count; });
  var maxVol = Math.max.apply(null, volumes) || 1;

  requestAnimationFrame(function() {
    var center = SIDO_CENTERS[sido] || { lat: 37.5665, lng: 126.9780, level: 8 };
    var map = new kakao.maps.Map(mapDiv, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level: center.level
    });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);

    distStats.forEach(function(dist) {
      geocodeAddr(sido + " " + dist.name).then(function(c) {
        if (!c) return;
        var color = priceColor(dist.avg_per_m2, minP, maxP);
        var volRatio = dist.txn_count / maxVol;
        var size = Math.round(36 + volRatio * 36);
        var rec = dist.recovery;
        var recLine = "";
        if (rec) {
          var st = RECOVERY_STATUS[rec.status] || RECOVERY_STATUS.flat;
          var vsPeak = (rec.vs_peak >= 0 ? "+" : "") + rec.vs_peak + "%";
          recLine = '<div style="font-size:9px;margin-top:1px;">' + st.label + ' ' + vsPeak + '</div>';
        }

        var el = document.createElement("div");
        el.className = "map-marker";
        el.style.background = color;
        el.style.minWidth = size + "px";
        el.style.padding = "5px 10px";
        el.innerHTML = '<div style="font-size:10px;opacity:.85;">' + dist.name + '</div>'
          + '<div style="font-size:13px;font-weight:800;">' + dist.avg_per_m2.toLocaleString() + '</div>'
          + recLine;

        var overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(c.lat, c.lng),
          content: el,
          yAnchor: 0.5,
          xAnchor: 0.5
        });
        overlay.setMap(map);

        el.addEventListener("click", function() {
          var html = '<div class="map-info-header"><span class="map-info-name">' + dist.name + '</span>';
          if (rec) {
            var st2 = RECOVERY_STATUS[rec.status] || RECOVERY_STATUS.flat;
            html += '<span class="recovery-badge ' + rec.status + '">' + st2.label + '</span>';
          }
          html += '</div><div class="map-info-stats">'
            + '<div class="map-info-stat"><span class="map-info-label">m\u00B2\uB2F9 \uD3C9\uADE0</span><span class="map-info-val">' + dist.avg_per_m2.toLocaleString() + '\uB9CC</span></div>'
            + '<div class="map-info-stat"><span class="map-info-label">\uAC70\uB798\uAC74\uC218</span><span class="map-info-val">' + dist.txn_count + '\uAC74</span></div>'
            + '<div class="map-info-stat"><span class="map-info-label">\uB3D9 \uC218</span><span class="map-info-val">' + dist.dong_count + '\uAC1C</span></div>';
          if (rec) {
            var vsPeakStr = (rec.vs_peak >= 0 ? "+" : "") + rec.vs_peak + "%";
            var chg6mStr = (rec.chg6m >= 0 ? "+" : "") + rec.chg6m + "%";
            var st3 = RECOVERY_STATUS[rec.status] || RECOVERY_STATUS.flat;
            html += '<div class="map-info-stat"><span class="map-info-label">\uC804\uACE0\uC810 \uB300\uBE44</span><span class="map-info-val" style="color:' + st3.textColor + '">' + vsPeakStr + '</span></div>'
              + '<div class="map-info-stat"><span class="map-info-label">6\uAC1C\uC6D4 \uBCC0\uD654</span><span class="map-info-val">' + chg6mStr + '</span></div>';
          }
          html += '</div>';
          infoPanel.innerHTML = html;
          infoPanel.style.display = "block";
          infoPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
    });
  });

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

  // 통합 지도 (시세 + 회복률)
  if (activeDistrict && data.dong_stats && data.dong_stats.length > 1) {
    var mapSec = renderCombinedMap(data.dong_stats, data.dong_recovery, activeDistrict + " \uB3D9\uBCC4 \uC2DC\uC138 \uC9C0\uB3C4", activeSido, activeDistrict);
    if (mapSec) gridEl.appendChild(mapSec);
  } else if (!activeDistrict && sidoData.districts) {
    var distMapSec = renderDistrictMap(sidoData, activeSido + " \uAD6C\uBCC4 \uC2DC\uC138 \uC9C0\uB3C4", activeSido);
    if (distMapSec) gridEl.appendChild(distMapSec);
  }

  // 시세 추이 차트
  if (data.trend && data.trend.length > 1) {
    gridEl.appendChild(renderTrendSection(data.trend, regionName + " \uC2DC\uC138 \uCD94\uC774"));
  }

  // 동네별 시세 비교 (바 차트)
  if (activeDistrict && data.dong_stats && data.dong_stats.length > 1) {
    var dongSec = renderDongStats(data.dong_stats, activeDistrict + " \uB3D9\uBCC4 \uC2DC\uC138 \uBE44\uAD50");
    if (dongSec) gridEl.appendChild(dongSec);
  } else if (!activeDistrict && sidoData.districts) {
    var allDongSec = renderAllDongStats(sidoData, activeSido + " \uB3D9\uBCC4 \uC2DC\uC138 \uBE44\uAD50");
    if (allDongSec) gridEl.appendChild(allDongSec);
  }

  // 시세 회복 현황 (바 차트 — 항상 표시)
  var recovery = sidoData.recovery;
  if (!activeDistrict && recovery && recovery.items && recovery.items.length) {
    var recSec = renderRecoverySection(recovery.items, activeSido + " \uC2DC\uC138 \uD68C\uBCF5 \uD604\uD669", false);
    if (recSec) gridEl.appendChild(recSec);
  }
  var dongRec = data.dong_recovery;
  if (activeDistrict && dongRec && dongRec.items && dongRec.items.length) {
    var dRecSec = renderRecoverySection(dongRec.items, activeDistrict + " \uB3D9\uBCC4 \uD68C\uBCF5 \uD604\uD669", true);
    if (dRecSec) gridEl.appendChild(dRecSec);
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
  try {
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

    statusEl.innerHTML = "";
    var dateOnly = globalData.updated_at ? globalData.updated_at.slice(0, 10) : "";
    metaEl.textContent = "\uC5C5\uB370\uC774\uD2B8: " + dateOnly;
  } catch (e) {
    statusEl.textContent = "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
  }
}

init();

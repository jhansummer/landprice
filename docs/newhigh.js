/* APT Mine - 신고가 아파트 검색 */
var summaryPath = "data/apt_trade/newhigh_summary.json";

var tabsEl = document.getElementById("tabs");
var subtabsEl = document.getElementById("subtabs");
var dongtabsEl = document.getElementById("dongtabs");
var statusEl = document.getElementById("status");
var resultsEl = document.getElementById("results");

var globalData = null;
var activeSido = null;
var activeDistrict = null;
var activeDong = null;
var PAGE_SIZE = 20;
var visibleCount = PAGE_SIZE;

var RECOVERY_STATUS = APTCommon.RECOVERY_STATUS;
var fmt = APTCommon.fmt;

/* ── 필터 요소 ── */
var fAreaMin = document.getElementById("f-area-min");
var fAreaMax = document.getElementById("f-area-max");
var fPriceMin = document.getElementById("f-price-min");
var fPriceMax = document.getElementById("f-price-max");
var fSearchBtn = document.getElementById("f-search");

fSearchBtn.addEventListener("click", function () {
  visibleCount = PAGE_SIZE;
  renderResults();
});

/* ── 억원 포맷 ── */
function fmtEok(val) {
  if (val >= 1) return val.toFixed(1) + "억";
  return (val * 10000).toFixed(0) + "만";
}

/* ── 시도 탭 ── */
function renderTabs(sidoOrder) {
  APTCommon.renderTabs(tabsEl, sidoOrder, activeSido, function (sido) {
    activeSido = sido;
    activeDistrict = null;
    activeDong = null;
    visibleCount = PAGE_SIZE;
    renderTabs(sidoOrder);
    renderSubTabs();
    renderDongTabs();
    renderResults();
    updateHash();
  });
}

/* ── 구/군 드롭다운 ── */
function renderSubTabs() {
  if (!globalData || !activeSido) { subtabsEl.innerHTML = ""; return; }
  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) { subtabsEl.innerHTML = ""; return; }
  APTCommon.renderSubTabs(subtabsEl, sidoData.district_order, activeSido, activeDistrict, function (district) {
    activeDistrict = district;
    activeDong = null;
    visibleCount = PAGE_SIZE;
    renderDongTabs();
    renderResults();
    updateHash();
  });
}

/* ── 동 드롭다운 ── */
function renderDongTabs() {
  dongtabsEl.innerHTML = "";
  if (!globalData || !activeSido || !activeDistrict) return;
  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;
  var distData = sidoData.districts[activeDistrict];
  if (!distData || !distData.dong_order || !distData.dong_order.length) return;

  var select = document.createElement("select");
  select.className = "dong-select";

  var allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "전체 동";
  if (activeDong === null) allOpt.selected = true;
  select.appendChild(allOpt);

  distData.dong_order.forEach(function (dong) {
    var opt = document.createElement("option");
    opt.value = dong;
    opt.textContent = dong;
    if (dong === activeDong) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", function () {
    activeDong = select.value || null;
    visibleCount = PAGE_SIZE;
    renderResults();
    updateHash();
  });

  dongtabsEl.appendChild(select);
}

/* ── 신고가 아파트 수집 (필터 적용) ── */
function collectNewHighApts() {
  if (!globalData || !activeSido) return [];
  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return [];

  var areaMin = parseFloat(fAreaMin.value) || 0;
  var areaMax = parseFloat(fAreaMax.value) || Infinity;
  var priceMinEok = parseFloat(fPriceMin.value) || 0;
  var priceMaxEok = parseFloat(fPriceMax.value) || Infinity;

  var items = [];
  var districts = activeDistrict ? [activeDistrict] : (sidoData.district_order || []);

  districts.forEach(function (distName) {
    var dist = sidoData.districts[distName];
    if (!dist || !dist.dong_recovery || !dist.dong_recovery.items) return;

    dist.dong_recovery.items.forEach(function (dongItem) {
      if (!dongItem.apt_details) return;
      if (activeDong && dongItem.name !== activeDong) return;

      dongItem.apt_details.forEach(function (apt) {
        if (apt.vs_all_time_peak > 0) {
          // 면적 필터
          if (apt.area_m2 < areaMin || apt.area_m2 > areaMax) return;

          // 총 매매가 (억원) 필터
          var totalPriceEok = (apt.price * apt.area_m2) / 10000;
          if (totalPriceEok < priceMinEok || totalPriceEok > priceMaxEok) return;

          items.push({
            id: apt.id,
            apt_name: apt.apt_name,
            district: distName,
            dong: dongItem.name,
            area_m2: apt.area_m2,
            price: apt.price,
            peak: apt.all_time_peak,
            vs_peak: apt.vs_all_time_peak,
            chg6m: apt.chg6m,
            status: apt.status,
            last_deal_date: apt.last_deal_date || ""
          });
        }
      });
    });
  });

  items.sort(function (a, b) { return b.vs_peak - a.vs_peak || b.price - a.price; });
  return items;
}

/* ── 카드 렌더링 ── */
function renderCard(apt) {
  var card = document.createElement("div");
  card.className = "section newhigh-card";
  card.style.cssText = "padding:16px 20px;margin-bottom:10px";

  var st = RECOVERY_STATUS[apt.status] || RECOVERY_STATUS.recovered;

  // 총 매매가·고점가 (억원)
  var totalPrice = (apt.price * apt.area_m2) / 10000;
  var totalPeak = (apt.peak * apt.area_m2) / 10000;
  var pyeong = (apt.area_m2 / 3.306).toFixed(0);

  // 상단: 단지명 + 뱃지
  var header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px";

  var nameWrap = document.createElement("div");
  nameWrap.style.cssText = "display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden";
  var nameEl = document.createElement("div");
  nameEl.style.cssText = "font-size:15px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  nameEl.textContent = apt.apt_name;
  nameWrap.appendChild(nameEl);
  header.appendChild(nameWrap);

  var badge = document.createElement("span");
  badge.className = "recovery-badge " + apt.status;
  badge.textContent = st.label;
  header.appendChild(badge);

  card.appendChild(header);

  // 위치 + 면적 (m² + 평)
  var locEl = document.createElement("div");
  locEl.style.cssText = "font-size:12px;color:var(--muted);margin-bottom:10px";
  var locText = apt.district + " " + apt.dong + " · " + apt.area_m2.toFixed(0) + "m\u00B2(" + pyeong + "\ud3c9)";
  if (apt.last_deal_date) locText += " · \uc2e0\uace0\uac00 " + apt.last_deal_date.replace(/-/g, ".");
  locEl.textContent = locText;
  card.appendChild(locEl);

  // 가격 정보 그리드
  var grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px";

  // 현재가 (억원)
  var priceBox = document.createElement("div");
  priceBox.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:2px">현재가</div>'
    + '<div style="font-size:15px;font-weight:800;color:var(--up)">' + fmtEok(totalPrice) + '</div>';
  grid.appendChild(priceBox);

  // 고점가 (억원)
  var peakBox = document.createElement("div");
  peakBox.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:2px">고점가</div>'
    + '<div style="font-size:15px;font-weight:800;color:var(--ink)">' + fmtEok(totalPeak) + '</div>';
  grid.appendChild(peakBox);

  // 고점 대비
  var vsPeakBox = document.createElement("div");
  vsPeakBox.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:2px">고점 대비</div>'
    + '<div style="font-size:15px;font-weight:800;color:var(--up)">+' + apt.vs_peak.toFixed(1) + '%</div>';
  grid.appendChild(vsPeakBox);

  card.appendChild(grid);

  // 6개월 변화
  if (apt.chg6m !== undefined && apt.chg6m !== null) {
    var chgEl = document.createElement("div");
    chgEl.style.cssText = "margin-top:8px;font-size:11px;color:var(--muted)";
    var chgColor = apt.chg6m >= 0 ? "var(--up)" : "var(--down)";
    var chgSign = apt.chg6m >= 0 ? "+" : "";
    chgEl.innerHTML = '6개월 변화 <span style="font-weight:700;color:' + chgColor + '">' + chgSign + apt.chg6m.toFixed(1) + '%</span>';
    card.appendChild(chgEl);
  }

  // 차트 영역
  if (apt.id) {
    var chartWrap = document.createElement("div");
    chartWrap.style.cssText = "margin-top:12px";
    var canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:180px";
    chartWrap.appendChild(canvas);
    card.appendChild(chartWrap);

    // 비동기로 by_apt 데이터 로드 후 차트 그리기
    (function (cvs, aptId) {
      fetch("data/apt_trade/by_apt/" + aptId + ".json?t=" + Date.now())
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (txns) {
          if (txns && txns.length) {
            drawNewHighChart(cvs, txns);
          }
        })
        .catch(function () {});
    })(canvas, apt.id);
  }

  // 단지상세 링크
  if (apt.id) {
    var ctaWrap = document.createElement("div");
    ctaWrap.style.cssText = "margin-top:10px;display:flex;gap:8px";
    var aptLink = document.createElement("a");
    aptLink.className = "apt-detail-link";
    aptLink.href = "apt.html?id=" + encodeURIComponent(apt.id) + "&s=" + encodeURIComponent(activeSido || "");
    aptLink.textContent = "단지상세";
    aptLink.addEventListener("click", function (e) { e.stopPropagation(); });
    ctaWrap.appendChild(aptLink);
    card.appendChild(ctaWrap);
  }

  return card;
}

/* ── 결과 표시 ── */
function renderResults() {
  resultsEl.innerHTML = "";

  var items = collectNewHighApts();

  if (items.length === 0) {
    statusEl.innerHTML = "";
    var msg = document.createElement("div");
    msg.style.cssText = "text-align:center;color:var(--muted);font-size:14px;margin:40px 0";
    msg.textContent = "선택한 지역에 신고가 단지가 없습니다.";
    resultsEl.appendChild(msg);
    return;
  }

  // 요약
  var summary = document.createElement("div");
  summary.style.cssText = "font-size:13px;color:var(--muted);margin-bottom:12px;font-weight:500";
  var locationText = activeSido;
  if (activeDistrict) locationText += " " + activeDistrict;
  if (activeDong) locationText += " " + activeDong;
  summary.textContent = locationText + " 신고가 단지 " + fmt(items.length) + "개";
  resultsEl.appendChild(summary);

  // 카드 렌더
  var shown = Math.min(visibleCount, items.length);
  for (var i = 0; i < shown; i++) {
    resultsEl.appendChild(renderCard(items[i]));
  }

  // 더보기 버튼
  if (shown < items.length) {
    var moreBtn = document.createElement("button");
    moreBtn.className = "search-btn";
    moreBtn.style.cssText = "display:block;margin:16px auto;padding:12px 40px";
    moreBtn.textContent = "더보기 (" + (items.length - shown) + "개 남음)";
    moreBtn.addEventListener("click", function () {
      visibleCount += PAGE_SIZE;
      renderResults();
    });
    resultsEl.appendChild(moreBtn);
  }

  statusEl.innerHTML = "";
}

/* ── URL hash 관리 ── */
function updateHash() {
  var parts = [activeSido];
  if (activeDistrict) parts.push(activeDistrict);
  if (activeDong) parts.push(activeDong);
  history.replaceState(null, "", "#" + parts.join("/"));
}

function parseHash() {
  var hash = decodeURIComponent(location.hash.replace("#", ""));
  return hash.split("/");
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
    var parts = parseHash();
    var hashSido = parts[0] || "";
    var hashDist = parts[1] || "";
    var hashDong = parts[2] || "";

    activeSido = sidoOrder.indexOf(hashSido) >= 0 ? hashSido : sidoOrder[0] || null;

    if (hashDist && activeSido && globalData.sidos[activeSido]) {
      var dOrder = globalData.sidos[activeSido].district_order || [];
      if (dOrder.indexOf(hashDist) >= 0) {
        activeDistrict = hashDist;
        if (hashDong && globalData.sidos[activeSido].districts[hashDist]) {
          var dongOrder = globalData.sidos[activeSido].districts[hashDist].dong_order || [];
          if (dongOrder.indexOf(hashDong) >= 0) activeDong = hashDong;
        }
      }
    }

    renderTabs(sidoOrder);
    renderSubTabs();
    renderDongTabs();
    renderResults();

    statusEl.innerHTML = "";
  } catch (e) {
    statusEl.textContent = "네트워크 오류가 발생했습니다. 새로고침해주세요.";
  }
}

init();

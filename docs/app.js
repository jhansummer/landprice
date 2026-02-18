const summaryPath = "data/apt_trade/summary.json";

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

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

function calcChangeBadge(history, latestPrice) {
  if (!history || history.length < 2 || !latestPrice) return null;
  var prevPrice = history[history.length - 2][1];
  if (!prevPrice) return null;
  return ((latestPrice / prevPrice) - 1) * 100;
}

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
      activeDong = null;
      renderTabs(sidoOrder);
      renderSubTabs();
      renderSections();
      history.replaceState(null, "", "#" + sido);
      APTWatchlist.track("tab_switch", { sido: sido, page: "main" });
    });
    tabsEl.appendChild(btn);
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
  var aptEl = document.createElement("div");
  aptEl.className = "rank-apt";
  aptEl.textContent = r.apt_name;
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

  var detailBtn = document.createElement("button");
  detailBtn.className = "detail-btn";
  detailBtn.textContent = "\uC0C1\uC138";
  detailBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    showDetail(r);
    APTWatchlist.track("view_detail", { apt_name: r.apt_name, page: "main" });
  });
  ctaGroup.appendChild(detailBtn);

  if (r.id) {
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

  sidoData.district_order.forEach(function (dist) {
    var opt = document.createElement("option");
    opt.value = dist;
    opt.textContent = dist;
    if (dist === activeDistrict) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", function () {
    activeDistrict = select.value || null;
    activeDong = null;
    renderSections();
    var hash = activeSido;
    if (activeDistrict) hash += "/" + activeDistrict;
    history.replaceState(null, "", "#" + hash);
    APTWatchlist.track("district_select", { sido: activeSido, district: activeDistrict || "all", page: "main" });
  });

  subtabsEl.appendChild(select);
}

// renderFilters removed - nav is now hardcoded in HTML

/* ── 대시보드 ── */
function renderDashboard() {
  var dashEl = document.getElementById("dashboard");
  if (!dashEl || !globalData || !activeSido) return;
  dashEl.innerHTML = "";

  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;

  var trend = sidoData.trend;
  if (trend && trend.length >= 2) {
    var latest = trend[trend.length - 1];
    var prev = trend[trend.length - 2];
    var avgPrice = latest[1];
    var momChange = ((avgPrice / prev[1]) - 1) * 100;
    var txnCount = latest[2] || 0;

    var recDist = { recovered: 0, rising: 0, flat: 0, falling: 0 };
    if (sidoData.recovery && sidoData.recovery.items) {
      sidoData.recovery.items.forEach(function(item) {
        if (recDist[item.status] !== undefined) recDist[item.status]++;
      });
    }
    var totalRec = recDist.recovered + recDist.rising + recDist.flat + recDist.falling;

    // 시장 요약 문장
    var summaryText = activeSido + " 아파트 거래 단가(m\u00B2당)는 전월 대비 "
      + (momChange >= 0 ? "+" : "") + momChange.toFixed(1) + "%";
    if (totalRec > 0) {
      summaryText += ", " + totalRec + "개 구 중 " + recDist.recovered + "개 구 고점 대비 상승";
    }
    var summary = document.createElement("p");
    summary.className = "market-summary";
    summary.textContent = summaryText;
    dashEl.appendChild(summary);

    // 지표 카드
    var cards = document.createElement("div");
    cards.className = "dashboard-cards";

    var card1 = document.createElement("div");
    card1.className = "dash-card";
    card1.innerHTML = '<div class="dash-card-label">거래 단가 (m\u00B2당)</div>'
      + '<div class="dash-card-value">' + Math.round(avgPrice).toLocaleString() + '<span class="dash-card-unit">만원</span></div>'
      + '<div class="dash-card-change ' + (momChange >= 0 ? 'up' : 'down') + '">'
      + (momChange >= 0 ? '\u25B2' : '\u25BC') + ' ' + Math.abs(momChange).toFixed(1) + '% 전월대비</div>';
    cards.appendChild(card1);

    var card2 = document.createElement("div");
    card2.className = "dash-card";
    card2.innerHTML = '<div class="dash-card-label">이번 달 거래건수</div>'
      + '<div class="dash-card-value">' + txnCount.toLocaleString() + '<span class="dash-card-unit">건</span></div>';
    cards.appendChild(card2);

    // 전세가율 카드
    if (sidoData.jeonse && sidoData.jeonse.avg_ratio) {
      var cardJ = document.createElement("div");
      cardJ.className = "dash-card";
      cardJ.style.cursor = "pointer";
      cardJ.addEventListener("click", function() {
        location.href = "jeonse.html#" + activeSido;
      });
      cardJ.innerHTML = '<div class="dash-card-label">평균 전세가율</div>'
        + '<div class="dash-card-value">' + sidoData.jeonse.avg_ratio.toFixed(1) + '<span class="dash-card-unit">%</span></div>'
        + '<div class="dash-card-change" style="color:var(--muted)">' + sidoData.jeonse.count + '개 단지 기준</div>';
      cards.appendChild(cardJ);
    }

    if (totalRec > 0) {
      var card3 = document.createElement("div");
      card3.className = "dash-card dash-card-wide";
      var recBarHTML = '<div class="recovery-dist-bar">';
      if (recDist.recovered > 0) recBarHTML += '<div class="rec-bar-seg recovered" style="width:' + (recDist.recovered / totalRec * 100) + '%">' + recDist.recovered + '</div>';
      if (recDist.rising > 0) recBarHTML += '<div class="rec-bar-seg rising" style="width:' + (recDist.rising / totalRec * 100) + '%">' + recDist.rising + '</div>';
      if (recDist.flat > 0) recBarHTML += '<div class="rec-bar-seg flat" style="width:' + (recDist.flat / totalRec * 100) + '%">' + recDist.flat + '</div>';
      if (recDist.falling > 0) recBarHTML += '<div class="rec-bar-seg falling" style="width:' + (recDist.falling / totalRec * 100) + '%">' + recDist.falling + '</div>';
      recBarHTML += '</div>';
      card3.innerHTML = '<div class="dash-card-label">고점 대비 현황 (21~22년 전고점 기준) <span style="font-weight:400;color:var(--muted);font-size:11px">' + activeSido + ' ' + totalRec + '개 구/시 기준</span></div>'
        + recBarHTML
        + '<div class="recovery-dist-legend">'
        + '<span><span class="rec-dot recovered"></span>상승 ' + recDist.recovered + '</span>'
        + '<span><span class="rec-dot rising"></span>회복 ' + recDist.rising + '</span>'
        + '<span><span class="rec-dot flat"></span>횡보 ' + recDist.flat + '</span>'
        + '<span><span class="rec-dot falling"></span>하락 ' + recDist.falling + '</span>'
        + '</div>';
      cards.appendChild(card3);
    }

    dashEl.appendChild(cards);
  }

  // 시세 + 거래량 추이 차트
  if (trend && trend.length > 2) {
    var trendSec = document.createElement("div");
    trendSec.className = "popular-districts";
    var trendTitle = document.createElement("h3");
    trendTitle.className = "popular-title";
    trendTitle.textContent = "거래 단가 + 거래량 추이 (최근 7년)";
    trendSec.appendChild(trendTitle);
    var chartDiv = document.createElement("div");
    chartDiv.className = "scatter-chart";
    chartDiv.style.height = "180px";
    var chartCanvas = document.createElement("canvas");
    chartDiv.appendChild(chartCanvas);
    trendSec.appendChild(chartDiv);
    dashEl.appendChild(trendSec);
    requestAnimationFrame(function() { drawPriceVolumeChart(chartCanvas, trend); });
  }

  // 인기 지역 (거래량 상위 5)
  if (sidoData.districts) {
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

    if (top5.length) {
      var popularSec = document.createElement("div");
      popularSec.className = "popular-districts";
      var ptitle = document.createElement("h3");
      ptitle.className = "popular-title";
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
      dashEl.appendChild(popularSec);
    }
  }
}

function renderSections() {
  gridEl.innerHTML = "";
  if (!globalData || !activeSido) return;

  renderDashboard();

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
  if (data.section4) {
    gridEl.appendChild(renderSection(data.section4));
  }
  if (data.section3) {
    gridEl.appendChild(renderSection(data.section3));
  }

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
    + '<a class="popular-item" href="jeonse.html#' + activeSido + '" onclick="APTWatchlist.track(\'next_action_click\',{source:\'main\',target:\'jeonse\'})">'
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

  Promise.all(targets.map(function (t) {
    return fetch("data/apt_trade/by_apt/" + t.id + ".json")
      .then(function (res) {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then(function (history) { return { name: t.name, history: history, price: t.price, region: t.region }; });
  }))
    .then(function (seriesList) {
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
  } catch (e) {
    statusEl.textContent = "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
  }
}

init();

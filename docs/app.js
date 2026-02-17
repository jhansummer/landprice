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
  var detailBtn = document.createElement("button");
  detailBtn.className = "detail-btn";
  detailBtn.textContent = "\uC790\uC138\uD788";
  detailBtn.style.marginTop = "6px";
  detailBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    showDetail(r);
  });
  changeEl.appendChild(detailBtn);
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
  });

  subtabsEl.appendChild(select);
}

// renderFilters removed - nav is now hardcoded in HTML

function renderSections() {
  gridEl.innerHTML = "";
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
  if (data.section4) {
    gridEl.appendChild(renderSection(data.section4));
  }
  if (data.section3) {
    gridEl.appendChild(renderSection(data.section3));
  }
}

function showDetail(r) {
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
        var colors = ["#1a6f5a", "#2a6f97", "#b56576"];
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
          var priceText = (s.price != null) ? (" (현재 " + fmt(Math.round(s.price)) + "만)") : "";
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
      thead.innerHTML = "<tr><th>\uB0A0\uC9DC</th><th>\uAC00\uACA9(\uB9CC)</th></tr>";
      table.appendChild(thead);
      var tbody = document.createElement("tbody");
      for (var i = baseHistory.length - 1; i >= 0; i--) {
        var tr = document.createElement("tr");
        var tdDate = document.createElement("td");
        tdDate.textContent = baseHistory[i][0];
        var tdPrice = document.createElement("td");
        tdPrice.textContent = fmt(baseHistory[i][1]);
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

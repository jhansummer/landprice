/* APT Mine — 단지분석 (valuation search) */
(function () {
  var INDEX_PATH = "data/apt_trade/valuation/index.json";
  var BY_APT_BASE = "data/apt_trade/by_apt/";
  var LOCATION_SCORES_PATH = "data/apt_trade/location_scores.json";
  var VALUATION_GEO_PATH = "data/apt_trade/valuation_geo.json";
  var SUMMARY_PATH = "data/apt_trade/summary.json";
  var CHART_COLORS = ["#2563eb", "#ef4444", "#f59e0b"];
  var STATUS_LABELS = {
    undervalued: "저평가",
    leading: "리딩단지"
  };

  var statusEl = document.getElementById("status");
  var resultsEl = document.getElementById("results");
  var searchInput = document.getElementById("searchInput");
  var searchBtn = document.getElementById("searchBtn");
  var globalIndex = null;
  var sidoCache = {};
  var acDropdown = null;
  var acTimeout = null;
  var txnCache = {};
  var locationScores = null;
  var transportMinMax = null;
  var valuationGeo = null;
  var summaryAll = null;

  /* ── helpers ── */
  function fmt(v) { return new Intl.NumberFormat("ko-KR").format(Math.round(v)); }
  function fmtEok(v) { return (v / 10000).toFixed(1) + "\uC5B5"; }
  function fmtPerM2(price, area) { return (price / area / 1000).toFixed(1) + "\uCC9C\uB9CC/m\u00B2"; }
  var escapeHTML = APTCommon.escapeHTML;

  /* ── URL state ── */
  function updateURL() {
    var q = searchInput.value.trim();
    if (q) history.replaceState(null, "", "#?q=" + encodeURIComponent(q));
  }
  function parseURL() {
    var hash = decodeURIComponent(location.hash.replace("#", ""));
    if (!hash) return {};
    var parts = hash.split("?q=");
    return { query: parts[1] || "" };
  }

  /* ── data loading ── */
  function loadSido(sido) {
    if (sidoCache[sido]) return Promise.resolve(sidoCache[sido]);
    var path = "data/apt_trade/valuation/" + sido + ".json?t=" + Date.now();
    return fetch(path).then(function (r) { return r.json(); }).then(function (data) {
      sidoCache[sido] = data;
      return data;
    });
  }

  function loadAllSidos() {
    if (!globalIndex) return Promise.resolve();
    var promises = globalIndex.sido_order.map(function (sido) { return loadSido(sido); });
    return Promise.all(promises);
  }

  function getAllItems() {
    var all = [];
    globalIndex.sido_order.forEach(function (sido) {
      var data = sidoCache[sido];
      if (data && data.items) {
        data.items.forEach(function (item) { item._sido = sido; all.push(item); });
      }
    });
    return all;
  }

  function loadTxn(aptId) {
    if (txnCache[aptId]) return Promise.resolve(txnCache[aptId]);
    return fetch(BY_APT_BASE + aptId + ".json").then(function (r) { return r.json(); }).then(function (data) {
      txnCache[aptId] = data;
      return data;
    }).catch(function () { return []; });
  }

  /* ── value scoring data ── */
  function loadLocationScores() {
    return fetch(LOCATION_SCORES_PATH + "?t=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) { locationScores = data; })
      .catch(function () { locationScores = null; });
  }
  function loadValuationGeo() {
    return fetch(VALUATION_GEO_PATH + "?t=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) { valuationGeo = data; })
      .catch(function () { valuationGeo = null; });
  }
  function loadSummary() {
    return fetch(SUMMARY_PATH + "?t=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) { summaryAll = data; })
      .catch(function () { summaryAll = null; });
  }
  function buildTransportMinMax() {
    if (!locationScores) return;
    var min = Infinity, max = -Infinity;
    Object.keys(locationScores).forEach(function (sido) {
      var gus = locationScores[sido];
      Object.keys(gus).forEach(function (gu) {
        var t = gus[gu].transport;
        var score = t.gangnam * 0.5 + t.gwanghwamun * 0.25 + t.yeouido * 0.25;
        if (score < min) min = score;
        if (score > max) max = score;
      });
    });
    transportMinMax = { min: min, max: max };
  }

  /**
   * 역세권 점수 산출: max(5, 100 - dist_m / 30)
   * @param {number} distKm - 최근접 역 거리 (km)
   * @returns {number} 0~100
   */
  function calcSubwayScore(distKm) {
    var distM = distKm * 1000;
    return Math.max(5, Math.round(100 - distM / 30));
  }

  /**
   * 출퇴근 접근성 점수 (bottom.js와 동일 공식)
   * 역세권(30%) + 업무지구(70%), biz 없으면 역세권만
   */
  function calcCommuteScore(item) {
    var geo = valuationGeo && valuationGeo[item.id];
    if (!geo || geo.subway_dist == null) return null;
    var subwayScore = Math.max(0, 100 - geo.subway_dist * 50);
    if (geo.biz_gangnam == null) return Math.round(subwayScore);
    var gangnam = Math.max(0, 100 - geo.biz_gangnam * 4);
    var gwanghwamun = Math.max(0, 100 - geo.biz_gwanghwamun * 4);
    var yeouido = Math.max(0, 100 - geo.biz_yeouido * 4);
    var bizScore = gangnam * 0.5 + gwanghwamun * 0.25 + yeouido * 0.25;
    return Math.round(subwayScore * 0.3 + bizScore * 0.7);
  }

  /**
   * 종합 가치평가 점수 계산
   * OLS 회귀 기반 loc_score (R²=0.755) — 학군~40% + 생활~35% + 교통~15% + 환금성~10%
   * 서울: 교통 = 업무지구(70%)+지하철(30%)
   * 타지역: 교통 = 도심거리(70%)+지하철(30%)
   */
  function calcValueScore(item) {
    var geo = valuationGeo && valuationGeo[item.id];
    var sigungu = item.sigungu;
    var dongName = item.dong_name;

    // Find sido for this sigungu (from locationScores)
    var guData = null;
    var sidoName = null;
    if (locationScores) {
      var sidos = Object.keys(locationScores);
      for (var i = 0; i < sidos.length; i++) {
        if (locationScores[sidos[i]][sigungu]) {
          guData = locationScores[sidos[i]][sigungu];
          sidoName = sidos[i];
          break;
        }
      }
    }

    var isSeoul = sidoName === "서울";

    // 역세권 점수
    var subwayScore = null;
    var subwayName = null;
    var subwayLine = null;
    var subwayDist = null;
    var walkMin = null;
    if (geo && geo.subway_dist != null) {
      subwayScore = calcSubwayScore(geo.subway_dist);
      subwayName = geo.subway;
      subwayLine = geo.subway_line;
      subwayDist = geo.subway_dist;
      walkMin = geo.subway_walk_min || null;
    }

    // 생활인프라 점수
    var infraScore = (geo && geo.infra_score != null) ? geo.infra_score : null;

    // 출퇴근시간
    var commute = (geo && geo.commute) ? geo.commute : null;

    // 학군 점수: geo의 academy_score 우선, 없으면 서울 하드코딩 fallback
    var schoolScore = null;
    if (geo && geo.academy_score != null) {
      schoolScore = geo.academy_score;
    } else if (isSeoul && guData) {
      schoolScore = guData.school_base;
      if (guData.school_dong && guData.school_dong[dongName] !== undefined) {
        schoolScore = guData.school_dong[dongName];
      }
    }

    if (isSeoul && guData) {
      // 서울: 교통 = 역세권(50%) + 업무지구(50%)
      var t = guData.transport;
      var bizRaw = t.gangnam * 0.5 + t.gwanghwamun * 0.25 + t.yeouido * 0.25;
      var bizScore = bizRaw;
      if (transportMinMax && transportMinMax.max > transportMinMax.min) {
        bizScore = ((bizRaw - transportMinMax.min) / (transportMinMax.max - transportMinMax.min)) * 100;
      }

      var transportScore;
      if (subwayScore != null) {
        transportScore = subwayScore * 0.5 + bizScore * 0.5;
      } else {
        transportScore = bizScore;
      }

      // 종합: 학군~40%+생활~35%+교통~15%+환금성~10% (OLS 회귀 기반)
      var total;
      var wSum = transportScore * 3;
      var wTotal = 3;
      if (schoolScore != null) { wSum += schoolScore * 1; wTotal += 1; }
      if (infraScore != null) { wSum += infraScore * 1; wTotal += 1; }
      total = wSum / wTotal;

      return {
        transport: Math.round(transportScore),
        school: schoolScore != null ? Math.round(schoolScore) : null,
        infra: infraScore,
        commuteScore: calcCommuteScore(item),
        total: Math.round(total),
        isSeoul: true,
        subwayName: subwayName,
        subwayLine: subwayLine,
        subwayDist: subwayDist,
        walkMin: walkMin,
        commute: commute
      };
    }

    // 타 지역: 학군~40%+생활~35%+교통~15%+환금성~10% (OLS 회귀 기반, 업무지구 거리 반영)
    if (subwayScore != null) {
      var transportScore2 = subwayScore;
      if (geo && geo.biz_gangnam != null) {
        function bizDistScore(d) { return Math.max(0, Math.min(100, Math.round(100 - (d - 3) * 100 / 47))); }
        var bizBest = Math.max(
          bizDistScore(geo.biz_gangnam),
          bizDistScore(geo.biz_gwanghwamun || 99),
          bizDistScore(geo.biz_yeouido || 99)
        );
        transportScore2 = subwayScore * 0.5 + bizBest * 0.5;
      }
      var wSum2 = transportScore2 * 3;
      var wTotal2 = 3;
      if (schoolScore != null) { wSum2 += schoolScore * 1; wTotal2 += 1; }
      if (infraScore != null) { wSum2 += infraScore * 1; wTotal2 += 1; }
      var total2 = wSum2 / wTotal2;
      return {
        transport: Math.round(transportScore2),
        school: schoolScore != null ? Math.round(schoolScore) : null,
        infra: infraScore,
        commuteScore: calcCommuteScore(item),
        total: Math.round(total2),
        isSeoul: false,
        subwayName: subwayName,
        subwayLine: subwayLine,
        subwayDist: subwayDist,
        walkMin: walkMin,
        commute: commute
      };
    }

    // 서울인데 geo 없지만 guData 있으면 기존 방식 fallback
    if (guData) {
      var t2 = guData.transport;
      var bizRaw2 = t2.gangnam * 0.5 + t2.gwanghwamun * 0.25 + t2.yeouido * 0.25;
      var bizScore2 = bizRaw2;
      if (transportMinMax && transportMinMax.max > transportMinMax.min) {
        bizScore2 = ((bizRaw2 - transportMinMax.min) / (transportMinMax.max - transportMinMax.min)) * 100;
      }
      var schoolScore2 = guData.school_base;
      if (guData.school_dong && guData.school_dong[dongName] !== undefined) {
        schoolScore2 = guData.school_dong[dongName];
      }
      var total3 = (bizScore2 * 3 + schoolScore2) / 4;
      return {
        transport: Math.round(bizScore2),
        school: Math.round(schoolScore2),
        infra: null,
        commuteScore: null,
        total: Math.round(total3),
        isSeoul: true,
        subwayName: null, subwayLine: null, subwayDist: null,
        walkMin: null, commute: null
      };
    }

    return null;
  }

  /* ── value score UI ── */
  function renderValueSection(entry) {
    var scores = calcValueScore(entry);
    if (!scores) return null;
    // Use backend-computed loc_score if available
    var geoLoc = valuationGeo && valuationGeo[entry.id];
    if (geoLoc && geoLoc.loc_score != null) scores.total = geoLoc.loc_score;

    var section = document.createElement("div");
    section.className = "vs-section";

    // Title + total
    var header = document.createElement("div");
    header.className = "vs-header";
    var title = document.createElement("span");
    title.className = "vs-title";
    title.textContent = "\uC785\uC9C0\uC810\uC218";
    header.appendChild(title);
    var totalEl = document.createElement("span");
    totalEl.className = "vs-total";
    var _dispTotal = scaleScore50(scores.total);
    totalEl.innerHTML = '<span class="vs-total-num">' + _dispTotal + '</span><span class="vs-total-label">\uC810</span>';
    header.appendChild(totalEl);
    section.appendChild(header);

    // 점수 기준 안내 (접을 수 있는 토글)
    var guideBtn = document.createElement("button");
    guideBtn.className = "sort-btn";
    guideBtn.style.cssText = "font-size:10px;padding:2px 8px;margin-bottom:8px;color:var(--muted)";
    guideBtn.textContent = "\u2139 \uC810\uC218 \uAE30\uC900 \uBCF4\uAE30";
    var guideDiv = document.createElement("div");
    guideDiv.style.cssText = "display:none;font-size:11px;color:var(--muted);background:var(--bg);border-radius:8px;padding:10px 12px;margin-bottom:10px;line-height:1.6";
    guideDiv.innerHTML =
      "<b>학군(~40%)</b>: 반경 1.5km 내 초중학교 학업성취도 기반 (거리역수 가중평균)<br>" +
      "<b>생활(~35%)</b>: 인프라(학교·병원·편의시설) + 연식 + 실거주 환경<br>" +
      "<b>교통(~15%)</b>: 지하철 거리 · 도보시간 기반";
    guideBtn.addEventListener("click", function () {
      guideDiv.style.display = guideDiv.style.display === "none" ? "block" : "none";
      guideBtn.textContent = guideDiv.style.display === "none" ? "\u2139 \uC810\uC218 \uAE30\uC900 \uBCF4\uAE30" : "\u2139 \uC810\uC218 \uAE30\uC900 \uC811\uAE30";
    });
    section.appendChild(guideBtn);
    section.appendChild(guideDiv);

    // Subway info line with walking time
    if (scores.subwayName) {
      var subwayInfo = document.createElement("div");
      subwayInfo.className = "vs-subway-info";
      var walkText = "";
      if (scores.walkMin) {
        walkText = "\uB3C4\uBCF4 " + scores.walkMin + "\uBD84";
      } else {
        var distText = scores.subwayDist < 1
          ? Math.round(scores.subwayDist * 1000) + "m"
          : scores.subwayDist.toFixed(1) + "km";
        walkText = distText;
      }
      subwayInfo.innerHTML = '<span class="vs-subway-icon">\uD83D\uDE87</span>'
        + '<span class="vs-subway-name">' + escapeHTML(scores.subwayName) + '</span>'
        + '<span class="vs-subway-line">' + escapeHTML(scores.subwayLine || "") + '</span>'
        + '<span class="vs-subway-dist">' + walkText + '</span>';
      section.appendChild(subwayInfo);
    }

    // Commute times (수도권) + 출퇴근 점수 뱃지
    if (scores.commute) {
      var commuteEl = document.createElement("div");
      commuteEl.className = "vs-commute";
      var parts = [];
      if (scores.commute.gangnam) parts.push("\uAC15\uB0A8 " + scores.commute.gangnam + "\uBD84");
      if (scores.commute.gwanghwamun) parts.push("\uAD11\uD654\uBB38 " + scores.commute.gwanghwamun + "\uBD84");
      if (scores.commute.yeouido) parts.push("\uC5EC\uC758\uB3C4 " + scores.commute.yeouido + "\uBD84");
      if (parts.length) {
        var badgeHtml = "";
        if (scores.commuteScore != null) {
          var csColor = scores.commuteScore >= 70 ? "#2563eb" : scores.commuteScore >= 40 ? "#f59e0b" : "#94a3b8";
          var csBg = scores.commuteScore >= 70 ? "#dbeafe" : scores.commuteScore >= 40 ? "#fef3c7" : "#f1f5f9";
          badgeHtml = '<span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:8px;color:' + csColor + ';background:' + csBg + ';margin-left:6px">\uCD9C\uD1F4\uADFC ' + scores.commuteScore + '</span>';
        }
        commuteEl.innerHTML = '<span class="vs-commute-icon">\uD83D\uDE97</span>'
          + '<span class="vs-commute-label">\uCD9C\uD1F4\uADFC</span>'
          + '<span class="vs-commute-times">' + parts.join(" \u00B7 ") + '</span>'
          + badgeHtml;
        section.appendChild(commuteEl);
      }
    }

    // Bar gauges (3축: 교통/학군/생활 — drawScoreBars 통일)
    var transportBar = (geoLoc && geoLoc.subway_dist != null) ? Math.max(5, Math.round(100 - geoLoc.subway_dist * 1000 / 30)) : scores.transport;
    var schoolBar = (geoLoc && geoLoc.academy_score != null) ? geoLoc.academy_score : scores.school;
    var infraVal = geoLoc ? (geoLoc.infra_score || 0) : (scores.infra || 0);
    var livVal = geoLoc ? (geoLoc.livability_score || 0) : 0;
    var livingBar = Math.round((infraVal + livVal) / 2);
    var barsWrap = document.createElement("div");
    drawScoreBars(barsWrap, { transport: transportBar, school: schoolBar, living: livingBar });
    section.appendChild(barsWrap);

    // 단지품질 (세대수 + 브랜드 + 연식)
    if (geoLoc && (geoLoc.households || geoLoc.brand_score != null || geoLoc.age_score != null)) {
      var qualDiv = document.createElement("div");
      qualDiv.style.cssText = "display:flex;gap:12px;margin-top:8px;font-size:11px;color:var(--muted)";
      if (geoLoc.households) {
        var hSpan = document.createElement("span");
        var hc = geoLoc.households >= 1500 ? "#2563eb" : geoLoc.households >= 500 ? "#f59e0b" : "#94a3b8";
        hSpan.innerHTML = '\uC138\uB300 <b style="color:' + hc + '">' + geoLoc.households.toLocaleString() + '</b>';
        qualDiv.appendChild(hSpan);
      }
      if (geoLoc.brand_score != null) {
        var bSpan = document.createElement("span");
        var bc = geoLoc.brand_score >= 80 ? "#2563eb" : geoLoc.brand_score >= 60 ? "#f59e0b" : "#94a3b8";
        bSpan.innerHTML = '\uBE0C\uB79C\uB4DC <b style="color:' + bc + '">' + geoLoc.brand_score + '</b>';
        qualDiv.appendChild(bSpan);
      }
      if (geoLoc.age_score != null) {
        var aSpan = document.createElement("span");
        var ac = geoLoc.age_score >= 70 ? "#2563eb" : geoLoc.age_score >= 40 ? "#f59e0b" : "#94a3b8";
        aSpan.innerHTML = '\uC5F0\uC2DD ' + (2026 - (geoLoc.age_score > 0 ? Math.round(40 - geoLoc.age_score * 37 / 100) : 40)) + '\uB144 <b style="color:' + ac + '">' + geoLoc.age_score + '</b>';
        qualDiv.appendChild(aSpan);
      }
      section.appendChild(qualDiv);
    }

    return section;
  }

  /* ── tabs (removed — search is now cross-region) ── */

  /* ── autocomplete ── */
  function createAutocomplete() {
    acDropdown = document.createElement("div");
    acDropdown.className = "autocomplete-dropdown";
    acDropdown.style.display = "none";
    var wrap = searchInput.closest(".search-wrap");
    if (wrap) wrap.appendChild(acDropdown);
  }
  function showAutocomplete(query) {
    if (!acDropdown || query.length < 2) {
      if (acDropdown) acDropdown.style.display = "none";
      return;
    }
    var allItems = getAllItems();
    if (!allItems.length) return;
    var q = query.toLowerCase();
    var seen = {};
    var results = [];
    for (var i = 0; i < allItems.length && results.length < 10; i++) {
      var r = allItems[i];
      if (r.apt_name.toLowerCase().indexOf(q) < 0) continue;
      var key = r.apt_name + "\t" + r.sigungu + "\t" + r.dong_name;
      if (seen[key]) continue;
      seen[key] = true;
      results.push({ apt_name: r.apt_name, sigungu: r.sigungu, dong_name: r.dong_name });
    }
    if (!results.length) { acDropdown.style.display = "none"; return; }
    acDropdown.innerHTML = "";
    results.forEach(function (r) {
      var item = document.createElement("div");
      item.className = "ac-item";
      item.innerHTML = '<span class="ac-name">' + escapeHTML(r.apt_name) + '</span>'
        + '<span class="ac-loc">' + escapeHTML(r.sigungu + " " + r.dong_name) + '</span>';
      item.addEventListener("mousedown", function (e) {
        e.preventDefault();
        searchInput.value = r.apt_name;
        acDropdown.style.display = "none";
        doSearch(r.apt_name);
        updateURL();
      });
      acDropdown.appendChild(item);
    });
    acDropdown.style.display = "block";
  }

  /* ── search ── */
  function doSearch(query) {
    if (!query || query.length < 2) return;
    var allItems = getAllItems();
    if (!allItems.length) { resultsEl.innerHTML = '<div class="val-empty">데이터가 없습니다.</div>'; return; }

    var q = query.toLowerCase();
    var matches = allItems.filter(function (item) {
      return item.apt_name.toLowerCase().indexOf(q) >= 0;
    });

    if (!matches.length) {
      resultsEl.innerHTML = '<div class="val-empty">"' + escapeHTML(query) + '" 검색 결과가 없습니다.<br><span style="font-size:12px;color:var(--muted)">분석 대상: 36개월간 거래 15건 이상 단지</span></div>';
      return;
    }

    // Group by apt_name + sigungu + dong_name
    var groups = {};
    matches.forEach(function (m) {
      var key = m.apt_name + "\t" + m.sigungu + "\t" + m.dong_name;
      if (!groups[key]) groups[key] = { apt_name: m.apt_name, sigungu: m.sigungu, dong_name: m.dong_name, items: [] };
      groups[key].items.push(m);
    });

    resultsEl.innerHTML = "";
    var count = document.createElement("div");
    count.className = "result-count";
    count.textContent = Object.keys(groups).length + "\uAC1C \uB2E8\uC9C0 \u00B7 " + matches.length + "\uAC1C \uBA74\uC801";
    resultsEl.appendChild(count);

    // info card
    var infoCard = document.createElement("div");
    infoCard.className = "val-guide-card";
    infoCard.innerHTML = '<div class="val-guide-title">\uD310\uC815 \uAE30\uC900</div>'
      + '<div class="val-guide-grid">'
      + '<div class="val-guide-item">'
      + '<span class="val-badge val-badge-undervalued">\uC800\uD3C9\uAC00</span>'
      + '<span class="val-guide-desc">\uC720\uC0AC\uB2E8\uC9C0\uC640 3\uB144\uAC04 \uBE44\uC2B7\uD588\uC9C0\uB9CC<br>\uCD5C\uADFC 6\uAC1C\uC6D4 \uACA9\uCC28\uAC00 \uBC8C\uC5B4\uC838 \uC0C1\uB300\uC801\uC73C\uB85C \uC2FC \uB2E8\uC9C0</span>'
      + '</div>'
      + '<div class="val-guide-item">'
      + '<span class="val-badge val-badge-leading">\uB9AC\uB529\uB2E8\uC9C0</span>'
      + '<span class="val-guide-desc">\uC720\uC0AC\uB2E8\uC9C0 \uB300\uBE44<br>\uCD5C\uADFC 6\uAC1C\uC6D4 \uACA9\uCC28\uAC00 \uBC8C\uC5B4\uC838 \uC0C1\uB300\uC801\uC73C\uB85C \uC2DC\uC7A5\uC744 \uC120\uB3C4\uD558\uB294 \uB2E8\uC9C0</span>'
      + '</div>'
      + '</div>'
      + '<div class="val-guide-footer">\uBE44\uAD50 \uB300\uC0C1: \uAC19\uC740 \uAD6C+\uC778\uC811 \uAD6C \u00B7 \uBA74\uC801 30% \uC774\uB0B4 \u00B7 \uAC00\uACA9\uD750\uB984 \uC0C1\uAD00\uACC4\uC218 0.93\uC774\uC0C1</div>'
      + '<div class="val-guide-footer" style="margin-top:4px;font-size:11px;color:var(--muted)">\u203B \uC800\uD3C9\uAC00/\uB9AC\uB529\uC740 \uC2E4\uAC70\uB798\uAC00 \uAE30\uC900, \uC785\uC9C0\uBD84\uC11D\uC740 \uAD50\uD1B5\u00B7\uD559\uAD70\u00B7\uC790\uC5F0\uD658\uACBD\u00B7\uC778\uD504\uB77C\u00B7\uC815\uBE44\uAD6C\uC5ED\uC744 \uBC18\uC601\uD569\uB2C8\uB2E4.</div>';
    resultsEl.appendChild(infoCard);

    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      var groupEl = document.createElement("div");
      groupEl.style.marginBottom = "8px";

      // If multiple areas, show area tabs
      if (g.items.length > 1) {
        g.items.sort(function (a, b) { return a.area_m2 - b.area_m2; });
        var areaTabs = document.createElement("div");
        areaTabs.className = "val-area-tabs";
        var cardContainer = document.createElement("div");

        g.items.forEach(function (item, idx) {
          var btn = document.createElement("button");
          btn.className = "val-area-btn" + (idx === 0 ? " active" : "");
          btn.textContent = item.area_m2 + "m\u00B2";
          btn.addEventListener("click", function () {
            areaTabs.querySelectorAll(".val-area-btn").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            cardContainer.innerHTML = "";
            cardContainer.appendChild(renderValuationCard(item));
          });
          areaTabs.appendChild(btn);
        });
        groupEl.appendChild(areaTabs);
        cardContainer.appendChild(renderValuationCard(g.items[0]));
        groupEl.appendChild(cardContainer);
      } else {
        groupEl.appendChild(renderValuationCard(g.items[0]));
      }
      resultsEl.appendChild(groupEl);
    });
  }

  /* ── valuation card ── */
  function renderValuationCard(entry) {
    var card = document.createElement("div");
    card.className = "val-card";

    // Header: badge + gap
    var header = document.createElement("div");
    header.className = "val-header";
    var badge = document.createElement("span");
    badge.className = "val-badge val-badge-" + entry.status;
    badge.textContent = STATUS_LABELS[entry.status] || entry.status;
    if (entry.status !== "market") header.appendChild(badge);
    var gap = document.createElement("span");
    gap.className = "val-gap " + (entry.gap_pct < 0 ? "negative" : entry.gap_pct > 0 ? "positive" : "");
    gap.textContent = (entry.gap_pct > 0 ? "+" : "") + entry.gap_pct.toFixed(1) + "%";
    header.appendChild(gap);
    card.appendChild(header);

    // Name
    var name = document.createElement("div");
    name.className = "val-name";
    name.textContent = entry.apt_name;
    card.appendChild(name);

    // Info line
    var info = document.createElement("div");
    info.className = "val-info";
    info.textContent = entry.sigungu + " " + entry.dong_name + " \u00B7 "
      + entry.area_m2 + "m\u00B2 \u00B7 \uD604\uC7AC " + fmtEok(entry.current_price)
      + "(" + fmtPerM2(entry.current_price, entry.area_m2) + ")"
      + " \u00B7 \uBE44\uAD50\uB2E8\uC9C0 " + (entry.compare ? entry.compare.length : 0) + "\uAC1C";
    card.appendChild(info);

    // Gauge bar
    card.appendChild(createGauge(entry.gap_pct));

    // Comparison table
    if (entry.compare && entry.compare.length) {
      card.appendChild(createCompareTable(entry));
    }

    // Value score section
    var valueSec = renderValueSection(entry);
    if (valueSec) card.appendChild(valueSec);

    // CTA buttons
    var cta = document.createElement("div");
    cta.className = "val-cta";

    // Chart — auto load
    var chartPlaceholder = document.createElement("div");
    card.appendChild(chartPlaceholder);
    var ids = [entry.id];
    entry.compare.forEach(function (c) { ids.push(c.id); });
    Promise.all(ids.map(loadTxn)).then(function (txns) {
      var chartWrap = document.createElement("div");

      var canvasWrap = document.createElement("div");
      canvasWrap.className = "val-chart-wrap";
      var canvas = document.createElement("canvas");
      canvasWrap.appendChild(canvas);
      chartWrap.appendChild(canvasWrap);

      var seriesList = [];
      seriesList.push({ label: entry.apt_name, color: CHART_COLORS[0], history: txns[0] });
      entry.compare.forEach(function (c, i) {
        seriesList.push({ label: c.apt_name, color: CHART_COLORS[i + 1] || "#94a3b8", history: txns[i + 1] });
      });

      var legend = document.createElement("div");
      legend.className = "val-legend";
      seriesList.forEach(function (s) {
        var item = document.createElement("span");
        item.className = "val-legend-item";
        item.innerHTML = '<span class="val-legend-dot" style="background:' + s.color + '"></span>'
          + escapeHTML(s.label);
        legend.appendChild(item);
      });
      chartWrap.appendChild(legend);

      chartPlaceholder.replaceWith(chartWrap);
      drawMultiScatter(canvas, seriesList);
    });

    // Watchlist button
    if (typeof APTWatchlist !== "undefined") {
      var wlBtn = document.createElement("button");
      wlBtn.className = "detail-btn";
      var isWl = APTWatchlist.has(entry.id);
      wlBtn.textContent = isWl ? "\uAD00\uC2EC \uC81C\uAC70" : "\uAD00\uC2EC \uCD94\uAC00";
      wlBtn.addEventListener("click", function () {
        if (APTWatchlist.has(entry.id)) {
          APTWatchlist.remove(entry.id);
          wlBtn.textContent = "\uAD00\uC2EC \uCD94\uAC00";
        } else {
          APTWatchlist.add({
            id: entry.id,
            apt_name: entry.apt_name,
            sigungu: entry.sigungu,
            dong_name: entry.dong_name,
            area_m2: entry.area_m2,
            latest_price: entry.current_price,
            chg_pct: entry.gap_pct,
            sido: entry._sido || ""
          });
          wlBtn.textContent = "\uAD00\uC2EC \uC81C\uAC70";
        }
        APTWatchlist.track("watchlist_toggle", { apt_name: entry.apt_name, source: "valuation" });
      });
      cta.appendChild(wlBtn);
    }
    if (entry.id) {
      var aptLink = document.createElement("a");
      aptLink.className = "apt-detail-link";
      aptLink.href = "apt.html?id=" + encodeURIComponent(entry.id) + "&s=" + encodeURIComponent(entry._sido || "서울");
      aptLink.textContent = "단지상세";
      cta.appendChild(aptLink);
    }
    card.appendChild(cta);

    return card;
  }

  /* ── gauge bar ── */
  function createGauge(gapPct) {
    var wrap = document.createElement("div");
    wrap.className = "val-gauge-wrap";
    var labels = document.createElement("div");
    labels.className = "val-gauge-labels";
    labels.innerHTML = "<span>\uC800\uD3C9\uAC00</span><span>\uB9AC\uB529</span>";
    wrap.appendChild(labels);
    var track = document.createElement("div");
    track.className = "val-gauge-track";
    // Map gap_pct from [-30, +30] → [0%, 100%]
    var pct = Math.max(0, Math.min(100, ((gapPct + 30) / 60) * 100));
    var marker = document.createElement("div");
    marker.className = "val-gauge-marker";
    marker.style.left = pct + "%";
    track.appendChild(marker);
    wrap.appendChild(track);
    return wrap;
  }

  /* ── comparison table ── */
  function createCompareTable(entry) {
    var wrap = document.createElement("div");
    wrap.className = "val-compare-wrap";
    var title = document.createElement("div");
    title.className = "val-compare-title";
    title.textContent = "\uC720\uC0AC\uB2E8\uC9C0 \uBE44\uAD50";
    wrap.appendChild(title);

    var table = document.createElement("table");
    table.className = "val-compare-table";

    // thead
    var thead = document.createElement("thead");
    var htr = document.createElement("tr");
    htr.innerHTML = "<th>\uC9C0\uD45C</th><th class=\"val-me\">" + escapeHTML(entry.apt_name) + "</th>";
    entry.compare.forEach(function (c) {
      htr.innerHTML += "<th>" + escapeHTML(c.apt_name) + "</th>";
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    // tbody
    var tbody = document.createElement("tbody");
    var e6 = entry.recent_avg, e36 = entry.avg_36, eArea = entry.area_m2;
    var rows = [
      ["\uC704\uCE58", entry.sigungu + " " + entry.dong_name],
      ["\uBA74\uC801", entry.area_m2 + "m\u00B2"],
      ["\uD604\uC7AC\uAC00", fmtEok(entry.current_price)],
      ["\uBA74\uC801\uB2F9\uAC00", eArea ? fmtPerM2(entry.current_price, eArea) : "-"],
      ["6\uAC1C\uC6D4 \uD3C9\uADE0", e6 ? fmtEok(e6) : "-"],
      ["3\uB144 \uD3C9\uADE0", e36 ? fmtEok(e36) : "-"],
      ["\uAC70\uB798\uB7C9", entry.trade_count + "\uAC74"]
    ];
    rows.forEach(function (r, ri) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + r[0] + "</td><td class=\"val-me\">" + r[1] + "</td>";
      entry.compare.forEach(function (c) {
        var val = "-";
        var c6 = c.recent_avg, c36 = c.avg_36, cArea = c.area_m2;
        if (ri === 0) val = (c.sigungu || "") + " " + (c.dong_name || "");
        else if (ri === 1) val = cArea + "m\u00B2";
        else if (ri === 2) val = c.current_price ? fmtEok(c.current_price) : "-";
        else if (ri === 3) val = (c.current_price && cArea) ? fmtPerM2(c.current_price, cArea) : "-";
        else if (ri === 4) val = c6 ? fmtEok(c6) : "-";
        else if (ri === 5) val = c36 ? fmtEok(c36) : "-";
        else if (ri === 6) val = c.trade_count ? c.trade_count + "\uAC74" : "-";
        tr.innerHTML += "<td>" + val + "</td>";
      });
      tbody.appendChild(tr);
    });
    // Correlation row
    var corrTr = document.createElement("tr");
    corrTr.innerHTML = "<td>\uC0C1\uAD00\uACC4\uC218</td><td class=\"val-me\">-</td>";
    entry.compare.forEach(function (c) {
      corrTr.innerHTML += "<td>" + (c.corr ? c.corr.toFixed(3) : "-") + "</td>";
    });
    tbody.appendChild(corrTr);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  /* ── 초기 화면 (탭: 시세 저평가 / 입지점수 랭킹) ── */
  function showLocationValueRanking() {
    if (!globalIndex) { showHint(); return; }
    resultsEl.innerHTML = "";

    var totalCount = 0;
    globalIndex.sido_order.forEach(function (s) { var d = sidoCache[s]; if (d) totalCount += (d.count || 0); });

    // 탭 UI
    var mainTabWrap = document.createElement("div");
    mainTabWrap.style.cssText = "display:flex;gap:0;margin-bottom:12px;border-bottom:2px solid var(--border,#e5e7eb)";

    var tabStyle = "flex:1;padding:10px 0;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;margin-bottom:-2px;border-bottom:2px solid transparent;color:var(--muted)";

    var tabPrice = document.createElement("button");
    tabPrice.style.cssText = tabStyle;
    tabPrice.textContent = "\uC2DC\uC138 \uC800\uD3C9\uAC00";

    var tabLocRank = document.createElement("button");
    tabLocRank.style.cssText = tabStyle;
    tabLocRank.textContent = "\uC785\uC9C0\uC810\uC218 \uB7AD\uD0B9";

    var contentArea = document.createElement("div");
    var tabs = [tabPrice, tabLocRank];

    function activateTab(which) {
      tabs.forEach(function (t) {
        t.style.borderBottomColor = "transparent";
        t.style.color = "var(--muted)";
      });
      var activeTab = which === "locrank" ? tabLocRank : tabPrice;
      activeTab.style.borderBottomColor = "#2563eb";
      activeTab.style.color = "#2563eb";

      if (which === "locrank") renderLocScoreRanking(contentArea, totalCount);
      else renderPriceUndervaluedContent(contentArea, totalCount);
    }

    tabPrice.addEventListener("click", function () { activateTab("price"); });
    tabLocRank.addEventListener("click", function () { activateTab("locrank"); });

    mainTabWrap.appendChild(tabPrice);
    mainTabWrap.appendChild(tabLocRank);
    resultsEl.appendChild(mainTabWrap);
    resultsEl.appendChild(contentArea);

    activateTab("price");
  }

  /* ── 입지점수 랭킹 content ── */
  function renderLocScoreRanking(container, totalCount) {
    container.innerHTML = "";

    if (!valuationGeo) {
      container.innerHTML = '<div class="val-empty">\uC785\uC9C0\uC810\uC218 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
      return;
    }

    var intro = document.createElement("div");
    intro.className = "val-hint";
    intro.innerHTML = '<b>\uB2E8\uC9C0\uBCC4 \uC785\uC9C0\uC810\uC218 \uB7AD\uD0B9</b><br>'
      + '<span style="font-size:11px">\uAD50\uD1B5\u00B7\uD559\uAD70\u00B7\uC778\uD504\uB77C\u00B7\uC815\uBE44\uAD6C\uC5ED \uC885\uD569\uC810\uC218 \uAE30\uC900 \uC0C1\uC704 20\uAC1C \uB2E8\uC9C0</span>';
    container.appendChild(intro);

    // 시도별로 입지점수 상위 20개 수집
    var sidoGroups = {};
    globalIndex.sido_order.forEach(function (sido) {
      var data = sidoCache[sido];
      if (!data || !data.items) return;
      var scored = [];
      data.items.forEach(function (item) {
        var geo = valuationGeo[item.id];
        if (!geo || geo.loc_score == null) return;
        scored.push({
          id: item.id,
          apt_name: item.apt_name,
          sigungu: item.sigungu,
          dong_name: item.dong_name,
          area_m2: item.area_m2,
          current_price: item.current_price,
          loc_score: geo.loc_score,
          academy_score: geo.academy_score,
          infra_score: geo.infra_score,
          liquidity_score: geo.liquidity_score,
          subway_dist: geo.subway_dist,
          subway: geo.subway,
          subway_line: geo.subway_line
        });
      });
      scored.sort(function (a, b) { return b.loc_score - a.loc_score; });
      if (scored.length) sidoGroups[sido] = scored.slice(0, 20);
    });

    var sidoTabs = document.createElement("div");
    sidoTabs.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0";
    var contentDiv = document.createElement("div");

    function renderSido(sido) {
      contentDiv.innerHTML = "";
      sidoTabs.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.sido === sido);
      });

      var items = sidoGroups[sido] || [];
      if (!items.length) {
        contentDiv.innerHTML = '<div class="val-empty">\uD574\uB2F9 \uC2DC\uB3C4\uC5D0 \uC785\uC9C0\uC810\uC218 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
        return;
      }

      items.forEach(function (item, idx) {
        var card = document.createElement("div");
        card.className = "val-card";
        card.style.cursor = "pointer";

        var header = document.createElement("div");
        header.className = "val-header";
        var rank = document.createElement("span");
        rank.style.cssText = "font-size:12px;font-weight:700;color:var(--muted);margin-right:6px";
        rank.textContent = "#" + (idx + 1);
        header.appendChild(rank);

        var scoreBadge = document.createElement("span");
        var sc = scaleScore50(item.loc_score);
        var badgeColor = sc >= 85 ? "#dbeafe;color:#2563eb" : sc >= 70 ? "#fef3c7;color:#d97706" : "#f1f5f9;color:#64748b";
        scoreBadge.style.cssText = "font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;background:" + badgeColor;
        scoreBadge.textContent = "\uC785\uC9C0 " + sc + "\uC810";
        header.appendChild(scoreBadge);
        card.appendChild(header);

        var name = document.createElement("div");
        name.className = "val-name";
        name.textContent = item.apt_name;
        card.appendChild(name);

        var info = document.createElement("div");
        info.className = "val-info";
        info.textContent = item.sigungu + " " + item.dong_name + " \u00B7 " + item.area_m2 + "m\u00B2 \u00B7 " + fmtEok(item.current_price);
        card.appendChild(info);

        // 세부 점수 바
        var bars = document.createElement("div");
        bars.style.cssText = "display:flex;gap:8px;margin:6px 0 2px;font-size:10px;color:var(--muted)";
        var labels = [
          ["\uD559\uAD70", item.academy_score],
          ["\uC778\uD504\uB77C", item.infra_score],
          ["\uD658\uAE08\uC131", item.liquidity_score]
        ];
        labels.forEach(function (l) {
          if (l[1] == null) return;
          var sv = scaleScore50(l[1]);
          var s = document.createElement("span");
          var c = sv >= 85 ? "#2563eb" : sv >= 70 ? "#f59e0b" : "#94a3b8";
          s.innerHTML = l[0] + ' <b style="color:' + c + '">' + sv + '</b>';
          bars.appendChild(s);
        });
        if (item.subway) {
          var subwaySpan = document.createElement("span");
          subwaySpan.innerHTML = '\uC5ED ' + APTCommon.escapeHTML(item.subway) + ' <b>' + (item.subway_dist < 1 ? (item.subway_dist * 1000).toFixed(0) + 'm' : item.subway_dist.toFixed(1) + 'km') + '</b>';
          bars.appendChild(subwaySpan);
        }
        card.appendChild(bars);

        var cta = document.createElement("div");
        cta.style.cssText = "margin-top:6px;text-align:right";
        var link = document.createElement("a");
        link.className = "apt-detail-link";
        link.href = "apt.html?id=" + encodeURIComponent(item.id) + "&s=" + encodeURIComponent(sido);
        link.textContent = "\uB2E8\uC9C0\uC0C1\uC138";
        link.addEventListener("click", function (e) { e.stopPropagation(); });
        cta.appendChild(link);
        card.appendChild(cta);

        card.addEventListener("click", function () {
          searchInput.value = item.apt_name;
          doSearch(item.apt_name);
          updateURL();
        });

        contentDiv.appendChild(card);
      });
    }

    var sidos = Object.keys(sidoGroups);
    sidos.forEach(function (sido) {
      var items = sidoGroups[sido] || [];
      if (!items.length) return;
      var btn = document.createElement("button");
      btn.className = "sort-btn";
      btn.dataset.sido = sido;
      btn.textContent = sido + " (" + items.length + ")";
      btn.addEventListener("click", function () { renderSido(sido); });
      sidoTabs.appendChild(btn);
    });

    container.appendChild(sidoTabs);
    container.appendChild(contentDiv);

    if (sidos.length) renderSido(sidos[0]);

    var note = document.createElement("div");
    note.style.cssText = "margin-top:16px;padding:10px 12px;background:var(--bg-card,#f8fafc);border-radius:8px;font-size:11px;line-height:1.6;color:var(--muted)";
    note.innerHTML = '<b>입지점수 계산기준</b> (OLS 회귀, R\u00B2=0.755)<br>'
      + '학군 ~40% + 생활인프라 ~35% + 교통 ~15% + 환금성 ~10%<br>'
      + '교통: 서울 = 업무지구(70%)+지하철(30%) / 그 외 = 도심거리(70%)+지하철(30%)';
    container.appendChild(note);

    var hint = document.createElement("div");
    hint.style.cssText = "text-align:center;margin-top:12px;font-size:12px;color:var(--muted)";
    hint.textContent = "\uC804\uAD6D " + totalCount.toLocaleString() + "\uAC1C \uB2E8\uC9C0 \uAC80\uC0C9 \uAC00\uB2A5 \u2014 \uC704 \uAC80\uC0C9\uCC3D\uC5D0 \uB2E8\uC9C0\uBA85\uC744 \uC785\uB825\uD558\uC138\uC694";
    container.appendChild(hint);
  }

  /* ── 시세 저평가 content ── */
  function renderPriceUndervaluedContent(container, totalCount) {
    container.innerHTML = "";

    var intro = document.createElement("div");
    intro.className = "val-hint";
    intro.innerHTML = '<b>\uC2DC\uC138 \uC800\uD3C9\uAC00 \uC544\uD30C\uD2B8</b><br>'
      + '<span style="font-size:11px">\uC720\uC0AC\uB2E8\uC9C0 \uB300\uBE44 \uCD5C\uADFC \uC2DC\uC138\uAC00 \uAC00\uC7A5 \uB9CE\uC774 \uBC8C\uC5B4\uC9C4 \uB2E8\uC9C0 (\uAC00\uACA9 \uAE30\uC900)</span><br>'
      + '<span style="font-size:11px;color:var(--muted)">\uCE74\uB4DC\uB97C \uB204\uB974\uBA74 \uBE44\uAD50\uB2E8\uC9C0 \uC2DC\uC138 \uC0C1\uC138\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4</span>';
    container.appendChild(intro);

    // Collect undervalued items grouped by sido
    var sidoGroups = {};
    globalIndex.sido_order.forEach(function (sido) {
      var data = sidoCache[sido];
      if (!data || !data.items) return;
      var undervalued = data.items.filter(function (item) { return item.status === "undervalued"; });
      undervalued.sort(function (a, b) { return a.gap_pct - b.gap_pct; });
      if (undervalued.length) {
        sidoGroups[sido] = undervalued.slice(0, 20);
      }
    });

    var sidoTabs = document.createElement("div");
    sidoTabs.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0";
    var contentDiv = document.createElement("div");

    function renderSido(sido) {
      contentDiv.innerHTML = "";
      sidoTabs.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.sido === sido);
      });

      var items = sidoGroups[sido] || [];
      if (!items.length) {
        contentDiv.innerHTML = '<div class="val-empty">\uD574\uB2F9 \uC2DC\uB3C4\uC5D0 \uC2DC\uC138 \uC800\uD3C9\uAC00 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
        return;
      }

      items.forEach(function (item, idx) {
        var card = document.createElement("div");
        card.className = "val-card";
        card.style.cursor = "pointer";

        var header = document.createElement("div");
        header.className = "val-header";
        var rank = document.createElement("span");
        rank.style.cssText = "font-size:12px;font-weight:700;color:var(--muted);margin-right:6px";
        rank.textContent = "#" + (idx + 1);
        header.appendChild(rank);

        var badge = document.createElement("span");
        badge.className = "val-badge val-badge-undervalued";
        badge.textContent = "\uC800\uD3C9\uAC00";
        header.appendChild(badge);

        var gap = document.createElement("span");
        gap.className = "val-gap negative";
        gap.textContent = item.gap_pct.toFixed(1) + "%";
        header.appendChild(gap);
        card.appendChild(header);

        var name = document.createElement("div");
        name.className = "val-name";
        name.textContent = item.apt_name;
        card.appendChild(name);

        var info = document.createElement("div");
        info.className = "val-info";
        info.textContent = item.sigungu + " " + item.dong_name + " \u00B7 "
          + item.area_m2 + "m\u00B2 \u00B7 " + fmtEok(item.current_price)
          + " \u00B7 \uBE44\uAD50\uB2E8\uC9C0 " + (item.compare ? item.compare.length : 0) + "\uAC1C";
        card.appendChild(info);

        var puvCta = document.createElement("div");
        puvCta.style.cssText = "margin-top:6px;text-align:right";
        var puvLink = document.createElement("a");
        puvLink.className = "apt-detail-link";
        puvLink.href = "apt.html?id=" + encodeURIComponent(item.id) + "&s=" + encodeURIComponent(sido);
        puvLink.textContent = "단지상세";
        puvLink.addEventListener("click", function (e) { e.stopPropagation(); });
        puvCta.appendChild(puvLink);
        card.appendChild(puvCta);

        card.addEventListener("click", function () {
          searchInput.value = item.apt_name;
          doSearch(item.apt_name);
          updateURL();
        });

        contentDiv.appendChild(card);
      });
    }

    var sidos = Object.keys(sidoGroups);
    sidos.forEach(function (sido) {
      var items = sidoGroups[sido] || [];
      var btn = document.createElement("button");
      btn.className = "sort-btn";
      btn.dataset.sido = sido;
      btn.textContent = sido + " (" + items.length + ")";
      btn.addEventListener("click", function () { renderSido(sido); });
      sidoTabs.appendChild(btn);
    });

    container.appendChild(sidoTabs);
    container.appendChild(contentDiv);

    if (sidos.length) renderSido(sidos[0]);

    if (!sidos.length) {
      contentDiv.innerHTML = '<div class="val-empty">\uC2DC\uC138 \uC800\uD3C9\uAC00 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
    }

    var hint = document.createElement("div");
    hint.style.cssText = "text-align:center;margin-top:16px;font-size:12px;color:var(--muted)";
    hint.textContent = "\uC804\uAD6D " + totalCount.toLocaleString() + "\uAC1C \uB2E8\uC9C0 \uAC80\uC0C9 \uAC00\uB2A5 \u2014 \uC704 \uAC80\uC0C9\uCC3D\uC5D0 \uB2E8\uC9C0\uBA85\uC744 \uC785\uB825\uD558\uC138\uC694";
    container.appendChild(hint);
  }

  /* ── hint ── */
  function showHint() {
    var totalCount = 0;
    globalIndex.sido_order.forEach(function (s) { var d = sidoCache[s]; if (d) totalCount += (d.count || 0); });
    resultsEl.innerHTML = '<div class="val-hint">\uC804\uAD6D ' + totalCount.toLocaleString()
      + '\uAC1C \uB2E8\uC9C0 \uBD84\uC11D \uAC00\uB2A5<br><span style="font-size:11px">\uB2E8\uC9C0\uBA85\uC744 \uAC80\uC0C9\uD558\uBA74 \uC720\uC0AC\uB2E8\uC9C0 \uB300\uBE44 \uC800\uD3C9\uAC00/\uB9AC\uB529 \uC5EC\uBD80\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</span></div>';
  }

  /* ── init ── */
  function init() {
    fetch(INDEX_PATH + "?t=" + Date.now())
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (index) {
        globalIndex = index;
        var sidoOrder = index.sido_order || [];
        if (!sidoOrder.length) { statusEl.textContent = "\uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."; return; }

        var parsed = parseURL();

        return Promise.all([
          loadAllSidos(),
          loadLocationScores(),
          loadValuationGeo(),
          loadSummary()
        ]).then(function () {
          statusEl.innerHTML = "";
          buildTransportMinMax();
          createAutocomplete();
          if (parsed.query) {
            searchInput.value = parsed.query;
            doSearch(parsed.query);
          } else {
            showLocationValueRanking();
          }
        });
      })
      .catch(function () {
        statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
      });
  }

  /* ── event listeners ── */
  searchInput.addEventListener("input", function () {
    clearTimeout(acTimeout);
    acTimeout = setTimeout(function () { showAutocomplete(searchInput.value.trim()); }, 200);
  });
  searchInput.addEventListener("blur", function () {
    setTimeout(function () { if (acDropdown) acDropdown.style.display = "none"; }, 150);
  });
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      if (acDropdown) acDropdown.style.display = "none";
      doSearch(searchInput.value.trim());
      updateURL();
    }
  });
  searchBtn.addEventListener("click", function () {
    if (acDropdown) acDropdown.style.display = "none";
    doSearch(searchInput.value.trim());
    updateURL();
  });
  window.addEventListener("hashchange", function () {
    var parsed = parseURL();
    if (parsed.query) {
      searchInput.value = parsed.query;
      doSearch(parsed.query);
    }
  });

  init();
})();

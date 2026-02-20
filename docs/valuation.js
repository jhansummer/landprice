/* APT Mine — 단지분석 (valuation search) */
(function () {
  var INDEX_PATH = "data/apt_trade/valuation/index.json";
  var BY_APT_BASE = "data/apt_trade/by_apt/";
  var LOCATION_SCORES_PATH = "data/apt_trade/location_scores.json";
  var VALUATION_GEO_PATH = "data/apt_trade/valuation_geo.json";
  var LOCATION_VALUE_PATH = "data/apt_trade/location_value.json";
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
  var locationValue = null;

  /* ── helpers ── */
  function fmt(v) { return new Intl.NumberFormat("ko-KR").format(Math.round(v)); }
  function fmtEok(v) { return (v / 10000).toFixed(1) + "\uC5B5"; }
  function fmtPerM2(price, area) { return (price / area / 1000).toFixed(1) + "\uCC9C\uB9CC/m\u00B2"; }
  function escapeHTML(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

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
        data.items.forEach(function (item) { all.push(item); });
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
  function loadLocationValue() {
    return fetch(LOCATION_VALUE_PATH + "?t=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) { locationValue = data; })
      .catch(function () { locationValue = null; });
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
   * 서울: 교통 = 역세권(50%)+업무지구(50%), 종합 = 교통60%+학군20%+인프라20%
   * 타지역: 교통 = 역세권(100%), 종합 = 교통60%+학군20%+인프라20%
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

      // 종합: 교통60%+학군20%+인프라20%
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

    // 타 지역: 교통60%+학군20%+인프라20% (업무지구 거리 반영)
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

    var section = document.createElement("div");
    section.className = "vs-section";

    // Title + total
    var header = document.createElement("div");
    header.className = "vs-header";
    var title = document.createElement("span");
    title.className = "vs-title";
    title.textContent = "\uC785\uC9C0\uBD84\uC11D";
    header.appendChild(title);
    var totalEl = document.createElement("span");
    totalEl.className = "vs-total";
    totalEl.innerHTML = '<span class="vs-total-num">' + scores.total + '</span><span class="vs-total-label">\uC810</span>';
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
      "<b>\uAD50\uD1B5\uC811\uADFC\uC131</b>: " + (scores.isSeoul ? "\uC5ED\uC138\uAD8C(50%) + \uC5C5\uBB34\uC9C0\uAD6C(50%)" : "\uC5ED\uC138\uAD8C \uAC70\uB9AC \uAE30\uBC18") + ". \uC5ED\uC138\uAD8C = max(5, 100 - \uAC70\uB9AC(m)/30)<br>" +
      "<b>\uD559\uAD70</b>: \uBC18\uACBD 1km \uB0B4 \uD559\uC6D0 \uC218 \uAE30\uBC18 (300\uAC1C \uC774\uC0C1 \uB9CC\uC810)<br>" +
      "<b>\uCD9C\uD1F4\uADFC\uC811\uADFC\uC131</b>: \uC5ED\uC138\uAD8C(30%) + \uC5C5\uBB34\uC9C0\uAD6C \uAC70\uB9AC(70%). \uAC15\uB0A8 50% \u00B7 \uAD11\uD654\uBB38 25% \u00B7 \uC5EC\uC758\uB3C4 25%<br>" +
      "<b>\uC0DD\uD65C\uC778\uD504\uB77C</b>: \uBC18\uACBD 1km \uB0B4 \uD559\uAD50(30\uC810) \u00B7 \uBCD1\uC6D0(25\uC810) \u00B7 \uC740\uD589(20\uC810) \u00B7 \uD3B8\uC758\uC810(15\uC810) \u00B7 \uB9C8\uD2B8(10\uC810)<br>" +
      "<b>\uC885\uD569</b>: \uAD50\uD1B5 60% + \uD559\uAD70 20% + \uC778\uD504\uB77C 20% (\uAD50\uD1B5 \uAC00\uC911)";
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

    // Bar gauges
    var barsCol = document.createElement("div");
    barsCol.className = "vs-bars-col";
    var barItems = [
      { label: "\uAD50\uD1B5\uC811\uADFC\uC131", score: scores.transport }
    ];
    // 학군 (academy_score가 있으면 전 지역 표시)
    if (scores.school != null) {
      barItems.push({ label: "\uD559\uAD70", score: scores.school });
    }
    // 생활인프라
    if (scores.infra != null) {
      barItems.push({ label: "\uC0DD\uD65C\uC778\uD504\uB77C", score: scores.infra });
    }
    barItems.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "vs-bar-row";
      var lbl = document.createElement("span");
      lbl.className = "vs-bar-label";
      lbl.textContent = it.label;
      row.appendChild(lbl);
      var track = document.createElement("div");
      track.className = "vs-bar-track";
      var fill = document.createElement("div");
      fill.className = "vs-bar-fill";
      fill.style.width = it.score + "%";
      if (it.score >= 70) fill.classList.add("vs-bar-high");
      else if (it.score >= 40) fill.classList.add("vs-bar-mid");
      else fill.classList.add("vs-bar-low");
      track.appendChild(fill);
      row.appendChild(track);
      var val = document.createElement("span");
      val.className = "vs-bar-val";
      val.textContent = it.score;
      row.appendChild(val);
      barsCol.appendChild(row);
    });

    section.appendChild(barsCol);

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
      + '<div class="val-guide-footer" style="margin-top:4px;font-size:11px;color:var(--muted)">\u203B \uC800\uD3C9\uAC00/\uB9AC\uB529\uC740 \uC2E4\uAC70\uB798\uAC00 \uAE30\uC900, \uC785\uC9C0\uBD84\uC11D\uC740 \uC5ED\uC138\uAD8C\u00B7\uAD50\uD1B5\u00B7\uD559\uAD70(\uD559\uC6D0\uC218)\u00B7\uC0DD\uD65C\uC778\uD504\uB77C\uB97C \uBC18\uC601\uD569\uB2C8\uB2E4.</div>';
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
            chg_pct: entry.gap_pct
          });
          wlBtn.textContent = "\uAD00\uC2EC \uC81C\uAC70";
        }
        APTWatchlist.track("watchlist_toggle", { apt_name: entry.apt_name, source: "valuation" });
      });
      cta.appendChild(wlBtn);
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

  /* ── location value ranking ── */
  function showLocationValueRanking() {
    if (!locationValue || !locationValue.sidos) { showHint(); return; }
    resultsEl.innerHTML = "";

    var totalCount = 0;
    globalIndex.sido_order.forEach(function (s) { var d = sidoCache[s]; if (d) totalCount += (d.count || 0); });

    var intro = document.createElement("div");
    intro.className = "val-hint";
    intro.innerHTML = '<b>\uC785\uC9C0 \uB300\uBE44 \uC800\uD3C9\uAC00 \uC544\uD30C\uD2B8</b><br>'
      + '<span style="font-size:11px">\uC785\uC9C0\uC810\uC218(\uAD50\uD1B5\u00B7\uD559\uAD70\u00B7\uC778\uD504\uB77C)\uB294 \uB192\uC740\uB370 \uAC19\uC740 \uC2DC\uB3C4 \uB0B4 \uAC00\uACA9\uC740 \uC0C1\uB300\uC801\uC73C\uB85C \uB0AE\uC740 \uB2E8\uC9C0</span>';
    resultsEl.appendChild(intro);

    var sidoTabs = document.createElement("div");
    sidoTabs.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0";
    var contentDiv = document.createElement("div");

    var activeSido = null;

    function renderSido(sido) {
      activeSido = sido;
      contentDiv.innerHTML = "";
      sidoTabs.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.sido === sido);
      });

      var items = locationValue.sidos[sido] || [];
      if (!items.length) {
        contentDiv.innerHTML = '<div class="val-empty">\uD574\uB2F9 \uC2DC\uB3C4\uC5D0 \uC785\uC9C0 \uC800\uD3C9\uAC00 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
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

        var locBadge = document.createElement("span");
        locBadge.style.cssText = "font-size:10px;font-weight:600;padding:2px 6px;border-radius:8px;background:#dbeafe;color:#2563eb;margin-right:4px";
        locBadge.textContent = "\uC785\uC9C0 " + item.loc_score + "\uC810";
        header.appendChild(locBadge);

        if (item.status && item.status !== "market") {
          var badge = document.createElement("span");
          badge.className = "val-badge val-badge-" + item.status;
          badge.textContent = STATUS_LABELS[item.status] || item.status;
          header.appendChild(badge);
        }

        if (item.gap_pct != null) {
          var gap = document.createElement("span");
          gap.className = "val-gap " + (item.gap_pct < 0 ? "negative" : item.gap_pct > 0 ? "positive" : "");
          gap.textContent = (item.gap_pct > 0 ? "+" : "") + item.gap_pct.toFixed(1) + "%";
          header.appendChild(gap);
        }
        card.appendChild(header);

        var name = document.createElement("div");
        name.className = "val-name";
        name.textContent = item.apt_name;
        card.appendChild(name);

        var info = document.createElement("div");
        info.className = "val-info";
        var priceEok = (item.price * item.area_m2 / 10000).toFixed(1);
        info.textContent = item.sigungu + " " + item.dong_name + " \u00B7 " + item.area_m2 + "m\u00B2 \u00B7 " + priceEok + "\uC5B5";
        card.appendChild(info);

        // Score bars (compact)
        var bars = document.createElement("div");
        bars.style.cssText = "display:flex;gap:8px;margin:6px 0 2px;font-size:10px;color:var(--muted)";
        var labels = [
          ["\uAD50\uD1B5", item.loc_transport],
          ["\uD559\uAD70", item.loc_school],
          ["\uC778\uD504\uB77C", item.loc_infra]
        ];
        labels.forEach(function (l) {
          if (l[1] == null) return;
          var s = document.createElement("span");
          var c = l[1] >= 70 ? "#2563eb" : l[1] >= 40 ? "#f59e0b" : "#94a3b8";
          s.innerHTML = l[0] + ' <b style="color:' + c + '">' + l[1] + '</b>';
          bars.appendChild(s);
        });
        var pctSpan = document.createElement("span");
        pctSpan.innerHTML = '\uAC00\uACA9\uC21C\uC704 <b style="color:#ef4444">\uD558\uC704 ' + item.price_pct + '%</b>';
        bars.appendChild(pctSpan);
        card.appendChild(bars);

        card.addEventListener("click", function () {
          searchInput.value = item.apt_name;
          doSearch(item.apt_name);
          updateURL();
        });

        contentDiv.appendChild(card);
      });
    }

    var sidos = Object.keys(locationValue.sidos);
    sidos.forEach(function (sido) {
      var items = locationValue.sidos[sido] || [];
      if (!items.length) return;
      var btn = document.createElement("button");
      btn.className = "sort-btn";
      btn.dataset.sido = sido;
      btn.textContent = sido + " (" + items.length + ")";
      btn.addEventListener("click", function () { renderSido(sido); });
      sidoTabs.appendChild(btn);
    });

    resultsEl.appendChild(sidoTabs);
    resultsEl.appendChild(contentDiv);

    // Show first sido with data
    if (sidos.length) renderSido(sidos[0]);

    // Search hint at bottom
    var hint = document.createElement("div");
    hint.style.cssText = "text-align:center;margin-top:16px;font-size:12px;color:var(--muted)";
    hint.textContent = "\uC804\uAD6D " + totalCount.toLocaleString() + "\uAC1C \uB2E8\uC9C0 \uAC80\uC0C9 \uAC00\uB2A5 \u2014 \uC704 \uAC80\uC0C9\uCC3D\uC5D0 \uB2E8\uC9C0\uBA85\uC744 \uC785\uB825\uD558\uC138\uC694";
    resultsEl.appendChild(hint);
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
          loadLocationValue()
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

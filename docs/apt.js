/* APT Mine — 개별 단지 상세 페이지 */
(function () {
  var LOOKUP_BASE = "/data/apt_trade/apt_lookup/";
  var BY_APT_BASE = "/data/apt_trade/by_apt/";
  var GEO_PATH = "/data/apt_trade/valuation_geo.json";
  var SUMMARY_PATH = "/data/apt_trade/summary.json";
  var DAEJANG_PATH = "/data/apt_trade/daejang.json";

  var contentEl = document.getElementById("apt-content");
  var statusEl = document.getElementById("status");
  var fmt = APTCommon.fmt;
  var fmtEok = APTCommon.fmtEok;
  var escapeHTML = APTCommon.escapeHTML;

  /* ── URL 파라미터 파싱 ── */
  function getParams() {
    if (window.APT_PARAMS) return window.APT_PARAMS;
    var sp = new URLSearchParams(location.search);
    return { id: sp.get("id"), sido: sp.get("s") };
  }

  /* ── 메인 ── */
  async function init() {
    var params = getParams();
    if (!params.id || !params.sido) {
      statusEl.textContent = "잘못된 접근입니다. 검색 페이지에서 단지를 선택해주세요.";
      return;
    }

    try {
      // 병렬 로드
      var [lookupRes, txnRes, geoRes, summaryRes, daejangRes] = await Promise.all([
        fetch(LOOKUP_BASE + encodeURIComponent(params.sido) + ".json?t=" + Date.now()),
        fetch(BY_APT_BASE + params.id + ".json?t=" + Date.now()),
        fetch(GEO_PATH + "?t=" + Date.now()),
        fetch(SUMMARY_PATH + "?t=" + Date.now()),
        fetch(DAEJANG_PATH + "?t=" + Date.now())
      ]);

      var lookup = lookupRes.ok ? await lookupRes.json() : {};
      var raw = txnRes.ok ? await txnRes.json() : [];
      var txns = Array.isArray(raw) ? raw : (raw.trades || []);
      var geoAll = null;
      try { geoAll = geoRes.ok ? await geoRes.json() : null; } catch (e) { geoAll = null; }
      var summaryAll = null;
      try { summaryAll = summaryRes.ok ? await summaryRes.json() : null; } catch (e) { summaryAll = null; }
      var daejangAll = null;
      try { daejangAll = daejangRes.ok ? await daejangRes.json() : null; } catch (e) { daejangAll = null; }

      var aptInfo = lookup[params.id];
      if (!aptInfo) {
        statusEl.textContent = "단지 정보를 찾을 수 없습니다.";
        return;
      }

      // aptInfo: [name, sigungu, dong, area, year]
      var apt = {
        id: params.id,
        sido: params.sido,
        name: aptInfo[0],
        sigungu: aptInfo[1],
        dong: aptInfo[2],
        area: aptInfo[3],
        year: aptInfo[4]
      };

      var geo = geoAll ? geoAll[params.id] || null : null;

      // 대장아파트 조회
      var daejangInfo = null; // [apt_id, apt_name, area_m2, households]
      var daejangTxns = null;
      if (daejangAll && daejangAll[params.sido]) {
        var dongKey = apt.sigungu + "/" + apt.dong;
        var dj = daejangAll[params.sido][dongKey];
        if (dj) {
          daejangInfo = { id: dj[0], name: dj[1], area: dj[2], households: dj[3] };
          if (dj[0] !== params.id) {
            try {
              var djRes = await fetch(BY_APT_BASE + dj[0] + ".json?t=" + Date.now());
              var djRaw = djRes.ok ? await djRes.json() : null;
              daejangTxns = djRaw ? (Array.isArray(djRaw) ? djRaw : (djRaw.trades || null)) : null;
              if (daejangTxns) {
                daejangTxns.sort(function (a, b) { return new Date(a[0]).getTime() - new Date(b[0]).getTime(); });
              }
            } catch (e) { daejangTxns = null; }
          }
        }
      }

      // 거래 내역 정렬
      txns.sort(function (a, b) { return new Date(a[0]).getTime() - new Date(b[0]).getTime(); });

      // 동적 title + meta
      var titleStr = apt.name + " " + apt.area + "m² 시세 - APT Mine";
      document.title = titleStr;
      updateMeta("og:title", titleStr);
      updateMeta("twitter:title", titleStr);
      var descStr = apt.sigungu + " " + apt.dong + " " + apt.name + " " + apt.area + "m² 실거래가 시세 분석";
      updateMeta("description", descStr);
      updateMeta("og:description", descStr);
      updateMeta("twitter:description", descStr);

      // 페이지 렌더
      statusEl.remove();
      render(apt, txns, geo, summaryAll, daejangInfo, daejangTxns);

      APTWatchlist.track("apt_detail_view", { apt_name: apt.name, sigungu: apt.sigungu, area_m2: apt.area });
    } catch (e) {
      statusEl.textContent = "데이터를 불러오지 못했습니다. 새로고침해주세요.";
    }
  }

  function updateMeta(name, content) {
    var isOg = name.indexOf("og:") === 0 || name.indexOf("twitter:") === 0;
    var sel = isOg
      ? 'meta[property="' + name + '"]'
      : 'meta[name="' + name + '"]';
    var el = document.querySelector(sel);
    if (el) el.setAttribute("content", content);
  }

  /* ── 월별 평균 기반 고점/현재가 계산 (drawPeakChart와 동일 로직) ── */
  function calcPeakStats(txns) {
    var monthlyMap = {};
    txns.forEach(function (t) {
      var d = new Date(t[0]);
      var ym = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0");
      if (!monthlyMap[ym]) monthlyMap[ym] = { sum: 0, count: 0 };
      monthlyMap[ym].sum += t[1];
      monthlyMap[ym].count += 1;
    });
    var months = Object.keys(monthlyMap).sort();
    if (months.length < 1) return null;
    var data = months.map(function (ym) {
      var m = monthlyMap[ym];
      return { ym: ym, price: m.sum / m.count };
    });
    // 고점: 2021~2022 월평균 우선, 없으면 전체 최고
    var peakIdx = 0;
    var hasPeakRange = false;
    data.forEach(function (d, i) {
      if (d.ym >= "202101" && d.ym <= "202212") {
        if (!hasPeakRange || d.price > data[peakIdx].price) {
          peakIdx = i; hasPeakRange = true;
        }
      }
    });
    if (!hasPeakRange) {
      data.forEach(function (d, i) {
        if (d.price > data[peakIdx].price) peakIdx = i;
      });
    }
    var peakPrice = data[peakIdx].price;
    var peakYm = data[peakIdx].ym;
    // 현재가: 마지막 1개월 평균
    var currentPrice = data[data.length - 1].price;
    var vsPeakPct = peakPrice > 0 ? ((currentPrice - peakPrice) / peakPrice * 100) : 0;
    return { currentPrice: currentPrice, peakPrice: peakPrice, peakYm: peakYm, vsPeakPct: vsPeakPct };
  }

  /* ── 페이지 렌더링 ── */
  function render(apt, txns, geo, summaryAll, daejangInfo, daejangTxns) {
    var latest = txns.length ? txns[txns.length - 1] : null;
    var latestPrice = latest ? latest[1] : 0;
    var stats = txns.length ? calcPeakStats(txns) : null;
    var peakPrice = stats ? stats.peakPrice : 0;
    // 고점대비: 최근 실거래가 기준
    var vsPeak = peakPrice > 0 && latestPrice ? ((latestPrice - peakPrice) / peakPrice * 100) : 0;

    // ── 헤더 ──
    var header = document.createElement("div");
    header.className = "apt-header";
    var h1 = document.createElement("h1");
    h1.className = "apt-title";
    h1.textContent = apt.name;
    header.appendChild(h1);
    var sub = document.createElement("div");
    sub.className = "apt-sub";
    var parts = [apt.sigungu, apt.dong, apt.area + "m²"];
    if (apt.year) parts.push(apt.year + "년");
    sub.textContent = parts.join(" · ");
    header.appendChild(sub);
    contentEl.appendChild(header);

    // ── 액션 버튼 ──
    var actions = document.createElement("div");
    actions.className = "apt-actions";

    // 관심등록
    var wlBtn = document.createElement("button");
    wlBtn.className = "share-btn";
    var isW = APTWatchlist.has(apt.id);
    wlBtn.textContent = isW ? "★ 관심해제" : "☆ 관심등록";
    if (isW) wlBtn.classList.add("active");
    wlBtn.addEventListener("click", function () {
      if (APTWatchlist.has(apt.id)) {
        APTWatchlist.remove(apt.id);
        wlBtn.textContent = "☆ 관심등록";
        wlBtn.classList.remove("active");
      } else {
        APTWatchlist.add({
          id: apt.id, apt_name: apt.name, sigungu: apt.sigungu,
          dong_name: apt.dong, area_m2: apt.area, sido: apt.sido,
          latest_price: currentPrice || (latest ? latest[1] : 0)
        });
        wlBtn.textContent = "★ 관심해제";
        wlBtn.classList.add("active");
      }
    });
    actions.appendChild(wlBtn);

    // 카카오 공유
    var kakaoBtn = document.createElement("button");
    kakaoBtn.className = "share-btn";
    kakaoBtn.textContent = "카카오 공유";
    kakaoBtn.addEventListener("click", function () {
      APTShare.kakao({
        name: apt.name,
        sigungu: apt.sigungu,
        dong: apt.dong,
        area: apt.area,
        price: currentPrice ? fmtEok(currentPrice) : "",
        url: location.href
      });
    });
    actions.appendChild(kakaoBtn);

    // URL 복사
    var copyBtn = document.createElement("button");
    copyBtn.className = "share-btn";
    copyBtn.textContent = "URL 복사";
    copyBtn.addEventListener("click", function () { APTShare.copyURL(); });
    actions.appendChild(copyBtn);

    // 차트 저장 (차트 렌더 후 활성화)
    var dlBtn = document.createElement("button");
    dlBtn.className = "share-btn";
    dlBtn.textContent = "차트 저장";
    dlBtn.disabled = true;
    actions.appendChild(dlBtn);

    contentEl.appendChild(actions);

    // ── 가격 3칸 ──
    if (stats) {
      var grid = document.createElement("div");
      grid.className = "apt-price-grid";

      var peakYmStr = stats.peakYm.slice(0, 4) + "." + stats.peakYm.slice(4);
      grid.appendChild(createPriceCell("최근 실거래", fmtEok(latestPrice), latest ? latest[0] : ""));
      grid.appendChild(createPriceCell("고점가", fmtEok(peakPrice), peakYmStr));
      var vpColor = vsPeak >= 0 ? "var(--up)" : "var(--down)";
      var vpCell = createPriceCell("고점대비", (vsPeak >= 0 ? "+" : "") + vsPeak.toFixed(1) + "%", "");
      vpCell.querySelector(".apt-price-value").style.color = vpColor;
      grid.appendChild(vpCell);

      contentEl.appendChild(grid);
    }

    // ── 세대수 + 전세가율 ──
    var hasHouseholds = geo && geo.households;
    var jeonseRatio = null;
    var jeonseLabel = "";
    // 단지별 전세가율 우선 (valuation_geo.json)
    if (geo && geo.jeonse_ratio != null) {
      jeonseRatio = geo.jeonse_ratio;
      jeonseLabel = "이 단지";
    }
    // fallback: 구 평균
    if (jeonseRatio == null && summaryAll && summaryAll.sidos) {
      var sidoData = summaryAll.sidos[apt.sido];
      if (sidoData && sidoData.districts && sidoData.districts[apt.sigungu]) {
        var distData = sidoData.districts[apt.sigungu];
        if (distData.jeonse && distData.jeonse.avg_ratio != null) {
          jeonseRatio = distData.jeonse.avg_ratio;
          jeonseLabel = apt.sigungu + " 평균";
        }
      }
    }
    if (hasHouseholds || jeonseRatio != null) {
      var extraGrid = document.createElement("div");
      extraGrid.className = "apt-price-grid";
      extraGrid.style.gridTemplateColumns = "1fr 1fr";
      if (hasHouseholds) {
        var hVal = geo.households;
        var hColor = hVal >= 1500 ? "#2563eb" : hVal >= 500 ? "#f59e0b" : "#94a3b8";
        var hCell = createPriceCell("세대수", hVal.toLocaleString() + "세대", "");
        hCell.querySelector(".apt-price-value").style.color = hColor;
        extraGrid.appendChild(hCell);
      }
      if (jeonseRatio != null) {
        var jColor = jeonseRatio >= 60 ? "#ef4444" : jeonseRatio >= 40 ? "#f59e0b" : "#16a34a";
        var jCell = createPriceCell("전세가율", jeonseRatio.toFixed(1) + "%", jeonseLabel);
        jCell.querySelector(".apt-price-value").style.color = jColor;
        extraGrid.appendChild(jCell);
      }
      contentEl.appendChild(extraGrid);
    }

    // ── 인사이트 한줄 ──
    var insightLines = [];
    if (vsPeak < 0 && stats) {
      var diffVal = Math.round(peakPrice - latestPrice);
      insightLines.push('역대 <span class="term-tip">고점가</span>(' + fmtEok(peakPrice) + ')보다 <strong>' + fmtEok(diffVal) + ' 싸게</strong> 거래됐어요 (' + vsPeak.toFixed(1) + '%)');
    } else if (vsPeak > 0 && stats) {
      insightLines.push('역대 <span class="term-tip">고점가</span>를 <strong>경신했어요!</strong> (+' + vsPeak.toFixed(1) + '%)');
    }
    if (jeonseRatio != null) {
      var jComment = jeonseRatio >= 60
        ? '갭이 작아 실거주 부담이 적은 편이에요'
        : jeonseRatio >= 40
          ? '평균적인 수준이에요'
          : '투자 수요가 높은 단지예요';
      insightLines.push('<span class="term-tip">전세가율</span>이 매매가의 <strong>' + jeonseRatio.toFixed(1) + '%</strong>예요.');
    }
    if (insightLines.length) {
      var insightBlock = document.createElement("div");
      insightBlock.className = "explain-block";
      insightBlock.innerHTML = insightLines.join("<br>");
      contentEl.appendChild(insightBlock);
      APTCommon.initTooltips();
      if (typeof gtag === "function") {
        gtag("event", "insight_impression", { apt_name: apt.name, vs_peak: vsPeak.toFixed(1), jeonse_ratio: jeonseRatio != null ? jeonseRatio.toFixed(1) : "" });
      }
    }

    // ── 차트 ──
    if (txns.length > 1) {
      var chartSec = document.createElement("div");
      chartSec.className = "section";
      chartSec.style.padding = "16px";
      var chartTitle = document.createElement("div");
      chartTitle.style.cssText = "font-size:14px;font-weight:700;margin-bottom:8px;color:var(--ink)";
      chartTitle.textContent = "매매가 추이";
      chartSec.appendChild(chartTitle);

      var chartDiv = document.createElement("div");
      chartDiv.className = "scatter-chart";
      chartDiv.style.height = "220px";
      var canvas = document.createElement("canvas");
      chartDiv.appendChild(canvas);
      chartSec.appendChild(chartDiv);
      contentEl.appendChild(chartSec);

      requestAnimationFrame(function () {
        drawScatter(canvas, txns);
        dlBtn.disabled = false;
        dlBtn.addEventListener("click", function () {
          APTShare.downloadChart(canvas, apt.name + "-" + apt.area + "m2.png");
        });
      });
    }

    // ── 입지 정보 ──
    if (geo) {
      renderGeo(geo);
    }

    // ── 대장아파트 비교 ──
    if (daejangInfo) {
      renderDaejangSection(apt, txns, daejangInfo, daejangTxns);
    }

    // ── 이 지역 분석 링크 ──
    renderAreaMore(apt);

    // ── 거래 내역 테이블 ──
    if (txns.length) {
      renderTxnTable(txns);
    }

    // Kakao SDK 초기화 (JavaScript 앱 키)
    APTShare.init("");
  }

  function createPriceCell(label, value, sub) {
    var cell = document.createElement("div");
    cell.className = "apt-price-cell";
    var lbl = document.createElement("div");
    lbl.className = "apt-price-label";
    lbl.textContent = label;
    cell.appendChild(lbl);
    var val = document.createElement("div");
    val.className = "apt-price-value";
    val.textContent = value;
    cell.appendChild(val);
    if (sub) {
      var s = document.createElement("div");
      s.className = "apt-price-sub";
      s.textContent = sub;
      cell.appendChild(s);
    }
    return cell;
  }

  /* ── 입지 점수 계산 (3축: 교통/학군/생활) ── */
  function calcGeoScores(geo) {
    var transport = geo.subway_dist != null ? Math.max(5, Math.round(100 - geo.subway_dist * 1000 / 30)) : 0;
    var infra = geo.infra_score || 0;
    var livability = geo.livability_score || 0;
    var living = Math.round((infra + livability) / 2);
    return {
      transport: transport,
      school: geo.academy_score || 0,
      living: living
    };
  }

  /* ── 입지 정보 렌더 ── */
  function renderGeo(geo) {
    var sec = document.createElement("div");
    sec.className = "section";
    sec.style.padding = "16px";
    var title = document.createElement("div");
    title.style.cssText = "font-size:14px;font-weight:700;margin-bottom:12px;color:var(--ink)";
    title.textContent = "입지 정보";
    sec.appendChild(title);

    // 입지 점수 바 차트 (4축)
    var scores = calcGeoScores(geo);
    if (scores.transport || scores.school || scores.living) {
      var barWrap = document.createElement("div");
      barWrap.style.cssText = "margin-bottom:12px";
      sec.appendChild(barWrap);
      drawScoreBars(barWrap, scores);

      // 종합 점수
      if (geo.loc_score != null) {
        var totalDiv = document.createElement("div");
        totalDiv.style.cssText = "text-align:center;margin-bottom:12px";
        var dispScore = scaleScore50(geo.loc_score);
        var totalColor = dispScore >= 85 ? "#2563eb" : dispScore >= 70 ? "#f59e0b" : "#94a3b8";
        totalDiv.innerHTML = '<span style="font-size:13px;font-weight:700;color:' + totalColor + '">종합 ' + dispScore + '점</span>';
        sec.appendChild(totalDiv);
      }
    }

    var rows = [];

    // 역세권
    if (geo.subway) {
      var dist = geo.subway_dist;
      var distStr = dist < 1 ? Math.round(dist * 1000) + "m" : dist.toFixed(1) + "km";
      rows.push("🚇 " + geo.subway + "역 " + distStr + " (" + geo.subway_line + ")");
    }

    // 업무지구
    if (geo.biz_gangnam != null) {
      rows.push("🏢 강남 " + geo.biz_gangnam + "km · 광화문 " + (geo.biz_gwanghwamun || "-") + "km · 여의도 " + (geo.biz_yeouido || "-") + "km");
    }

    // 통근 시간
    if (geo.commute) {
      var c = geo.commute;
      var parts = [];
      if (c.gangnam) parts.push("강남 " + c.gangnam + "분");
      if (c.gwanghwamun) parts.push("광화문 " + c.gwanghwamun + "분");
      if (c.yeouido) parts.push("여의도 " + c.yeouido + "분");
      if (parts.length) rows.push("🚌 " + parts.join(" · "));
    }

    // 인프라
    if (geo.infra) {
      var inf = geo.infra;
      var items = [];
      if (inf.mart) items.push("마트" + inf.mart);
      if (inf.conv) items.push("편의점" + inf.conv);
      if (inf.school) items.push("학교" + inf.school);
      if (inf.hospital) items.push("병원" + inf.hospital);
      if (inf.bank) items.push("은행" + inf.bank);
      if (inf.academy) items.push("학원" + inf.academy);
      if (items.length) rows.push("🏪 " + items.join(" · "));
    }

    if (!rows.length && !scores.transport && !scores.school) return;

    rows.forEach(function (text) {
      var row = document.createElement("div");
      row.style.cssText = "font-size:13px;color:var(--ink);margin-bottom:6px;line-height:1.5";
      row.textContent = text;
      sec.appendChild(row);
    });

    contentEl.appendChild(sec);
  }

  /* ── 대장아파트 비교: 평균가 계산 ── */
  function avgPrice(txns, monthsBack) {
    if (!txns || !txns.length) return null;
    var now = new Date();
    var cutoff = new Date(now.getFullYear(), now.getMonth() - monthsBack, now.getDate());
    var cutoffStr = cutoff.toISOString().slice(0, 10);
    var sum = 0, count = 0;
    txns.forEach(function (t) {
      if (t[0] >= cutoffStr) {
        sum += t[1];
        count++;
      }
    });
    return count > 0 ? sum / count : null;
  }

  function computeDaejangComparison(apt, txns, daejangInfo, daejangTxns) {
    var myAvg3y = avgPrice(txns, 36);
    var myAvg6m = avgPrice(txns, 6);
    var djAvg3y = avgPrice(daejangTxns, 36);
    var djAvg6m = avgPrice(daejangTxns, 6);
    // 3년 데이터조차 없으면 비교 불가
    if (!myAvg3y || !djAvg3y) return null;
    var gap3y = (myAvg3y - djAvg3y) / djAvg3y * 100;
    var gap6m = (myAvg6m && djAvg6m) ? (myAvg6m - djAvg6m) / djAvg6m * 100 : null;
    var delta = (gap6m != null) ? gap6m - gap3y : null;
    var trend = delta != null ? (delta > 0 ? "narrowing" : "widening") : null;
    return {
      myAvg3y: myAvg3y, myAvg6m: myAvg6m,
      djAvg3y: djAvg3y, djAvg6m: djAvg6m,
      gap3y: gap3y, gap6m: gap6m,
      delta: delta, trend: trend
    };
  }

  /* ── 대장아파트 비교 섹션 렌더 ── */
  function renderDaejangSection(apt, txns, daejangInfo, daejangTxns) {
    var sec = document.createElement("div");
    sec.className = "section";
    sec.style.padding = "16px";

    var title = document.createElement("div");
    title.style.cssText = "font-size:14px;font-weight:700;margin-bottom:12px;color:var(--ink)";
    title.innerHTML = "\uD83C\uDFC6 \uB3D9\uBCC4 \uB300\uC7A5\uC544\uD30C\uD2B8 \uBE44\uAD50";
    sec.appendChild(title);

    var isSelf = daejangInfo.id === apt.id;

    // 대장 = 자기자신
    if (isSelf) {
      var badge = document.createElement("div");
      badge.style.cssText = "background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;text-align:center;font-size:13px;font-weight:600;color:#2563eb";
      badge.textContent = "\uC774 \uB2E8\uC9C0\uB294 " + apt.dong + "\uC758 \uB300\uC7A5\uC544\uD30C\uD2B8\uC785\uB2C8\uB2E4!";
      sec.appendChild(badge);
      contentEl.appendChild(sec);
      return;
    }

    // 대장 아파트 정보 카드
    var djCard = document.createElement("div");
    djCard.style.cssText = "background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px";
    var djTop = document.createElement("div");
    djTop.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px";
    var djLink = document.createElement("a");
    djLink.href = "apt.html?id=" + daejangInfo.id + "&s=" + encodeURIComponent(apt.sido);
    djLink.style.cssText = "font-size:14px;font-weight:700;color:#2563eb;text-decoration:none";
    djLink.textContent = daejangInfo.name;
    djTop.appendChild(djLink);
    var djBadge = document.createElement("span");
    djBadge.style.cssText = "font-size:11px;background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-weight:600";
    djBadge.textContent = "\uB300\uC7A5";
    djTop.appendChild(djBadge);
    djCard.appendChild(djTop);
    var djSub = document.createElement("div");
    djSub.style.cssText = "font-size:12px;color:var(--muted)";
    djSub.textContent = daejangInfo.area + "m\u00B2 \u00B7 " + daejangInfo.households.toLocaleString() + "\uC138\uB300";
    djCard.appendChild(djSub);
    sec.appendChild(djCard);

    // 비교 계산
    var comp = computeDaejangComparison(apt, txns, daejangInfo, daejangTxns);
    if (comp) {
      // 갭 비교 그리드
      var gapGrid = document.createElement("div");
      gapGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px";

      function createGapCell(label, gap, myAvg, djAvg) {
        var cell = document.createElement("div");
        cell.style.cssText = "background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center";
        var lbl = document.createElement("div");
        lbl.style.cssText = "font-size:11px;color:var(--muted);margin-bottom:4px";
        lbl.textContent = label;
        cell.appendChild(lbl);
        var val = document.createElement("div");
        val.style.cssText = "font-size:18px;font-weight:700;color:" + (gap >= 0 ? "var(--up)" : "var(--down)");
        val.textContent = (gap >= 0 ? "+" : "") + gap.toFixed(1) + "%";
        cell.appendChild(val);
        var detail = document.createElement("div");
        detail.style.cssText = "font-size:11px;color:var(--muted);margin-top:2px";
        detail.textContent = fmtEok(Math.round(myAvg)) + " vs " + fmtEok(Math.round(djAvg));
        cell.appendChild(detail);
        return cell;
      }

      gapGrid.appendChild(createGapCell("3\uB144 \uD3C9\uADE0 \uAC2D\uCC28", comp.gap3y, comp.myAvg3y, comp.djAvg3y));
      if (comp.gap6m != null) {
        gapGrid.appendChild(createGapCell("6\uAC1C\uC6D4 \uD3C9\uADE0 \uAC2D\uCC28", comp.gap6m, comp.myAvg6m, comp.djAvg6m));
      }
      sec.appendChild(gapGrid);

      // 트렌드 인사이트
      if (comp.trend) {
        var trendDiv = document.createElement("div");
        trendDiv.style.cssText = "font-size:13px;color:var(--ink);margin-bottom:12px;line-height:1.5";
        var deltaSign = comp.delta >= 0 ? "+" : "";
        if (comp.trend === "narrowing") {
          trendDiv.innerHTML = "\uB300\uC7A5\uC544\uD30C\uD2B8\uC640\uC758 \uAC00\uACA9 \uAC2D\uCC28\uAC00 <strong style='color:var(--up)'>\uC904\uC5B4\uB4E4\uACE0 \uC788\uC5B4\uC694</strong> (\u0394" + deltaSign + comp.delta.toFixed(1) + "%p)";
        } else {
          trendDiv.innerHTML = "\uB300\uC7A5\uC544\uD30C\uD2B8\uC640\uC758 \uAC00\uACA9 \uAC2D\uCC28\uAC00 <strong style='color:var(--down)'>\uBCA8\uC5B4\uC9C0\uACE0 \uC788\uC5B4\uC694</strong> (\u0394" + deltaSign + comp.delta.toFixed(1) + "%p)";
        }
        sec.appendChild(trendDiv);
      }
    }

    // 비교 차트: m²당 가격 추이
    if (daejangTxns && daejangTxns.length > 1 && txns.length > 1) {
      var chartDiv = document.createElement("div");
      chartDiv.className = "scatter-chart";
      chartDiv.style.height = "200px";
      var chartCanvas = document.createElement("canvas");
      chartDiv.appendChild(chartCanvas);
      sec.appendChild(chartDiv);

      var mySeries = txns.map(function (t) { return [t[0], t[1]]; });
      var djSeries = daejangTxns.map(function (t) { return [t[0], t[1]]; });

      requestAnimationFrame(function () {
        drawMultiScatter(chartCanvas, [
          { name: apt.name + " " + apt.area + "m\u00B2", history: mySeries },
          { name: daejangInfo.name + " " + daejangInfo.area + "m\u00B2", history: djSeries }
        ]);
      });

      var legend = document.createElement("div");
      legend.style.cssText = "display:flex;gap:12px;justify-content:center;margin-top:6px;font-size:11px;color:var(--muted)";
      legend.innerHTML = '<span style="color:#2563eb">\u25CF ' + escapeHTML(apt.name) + ' ' + apt.area + 'm\u00B2</span><span style="color:#ef4444">\u25CF ' + escapeHTML(daejangInfo.name) + ' ' + daejangInfo.area + 'm\u00B2</span>';
      sec.appendChild(legend);
    }

    contentEl.appendChild(sec);
  }

  /* ── 이 지역 더보기 ── */
  function renderAreaMore(apt) {
    if (!apt.sido) return;
    var sec = document.createElement("div");
    sec.className = "section";
    sec.style.padding = "16px";
    var title = document.createElement("div");
    title.style.cssText = "font-size:14px;font-weight:700;margin-bottom:10px;color:var(--ink)";
    title.textContent = "\uD83D\uDCCA APT Mine \uBD84\uC11D";
    sec.appendChild(title);
    var hash = encodeURIComponent(apt.sido);
    var links = document.createElement("div");
    links.className = "insight-card-links";
    var items = [
      { icon: "\uD83D\uDCA1", text: "\uC800\uD3C9\uAC00 TOP3", href: "undervalued.html#" + hash },
      { icon: "\uD83D\uDCC9", text: "\uBC14\uB2E5\uCC3E\uAE30", href: "bottom.html#" + hash },
      { icon: "\uD83C\uDFC6", text: "\uC785\uC9C0 \uB7AD\uD0B9", href: "valuation.html" }
    ];
    items.forEach(function (it) {
      var a = document.createElement("a");
      a.className = "insight-card-link";
      a.href = it.href;
      a.textContent = it.icon + " " + it.text;
      links.appendChild(a);
    });
    sec.appendChild(links);
    contentEl.appendChild(sec);
  }

  /* ── 거래 내역 테이블 ── */
  function renderTxnTable(txns) {
    var sec = document.createElement("div");
    sec.className = "section";
    sec.style.padding = "16px";
    var title = document.createElement("div");
    title.style.cssText = "font-size:14px;font-weight:700;margin-bottom:8px;color:var(--ink)";
    title.textContent = "거래 내역 (" + txns.length + "건)";
    sec.appendChild(title);

    var tableWrap = document.createElement("div");
    tableWrap.style.cssText = "overflow-x:auto;-webkit-overflow-scrolling:touch";
    var table = document.createElement("table");
    table.className = "apt-txn-table";

    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>날짜</th><th>가격(만)</th><th>직전거래대비</th></tr>";
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    for (var i = txns.length - 1; i >= 0; i--) {
      var tr = document.createElement("tr");
      var tdDate = document.createElement("td");
      tdDate.textContent = txns[i][0];
      tr.appendChild(tdDate);

      var tdPrice = document.createElement("td");
      tdPrice.textContent = fmt(txns[i][1]);
      tr.appendChild(tdPrice);

      var tdChg = document.createElement("td");
      if (i < txns.length - 1) {
        var prev = txns[i + 1][1];
        var diff = txns[i][1] - prev;
        var pct = prev > 0 ? (diff / prev * 100) : 0;
        var sign = diff >= 0 ? "+" : "";
        tdChg.textContent = sign + fmt(diff) + " (" + sign + pct.toFixed(1) + "%)";
        tdChg.style.color = diff >= 0 ? "var(--up)" : "var(--down)";
      } else {
        tdChg.textContent = "-";
        tdChg.style.color = "var(--muted)";
      }
      tr.appendChild(tdChg);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    sec.appendChild(tableWrap);
    contentEl.appendChild(sec);
  }

  init();
})();

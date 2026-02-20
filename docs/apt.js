/* APT Mine — 개별 단지 상세 페이지 */
(function () {
  var LOOKUP_BASE = "/data/apt_trade/apt_lookup/";
  var BY_APT_BASE = "/data/apt_trade/by_apt/";
  var GEO_PATH = "/data/apt_trade/valuation_geo.json";

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
      var [lookupRes, txnRes, geoRes] = await Promise.all([
        fetch(LOOKUP_BASE + encodeURIComponent(params.sido) + ".json?t=" + Date.now()),
        fetch(BY_APT_BASE + params.id + ".json?t=" + Date.now()),
        fetch(GEO_PATH + "?t=" + Date.now())
      ]);

      var lookup = lookupRes.ok ? await lookupRes.json() : {};
      var txns = txnRes.ok ? await txnRes.json() : [];
      var geoAll = null;
      try { geoAll = geoRes.ok ? await geoRes.json() : null; } catch (e) { geoAll = null; }

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
      render(apt, txns, geo);

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
    // 현재가: 최근 3개월 평균 (Python _recovery_from_trend와 동일)
    var recentSlice = data.slice(-3);
    var currentPrice = recentSlice.reduce(function (s, d) { return s + d.price; }, 0) / recentSlice.length;
    var vsPeakPct = peakPrice > 0 ? ((currentPrice - peakPrice) / peakPrice * 100) : 0;
    return { currentPrice: currentPrice, peakPrice: peakPrice, peakYm: peakYm, vsPeakPct: vsPeakPct };
  }

  /* ── 페이지 렌더링 ── */
  function render(apt, txns, geo) {
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

  /* ── 입지 정보 렌더 ── */
  function renderGeo(geo) {
    var sec = document.createElement("div");
    sec.className = "section";
    sec.style.padding = "16px";
    var title = document.createElement("div");
    title.style.cssText = "font-size:14px;font-weight:700;margin-bottom:12px;color:var(--ink)";
    title.textContent = "입지 정보";
    sec.appendChild(title);

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
      if (items.length) rows.push("🏪 " + items.join(" · "));
    }

    // 점수 배지
    if (geo.loc_score != null) {
      var scoreDiv = document.createElement("div");
      scoreDiv.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px";
      var scores = [
        { label: "종합", val: geo.loc_score },
        { label: "교통", val: geo.subway_dist != null ? Math.max(5, Math.round(100 - geo.subway_dist * 1000 / 30)) : null },
        { label: "학군", val: geo.academy_score },
        { label: "인프라", val: geo.infra_score }
      ];
      scores.forEach(function (s) {
        if (s.val == null) return;
        var badge = document.createElement("span");
        var color = s.val >= 70 ? "#2563eb" : s.val >= 40 ? "#f59e0b" : "#94a3b8";
        var bg = s.val >= 70 ? "#dbeafe" : s.val >= 40 ? "#fef3c7" : "#f1f5f9";
        badge.style.cssText = "font-size:12px;font-weight:600;padding:2px 8px;border-radius:8px;color:" + color + ";background:" + bg;
        badge.textContent = s.label + " " + s.val;
        scoreDiv.appendChild(badge);
      });
      sec.appendChild(scoreDiv);
    }

    if (!rows.length && !geo.loc_score) return;

    rows.forEach(function (text) {
      var row = document.createElement("div");
      row.style.cssText = "font-size:13px;color:var(--ink);margin-bottom:6px;line-height:1.5";
      row.textContent = text;
      sec.appendChild(row);
    });

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
    thead.innerHTML = "<tr><th>날짜</th><th>가격(만)</th><th>전회대비</th></tr>";
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

/* APT Mine - 저평가 백테스트 */
var dataPath = "data/apt_trade/backtest.json";
var byAptBase = "data/apt_trade/by_apt/";

var contentEl = document.getElementById("content");
var statusEl = document.getElementById("status");

var data = null;
var activeSort = "return";
var activeSixSort = "return";
var txnCache = {};

function fmt(v) { return new Intl.NumberFormat("ko-KR").format(v); }

function fmtEok(v) {
  if (v >= 10000) return (v / 10000).toFixed(1) + "\uC5B5";
  return fmt(Math.round(v)) + "\uB9CC";
}

function fmtYm(ym) {
  return ym.slice(0, 4) + "." + ym.slice(4);
}

/* ── 6개월 전 저평가 리딩 검증 (메인 섹션) ── */
function renderSixMonth(sixMonth) {
  if (!sixMonth || !sixMonth.picks || !sixMonth.picks.length) return null;

  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = fmtYm(sixMonth.flag_ym) + " \uC800\uD3C9\uAC00 \uB9AC\uB529 \uAC80\uC99D";
  sec.appendChild(h2);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = sixMonth.months_elapsed + "\uAC1C\uC6D4 \uC804 \uC800\uD3C9\uAC00\uB85C \uC120\uC815\uD55C " + sixMonth.total + "\uAC1C \uB2E8\uC9C0\uC758 \uD604\uC7AC \uC2E4\uC801";
  sec.appendChild(sub);

  // 요약 대시보드
  var dash = document.createElement("div");
  dash.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:16px 0";

  var metrics = [
    {
      label: "\uC801\uC911\uB960",
      value: sixMonth.went_up_pct + "%",
      sub: sixMonth.went_up + "/" + sixMonth.total + "\uAC74 \uC0C1\uC2B9",
      color: sixMonth.went_up_pct >= 50 ? "var(--accent)" : "#ef4444"
    },
    {
      label: "\uD3C9\uADE0 \uC218\uC775\uB960",
      value: (sixMonth.avg_return >= 0 ? "+" : "") + sixMonth.avg_return + "%",
      sub: "\uC800\uD3C9\uAC00 \uC885\uBAA9 \uD3C9\uADE0",
      color: sixMonth.avg_return >= 0 ? "#16a34a" : "#ef4444"
    },
    {
      label: "\uC2DC\uC7A5 \uD3C9\uADE0",
      value: sixMonth.avg_market_return !== null ? ((sixMonth.avg_market_return >= 0 ? "+" : "") + sixMonth.avg_market_return + "%") : "-",
      sub: "\uAC19\uC740 \uAE30\uAC04 \uC2DC\uB3C4 \uD3C9\uADE0",
      color: "var(--muted)"
    },
    {
      label: "\uCD08\uACFC\uC218\uC775(\uC54C\uD30C)",
      value: sixMonth.avg_alpha !== null ? ((sixMonth.avg_alpha >= 0 ? "+" : "") + sixMonth.avg_alpha + "%") : "-",
      sub: "\uC2DC\uC7A5 \uB300\uBE44 \uCD08\uACFC \uC218\uC775",
      color: sixMonth.avg_alpha !== null && sixMonth.avg_alpha >= 0 ? "#16a34a" : "#ef4444"
    }
  ];

  metrics.forEach(function (m) {
    var card = document.createElement("div");
    card.style.cssText = "text-align:center;padding:20px 12px;background:var(--bg);border-radius:var(--radius-sm)";
    var val = document.createElement("div");
    val.style.cssText = "font-size:28px;font-weight:800;color:" + m.color;
    val.textContent = m.value;
    card.appendChild(val);
    var lbl = document.createElement("div");
    lbl.style.cssText = "font-size:13px;font-weight:700;margin-top:6px;color:var(--ink)";
    lbl.textContent = m.label;
    card.appendChild(lbl);
    var subEl = document.createElement("div");
    subEl.style.cssText = "font-size:11px;color:var(--muted);margin-top:2px";
    subEl.textContent = m.sub;
    card.appendChild(subEl);
    dash.appendChild(card);
  });
  sec.appendChild(dash);

  // 정렬 버튼
  var sortWrap = document.createElement("div");
  sortWrap.className = "sort-btns";
  sortWrap.style.marginBottom = "12px";
  var sorts = [
    ["return", "\uC218\uC775\uB960\uC21C"],
    ["alpha", "\uC54C\uD30C\uC21C"]
  ];
  sorts.forEach(function (pair) {
    var btn = document.createElement("button");
    btn.className = "sort-btn" + (activeSixSort === pair[0] ? " active" : "");
    btn.textContent = pair[1];
    btn.addEventListener("click", function () {
      activeSixSort = pair[0];
      renderSixList();
    });
    sortWrap.appendChild(btn);
  });
  sec.appendChild(sortWrap);

  var listContainer = document.createElement("div");
  sec.appendChild(listContainer);

  function renderSixList() {
    listContainer.innerHTML = "";
    var sorted = sixMonth.picks.slice();
    if (activeSixSort === "return") sorted.sort(function (a, b) { return b.return_pct - a.return_pct; });
    else sorted.sort(function (a, b) { return (b.alpha || 0) - (a.alpha || 0); });

    sortWrap.querySelectorAll(".sort-btn").forEach(function (b, i) {
      b.className = "sort-btn" + (activeSixSort === sorts[i][0] ? " active" : "");
    });

    var INITIAL = 20;
    sorted.slice(0, INITIAL).forEach(function (p, i) {
      listContainer.appendChild(renderSixCard(p, i, sixMonth.flag_ym));
    });

    if (sorted.length > INITIAL) {
      var moreBtn = document.createElement("button");
      moreBtn.className = "sort-btn";
      moreBtn.style.cssText = "display:block;margin:12px auto 0;padding:8px 24px";
      moreBtn.textContent = "\uB354\uBCF4\uAE30 (" + sorted.length + "\uAC1C \uC804\uCCB4)";
      moreBtn.addEventListener("click", function () {
        sorted.slice(INITIAL).forEach(function (p, i) {
          listContainer.appendChild(renderSixCard(p, INITIAL + i, sixMonth.flag_ym));
        });
        moreBtn.remove();
      });
      listContainer.appendChild(moreBtn);
    }
  }

  renderSixList();
  return sec;
}

function renderSixCard(pick, idx, flagYm) {
  var card = document.createElement("div");
  card.className = "rank-card";
  card.style.cursor = "pointer";

  var num = document.createElement("div");
  num.className = "rank-num" + (idx < 3 ? " n" + (idx + 1) : "");
  num.textContent = idx + 1;
  card.appendChild(num);

  var body = document.createElement("div");
  body.style.flex = "1";

  var top = document.createElement("div");
  top.className = "rank-top";

  // 왼쪽: 단지정보
  var info = document.createElement("div");
  info.style.flex = "1";
  var nameDiv = document.createElement("div");
  nameDiv.className = "rank-apt";
  nameDiv.textContent = pick.apt_name;
  info.appendChild(nameDiv);
  var detail = document.createElement("div");
  detail.className = "rank-detail";
  detail.textContent = pick.sido + " " + pick.sigungu + " " + pick.dong_name + " \u00B7 " + pick.area_m2 + "m\u00B2";
  info.appendChild(detail);
  top.appendChild(info);

  // 오른쪽: 수익률 비교
  var metrics = document.createElement("div");
  metrics.className = "rank-change";
  var retDiv = document.createElement("div");
  retDiv.className = "rank-pct";
  retDiv.style.color = pick.return_pct >= 0 ? "#16a34a" : "#ef4444";
  retDiv.textContent = (pick.return_pct >= 0 ? "+" : "") + pick.return_pct + "%";
  metrics.appendChild(retDiv);

  var priceDiv = document.createElement("div");
  priceDiv.className = "rank-diff";
  priceDiv.textContent = fmtEok(pick.flagged_price) + " \u2192 " + fmtEok(pick.current_price);
  metrics.appendChild(priceDiv);

  if (pick.alpha !== null) {
    var alphaDiv = document.createElement("div");
    alphaDiv.style.cssText = "font-size:11px;margin-top:2px;color:" + (pick.alpha >= 0 ? "#16a34a" : "#ef4444");
    alphaDiv.textContent = "\uC54C\uD30C " + (pick.alpha >= 0 ? "+" : "") + pick.alpha + "%";
    metrics.appendChild(alphaDiv);
  }
  top.appendChild(metrics);
  body.appendChild(top);

  // 가격 변동 바
  var barWrap = document.createElement("div");
  barWrap.style.cssText = "margin-top:8px;display:flex;align-items:center;gap:8px;font-size:11px";
  var barBg = document.createElement("div");
  barBg.style.cssText = "flex:1;background:#f1f5f9;border-radius:4px;height:6px;position:relative";
  var ratio = pick.flagged_price > 0 ? Math.min(pick.current_price / pick.flagged_price * 100, 150) : 100;
  var barFill = document.createElement("div");
  barFill.style.cssText = "height:100%;border-radius:4px;width:" + Math.min(ratio, 100) + "%;background:" + (pick.return_pct >= 0 ? "#16a34a" : "#ef4444");
  barBg.appendChild(barFill);
  barWrap.appendChild(barBg);
  body.appendChild(barWrap);

  card.appendChild(body);

  card.addEventListener("click", function () {
    toggleChart(card, pick);
  });

  return card;
}

/* ── 전체 기간 요약 대시보드 ── */
function renderSummary(summary, meta) {
  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "\uC804\uCCB4 \uAE30\uAC04 \uBC31\uD14C\uC2A4\uD2B8";
  sec.appendChild(h2);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = fmtYm(meta.first_snapshot) + " ~ " + fmtYm(meta.last_snapshot) + " \uAE30\uAC04 \u00B7 " + meta.snapshots_count + "\uAC1C\uC6D4 \uCD94\uC801";
  sec.appendChild(sub);

  var dash = document.createElement("div");
  dash.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:16px 0";

  var metrics = [
    {
      label: "\uC801\uC911\uB960",
      value: summary.went_up_pct + "%",
      sub: summary.went_up + "/" + summary.total_picks + "\uAC74 \uC0C1\uC2B9",
      color: summary.went_up_pct >= 50 ? "var(--accent)" : "#ef4444"
    },
    {
      label: "\uD3C9\uADE0 \uC218\uC775\uB960",
      value: (summary.avg_return >= 0 ? "+" : "") + summary.avg_return + "%",
      sub: "\uC800\uD3C9\uAC00 \uC885\uBAA9 \uD3C9\uADE0",
      color: summary.avg_return >= 0 ? "#16a34a" : "#ef4444"
    },
    {
      label: "\uC2DC\uC7A5 \uD3C9\uADE0",
      value: summary.avg_market_return !== null ? ((summary.avg_market_return >= 0 ? "+" : "") + summary.avg_market_return + "%") : "-",
      sub: "\uAC19\uC740 \uAE30\uAC04 \uC2DC\uB3C4 \uD3C9\uADE0",
      color: "var(--muted)"
    },
    {
      label: "\uCD08\uACFC\uC218\uC775(\uC54C\uD30C)",
      value: summary.avg_alpha !== null ? ((summary.avg_alpha >= 0 ? "+" : "") + summary.avg_alpha + "%") : "-",
      sub: "\uC2DC\uC7A5 \uB300\uBE44 \uCD08\uACFC \uC218\uC775",
      color: summary.avg_alpha !== null && summary.avg_alpha >= 0 ? "#16a34a" : "#ef4444"
    }
  ];

  metrics.forEach(function (m) {
    var card = document.createElement("div");
    card.style.cssText = "text-align:center;padding:20px 12px;background:var(--bg);border-radius:var(--radius-sm)";
    var val = document.createElement("div");
    val.style.cssText = "font-size:28px;font-weight:800;color:" + m.color;
    val.textContent = m.value;
    card.appendChild(val);
    var lbl = document.createElement("div");
    lbl.style.cssText = "font-size:13px;font-weight:700;margin-top:6px;color:var(--ink)";
    lbl.textContent = m.label;
    card.appendChild(lbl);
    var subEl = document.createElement("div");
    subEl.style.cssText = "font-size:11px;color:var(--muted);margin-top:2px";
    subEl.textContent = m.sub;
    card.appendChild(subEl);
    dash.appendChild(card);
  });

  sec.appendChild(dash);
  return sec;
}

/* ── 월별 추이 차트 ── */
function renderTimeline(timeline) {
  if (!timeline || timeline.length < 2) return null;
  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "\uC6D4\uBCC4 \uC801\uC911\uB960 \uCD94\uC774";
  sec.appendChild(h2);

  var chartDiv = document.createElement("div");
  chartDiv.className = "scatter-chart";
  chartDiv.style.height = "220px";
  var canvas = document.createElement("canvas");
  chartDiv.appendChild(canvas);
  sec.appendChild(chartDiv);

  requestAnimationFrame(function () {
    drawBacktestTimeline(canvas, timeline);
  });

  return sec;
}

/* ── 백테스트 타임라인 차트 (바+라인) ── */
function drawBacktestTimeline(canvas, timeline) {
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
  var pad = { top: 20, right: 50, bottom: 30, left: 50 };
  var plotW = cw - pad.left - pad.right;
  var plotH = ch - pad.top - pad.bottom;

  var n = timeline.length;
  var barW = Math.max(plotW / n * 0.6, 8);

  var maxReturn = Math.max.apply(null, timeline.map(function (t) { return Math.abs(t.avg_return); }));
  maxReturn = Math.max(maxReturn, 5);

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, cw, ch);

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (var i = 0; i <= 4; i++) {
    var y = pad.top + plotH * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(cw - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText((i * 25) + "%", pad.left - 4, y + 3);
  }

  timeline.forEach(function (t, idx) {
    var x = pad.left + (idx + 0.5) * (plotW / n);
    var pct = t.went_up_pct;
    var barH = (pct / 100) * plotH;
    var barY = pad.top + plotH - barH;

    ctx.fillStyle = pct >= 50 ? "rgba(37,99,235,0.3)" : "rgba(239,68,68,0.3)";
    ctx.fillRect(x - barW / 2, barY, barW, barH);
    ctx.strokeStyle = pct >= 50 ? "#2563eb" : "#ef4444";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - barW / 2, barY, barW, barH);

    ctx.fillStyle = "#64748b";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(fmtYm(t.ym), x, ch - pad.bottom + 14);
  });

  ctx.beginPath();
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 2;
  timeline.forEach(function (t, idx) {
    var x = pad.left + (idx + 0.5) * (plotW / n);
    var y = pad.top + plotH / 2 - (t.avg_return / maxReturn) * (plotH / 2);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  timeline.forEach(function (t, idx) {
    var x = pad.left + (idx + 0.5) * (plotW / n);
    var y = pad.top + plotH / 2 - (t.avg_return / maxReturn) * (plotH / 2);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#16a34a";
    ctx.fill();
  });

  ctx.fillStyle = "#16a34a";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("+" + maxReturn.toFixed(0) + "%", cw - pad.right + 4, pad.top + 3);
  ctx.fillText("0%", cw - pad.right + 4, pad.top + plotH / 2 + 3);
  ctx.fillText("-" + maxReturn.toFixed(0) + "%", cw - pad.right + 4, pad.top + plotH + 3);

  ctx.fillStyle = "rgba(37,99,235,0.3)";
  ctx.fillRect(pad.left, 4, 12, 10);
  ctx.fillStyle = "#334155";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("\uC801\uC911\uB960", pad.left + 16, 13);

  ctx.beginPath();
  ctx.moveTo(pad.left + 70, 9);
  ctx.lineTo(pad.left + 82, 9);
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#334155";
  ctx.fillText("\uD3C9\uADE0\uC218\uC775\uB960", pad.left + 86, 13);
}

/* ── 개별 종목 결과 (전체 기간) ── */
function renderPicks(picks) {
  var sec = document.createElement("div");
  sec.className = "section";

  var h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = "\uAC1C\uBCC4 \uC885\uBAA9 \uACB0\uACFC";
  sec.appendChild(h2);

  var sub = document.createElement("p");
  sub.className = "section-sub";
  sub.textContent = "\uC800\uD3C9\uAC00 \uD50C\uB798\uADF8 \uC2DC\uC810 \u2192 \uD604\uC7AC \uAC00\uACA9 \uBCC0\uB3D9";
  sec.appendChild(sub);

  var sortWrap = document.createElement("div");
  sortWrap.className = "sort-btns";
  sortWrap.style.marginBottom = "12px";
  var sorts = [
    ["return", "\uC218\uC775\uB960\uC21C"],
    ["alpha", "\uC54C\uD30C\uC21C"],
    ["date", "\uC2DC\uC810\uC21C"]
  ];
  sorts.forEach(function (pair) {
    var btn = document.createElement("button");
    btn.className = "sort-btn" + (activeSort === pair[0] ? " active" : "");
    btn.textContent = pair[1];
    btn.addEventListener("click", function () {
      activeSort = pair[0];
      renderList();
    });
    sortWrap.appendChild(btn);
  });
  sec.appendChild(sortWrap);

  var listContainer = document.createElement("div");
  sec.appendChild(listContainer);

  function renderList() {
    listContainer.innerHTML = "";
    var sorted = picks.slice();
    if (activeSort === "return") sorted.sort(function (a, b) { return b.return_pct - a.return_pct; });
    else if (activeSort === "alpha") sorted.sort(function (a, b) { return (b.alpha || 0) - (a.alpha || 0); });
    else sorted.sort(function (a, b) { return a.flag_ym.localeCompare(b.flag_ym); });

    sortWrap.querySelectorAll(".sort-btn").forEach(function (b, i) {
      b.className = "sort-btn" + (activeSort === sorts[i][0] ? " active" : "");
    });

    var INITIAL = 20;
    sorted.slice(0, INITIAL).forEach(function (p, i) {
      listContainer.appendChild(renderPickCard(p, i));
    });

    if (sorted.length > INITIAL) {
      var moreBtn = document.createElement("button");
      moreBtn.className = "sort-btn";
      moreBtn.style.cssText = "display:block;margin:12px auto 0;padding:8px 24px";
      moreBtn.textContent = "\uB354\uBCF4\uAE30 (" + sorted.length + "\uAC1C \uC804\uCCB4)";
      moreBtn.addEventListener("click", function () {
        sorted.slice(INITIAL).forEach(function (p, i) {
          listContainer.appendChild(renderPickCard(p, INITIAL + i));
        });
        moreBtn.remove();
      });
      listContainer.appendChild(moreBtn);
    }
  }

  renderList();
  return sec;
}

function renderPickCard(pick, idx) {
  var card = document.createElement("div");
  card.className = "rank-card";
  card.style.cursor = "pointer";

  var num = document.createElement("div");
  num.className = "rank-num" + (idx < 3 ? " n" + (idx + 1) : "");
  num.textContent = idx + 1;
  card.appendChild(num);

  var body = document.createElement("div");
  body.style.flex = "1";

  var top = document.createElement("div");
  top.className = "rank-top";

  var info = document.createElement("div");
  info.style.flex = "1";
  var nameDiv = document.createElement("div");
  nameDiv.className = "rank-apt";
  nameDiv.textContent = pick.apt_name;
  info.appendChild(nameDiv);
  var detail = document.createElement("div");
  detail.className = "rank-detail";
  detail.textContent = pick.sido + " " + pick.sigungu + " " + pick.dong_name + " \u00B7 " + pick.area_m2 + "m\u00B2";
  var flagTag = document.createElement("span");
  flagTag.className = "tag";
  flagTag.style.cssText = "background:#dbeafe;color:#1e40af";
  flagTag.textContent = fmtYm(pick.flag_ym) + " \uD310\uC815";
  detail.appendChild(flagTag);
  info.appendChild(detail);
  top.appendChild(info);

  var metrics = document.createElement("div");
  metrics.className = "rank-change";
  var retDiv = document.createElement("div");
  retDiv.className = "rank-pct";
  retDiv.style.color = pick.return_pct >= 0 ? "#16a34a" : "#ef4444";
  retDiv.textContent = (pick.return_pct >= 0 ? "+" : "") + pick.return_pct + "%";
  metrics.appendChild(retDiv);

  var priceDiv = document.createElement("div");
  priceDiv.className = "rank-diff";
  priceDiv.textContent = fmtEok(pick.flagged_price) + " \u2192 " + fmtEok(pick.current_price);
  metrics.appendChild(priceDiv);

  if (pick.alpha !== null) {
    var alphaDiv = document.createElement("div");
    alphaDiv.style.cssText = "font-size:11px;margin-top:2px;color:" + (pick.alpha >= 0 ? "#16a34a" : "#ef4444");
    alphaDiv.textContent = "\uC54C\uD30C " + (pick.alpha >= 0 ? "+" : "") + pick.alpha + "%";
    metrics.appendChild(alphaDiv);
  }
  top.appendChild(metrics);
  body.appendChild(top);
  card.appendChild(body);

  card.addEventListener("click", function () {
    toggleChart(card, pick);
  });

  return card;
}

/* ── 차트 토글 ── */
async function toggleChart(card, pick) {
  var existing = card.querySelector(".backtest-chart-panel");
  if (existing) { existing.remove(); return; }

  var panel = document.createElement("div");
  panel.className = "backtest-chart-panel";
  panel.style.cssText = "margin-top:12px;padding:12px;background:var(--bg);border-radius:var(--radius-sm)";
  panel.addEventListener("click", function (e) { e.stopPropagation(); });

  var loading = document.createElement("div");
  loading.style.cssText = "text-align:center;color:var(--muted);font-size:12px;padding:20px";
  loading.textContent = "\uCC28\uD2B8 \uB85C\uB529 \uC911...";
  panel.appendChild(loading);
  card.appendChild(panel);

  try {
    if (!txnCache[pick.id]) {
      var res = await fetch(byAptBase + pick.id + ".json?t=" + Date.now());
      txnCache[pick.id] = res.ok ? await res.json() : [];
    }
    var txns = txnCache[pick.id];
    if (!txns.length) {
      loading.textContent = "\uAC70\uB798 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
      return;
    }
    txns.sort(function (a, b) { return new Date(a[0]).getTime() - new Date(b[0]).getTime(); });
    loading.remove();
    var chartDiv = document.createElement("div");
    chartDiv.className = "scatter-chart";
    chartDiv.style.height = "180px";
    var canvas = document.createElement("canvas");
    chartDiv.appendChild(canvas);
    panel.appendChild(chartDiv);
    requestAnimationFrame(function () {
      if (typeof drawBacktestPickChart === "function") {
        drawBacktestPickChart(canvas, txns, pick);
      } else if (typeof drawScatter === "function") {
        drawScatter(canvas, txns);
      }
    });

    var flagInfo = document.createElement("div");
    flagInfo.style.cssText = "text-align:center;font-size:11px;color:var(--muted);margin-top:4px";
    flagInfo.textContent = fmtYm(pick.flag_ym) + " \uC800\uD3C9\uAC00 \uD310\uC815 \u2192 \uD604\uC7AC " + (pick.return_pct >= 0 ? "+" : "") + pick.return_pct + "% \uBCC0\uB3D9";
    panel.appendChild(flagInfo);
  } catch (e) {
    loading.textContent = "\uCC28\uD2B8\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
  }
}

/* ── 초기화 ── */
async function init() {
  try {
    var res = await fetch(dataPath + "?t=" + Date.now());
    if (!res.ok) {
      statusEl.textContent = "\uBC31\uD14C\uC2A4\uD2B8 \uB370\uC774\uD130\uAC00 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4. \uB370\uC774\uD130\uAC00 \uCDA9\uBD84\uD788 \uC313\uC774\uBA74 \uC790\uB3D9\uC73C\uB85C \uC0DD\uC131\uB429\uB2C8\uB2E4.";
      return;
    }
    data = await res.json();
    statusEl.innerHTML = "";

    if (!data.picks || !data.picks.length) {
      contentEl.innerHTML = '<div class="section"><p style="text-align:center;color:var(--muted);padding:40px">\uBC31\uD14C\uC2A4\uD2B8 \uB300\uC0C1\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uB370\uC774\uD130\uAC00 \uCDA9\uBD84\uD788 \uC313\uC774\uBA74 \uC790\uB3D9\uC73C\uB85C \uC0DD\uC131\uB429\uB2C8\uB2E4.</p></div>';
      return;
    }

    // 1. 6개월 전 저평가 리딩 검증 (메인)
    if (data.six_month) {
      var sixSec = renderSixMonth(data.six_month);
      if (sixSec) contentEl.appendChild(sixSec);
    }

    // 2. 전체 기간 요약
    contentEl.appendChild(renderSummary(data.summary, data));

    // 3. 타임라인 차트
    var tl = renderTimeline(data.timeline);
    if (tl) contentEl.appendChild(tl);

    // 4. 전체 개별 종목
    contentEl.appendChild(renderPicks(data.picks));

    // 면책
    var disc = document.createElement("div");
    disc.className = "section";
    disc.innerHTML = '<p class="section-sub" style="margin:0;text-align:center">' +
      '\uBCF8 \uBC31\uD14C\uC2A4\uD2B8\uB294 \uACFC\uAC70 \uB370\uC774\uD130 \uAE30\uBC18\uC774\uBA70, \uBBF8\uB798 \uC218\uC775\uC744 \uBCF4\uC7A5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uD22C\uC790 \uD310\uB2E8\uC758 \uCC38\uACE0 \uC790\uB8CC\uB85C\uB9CC \uD65C\uC6A9\uD558\uC138\uC694.</p>';
    contentEl.appendChild(disc);
  } catch (e) {
    statusEl.textContent = "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574\uC8FC\uC138\uC694.";
  }
}

init();

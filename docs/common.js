/* APT Mine — Common utilities */
var APTCommon = (function () {
  var C = {};

  /* 숫자 포맷 (천단위 콤마) */
  C.fmt = function (v) {
    return new Intl.NumberFormat("ko-KR").format(v);
  };

  /* 억/만 포맷 */
  C.fmtEok = function (v) {
    if (v >= 10000) return (v / 10000).toFixed(1) + "\uC5B5";
    return C.fmt(Math.round(v)) + "\uB9CC";
  };

  /* HTML 이스케이프 */
  C.escapeHTML = function (s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  };

  /* 시세 회복 상태 */
  C.RECOVERY_STATUS = {
    recovered: { label: "\uC0C1\uC2B9", color: "#2563eb", barColor: "#2563eb", bgColor: "#dbeafe", textColor: "#1e40af" },
    rising:    { label: "\uD68C\uBCF5", color: "#16a34a", barColor: "#16a34a", bgColor: "#dcfce7", textColor: "#166534" },
    flat:      { label: "\uD6A1\uBCF4", color: "#94a3b8", barColor: "#94a3b8", bgColor: "#f1f5f9", textColor: "#64748b" },
    falling:   { label: "\uD558\uB77D", color: "#ef4444", barColor: "#ef4444", bgColor: "#fef2f2", textColor: "#dc2626" }
  };

  /* 시도 탭 렌더링 */
  C.renderTabs = function (tabsEl, sidoOrder, activeSido, onClick) {
    tabsEl.innerHTML = "";
    tabsEl.setAttribute("role", "tablist");
    var label = document.createElement("span");
    label.className = "region-label";
    label.textContent = "\uC9C0\uC5ED";
    tabsEl.appendChild(label);
    sidoOrder.forEach(function (sido) {
      var btn = document.createElement("button");
      btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", sido === activeSido ? "true" : "false");
      btn.textContent = sido;
      btn.addEventListener("click", function () { onClick(sido); });
      tabsEl.appendChild(btn);
    });
  };

  /* 구/군 드롭다운 렌더링 */
  C.renderSubTabs = function (subtabsEl, districtOrder, activeSido, activeDistrict, onChange) {
    subtabsEl.innerHTML = "";
    if (!districtOrder || !districtOrder.length) return;

    var select = document.createElement("select");
    select.className = "district-select";

    var allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = activeSido + " \uC804\uCCB4";
    if (activeDistrict === null) allOpt.selected = true;
    select.appendChild(allOpt);

    districtOrder.forEach(function (dist) {
      var opt = document.createElement("option");
      opt.value = dist;
      opt.textContent = dist;
      if (dist === activeDistrict) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener("change", function () {
      onChange(select.value || null);
    });

    subtabsEl.appendChild(select);
  };

  /* ── 전문용어 사전 (툴팁) ── */
  C.GLOSSARY = {
    "고점가": "2021~2022년 부동산 상승기 때 기록한 역대 최고 매매가입니다.",
    "고점대비": "역대 고점가 대비 현재 가격이 얼마나 떨어졌는지(또는 올랐는지) 비율입니다.",
    "전세가율": "매매가 대비 전세가의 비율(%). 높을수록 갭(매매가-전세가)이 작습니다.",
    "세대수": "아파트 단지에 포함된 전체 가구 수. 대단지일수록 유동성이 좋습니다.",
    "상승률": "이전 거래 대비 가격이 오른 비율(%)입니다.",
    "저평가": "인근 유사단지 평균보다 현재 매매가가 낮은 상태를 뜻합니다.",
    "회복률": "고점 대비 하락 후 다시 올라온 정도를 나타내는 비율입니다.",
    "실거래가": "국토교통부에 신고된 실제 매매 계약 금액입니다.",
    "바닥찾기": "고점 대비 크게 하락한 단지 중 반등 가능성이 있는 곳을 탐색하는 분석입니다."
  };

  /* ── 툴팁 초기화 ── */
  C.initTooltips = function () {
    var tips = document.querySelectorAll(".term-tip");
    if (!tips.length) return;

    tips.forEach(function (el) {
      var text = el.textContent.trim();
      var desc = C.GLOSSARY[text];
      if (desc) el.setAttribute("data-tip", desc);

      el.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleTooltip(el);
        if (typeof gtag === "function") {
          gtag("event", "tooltip_view", { term: text });
        }
      });
    });

    document.addEventListener("click", function () {
      tips.forEach(function (el) { el.classList.remove("tip-active"); });
    });
  };

  /* ── 스크롤 깊이 추적 ── */
  C.initScrollDepth = function () {
    var milestones = [25, 50, 75, 100];
    var fired = {};
    window.addEventListener("scroll", function () {
      var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (docHeight <= 0) return;
      var pct = Math.round(scrollTop / docHeight * 100);
      milestones.forEach(function (m) {
        if (pct >= m && !fired[m]) {
          fired[m] = true;
          if (typeof gtag === "function") {
            gtag("event", "scroll_depth", { milestone: m, page: location.pathname });
          }
        }
      });
    }, { passive: true });
  };

  /* ── 첫 방문 첫 액션 추적 ── */
  C.initFirstVisitAction = function () {
    if (sessionStorage.getItem("aptmine_fva")) return;
    function handler(e) {
      var tag = e.target.tagName;
      var text = (e.target.textContent || "").trim().slice(0, 30);
      sessionStorage.setItem("aptmine_fva", "1");
      if (typeof gtag === "function") {
        gtag("event", "first_visit_action", { element: tag, text: text, page: location.pathname });
      }
      document.removeEventListener("click", handler);
    }
    document.addEventListener("click", handler);
  };

  function toggleTooltip(el) {
    var wasActive = el.classList.contains("tip-active");
    document.querySelectorAll(".term-tip.tip-active").forEach(function (t) {
      t.classList.remove("tip-active");
    });
    if (!wasActive) el.classList.add("tip-active");
  }

  return C;
})();

/* ── GA4 자동 초기화 ── */
document.addEventListener("DOMContentLoaded", function () {
  APTCommon.initScrollDepth();
  APTCommon.initFirstVisitAction();
  APTCommon.initTooltips();
});

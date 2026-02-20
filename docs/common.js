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

  return C;
})();

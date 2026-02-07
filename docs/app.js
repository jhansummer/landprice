const indexPath = "data/apt_trade/index.json";

const lawdSelect = document.getElementById("lawdSelect");
const monthSelect = document.getElementById("monthSelect");
const tableBody = document.getElementById("tableBody");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

let indexData = null;

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function clearTable() {
  tableBody.innerHTML = "";
}

function buildOptions(select, values) {
  select.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function getAvailableMonths(lawdCd) {
  return indexData.files
    .filter((entry) => entry.lawd_cd === lawdCd)
    .map((entry) => entry.deal_ym)
    .sort();
}

function findFileEntry(lawdCd, dealYm) {
  return indexData.files.find(
    (entry) => entry.lawd_cd === lawdCd && entry.deal_ym === dealYm
  );
}

function renderMeta(lawdCd, dealYm, count) {
  metaEl.innerHTML = "";
  const items = [
    `업데이트: ${indexData.updated_at}`,
    `보관 기간: ${indexData.months_kept}개월`,
    `법정동코드: ${lawdCd}`,
    `계약월: ${dealYm}`,
    `건수: ${formatNumber(count)}`,
  ];
  items.forEach((item) => {
    const span = document.createElement("span");
    span.textContent = item;
    metaEl.appendChild(span);
  });
}

function renderRows(rows) {
  clearTable();
  if (!rows.length) {
    setStatus("해당 월에 데이터가 없습니다.");
    return;
  }
  setStatus("");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const cells = [
      row.deal_date,
      row.apt_name,
      formatNumber(row.price_man),
      row.area_m2,
      row.floor,
      row.dong_name,
    ];
    const labels = ["날짜", "단지명", "가격", "면적", "층", "법정동"];
    cells.forEach((value, idx) => {
      const td = document.createElement("td");
      td.textContent = value;
      td.setAttribute("data-label", labels[idx]);
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  });
}

async function loadMonthData(lawdCd, dealYm) {
  const entry = findFileEntry(lawdCd, dealYm);
  if (!entry) {
    setStatus("선택한 데이터 파일을 찾을 수 없습니다.");
    clearTable();
    return;
  }
  setStatus("데이터 로딩 중...");
  const response = await fetch(entry.path, { cache: "no-store" });
  if (!response.ok) {
    setStatus("데이터를 불러오지 못했습니다.");
    clearTable();
    return;
  }
  const rows = await response.json();
  renderMeta(lawdCd, dealYm, entry.count);
  renderRows(rows);
}

function onLawdChange() {
  const lawdCd = lawdSelect.value;
  const months = getAvailableMonths(lawdCd);
  buildOptions(monthSelect, months);
  monthSelect.value = months[months.length - 1];
  loadMonthData(lawdCd, monthSelect.value);
}

function onMonthChange() {
  loadMonthData(lawdSelect.value, monthSelect.value);
}

async function init() {
  const response = await fetch(indexPath, { cache: "no-store" });
  if (!response.ok) {
    setStatus("index.json을 불러오지 못했습니다.");
    return;
  }
  indexData = await response.json();
  if (!indexData.lawd_list || !indexData.lawd_list.length) {
    setStatus("lawd_list가 비어 있습니다.");
    return;
  }

  buildOptions(lawdSelect, indexData.lawd_list);
  lawdSelect.value = indexData.lawd_list[0];
  const months = getAvailableMonths(lawdSelect.value);
  buildOptions(monthSelect, months);
  monthSelect.value = months[months.length - 1];
  renderMeta(lawdSelect.value, monthSelect.value, 0);
  await loadMonthData(lawdSelect.value, monthSelect.value);

  lawdSelect.addEventListener("change", onLawdChange);
  monthSelect.addEventListener("change", onMonthChange);
}

init();

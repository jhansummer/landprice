const indexPath = "data/apt_trade/index.json";

const LAWD_NAMES = {
  "11110": "종로구", "11140": "중구", "11170": "용산구",
  "11200": "성동구", "11215": "광진구", "11230": "동대문구",
  "11260": "중랑구", "11290": "성북구", "11305": "강북구",
  "11320": "도봉구", "11350": "노원구", "11380": "은평구",
  "11410": "서대문구", "11440": "마포구", "11470": "양천구",
  "11500": "강서구", "11530": "구로구", "11545": "금천구",
  "11560": "영등포구", "11590": "동작구", "11620": "관악구",
  "11650": "서초구", "11680": "강남구", "11710": "송파구",
  "11740": "강동구",
};

const lawdSelect = document.getElementById("lawdSelect");
const tableBody = document.getElementById("tableBody");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

let indexData = null;
let currentResults = [];
let currentSort = { key: "change_pct", desc: true };

function formatNumber(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function clearTable() {
  tableBody.innerHTML = "";
}

function buildLawdOptions(lawdList) {
  lawdSelect.innerHTML = "";
  lawdList.forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = LAWD_NAMES[code] || code;
    lawdSelect.appendChild(opt);
  });
}

function getFilesForLawd(lawdCd) {
  return indexData.files.filter((e) => e.lawd_cd === lawdCd);
}

async function loadAllMonths(lawdCd) {
  const files = getFilesForLawd(lawdCd);
  const promises = files
    .filter((e) => e.count > 0)
    .map((e) => fetch(e.path, { cache: "no-store" }).then((r) => r.ok ? r.json() : []));
  const arrays = await Promise.all(promises);
  return arrays.flat();
}

function groupAndCompare(rows) {
  const groups = {};
  rows.forEach((r) => {
    const key = `${r.apt_name}\t${r.area_m2}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  const results = [];
  Object.values(groups).forEach((txns) => {
    txns.sort((a, b) => {
      const d = b.deal_date.localeCompare(a.deal_date);
      return d !== 0 ? d : b.price_man - a.price_man;
    });

    const latest = txns[0];
    const prev = txns.find((t) => t.deal_date !== latest.deal_date);

    const change = prev ? latest.price_man - prev.price_man : null;
    const changePct = prev && prev.price_man ? (change / prev.price_man) * 100 : null;

    results.push({
      apt_name: latest.apt_name,
      dong_name: latest.dong_name,
      area_m2: latest.area_m2,
      latest_date: latest.deal_date,
      latest_price: latest.price_man,
      latest_floor: latest.floor,
      prev_date: prev ? prev.deal_date : null,
      prev_price: prev ? prev.price_man : null,
      prev_floor: prev ? prev.floor : null,
      change: change,
      change_pct: changePct,
    });
  });

  return results;
}

function sortResults(results, key, desc) {
  return results.slice().sort((a, b) => {
    let va = a[key], vb = b[key];
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string") {
      const cmp = va.localeCompare(vb, "ko");
      return desc ? -cmp : cmp;
    }
    return desc ? vb - va : va - vb;
  });
}

const SORT_KEY_MAP = {
  apt: "apt_name",
  area: "area_m2",
  latest_price: "latest_price",
  prev_price: "prev_price",
  change_pct: "change_pct",
};

function onHeaderClick(e) {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  const key = SORT_KEY_MAP[th.dataset.sort];
  if (!key) return;
  if (currentSort.key === key) {
    currentSort.desc = !currentSort.desc;
  } else {
    currentSort = { key, desc: true };
  }
  renderRows(sortResults(currentResults, currentSort.key, currentSort.desc));
}

function renderMeta(lawdCd, total, withPrev) {
  metaEl.innerHTML = "";
  const items = [
    `업데이트: ${indexData.updated_at}`,
    `자치구: ${LAWD_NAMES[lawdCd] || lawdCd}`,
    `단지·면적: ${formatNumber(total)}개`,
    `비교가능: ${formatNumber(withPrev)}개`,
  ];
  items.forEach((t) => {
    const span = document.createElement("span");
    span.textContent = t;
    metaEl.appendChild(span);
  });
}

function renderRows(results) {
  clearTable();
  if (!results.length) {
    setStatus("해당 구에 데이터가 없습니다.");
    return;
  }
  setStatus("");

  results.forEach((r) => {
    const tr = document.createElement("tr");

    // 단지명 + 동
    const tdApt = document.createElement("td");
    tdApt.setAttribute("data-label", "단지명");
    tdApt.textContent = r.apt_name;
    if (r.dong_name) {
      const sub = document.createElement("span");
      sub.className = "sub";
      sub.textContent = r.dong_name;
      tdApt.appendChild(sub);
    }
    tr.appendChild(tdApt);

    // 면적
    const tdArea = document.createElement("td");
    tdArea.setAttribute("data-label", "면적");
    tdArea.textContent = r.area_m2 + "m²";
    tr.appendChild(tdArea);

    // 최근거래
    const tdLatest = document.createElement("td");
    tdLatest.setAttribute("data-label", "최근거래");
    tdLatest.textContent = formatNumber(r.latest_price) + "만";
    const subLatest = document.createElement("span");
    subLatest.className = "sub";
    subLatest.textContent = r.latest_date + " · " + r.latest_floor + "층";
    tdLatest.appendChild(subLatest);
    tr.appendChild(tdLatest);

    // 직전거래
    const tdPrev = document.createElement("td");
    tdPrev.setAttribute("data-label", "직전거래");
    if (r.prev_price != null) {
      tdPrev.textContent = formatNumber(r.prev_price) + "만";
      const subPrev = document.createElement("span");
      subPrev.className = "sub";
      subPrev.textContent = r.prev_date + " · " + r.prev_floor + "층";
      tdPrev.appendChild(subPrev);
    } else {
      tdPrev.textContent = "-";
    }
    tr.appendChild(tdPrev);

    // 변동
    const tdChange = document.createElement("td");
    tdChange.setAttribute("data-label", "변동");
    if (r.change != null) {
      const sign = r.change > 0 ? "+" : "";
      tdChange.textContent = sign + formatNumber(r.change) + "만";
      const subPct = document.createElement("span");
      subPct.className = "sub";
      subPct.textContent = sign + r.change_pct.toFixed(1) + "%";
      tdChange.appendChild(subPct);
      if (r.change > 0) tdChange.classList.add("up");
      else if (r.change < 0) tdChange.classList.add("down");
    } else {
      tdChange.textContent = "-";
    }
    tr.appendChild(tdChange);

    tableBody.appendChild(tr);
  });
}

async function loadAndRender(lawdCd) {
  setStatus("12개월 데이터 로딩 중...");
  clearTable();
  const rows = await loadAllMonths(lawdCd);
  setStatus("분석 중...");
  const results = groupAndCompare(rows);
  currentResults = results;
  const withPrev = results.filter((r) => r.change != null).length;
  renderMeta(lawdCd, results.length, withPrev);
  renderRows(sortResults(results, currentSort.key, currentSort.desc));
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

  buildLawdOptions(indexData.lawd_list);
  lawdSelect.value = indexData.lawd_list[0];
  await loadAndRender(lawdSelect.value);

  lawdSelect.addEventListener("change", () => loadAndRender(lawdSelect.value));
  document.querySelector("thead tr").addEventListener("click", onHeaderClick);
}

init();

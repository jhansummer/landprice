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

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

let indexData = null;

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

function groupAndTop3(rows) {
  const groups = {};
  rows.forEach((r) => {
    const key = `${r.apt_name}\t${r.area_m2}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  const compared = [];
  Object.values(groups).forEach((txns) => {
    txns.sort((a, b) => {
      const d = b.deal_date.localeCompare(a.deal_date);
      return d !== 0 ? d : b.price_man - a.price_man;
    });
    const latest = txns[0];
    const prev = txns.find((t) => t.deal_date !== latest.deal_date);
    if (!prev || !prev.price_man) return;

    const change = latest.price_man - prev.price_man;
    const pct = (change / prev.price_man) * 100;
    if (pct <= 0) return; // 상승만

    compared.push({
      apt_name: latest.apt_name,
      dong_name: latest.dong_name,
      area_m2: latest.area_m2,
      latest_date: latest.deal_date,
      latest_price: latest.price_man,
      prev_date: prev.deal_date,
      prev_price: prev.price_man,
      change: change,
      pct: pct,
    });
  });

  compared.sort((a, b) => b.pct - a.pct);
  return compared.slice(0, 3);
}

function renderCard(lawdCd, top3) {
  const card = document.createElement("div");
  card.className = "card";

  const title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = LAWD_NAMES[lawdCd] || lawdCd;
  card.appendChild(title);

  if (!top3.length) {
    const p = document.createElement("p");
    p.className = "no-data";
    p.textContent = "비교 가능한 상승 거래 없음";
    card.appendChild(p);
    return card;
  }

  const ul = document.createElement("ul");
  ul.className = "rank-list";

  top3.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "rank-item";

    // 순위
    const num = document.createElement("span");
    num.className = `rank-num n${i + 1}`;
    num.textContent = i + 1;
    li.appendChild(num);

    // 단지 정보
    const info = document.createElement("div");
    info.className = "rank-info";
    const aptEl = document.createElement("div");
    aptEl.className = "rank-apt";
    aptEl.textContent = r.apt_name;
    info.appendChild(aptEl);
    const detail = document.createElement("div");
    detail.className = "rank-detail";
    detail.textContent = `${r.area_m2}m\u00B2 · ${r.dong_name} · ${r.latest_date}`;
    info.appendChild(detail);
    li.appendChild(info);

    // 변동
    const changeEl = document.createElement("div");
    changeEl.className = "rank-change";
    const pctEl = document.createElement("div");
    pctEl.className = "rank-pct";
    pctEl.textContent = `+${r.pct.toFixed(1)}%`;
    changeEl.appendChild(pctEl);
    const diffEl = document.createElement("div");
    diffEl.className = "rank-diff";
    diffEl.textContent = `${fmt(r.prev_price)} → ${fmt(r.latest_price)}만`;
    changeEl.appendChild(diffEl);
    li.appendChild(changeEl);

    ul.appendChild(li);
  });

  card.appendChild(ul);
  return card;
}

async function loadLawdData(lawdCd) {
  const files = indexData.files.filter((e) => e.lawd_cd === lawdCd && e.count > 0);
  const promises = files.map((e) =>
    fetch(e.path, { cache: "no-store" }).then((r) => (r.ok ? r.json() : []))
  );
  const arrays = await Promise.all(promises);
  return arrays.flat();
}

async function init() {
  const response = await fetch(indexPath, { cache: "no-store" });
  if (!response.ok) {
    statusEl.textContent = "index.json을 불러오지 못했습니다.";
    return;
  }
  indexData = await response.json();
  const lawdList = indexData.lawd_list || [];
  if (!lawdList.length) {
    statusEl.textContent = "데이터가 없습니다.";
    return;
  }

  statusEl.textContent = `25개 구 데이터 로딩 중...`;

  // 구별로 순차 로드 + 렌더 (카드가 하나씩 나타남)
  let totalTxns = 0;
  for (const lawdCd of lawdList) {
    statusEl.textContent = `${LAWD_NAMES[lawdCd] || lawdCd} 로딩 중...`;
    const rows = await loadLawdData(lawdCd);
    totalTxns += rows.length;
    const top3 = groupAndTop3(rows);
    const card = renderCard(lawdCd, top3);
    gridEl.appendChild(card);
  }

  statusEl.textContent = "";
  metaEl.textContent = `업데이트: ${indexData.updated_at} · 총 거래 ${fmt(totalTxns)}건 · ${indexData.months_kept}개월`;
}

init();

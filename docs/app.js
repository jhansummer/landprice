const summaryPath = "data/apt_trade/summary.json";

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

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
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

    const num = document.createElement("span");
    num.className = `rank-num n${i + 1}`;
    num.textContent = i + 1;
    li.appendChild(num);

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

    const changeEl = document.createElement("div");
    changeEl.className = "rank-change";
    const pctEl = document.createElement("div");
    pctEl.className = "rank-pct";
    pctEl.textContent = `+${r.pct.toFixed(1)}%`;
    changeEl.appendChild(pctEl);
    const diffEl = document.createElement("div");
    diffEl.className = "rank-diff";
    diffEl.textContent = `${fmt(r.prev_price)} \u2192 ${fmt(r.latest_price)}만`;
    changeEl.appendChild(diffEl);
    li.appendChild(changeEl);

    ul.appendChild(li);
  });

  card.appendChild(ul);
  return card;
}

async function init() {
  const response = await fetch(summaryPath);
  if (!response.ok) {
    statusEl.textContent = "데이터를 불러오지 못했습니다.";
    return;
  }
  const data = await response.json();
  const lawdList = data.lawd_list || [];

  for (const lawdCd of lawdList) {
    const top3 = data.by_lawd[lawdCd] || [];
    const card = renderCard(lawdCd, top3);
    gridEl.appendChild(card);
  }

  statusEl.textContent = "";
  metaEl.textContent = `업데이트: ${data.updated_at} · 총 거래 ${fmt(data.total_txns)}건 · ${data.months_kept}개월`;
}

init();

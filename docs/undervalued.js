const dataPath = "data/apt_trade/undervalued.json";

const tabsEl = document.getElementById("tabs");
const contentEl = document.getElementById("content");

let data = null;
let activeSido = null;

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

function renderTabs(sidoOrder) {
  tabsEl.innerHTML = "";
  sidoOrder.forEach(function (sido) {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      renderTabs(sidoOrder);
      renderSections();
    });
    tabsEl.appendChild(btn);
  });
}

function renderItem(r, idx) {
  const card = document.createElement("div");
  card.className = "rank-card";

  const num = document.createElement("div");
  num.className = "rank-num";
  num.textContent = idx + 1;
  card.appendChild(num);

  const content = document.createElement("div");
  const top = document.createElement("div");
  top.className = "rank-top";

  const info = document.createElement("div");
  const apt = document.createElement("div");
  apt.className = "rank-apt";
  apt.textContent = r.apt_name;
  info.appendChild(apt);
  const detail = document.createElement("div");
  detail.className = "rank-detail";
  detail.textContent = r.sigungu + " " + r.dong_name + " · " + r.area_m2 + "m²";
  info.appendChild(detail);
  top.appendChild(info);

  const change = document.createElement("div");
  change.className = "rank-change";
  const pct = document.createElement("div");
  pct.className = "rank-pct";
  pct.textContent = "최근6개월 " + fmt(Math.round(r.recent_avg)) + "만";
  change.appendChild(pct);
  const diff = document.createElement("div");
  diff.className = "rank-diff";
  diff.textContent = "비교평균 " + fmt(Math.round(r.compare_avg_recent)) + "만";
  change.appendChild(diff);
  top.appendChild(change);

  content.appendChild(top);

  const meta = document.createElement("div");
  meta.className = "rank-detail";
  if (r.compare && r.compare.length) {
    const names = r.compare.map(function (c) {
      return c.apt_name + "(" + c.sigungu + " " + c.dong_name + ")";
    });
    meta.textContent = "비교: " + names.join(" · ");
  }
  content.appendChild(meta);

  card.appendChild(content);
  return card;
}

function renderSection(title, sub, items) {
  const sec = document.createElement("div");
  sec.className = "section";
  const h2 = document.createElement("h2");
  h2.className = "section-title";
  h2.textContent = title;
  sec.appendChild(h2);
  if (sub) {
    const p = document.createElement("p");
    p.className = "section-sub";
    p.textContent = sub;
    sec.appendChild(p);
  }
  if (!items || !items.length) {
    const p = document.createElement("p");
    p.className = "no-data";
    p.textContent = "해당 없음";
    sec.appendChild(p);
    return sec;
  }
  items.slice(0, 3).forEach(function (r, i) {
    sec.appendChild(renderItem(r, i));
  });
  return sec;
}

function renderSections() {
  contentEl.innerHTML = "";
  if (!data || !activeSido) return;
  const s = data.sidos[activeSido];
  if (!s) return;

  contentEl.appendChild(
    renderSection(
      "저평가 TOP3",
      "비교 단지 평균 대비 최근 6개월 평균가가 낮은 순",
      s.undervalued || []
    )
  );

  (s.bands || []).forEach(function (b) {
    contentEl.appendChild(
      renderSection(
        "저평가 TOP3 (가격대: " + b.label + ")",
        "최근 6개월 평균가 기준",
        b.top3 || []
      )
    );
  });
}

async function init() {
  const res = await fetch(dataPath);
  if (!res.ok) {
    contentEl.textContent = "데이터를 불러오지 못했습니다.";
    return;
  }
  data = await res.json();
  const sidoOrder = data ? Object.keys(data.sidos || {}) : [];
  activeSido = sidoOrder[0] || null;
  renderTabs(sidoOrder);
  renderSections();
}

init();

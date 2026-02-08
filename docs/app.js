const summaryPath = "data/apt_trade/summary.json";

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const tabsEl = document.getElementById("tabs");

let globalData = null;
let activeSido = null;

function fmt(v) {
  return new Intl.NumberFormat("ko-KR").format(v);
}

function renderTabs(sidoOrder) {
  tabsEl.innerHTML = "";
  sidoOrder.forEach(function (sido) {
    var btn = document.createElement("button");
    btn.className = "tab-btn" + (sido === activeSido ? " active" : "");
    btn.textContent = sido;
    btn.addEventListener("click", function () {
      activeSido = sido;
      renderTabs(sidoOrder);
      renderGrid();
      history.replaceState(null, "", "#" + sido);
    });
    tabsEl.appendChild(btn);
  });
}

function renderCard(lawdCd, districtData) {
  var card = document.createElement("div");
  card.className = "card";

  var title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = districtData.name || lawdCd;
  card.appendChild(title);

  var top3 = districtData.top3 || [];
  if (!top3.length) {
    var p = document.createElement("p");
    p.className = "no-data";
    p.textContent = "\uBE44\uAD50 \uAC00\uB2A5\uD55C \uC0C1\uC2B9 \uAC70\uB798 \uC5C6\uC74C";
    card.appendChild(p);
    return card;
  }

  var ul = document.createElement("ul");
  ul.className = "rank-list";

  top3.forEach(function (r, i) {
    var li = document.createElement("li");
    li.className = "rank-item";

    var num = document.createElement("span");
    num.className = "rank-num n" + (i + 1);
    num.textContent = i + 1;
    li.appendChild(num);

    var info = document.createElement("div");
    info.className = "rank-info";
    var aptEl = document.createElement("div");
    aptEl.className = "rank-apt";
    aptEl.textContent = r.apt_name;
    info.appendChild(aptEl);
    var detail = document.createElement("div");
    detail.className = "rank-detail";
    detail.textContent = r.area_m2 + "m\u00B2 \u00B7 " + r.dong_name + " \u00B7 " + r.latest_date;
    info.appendChild(detail);
    li.appendChild(info);

    var changeEl = document.createElement("div");
    changeEl.className = "rank-change";
    var pctEl = document.createElement("div");
    pctEl.className = "rank-pct";
    pctEl.textContent = "+" + r.pct.toFixed(1) + "%";
    changeEl.appendChild(pctEl);
    var diffEl = document.createElement("div");
    diffEl.className = "rank-diff";
    diffEl.textContent = fmt(r.prev_price) + " \u2192 " + fmt(r.latest_price) + "\uB9CC";
    changeEl.appendChild(diffEl);
    li.appendChild(changeEl);

    ul.appendChild(li);
  });

  card.appendChild(ul);
  return card;
}

function renderGrid() {
  gridEl.innerHTML = "";
  if (!globalData || !activeSido) return;

  var sidoData = globalData.sidos[activeSido];
  if (!sidoData) return;

  var codes = Object.keys(sidoData.districts).sort();
  for (var i = 0; i < codes.length; i++) {
    var card = renderCard(codes[i], sidoData.districts[codes[i]]);
    gridEl.appendChild(card);
  }
}

async function init() {
  var response = await fetch(summaryPath);
  if (!response.ok) {
    statusEl.textContent = "\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
    return;
  }
  globalData = await response.json();

  var sidoOrder = globalData.sido_order || [];
  var hash = decodeURIComponent(location.hash.replace("#", ""));
  activeSido = sidoOrder.indexOf(hash) >= 0 ? hash : sidoOrder[0] || null;

  renderTabs(sidoOrder);
  renderGrid();

  statusEl.textContent = "";
  metaEl.textContent = "\uC5C5\uB370\uC774\uD2B8: " + globalData.updated_at +
    " \u00B7 \uCD1D \uAC70\uB798 " + fmt(globalData.total_txns) + "\uAC74" +
    " \u00B7 " + globalData.months_kept + "\uAC1C\uC6D4";
}

init();

/* APT Mine - 최근 본 단지 localStorage 유틸 */

var RECENT_KEY = "aptmine_recent";
var RECENT_MAX = 20;

/* ── 최근 본 단지 ── */
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch (e) { return []; }
}

function addRecent(item) {
  if (!item || !item.id) return;
  var recents = getRecent();
  recents = recents.filter(function (r) { return r.id !== item.id; });
  recents.unshift({
    id: item.id,
    apt_name: item.apt_name,
    sigungu: item.sigungu || "",
    dong_name: item.dong_name || "",
    area_m2: item.area_m2,
    latest_price: item.latest_price || item.current_price || 0,
    viewed_at: new Date().toISOString()
  });
  if (recents.length > RECENT_MAX) recents = recents.slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
}

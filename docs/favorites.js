/* APT Mine - 즐겨찾기 & 최근 본 단지 localStorage 유틸 */

var FAVORITES_KEY = "aptmine_favorites";
var RECENT_KEY = "aptmine_recent";
var RECENT_MAX = 20;

/* ── 즐겨찾기 ── */
function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; }
  catch (e) { return []; }
}

function isFavorite(id) {
  return getFavorites().some(function (f) { return f.id === id; });
}

function toggleFavorite(item) {
  var favs = getFavorites();
  var idx = -1;
  for (var i = 0; i < favs.length; i++) {
    if (favs[i].id === item.id) { idx = i; break; }
  }
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push({
      id: item.id,
      apt_name: item.apt_name,
      sigungu: item.sigungu || "",
      dong_name: item.dong_name || "",
      area_m2: item.area_m2,
      latest_price: item.latest_price || item.current_price || 0,
      added_at: new Date().toISOString()
    });
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  return idx < 0; // true = added, false = removed
}

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

/* APT Mine — 공유 유틸리티 */
var APTShare = (function () {
  var S = {};
  var _kakaoReady = false;
  var _toastTimer = null;

  /* ── Kakao SDK 동적 로드 + 초기화 ── */
  S.init = function (kakaoAppKey) {
    if (!kakaoAppKey) return;
    if (window.Kakao && window.Kakao.isInitialized && window.Kakao.isInitialized()) {
      _kakaoReady = true;
      return;
    }
    var script = document.createElement("script");
    script.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";
    script.onload = function () {
      if (window.Kakao && !window.Kakao.isInitialized()) {
        window.Kakao.init(kakaoAppKey);
        _kakaoReady = true;
      }
    };
    document.head.appendChild(script);
  };

  /* ── 카카오톡 피드 공유 ── */
  S.kakao = function (aptData) {
    if (!_kakaoReady || !window.Kakao || !window.Kakao.Share) {
      S.copyURL();
      return;
    }
    var desc = aptData.sigungu + " " + aptData.dong + " · " + aptData.area + "m²";
    if (aptData.price) desc += " · 현재 " + aptData.price;
    Kakao.Share.sendDefault({
      objectType: "feed",
      content: {
        title: aptData.name + " 시세 - APT Mine",
        description: desc,
        imageUrl: "https://aptmine.com/og-image.png",
        link: {
          mobileWebUrl: aptData.url || location.href,
          webUrl: aptData.url || location.href
        }
      },
      buttons: [
        {
          title: "시세 보기",
          link: {
            mobileWebUrl: aptData.url || location.href,
            webUrl: aptData.url || location.href
          }
        }
      ]
    });
    if (typeof APTWatchlist !== "undefined") {
      APTWatchlist.track("share_kakao", { apt_name: aptData.name });
    }
  };

  /* ── URL 클립보드 복사 + 토스트 ── */
  S.copyURL = function () {
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        _showToast("URL이 복사되었습니다");
      }).catch(function () {
        _fallbackCopy(url);
      });
    } else {
      _fallbackCopy(url);
    }
    if (typeof APTWatchlist !== "undefined") {
      APTWatchlist.track("share_copy_url");
    }
  };

  function _fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); _showToast("URL이 복사되었습니다"); }
    catch (e) { _showToast("복사에 실패했습니다"); }
    document.body.removeChild(ta);
  }

  /* ── 차트 PNG 다운로드 (워터마크 포함) ── */
  S.downloadChart = function (canvas, filename) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.width;
    var h = canvas.height;

    // 복사본에 워터마크 추가
    var copy = document.createElement("canvas");
    copy.width = w;
    copy.height = h;
    var ctx = copy.getContext("2d");
    ctx.drawImage(canvas, 0, 0);

    // 워터마크
    ctx.font = (11 * dpr) + "px sans-serif";
    ctx.fillStyle = "rgba(100, 116, 139, 0.5)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("aptmine.com", w - 8 * dpr, h - 6 * dpr);

    copy.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename || "aptmine-chart.png";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }, "image/png");

    if (typeof APTWatchlist !== "undefined") {
      APTWatchlist.track("share_download_chart");
    }
  };

  /* ── 토스트 ── */
  function _showToast(msg) {
    var old = document.querySelector(".share-toast");
    if (old) old.remove();
    clearTimeout(_toastTimer);

    var toast = document.createElement("div");
    toast.className = "share-toast";
    toast.textContent = msg;
    document.body.appendChild(toast);

    requestAnimationFrame(function () { toast.classList.add("show"); });
    _toastTimer = setTimeout(function () {
      toast.classList.remove("show");
      setTimeout(function () { toast.remove(); }, 300);
    }, 2000);
  }

  return S;
})();

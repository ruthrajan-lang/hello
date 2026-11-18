// Runs inside youtube.com/tv before any of YouTube's own scripts.
// Removes ad data from YouTube's API responses so the player never schedules ads.
// Keep this ES2017 and dependency-free: it runs in the TV's built-in Chromium.
(function () {
  if (window.__adfree) return;
  window.__adfree = { blocked: 0 };

  // Fields on player/next responses that tell the player to play ads.
  var EMPTY = { adPlacements: [], adSlots: [], adBreakHeartbeatParams: null };
  var DROP = ['playerAds'];
  // Renderers that put ad tiles or banners into feeds and shelves.
  var AD_RENDERERS = ['adSlotRenderer', 'displayAdRenderer', 'promotedSparklesWebRenderer',
    'promotedVideoRenderer', 'tvMastheadRenderer', 'statementBannerRenderer'];

  function isAdItem(item) {
    if (!item || typeof item !== 'object') return false;
    for (var i = 0; i < AD_RENDERERS.length; i++) if (item[AD_RENDERERS[i]]) return true;
    return false;
  }

  function clean(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (var i = node.length - 1; i >= 0; i--) {
        if (isAdItem(node[i])) { node.splice(i, 1); window.__adfree.blocked++; }
        else clean(node[i]);
      }
      return;
    }
    for (var k in EMPTY) {
      if (k in node && node[k] && (!Array.isArray(node[k]) || node[k].length)) {
        node[k] = Array.isArray(EMPTY[k]) ? [] : EMPTY[k];
        window.__adfree.blocked++;
      }
    }
    for (var d = 0; d < DROP.length; d++) if (DROP[d] in node) delete node[DROP[d]];
    for (var key in node) {
      var v = node[key];
      if (v && typeof v === 'object') clean(v);
    }
  }

  // Only walk YouTube API payloads, not every small JSON.parse call.
  function maybeClean(r) {
    try {
      if (r && typeof r === 'object' && (r.responseContext || r.playerResponse || r.adPlacements || Array.isArray(r))) clean(r);
    } catch (e) { /* never break the page */ }
    return r;
  }

  var origParse = JSON.parse;
  JSON.parse = function () { return maybeClean(origParse.apply(this, arguments)); };

  if (window.Response && Response.prototype.json) {
    var origJson = Response.prototype.json;
    Response.prototype.json = function () { return origJson.apply(this, arguments).then(maybeClean); };
  }

  // Backup: if an ad still starts (YouTube changes formats over time), skip it.
  var SKIP_BUTTONS = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, ytlr-skip-button-renderer, [class*="skip-ad"] button';
  function adPlaying() {
    var p = document.querySelector('.html5-video-player');
    if (p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) return true;
    try { if (p && typeof p.getAdState === 'function' && p.getAdState() === 1) return true; } catch (e) {}
    return !!document.querySelector('ytlr-ad-badge-renderer, ytlr-player-ad-overlay-renderer, .ytp-ad-player-overlay');
  }
  setInterval(function () {
    if (!adPlaying()) return;
    var btn = document.querySelector(SKIP_BUTTONS);
    if (btn) btn.click();
    var v = document.querySelector('video');
    if (v && isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) {
      v.muted = true;
      v.currentTime = v.duration;
      window.__adfree.blocked++;
    }
  }, 300);

  // Restore sound once real content plays (we only mute during ad skips).
  document.addEventListener('playing', function (e) {
    var v = e.target;
    if (v && v.tagName === 'VIDEO' && v.muted && !adPlaying()) v.muted = false;
  }, true);

  // Small confirmation badge so you can tell the blocker loaded.
  function badge() {
    if (!document.body) return setTimeout(badge, 500);
    var b = document.createElement('div');
    b.textContent = 'Ad blocking on';
    b.style.cssText = 'position:fixed;top:32px;right:48px;z-index:2147483647;padding:10px 20px;border-radius:8px;' +
      'background:rgba(0,0,0,.75);color:#fff;font:600 24px sans-serif;transition:opacity .6s';
    document.body.appendChild(b);
    setTimeout(function () { b.style.opacity = '0'; }, 4000);
    setTimeout(function () { b.remove(); }, 5000);
  }
  badge();
})();

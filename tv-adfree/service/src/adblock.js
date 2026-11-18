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

  // Small on-screen note in the top-right corner.
  function toast(text, ms) {
    if (!document.body) return setTimeout(function () { toast(text, ms); }, 500);
    var b = document.createElement('div');
    b.textContent = text;
    b.style.cssText = 'position:fixed;top:32px;right:48px;z-index:2147483647;padding:10px 20px;border-radius:8px;' +
      'background:rgba(0,0,0,.75);color:#fff;font:600 24px sans-serif;transition:opacity .6s';
    document.body.appendChild(b);
    setTimeout(function () { b.style.opacity = '0'; }, ms || 3000);
    setTimeout(function () { b.remove(); }, (ms || 3000) + 1000);
  }
  toast('Ad blocking on', 4000);

  // SponsorBlock: skip community-marked sponsor reads, self-promos and subscribe reminders.
  var SB_CATEGORIES = ['sponsor', 'selfpromo', 'interaction'];
  var SB_NAMES = { sponsor: 'sponsor', selfpromo: 'self-promotion', interaction: 'subscribe reminder' };
  var sb = { id: null, segments: [] };

  function currentVideoId() {
    var m = /[?&]v=([\w-]{11})/.exec(location.hash + '&' + location.search);
    return m ? m[1] : null;
  }

  function loadSegments(id) {
    sb.id = id;
    sb.segments = [];
    fetch('https://sponsor.ajay.app/api/skipSegments?videoID=' + id +
      '&categories=' + encodeURIComponent(JSON.stringify(SB_CATEGORIES)))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        if (sb.id !== id) return;
        sb.segments = (list || []).filter(function (s) { return s.actionType === 'skip' || !s.actionType; })
          .map(function (s) { return { start: s.segment[0], end: s.segment[1], category: s.category }; });
      })
      .catch(function () {});
  }

  setInterval(function () {
    var id = currentVideoId();
    if (id !== sb.id) { if (id) loadSegments(id); else sb = { id: null, segments: [] }; }
    if (!sb.segments.length || adPlaying()) return;
    var v = document.querySelector('video');
    if (!v || v.paused) return;
    for (var i = 0; i < sb.segments.length; i++) {
      var s = sb.segments[i];
      if (v.currentTime >= s.start && v.currentTime < s.end - 0.5) {
        v.currentTime = s.end;
        toast('Skipped ' + (SB_NAMES[s.category] || s.category));
        break;
      }
    }
  }, 500);
})();

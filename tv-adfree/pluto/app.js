/* AdFree Pluto: on-demand Pluto TV with the stitched-in ad breaks removed. */
(function () {
  'use strict';
  var SERVICE = 'http://127.0.0.1:8101';
  var KEY = { DONE: 65376, CANCEL: 65385, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412 };
  var MAX_ROWS = 40, MAX_ITEMS = 40;

  var $ = function (id) { return document.getElementById(id); };
  var screen = 'status';
  var home = { all: [], rows: [], r: 0, c: [], filter: 'all', top: 0 };
  var FILTERS = ['all', 'movie', 'series'];
  var ser = { data: null, s: 0, e: 0 };
  var play = { queue: [], index: 0, osdTimer: 0 };
  var video = $('video');
  var q = $('q');
  var res = { items: [], i: 0, from: 'home' };
  var hls = null;

  // ---------- helpers ----------
  try {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind']
      .forEach(function (k) { tizen.tvinputdevice.registerKey(k); });
  } catch (e) {}

  function show(name) {
    screen = name;
    ['home', 'results', 'series', 'player'].forEach(function (s) { $(s).classList.toggle('on', s === name); });
    $('status').style.display = name === 'status' ? 'flex' : 'none';
  }
  function status(text) { $('status').textContent = text; show('status'); }
  function getJSON(path) {
    return fetch(SERVICE + path).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; });
    });
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function mins(ms) { return ms ? Math.round(ms / 60000) + ' min' : ''; }
  function exitApp() { try { tizen.application.getCurrentApplication().exit(); } catch (e) { window.close(); } }

  // ---------- startup ----------
  function startService() {
    try {
      var app = tizen.application.getCurrentApplication();
      tizen.application.launchAppControl(
        new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
        app.appInfo.packageId + '.Service', function () {}, function () {});
    } catch (e) {}
  }

  var tries = 0;
  function waitForService() {
    fetch(SERVICE + '/ping').then(function () { loadHome(); }).catch(function () {
      tries++;
      if (tries % 40 === 0) startService();
      if (tries === 20) status('Starting… the first launch can take up to a minute.');
      if (tries > 180) return status('The background service didn\'t start. Unplug the TV for 30 seconds and try again.');
      setTimeout(waitForService, 500);
    });
  }

  function loadHome() {
    status('Loading Pluto…');
    getJSON('/api/categories').then(function (cats) {
      home.all = cats;
      applyFilter();
      show('home');
      focusHome();
    }).catch(function (e) { status('Couldn\'t load Pluto (' + e.message + '). Press OK to try again.'); });
  }

  // ---------- home ----------
  function renderHome() {
    $('rowsInner').innerHTML = home.rows.map(function (row, r) {
      return '<div class="row"><h2>' + esc(row.name) + '</h2><div class="strip" id="strip' + r + '">' +
        row.items.map(function (it, c) {
          return '<div class="card" id="card' + r + '_' + c + '" data-img="' + esc(it.image) + '">' +
            (it.type === 'series' ? '<span class="badge">Series</span>' : '') +
            '<div class="t">' + esc(it.name) + '</div></div>';
        }).join('') + '</div></div>';
    }).join('');
  }

  function loadImages() {
    for (var r = Math.max(0, home.r - 1); r <= Math.min(home.rows.length - 1, home.r + 3); r++) {
      var c0 = Math.max(0, home.c[r] - 2), c1 = Math.min(home.rows[r].items.length - 1, home.c[r] + 7);
      for (var c = c0; c <= c1; c++) {
        var el = $('card' + r + '_' + c);
        if (el && el.dataset.img) { el.style.backgroundImage = 'url("' + el.dataset.img + '")'; el.dataset.img = ''; }
      }
    }
  }

  function byFilter(it) { return home.filter === 'all' || it.type === home.filter; }

  // Rebuild the rows for the chosen tab (All / Movies / TV Shows).
  function applyFilter() {
    home.rows = [];
    home.all.forEach(function (c) {
      if (home.rows.length >= MAX_ROWS) return;
      var items = c.items.filter(byFilter).slice(0, MAX_ITEMS);
      if (items.length) home.rows.push({ name: c.name, items: items });
    });
    home.c = home.rows.map(function () { return 0; });
    var tabs = $('tabs').children;
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('sel', tabs[i].dataset.f === home.filter);
    $('rowsInner').style.transform = 'translateY(0)';
    renderHome();
  }

  function focusHome() {
    var old = document.querySelector('.card.focus');
    if (old) old.classList.remove('focus');
    var tabs = $('tabs').children;
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('focus', home.r < 0 && home.top === i);
    $('searchbar').classList.toggle('focus', home.r < 0 && home.top === tabs.length);
    if (home.r < 0 || !home.rows.length) return;
    var r = home.r, c = home.c[r], it = home.rows[r].items[c];
    $('card' + r + '_' + c).classList.add('focus');
    $('rowsInner').style.transform = 'translateY(' + (-r * 330) + 'px)';
    $('strip' + r).style.transform = 'translateX(' + (-Math.max(0, c - 1) * 408) + 'px)';
    var hero = $('hero');
    hero.querySelector('h1').textContent = it.name;
    hero.querySelector('.meta').textContent = [it.type === 'series' ? 'Series' : mins(it.duration), it.rating, it.genre].filter(Boolean).join(' · ');
    hero.querySelector('p').textContent = it.description;
    loadImages();
  }

  function homeKey(k) {
    if (home.r < 0) { // top bar: filter tabs, then the search box
      if (k === KEY.LEFT && home.top > 0) home.top--;
      else if (k === KEY.RIGHT && home.top < FILTERS.length) home.top++;
      else if (k === KEY.ENTER && home.top === FILTERS.length) { q.focus(); return; } // opens the TV keyboard
      else if (k === KEY.ENTER) { home.filter = FILTERS[home.top]; applyFilter(); }
      else if (k === KEY.DOWN && home.rows.length) home.r = 0;
      else if (k === KEY.BACK) return exitApp();
      else return;
      return focusHome();
    }
    if (k === KEY.UP && home.r === 0) home.r = -1;
    else if (k === KEY.UP && home.r > 0) home.r--;
    else if (k === KEY.DOWN && home.r < home.rows.length - 1) home.r++;
    else if (k === KEY.LEFT && home.c[home.r] > 0) home.c[home.r]--;
    else if (k === KEY.RIGHT && home.c[home.r] < home.rows[home.r].items.length - 1) home.c[home.r]++;
    else if (k === KEY.ENTER) return openItem(home.rows[home.r].items[home.c[home.r]]);
    else if (k === KEY.BACK) return exitApp();
    else return;
    focusHome();
  }

  function openItem(it, from) {
    from = from || 'home';
    if (it.type === 'series') return openSeries(it, from);
    startPlayback([it], 0, from);
  }

  // ---------- search ----------
  function searchKey(k) {
    if (k === KEY.ENTER || k === KEY.DONE) { q.blur(); runSearch(q.value.trim()); return true; }
    if (k === KEY.CANCEL || k === KEY.BACK) { q.blur(); return true; }
    return false; // let the keyboard handle everything else
  }

  function runSearch(text) {
    if (!text) return;
    status('Searching for "' + text + '"…');
    getJSON('/api/search?q=' + encodeURIComponent(text)).then(function (items) {
      items = items.filter(byFilter);
      res = { items: items, i: 0, from: 'home' };
      $('results').querySelector('h1').textContent = items.length ? 'Results for "' + text + '"' : 'No results for "' + text + '"';
      $('gridInner').innerHTML = items.map(function (it, i) {
        return '<div class="card" id="res' + i + '" style="background-image:url(&quot;' + esc(it.image) + '&quot;)">' +
          (it.type === 'series' ? '<span class="badge">Series</span>' : '') + '<div class="t">' + esc(it.name) + '</div></div>';
      }).join('');
      show('results');
      focusResult();
    }).catch(function (e) {
      status('Search failed (' + e.message + ').');
      setTimeout(function () { show('home'); }, 2500);
    });
  }

  function focusResult() {
    var old = document.querySelector('#gridInner .card.focus');
    if (old) old.classList.remove('focus');
    var el = $('res' + res.i);
    if (!el) return;
    el.classList.add('focus');
    $('gridInner').style.transform = 'translateY(' + (-Math.max(0, Math.floor(res.i / 4) - 1) * 252) + 'px)';
  }

  function resultsKey(k) {
    var n = res.items.length;
    if (k === KEY.LEFT && res.i % 4 > 0) res.i--;
    else if (k === KEY.RIGHT && res.i % 4 < 3 && res.i < n - 1) res.i++;
    else if (k === KEY.UP && res.i >= 4) res.i -= 4;
    else if (k === KEY.DOWN && res.i + 4 < n) res.i += 4;
    else if (k === KEY.ENTER && n) return openItem(res.items[res.i], 'results');
    else if (k === KEY.BACK) { show('home'); return; }
    else return;
    focusResult();
  }

  // ---------- series ----------
  function openSeries(it, from) {
    status('Loading ' + it.name + '…');
    getJSON('/api/series?id=' + encodeURIComponent(it.id)).then(function (d) {
      d.seasons = d.seasons.filter(function (s) { return s.episodes.length; });
      if (!d.seasons.length) throw new Error('no episodes available');
      ser = { data: d, s: 0, e: 0, from: from };
      $('series').querySelector('h1').textContent = d.name;
      $('series').querySelector('.desc').textContent = d.description;
      renderSeason();
      show('series');
    }).catch(function (e) {
      status('Couldn\'t open this series (' + e.message + ').');
      setTimeout(function () { show(from); }, 2500);
    });
  }

  function renderSeason() {
    $('seasons').innerHTML = ser.data.seasons.map(function (s, i) {
      return '<span class="' + (i === ser.s ? 'sel' : '') + '">Season ' + s.number + '</span>';
    }).join('');
    $('epInner').innerHTML = ser.data.seasons[ser.s].episodes.map(function (ep, i) {
      return '<div class="ep" id="ep' + i + '"><img src="' + esc(ep.image) + '"><div><div class="n">' + esc(ep.number + '. ' + ep.name) +
        ' <span style="color:var(--muted);font-size:22px">' + mins(ep.duration) + '</span></div><div class="d">' + esc(ep.description) + '</div></div></div>';
    }).join('');
    focusEpisode();
  }

  function focusEpisode() {
    var old = document.querySelector('.ep.focus');
    if (old) old.classList.remove('focus');
    var el = $('ep' + ser.e);
    if (el) el.classList.add('focus');
    $('epInner').style.transform = 'translateY(' + (-Math.max(0, ser.e - 2) * 162) + 'px)';
  }

  function seriesKey(k) {
    var eps = ser.data.seasons[ser.s].episodes;
    if (k === KEY.UP && ser.e > 0) { ser.e--; focusEpisode(); }
    else if (k === KEY.DOWN && ser.e < eps.length - 1) { ser.e++; focusEpisode(); }
    else if (k === KEY.LEFT && ser.s > 0) { ser.s--; ser.e = 0; renderSeason(); }
    else if (k === KEY.RIGHT && ser.s < ser.data.seasons.length - 1) { ser.s++; ser.e = 0; renderSeason(); }
    else if (k === KEY.ENTER) startPlayback(eps, ser.e, 'series');
    else if (k === KEY.BACK) show(ser.from);
  }

  // ---------- player ----------
  function startPlayback(queue, index, from) {
    play.queue = queue; play.index = index; play.from = from;
    var it = queue[index];
    if (!it.path) { toast('This title isn\'t available right now'); return; }
    status('Starting ' + it.name + '…');
    getJSON('/api/play?path=' + encodeURIComponent(it.path)).then(function (p) {
      $('osd').querySelector('.title').textContent = it.name;
      attach(p.url);
      show('player');
      showOsd();
    }).catch(function (e) {
      status('Couldn\'t start playback (' + e.message + ').');
      setTimeout(function () { show(from); }, 2500);
    });
  }

  // Pluto streams use separate audio tracks and encryption, which the TV's built-in
  // player handles poorly, so play them with hls.js (the same player pluto.tv uses).
  function attach(url) {
    detach();
    if (!window.Hls) { failPlayback('player file missing from the app, reinstall it'); return; }
    if (Hls.isSupported()) {
      var recovered = false;
      hls = new Hls({ maxBufferLength: 30, backBufferLength: 30, enableWorker: true });
      hls.on(Hls.Events.MANIFEST_PARSED, function () { video.play(); });
      hls.on(Hls.Events.ERROR, function (ev, d) {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
        failPlayback(d.details);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
      video.play();
    }
  }

  function detach() {
    if (hls) { hls.destroy(); hls = null; }
  }

  function failPlayback(detail) {
    if (screen !== 'player') return;
    toast('Playback error' + (detail ? ': ' + detail : ''));
    setTimeout(stopPlayback, 4000);
  }

  function stopPlayback() {
    detach();
    video.pause();
    video.removeAttribute('src');
    video.load();
    show(play.from);
  }

  function showOsd() {
    $('osd').classList.remove('hide');
    clearTimeout(play.osdTimer);
    play.osdTimer = setTimeout(function () { if (!video.paused) $('osd').classList.add('hide'); }, 4000);
  }

  function toast(text) {
    var t = $('toast');
    t.textContent = text; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 2500);
  }

  function seek(delta) {
    if (!isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta));
    showOsd();
  }

  video.addEventListener('timeupdate', function () {
    $('cur').textContent = fmt(video.currentTime);
    $('dur').textContent = fmt(video.duration);
    $('fill').style.width = (video.duration ? video.currentTime / video.duration * 100 : 0) + '%';
  });
  video.addEventListener('ended', function () {
    if (play.index < play.queue.length - 1) { toast('Next episode'); startPlayback(play.queue, play.index + 1, play.from); }
    else stopPlayback();
  });
  video.addEventListener('error', function () {
    if (hls) return; // hls.js reports and recovers its own errors
    failPlayback(video.error ? 'code ' + video.error.code : '');
  });

  function playerKey(k) {
    if (k === KEY.ENTER || k === KEY.PLAYPAUSE) { if (video.paused) video.play(); else video.pause(); showOsd(); }
    else if (k === KEY.PLAY) { video.play(); showOsd(); }
    else if (k === KEY.PAUSE) { video.pause(); showOsd(); }
    else if (k === KEY.LEFT) seek(-10);
    else if (k === KEY.RIGHT) seek(10);
    else if (k === KEY.RW) seek(-60);
    else if (k === KEY.FF) seek(60);
    else if (k === KEY.UP || k === KEY.DOWN) showOsd();
    else if (k === KEY.BACK || k === KEY.STOP) stopPlayback();
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (document.activeElement === q) {
      if (searchKey(k)) e.preventDefault();
      return;
    }
    if (screen === 'home') homeKey(k);
    else if (screen === 'results') resultsKey(k);
    else if (screen === 'series') seriesKey(k);
    else if (screen === 'player') playerKey(k);
    else if (screen === 'status') {
      if (k === KEY.ENTER) loadHome();
      else if (k === KEY.BACK) exitApp();
    }
    e.preventDefault();
  });

  startService();
  waitForService();
})();

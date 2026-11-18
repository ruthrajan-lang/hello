/* AdFree Pluto: on-demand Pluto TV with the stitched-in ad breaks removed. */
(function () {
  'use strict';
  var SERVICE = 'http://127.0.0.1:8101';
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412 };
  var MAX_ROWS = 40, MAX_ITEMS = 40;

  var $ = function (id) { return document.getElementById(id); };
  var screen = 'status';
  var home = { rows: [], r: 0, c: [] };
  var ser = { data: null, s: 0, e: 0 };
  var play = { queue: [], index: 0, osdTimer: 0 };
  var video = $('video');

  // ---------- helpers ----------
  try {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind']
      .forEach(function (k) { tizen.tvinputdevice.registerKey(k); });
  } catch (e) {}

  function show(name) {
    screen = name;
    ['home', 'series', 'player'].forEach(function (s) { $(s).classList.toggle('on', s === name); });
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
      home.rows = cats.slice(0, MAX_ROWS).map(function (c) { return { name: c.name, items: c.items.slice(0, MAX_ITEMS) }; });
      home.c = home.rows.map(function () { return 0; });
      renderHome();
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

  function focusHome() {
    var old = document.querySelector('.card.focus');
    if (old) old.classList.remove('focus');
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
    if (k === KEY.UP && home.r > 0) home.r--;
    else if (k === KEY.DOWN && home.r < home.rows.length - 1) home.r++;
    else if (k === KEY.LEFT && home.c[home.r] > 0) home.c[home.r]--;
    else if (k === KEY.RIGHT && home.c[home.r] < home.rows[home.r].items.length - 1) home.c[home.r]++;
    else if (k === KEY.ENTER) return openItem(home.rows[home.r].items[home.c[home.r]]);
    else if (k === KEY.BACK) return exitApp();
    else return;
    focusHome();
  }

  function openItem(it) {
    if (it.type === 'series') return openSeries(it);
    startPlayback([it], 0, 'home');
  }

  // ---------- series ----------
  function openSeries(it) {
    status('Loading ' + it.name + '…');
    getJSON('/api/series?id=' + encodeURIComponent(it.id)).then(function (d) {
      d.seasons = d.seasons.filter(function (s) { return s.episodes.length; });
      if (!d.seasons.length) throw new Error('no episodes available');
      ser = { data: d, s: 0, e: 0 };
      $('series').querySelector('h1').textContent = d.name;
      $('series').querySelector('.desc').textContent = d.description;
      renderSeason();
      show('series');
    }).catch(function (e) {
      status('Couldn\'t open this series (' + e.message + ').');
      setTimeout(function () { show('home'); }, 2500);
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
    else if (k === KEY.BACK) show('home');
  }

  // ---------- player ----------
  function startPlayback(queue, index, from) {
    play.queue = queue; play.index = index; play.from = from;
    var it = queue[index];
    if (!it.path) { toast('This title isn\'t available right now'); return; }
    status('Starting ' + it.name + '…');
    getJSON('/api/play?path=' + encodeURIComponent(it.path)).then(function (p) {
      $('osd').querySelector('.title').textContent = it.name;
      video.src = p.url;
      video.play();
      show('player');
      showOsd();
    }).catch(function (e) {
      status('Couldn\'t start playback (' + e.message + ').');
      setTimeout(function () { show(from); }, 2500);
    });
  }

  function stopPlayback() {
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
    if (screen === 'player') { toast('Playback error'); setTimeout(stopPlayback, 2000); }
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
    if (screen === 'home') homeKey(k);
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

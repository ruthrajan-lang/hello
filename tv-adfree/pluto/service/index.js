// AdFree Pluto background service (Node.js, runs on the TV). No dependencies.
// - /api/*  : talks to Pluto's catalog for the app (Pluto only allows its own website to call it directly).
// - /hls?u= : fetches Pluto's HLS playlists and removes the stitched-in ad breaks before the TV's
//             video player sees them. Video segments themselves are loaded straight from Pluto's CDN.
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
const { URL } = require('url');

const PORT = 8101;
const SELF = 'http://127.0.0.1:' + PORT;
const CLIENT_ID = crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
let session = null; // { token, stitcher, params, expires }

function get(url, headers, redirects) {
  return new Promise((resolve, reject) => {
    // Ask for compressed responses: Pluto's catalog is ~33 MB raw but ~4.6 MB gzipped.
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 (SMART-TV; Tizen) AdFreePluto', 'Accept-Encoding': 'gzip' }, headers) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 5) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), headers, (redirects || 0) + 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        const raw = Buffer.concat(chunks);
        if (res.headers['content-encoding'] !== 'gzip') return resolve(raw.toString('utf8'));
        zlib.gunzip(raw, (err, out) => (err ? reject(err) : resolve(out.toString('utf8'))));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

function boot() {
  if (session && Date.now() < session.expires) return Promise.resolve(session);
  const q = 'appName=web&appVersion=9.0.0&deviceVersion=120.0.0&deviceModel=web&deviceMake=chrome&deviceType=web' +
    '&clientModelNumber=1.0.0&serverSideAds=true&clientID=' + CLIENT_ID;
  return get('https://boot.pluto.tv/v4/start?' + q).then((t) => {
    const j = JSON.parse(t);
    session = {
      token: j.sessionToken,
      stitcher: j.servers.stitcher,
      params: j.stitcherParams,
      expires: Date.now() + Math.max(600, (j.refreshInSec || 3600) - 300) * 1000
    };
    return session;
  });
}

function api(path) {
  return boot().then((s) => get('https://service-vod.clusters.pluto.tv' + path, { Authorization: 'Bearer ' + s.token }))
    .then(JSON.parse);
}

function poster(item) {
  const covers = item.covers || [];
  const wide = covers.find((c) => c.aspectRatio === '16:9') || covers[0];
  return wide ? wide.url.replace(/w=\d+/, 'w=480').replace(/h=\d+/, 'h=270') : '';
}

function slim(item) {
  return {
    id: item._id, type: item.type, name: item.name, description: item.description || item.summary || '',
    rating: item.rating || '', genre: item.genre || '', duration: item.duration || 0,
    image: poster(item), path: item.stitched && item.stitched.path || ''
  };
}

// The catalog changes a few times a day, so keep it for 30 minutes.
let catCache = null;
function categories() {
  if (catCache && Date.now() - catCache.at < 30 * 60 * 1000) return Promise.resolve(catCache.data);
  return api('/v4/vod/categories?includeItems=true&offset=1000&page=1').then((j) => {
    const data = (j.categories || [])
      .filter((c) => c.items && c.items.length)
      .map((c) => ({ name: c.name, items: c.items.filter((i) => i.type === 'movie' || i.type === 'series').slice(0, 60).map(slim) }))
      .filter((c) => c.items.length);
    catCache = { at: Date.now(), data };
    return data;
  });
}

function series(id) {
  return api('/v4/vod/series/' + encodeURIComponent(id) + '/seasons?offset=1000&page=1').then((j) => ({
    name: j.name, description: j.description || '',
    seasons: (j.seasons || []).map((s) => ({
      number: s.number,
      episodes: (s.episodes || []).map((e) => Object.assign(slim(e), { number: e.number, season: e.season }))
    }))
  }));
}

// Search returns bare IDs; look up full details (pictures, playable path) in one batch.
function search(q) {
  return boot().then((s) => get('https://service-media-search.clusters.pluto.tv/v1/search?limit=60&q=' + encodeURIComponent(q),
    { Authorization: 'Bearer ' + s.token }))
    .then(JSON.parse)
    .then((j) => {
      const ids = (j.data || []).filter((i) => i.type === 'movie' || i.type === 'series').map((i) => i.id).slice(0, 40);
      if (!ids.length) return [];
      return api('/v4/vod/items?ids=' + ids.join(',')).then((items) => {
        const byId = {};
        (items || []).forEach((it) => { byId[it._id] = it; });
        return ids.filter((id) => byId[id]).map((id) => slim(byId[id]));
      });
    });
}

function playUrl(path) {
  return boot().then((s) => s.stitcher + '/v2' + path + '?' + s.params + '&jwt=' + s.token + '&masterJWTPassthrough=true');
}

// ---------- Playlist rewriting ----------

const proxied = (abs) => SELF + '/hls?u=' + encodeURIComponent(abs);

// Master playlist: route every variant, audio and subtitle playlist back through us.
function rewriteMaster(text, base) {
  return text.split('\n').map((line) => {
    if (!line || line[0] === '#') {
      return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + proxied(new URL(u, base).toString()) + '"');
    }
    return proxied(new URL(line.trim(), base).toString());
  }).join('\n');
}

// Which video file (clip) a segment belongs to, e.g. host/857_warner_bros/clip/<clip-id>.
function clipOf(uri) {
  try {
    const u = new URL(uri);
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('clip');
    return u.host + '/' + (i >= 0 ? parts.slice(0, i + 2) : parts.slice(0, 2)).join('/');
  } catch (e) { return uri; }
}

// Media playlist: split into runs at each discontinuity, keep only runs from the main
// title's clip (the one with the most playing time) and drop the rest — those are ads.
function rewriteMedia(text, base) {
  const lines = text.split('\n');
  const header = [];
  const runs = [];
  let run = null;
  let footer = [];
  let pendingDuration = 0;

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line === '#EXT-X-ENDLIST') { footer.push(line); return; }
    if (line === '#EXT-X-DISCONTINUITY') { run = { lines: [], clips: {} }; runs.push(run); return; }
    if (!run && (line.indexOf('#EXTINF') === 0 || line[0] !== '#' || line.indexOf('#EXT-X-KEY') === 0 ||
        line.indexOf('#EXT-X-PROGRAM-DATE-TIME') === 0 || line.indexOf('#EXT-X-MAP') === 0)) {
      run = { lines: [], clips: {} }; runs.push(run);
    }
    if (!run) { header.push(line); return; }
    if (line[0] === '#') {
      const m = /^#EXTINF:([\d.]+)/.exec(line);
      if (m) pendingDuration = parseFloat(m[1]);
      run.lines.push(line.replace(/URI="([^"]+)"/g, (x, u) => 'URI="' + new URL(u, base).toString() + '"'));
      return;
    }
    const abs = new URL(line, base).toString();
    const clip = clipOf(abs);
    run.clips[clip] = (run.clips[clip] || 0) + pendingDuration;
    pendingDuration = 0;
    run.lines.push(abs);
  });

  const total = {};
  runs.forEach((r) => Object.keys(r.clips).forEach((c) => { total[c] = (total[c] || 0) + r.clips[c]; }));
  const main = Object.keys(total).sort((a, b) => total[b] - total[a])[0];
  const kept = runs.filter((r) => {
    const keys = Object.keys(r.clips);
    if (!keys.length) return false;
    const mainTime = r.clips[main] || 0;
    const all = keys.reduce((s, k) => s + r.clips[k], 0);
    return mainTime >= all * 0.5;
  });

  const out = header.filter((l) => l.indexOf('#EXT-X-DISCONTINUITY-SEQUENCE') !== 0);
  kept.forEach((r, i) => {
    if (i > 0) out.push('#EXT-X-DISCONTINUITY');
    out.push.apply(out, r.lines);
  });
  out.push.apply(out, footer.length ? footer : ['#EXT-X-ENDLIST']);
  return out.join('\n') + '\n';
}

function rewrite(text, base) {
  return text.indexOf('#EXT-X-STREAM-INF') !== -1 ? rewriteMaster(text, base) : rewriteMedia(text, base);
}

// ---------- HTTP server ----------

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const u = new URL(req.url, SELF);
  const json = (p) => p.then((data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }).catch((e) => { res.statusCode = 502; res.end(JSON.stringify({ error: String(e.message || e) })); });

  if (u.pathname === '/ping') return res.end('ok');
  if (u.pathname === '/api/categories') return json(categories());
  if (u.pathname === '/api/series') return json(series(u.searchParams.get('id')));
  if (u.pathname === '/api/search') return json(search(u.searchParams.get('q') || ''));
  if (u.pathname === '/api/play') {
    return json(playUrl(u.searchParams.get('path')).then((url) => ({ url: proxied(url) })));
  }
  if (u.pathname === '/hls') {
    const target = u.searchParams.get('u');
    return get(target).then((text) => {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(rewrite(text, target));
    }).catch((e) => { res.statusCode = 502; res.end(String(e.message || e)); });
  }
  res.statusCode = 404;
  res.end('not found');
}).listen(PORT, '127.0.0.1');

categories().catch(() => {}); // warm up so the app opens fast

module.exports = { onStart() {}, onRequest() {}, onExit() {}, _rewriteMedia: rewriteMedia };

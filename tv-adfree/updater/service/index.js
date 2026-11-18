// AdFree Updater background service (Node.js on the TV, no dependencies).
// Finds the Mac that's sharing updates (./install-mac.sh --serve), downloads the signed apps
// and installs them through the TV's own developer connection, so Host PC IP can stay 127.0.0.1.
const http = require('http');
const os = require('os');
const { Connection } = require('./sdb.js');

const PORT = 8102;
const UPDATE_PORT = 8765;
const REMOTE_DIR = '/home/owner/share/tmp/sdk_tools/tmp';
const SELF_PKG = 'AdFreeUpdt';

const job = { running: false, done: false, ok: false, log: [], host: null };
function log(line) { job.log.push(line); }

function fetchBuf(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Hard deadline: on some TVs a connect to an address with no device can hang for minutes.
    const timer = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, timeoutMs || 30000);
    const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
    resolve = done(resolve); reject = done(reject);
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 30000, () => req.destroy(new Error('timeout')));
  });
}

function manifest(host) {
  return fetchBuf('http://' + host + ':' + UPDATE_PORT + '/adfree.json', 1200).then((b) => JSON.parse(b.toString()));
}

function localPrefixes() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach((name) => (ifs[name] || []).forEach((a) => {
    if (a.family === 'IPv4' && !a.internal && /^(10|172|192)\./.test(a.address)) out.push(a.address.split('.').slice(0, 3).join('.'));
  }));
  return out.filter((p, i) => out.indexOf(p) === i);
}

// Try the remembered address first, then every address on the TV's local network.
function findMac(hint) {
  const tryHost = (h) => manifest(h).then(() => h);
  const first = hint ? tryHost(hint) : Promise.reject();
  return first.catch(() => {
    const candidates = [];
    localPrefixes().forEach((p) => { for (let i = 1; i < 255; i++) candidates.push(p + '.' + i); });
    if (!candidates.length) throw new Error('The TV has no network address');
    return new Promise((resolve, reject) => {
      let next = 0, active = 0, found = false;
      const pump = () => {
        if (found) return;
        if (next >= candidates.length && active === 0) return reject(new Error('No Mac is sharing updates. On the Mac run: ./install-mac.sh --serve'));
        while (active < 64 && next < candidates.length) {
          const h = candidates[next++];
          active++;
          tryHost(h).then((ok) => { found = true; resolve(ok); }, () => {}).then(() => { active--; pump(); });
        }
      };
      pump();
    });
  });
}

function installOne(conn, host, app) {
  log('Downloading ' + app.name + '…');
  return fetchBuf('http://' + host + ':' + UPDATE_PORT + '/' + app.file, 120000).then((data) => {
    log('Copying ' + app.name + ' to the TV (' + Math.round(data.length / 1024) + ' KB)…');
    const remote = REMOTE_DIR + '/' + app.file;
    return conn.push(data, remote).then(() => {
      log('Installing ' + app.name + '…');
      // Samsung's installer is given the app ID (package.AppName); the package ID alone installs
      // the app but files it under the wrong name in My Apps, which breaks its icon there.
      return conn.shell('0 vd_appinstall ' + (app.appId || app.pkg) + ' ' + remote);
    });
  }).then((out) => {
    if (/fail|error/i.test(out)) { // success output varies by TV model, so only treat explicit failures as errors
      const reason = (/reason:\s*([^\n]+)/.exec(out) || [])[1] || out.trim().split('\n').slice(-2).join(' ');
      throw new Error(app.name + ' install failed: ' + reason);
    }
    log('✓ ' + app.name + ' ' + app.version + ' installed');
  });
}

function runUpdate(hint, skip) {
  Object.assign(job, { running: true, done: false, ok: false, log: [], host: null });
  log('Looking for your Mac…');
  let conn;
  return findMac(hint).then((host) => {
    job.host = host;
    log('Found it at ' + host);
    return manifest(host);
  }).then((m) => {
    log('Connecting to the TV\'s developer connection…');
    conn = new Connection();
    return conn.connect().then(() => m);
  }).then((m) => {
    // Install the updater itself last: installing it restarts this service.
    // Skip apps the TV says are already at this version.
    const apps = (m.apps || []).filter((a) => skip.indexOf(a.appId + '@' + a.version) === -1)
      .sort((a, b) => (a.pkg === SELF_PKG) - (b.pkg === SELF_PKG));
    if (!apps.length) log('Everything is already up to date.');
    return apps.reduce((p, app) => p.then(() => {
      if (app.pkg === SELF_PKG) log('Updating AdFree Updater last; it will close when done.');
      return installOne(conn, job.host, app);
    }), Promise.resolve());
  }).then(() => {
    job.ok = true;
    log('All done.');
  }).catch((e) => {
    log('✗ ' + (e && e.message || e));
  }).then(() => {
    job.running = false;
    job.done = true;
    if (conn) conn.close();
  });
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/ping') return res.end('{"ok":true}');
  if (u.pathname === '/check') {
    return findMac(u.searchParams.get('hint')).then((host) => manifest(host).then((m) => res.end(JSON.stringify({ host, apps: m.apps, built: m.built }))))
      .catch((e) => res.end(JSON.stringify({ error: e.message })));
  }
  if (u.pathname === '/update') {
    if (!job.running) runUpdate(u.searchParams.get('hint'), (u.searchParams.get('skip') || '').split(','));
    return res.end('{"started":true}');
  }
  if (u.pathname === '/progress') return res.end(JSON.stringify(job));
  res.statusCode = 404;
  res.end('{}');
}).listen(PORT, '127.0.0.1');

module.exports = { onStart() {}, onRequest() {}, onExit() {} };

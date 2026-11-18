// Not strict mode: the bundled adbhost library relies on sloppy-mode globals.
// Background service (Node.js, runs on the TV).
// 1. The launcher asks /state whether Developer Mode points at this TV (127.0.0.1).
// 2. /launch: once the launcher exits, relaunch the app in debug mode over the TV's own sdb port.
// 3. Attach with the DevTools protocol, register the ad-block script to run before
//    YouTube's code on every page load, then open youtube.com/tv.
const http = require('http');
const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');

/* global tizen, __ADBLOCK__ */
const SCRIPT = __ADBLOCK__;
const PORT = 8100;
const YT_URL = 'https://www.youtube.com/tv';
const appInfo = tizen.application.getAppInfo();
const APP_ID = appInfo.packageId + '.AdFreeTube';
const IS_TIZEN3 = String(tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')).indexOf('3.') === 0;

let busy = false;
let busyTimer = null;

function setBusy(on) {
  busy = on;
  clearTimeout(busyTimer);
  if (on) busyTimer = setTimeout(() => { busy = false; }, 30000); // give up on a stuck attach
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
  });
}

// The real test: can we open the TV's developer (sdb) connection from here?
// That only works when Developer Mode is on and its Host PC IP is 127.0.0.1.
function sdbReachable() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { sdb._stream.end(); } catch (e) {} resolve(ok); };
    const sdb = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });
    sdb.on('connect', () => finish(true));
    sdb._stream.on('error', () => finish(false));
    sdb._stream.on('close', () => finish(false));
    setTimeout(() => finish(false), 4000);
  });
}

// Settings the TV reports about itself; only used to explain problems and find its IP.
function tvInfo() {
  return getJson('http://127.0.0.1:8001/api/v2/')
    .then((j) => j.device || {})
    .catch((e) => ({ error: String(e && e.message || e) }));
}

function tvState() {
  return Promise.all([sdbReachable(), tvInfo()]).then(([ready, d]) => ({
    ready,
    devMode: d.developerMode,
    hostIp: d.developerIP || '',
    ip: d.ip || '127.0.0.1',
    infoError: d.error
  }));
}

function appRunning() {
  return new Promise((resolve) => {
    tizen.application.getAppsContext(
      (ctx) => resolve(ctx.some((c) => c.appId === APP_ID)),
      () => resolve(false)
    );
  });
}

function waitForExit(tries) {
  return appRunning().then((running) => {
    if (!running || tries <= 0) return;
    return new Promise((r) => setTimeout(r, 100)).then(() => waitForExit(tries - 1));
  });
}

function debugLaunch(ip) {
  const sdb = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });
  sdb._stream.on('error', () => setBusy(false));
  sdb._stream.on('connect', () => {
    const shell = sdb.createStream('shell:0 debug ' + APP_ID + (IS_TIZEN3 ? ' 0' : ''));
    let out = '';
    shell.on('data', (data) => {
      out += data.toString();
      const m = out.match(/:\s*(\d{2,5})/);
      if (out.indexOf('debug') !== -1 && m) {
        attach(ip, Number(m[1]), 0);
        setTimeout(() => sdb._stream.end(), 1000);
      }
    });
  });
}

function call(client, method, params) {
  const [domain, fn] = method.split('.');
  return client[domain][fn](params).catch(() => null);
}

function attach(host, port, attempt) {
  CDP({ host, port, local: true }, (client) => {
    let injectedOnLoad = false;
    // Fallback for older engines: inject into each new page context as it appears.
    client.on('Runtime.executionContextCreated', (m) => {
      if (injectedOnLoad || !m.context || !m.context.origin || m.context.origin.indexOf('youtube.com') === -1) return;
      call(client, 'Runtime.evaluate', { expression: SCRIPT, contextId: m.context.id });
    });
    client.on('disconnect', () => setBusy(false));

    Promise.all([call(client, 'Page.enable'), call(client, 'Runtime.enable')])
      .then(() => call(client, 'Page.setBypassCSP', { enabled: true }))
      .then(() => call(client, 'Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT }))
      .then((res) => {
        if (res && res.identifier) { injectedOnLoad = true; return; }
        return call(client, 'Page.addScriptToEvaluateOnLoad', { scriptSource: SCRIPT })
          .then((r) => { injectedOnLoad = !!(r && r.identifier); });
      })
      .then(() => call(client, 'Page.navigate', { url: YT_URL }));
  }).on('error', () => {
    if (attempt < 50) setTimeout(() => attach(host, port, attempt + 1), 200);
    else setBusy(false);
  });
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const send = (obj) => res.end(JSON.stringify(obj));

  if (req.url === '/state') {
    return tvState()
      .then((s) => send(Object.assign({ busy }, s)))
      .catch((e) => send({ busy, ready: false, infoError: String(e) }));
  }
  if (req.url === '/launch') {
    if (busy) return send({ ok: true });
    setBusy(true);
    send({ ok: true });
    return tvInfo()
      .then((d) => waitForExit(100).then(() => debugLaunch(d.ip || '127.0.0.1')))
      .catch(() => setBusy(false));
  }
  res.statusCode = 404;
  send({ error: 'not found' });
}).listen(PORT, '127.0.0.1');

module.exports = { onStart() {}, onRequest() {}, onExit() {} };

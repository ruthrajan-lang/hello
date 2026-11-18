// Minimal client for the TV's developer connection (sdb, which speaks the adb protocol).
// Supports what the updater needs: pushing a file (sync SEND) and running a shell command.
// Works only when Developer Mode's Host PC IP is 127.0.0.1, since sdbd accepts that host only.
const net = require('net');

const CMD = { CNXN: 0x4e584e43, OPEN: 0x4e45504f, OKAY: 0x59414b4f, WRTE: 0x45545257, CLSE: 0x45534c43 };

function packet(cmd, arg0, arg1, data) {
  data = data || Buffer.alloc(0);
  const h = Buffer.alloc(24);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum = (sum + data[i]) >>> 0;
  h.writeUInt32LE(cmd, 0);
  h.writeUInt32LE(arg0 >>> 0, 4);
  h.writeUInt32LE(arg1 >>> 0, 8);
  h.writeUInt32LE(data.length, 12);
  h.writeUInt32LE(sum, 16);
  h.writeUInt32LE((cmd ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, data]);
}

class Connection {
  constructor(host, port) {
    this.host = host || '127.0.0.1';
    this.port = port || 26101;
    this.maxData = 4096;
    this.nextId = 1;
    this.streams = {};
    this.buf = Buffer.alloc(0);
  }

  connect(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new Error('Developer connection timed out (is Host PC IP 127.0.0.1?)')); }, timeoutMs || 5000);
      this.sock = net.connect(this.port, this.host);
      this.sock.on('error', (e) => { clearTimeout(timer); reject(new Error('Developer connection refused (is Developer Mode on with Host PC IP 127.0.0.1?): ' + e.message)); });
      this.sock.on('data', (d) => this._onData(d));
      this.sock.on('close', () => Object.keys(this.streams).forEach((id) => this.streams[id]._closed()));
      this.sock.on('connect', () => this.sock.write(packet(CMD.CNXN, 0x01000000, 256 * 1024, Buffer.from('host::\0'))));
      this._onConnect = (maxData) => { clearTimeout(timer); this.maxData = Math.min(maxData || 4096, 64 * 1024); resolve(this); };
    });
  }

  close() { try { this.sock.destroy(); } catch (e) {} }

  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 24) {
      const len = this.buf.readUInt32LE(12);
      if (this.buf.length < 24 + len) return;
      const cmd = this.buf.readUInt32LE(0), a0 = this.buf.readUInt32LE(4), a1 = this.buf.readUInt32LE(8);
      const data = this.buf.slice(24, 24 + len);
      this.buf = this.buf.slice(24 + len);
      this._onPacket(cmd, a0, a1, data);
    }
  }

  _onPacket(cmd, a0, a1, data) {
    if (cmd === CMD.CNXN) return this._onConnect && this._onConnect(a1);
    const s = this.streams[a1];
    if (!s) return;
    if (cmd === CMD.OKAY) { s.remoteId = a0; s._okay(); }
    else if (cmd === CMD.WRTE) { this.sock.write(packet(CMD.OKAY, s.localId, s.remoteId)); s._data(data); }
    else if (cmd === CMD.CLSE) { s._closed(); }
  }

  open(service) {
    const s = new Stream(this, this.nextId++);
    this.streams[s.localId] = s;
    this.sock.write(packet(CMD.OPEN, s.localId, 0, Buffer.from(service + '\0')));
    return s.ready.then(() => s);
  }

  // Run a shell command and collect everything it prints until the TV closes the stream.
  shell(command) {
    return this.open('shell:' + command).then((s) => s.readAll()).then((b) => b.toString());
  }

  // Push a file using the sync protocol (SEND, DATA..., DONE).
  push(data, remotePath, mode) {
    return this.open('sync:').then((s) => {
      const spec = Buffer.from(remotePath + ',' + (mode || 0o644));
      const head = Buffer.alloc(8);
      head.write('SEND', 0); head.writeUInt32LE(spec.length, 4);
      let p = s.write(Buffer.concat([head, spec]));
      for (let off = 0; off < data.length; off += 64 * 1024) {
        const chunk = data.slice(off, off + 64 * 1024);
        const h = Buffer.alloc(8);
        h.write('DATA', 0); h.writeUInt32LE(chunk.length, 4);
        p = p.then(() => s.write(Buffer.concat([h, chunk])));
      }
      return p.then(() => {
        const done = Buffer.alloc(8);
        done.write('DONE', 0); done.writeUInt32LE(Math.floor(Date.now() / 1000), 4);
        return s.write(done);
      }).then(() => s.readBytes(8)).then((reply) => {
        const id = reply.toString('ascii', 0, 4);
        if (id === 'OKAY') { const quit = Buffer.alloc(8); quit.write('QUIT', 0); return s.write(quit).then(() => s.close()); }
        return s.readBytes(reply.readUInt32LE(4)).then((msg) => { throw new Error('Copy to TV failed: ' + msg.toString()); });
      });
    });
  }
}

class Stream {
  constructor(conn, localId) {
    this.conn = conn;
    this.localId = localId;
    this.remoteId = 0;
    this.incoming = Buffer.alloc(0);
    this.waiters = [];
    this.closed = false;
    this.ready = new Promise((res, rej) => { this._pendingOkay = { res, rej }; });
  }
  _okay() { const p = this._pendingOkay; this._pendingOkay = null; if (p) p.res(); }
  _data(d) { this.incoming = Buffer.concat([this.incoming, d]); this._wake(); }
  _closed() {
    this.closed = true;
    if (this._pendingOkay) { this._pendingOkay.rej(new Error('TV closed the connection')); this._pendingOkay = null; }
    this._wake();
  }
  _wake() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }

  // Send data in packets no larger than the TV accepts, waiting for each to be acknowledged.
  write(data) {
    let p = Promise.resolve();
    for (let off = 0; off < data.length; off += this.conn.maxData) {
      const chunk = data.slice(off, off + this.conn.maxData);
      p = p.then(() => new Promise((res, rej) => {
        if (this.closed) return rej(new Error('TV closed the connection'));
        this._pendingOkay = { res, rej };
        this.conn.sock.write(packet(CMD.WRTE, this.localId, this.remoteId, chunk));
      }));
    }
    return p;
  }

  readBytes(n) {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.incoming.length >= n) { const out = this.incoming.slice(0, n); this.incoming = this.incoming.slice(n); return resolve(out); }
        if (this.closed) return reject(new Error('TV closed the connection'));
        this.waiters.push(check);
      };
      check();
    });
  }

  readAll() {
    return new Promise((resolve) => {
      const check = () => (this.closed ? resolve(this.incoming) : this.waiters.push(check));
      check();
    });
  }

  close() { if (!this.closed) this.conn.sock.write(packet(CMD.CLSE, this.localId, this.remoteId)); this.closed = true; }
}

module.exports = { Connection };

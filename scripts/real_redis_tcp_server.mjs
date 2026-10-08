// =============================================================================
// ZAMORIN CAFÉ ERP — STANDALONE TCP RESP REDIS PROTOCOL SERVER
// scripts/real_redis_tcp_server.mjs
//
// Provides a real TCP socket server implementing REdis Serialization Protocol (RESP2)
// on loopback (127.0.0.1:port) for multi-process distributed testing without Docker.
// =============================================================================

import net from 'node:net';

export class TcpRedisServer {
  constructor(port = 6390, host = '127.0.0.1') {
    this.port = port;
    this.host = host;
    this.server = null;
    this.sockets = new Set();
    this.kvStore = new Map();       // key -> string
    this.ttlStore = new Map();      // key -> expiresAt (timestamp)
    this.isListening = false;
  }

  _isExpired(key) {
    if (this.ttlStore.has(key)) {
      if (Date.now() >= this.ttlStore.get(key)) {
        this.kvStore.delete(key);
        this.ttlStore.delete(key);
        return true;
      }
    }
    return false;
  }

  _cleanExpired() {
    const now = Date.now();
    for (const [key, exp] of this.ttlStore.entries()) {
      if (now >= exp) {
        this.kvStore.delete(key);
        this.ttlStore.delete(key);
      }
    }
  }

  _parseCommands(buf) {
    const commands = [];
    let offset = 0;

    while (offset < buf.length) {
      // Skip CRLF
      while (offset < buf.length && (buf[offset] === 13 || buf[offset] === 10)) {
        offset++;
      }
      if (offset >= buf.length) break;

      // Inline commands
      if (buf[offset] !== 42) { // not '*'
        const lineEnd = buf.indexOf(Buffer.from('\r\n'), offset);
        if (lineEnd === -1) break;
        const line = buf.slice(offset, lineEnd).toString('utf8').trim();
        if (line) {
          commands.push(line.split(/\s+/));
        }
        offset = lineEnd + 2;
        continue;
      }

      // RESP Multi-Bulk Array: *<count>\r\n$<len>\r\n<arg>\r\n...
      const lineEnd = buf.indexOf(Buffer.from('\r\n'), offset);
      if (lineEnd === -1) break;

      const count = parseInt(buf.slice(offset + 1, lineEnd).toString('utf8'), 10);
      let cur = lineEnd + 2;
      const args = [];
      let ok = true;

      for (let i = 0; i < count; i++) {
        if (cur >= buf.length || buf[cur] !== 36) { // '$'
          ok = false;
          break;
        }
        const lEnd = buf.indexOf(Buffer.from('\r\n'), cur);
        if (lEnd === -1) {
          ok = false;
          break;
        }
        const len = parseInt(buf.slice(cur + 1, lEnd).toString('utf8'), 10);
        cur = lEnd + 2;
        if (cur + len + 2 > buf.length) {
          ok = false;
          break;
        }
        args.push(buf.slice(cur, cur + len).toString('utf8'));
        cur += len + 2;
      }

      if (ok) {
        commands.push(args);
        offset = cur;
      } else {
        break;
      }
    }

    return { commands, remaining: buf.slice(offset) };
  }

  _handleCommand(sock, args) {
    if (!args || args.length === 0) return;
    const cmd = args[0].toUpperCase();

    this._cleanExpired();

    if (cmd === 'PING') {
      sock.write('+PONG\r\n');
    } else if (cmd === 'CLIENT') {
      sock.write('+OK\r\n');
    } else if (cmd === 'QUIT') {
      sock.write('+OK\r\n');
      sock.end();
    } else if (cmd === 'INFO') {
      const info = 'redis_version:7.0.0\r\nrole:master\r\n';
      sock.write('$' + Buffer.byteLength(info) + '\r\n' + info + '\r\n');
    } else if (cmd === 'SET') {
      // SET key value [NX|XX] [PX ms] [EX s]
      const key = args[1];
      const val = args[2];
      let hasNx = false;
      let pxMs = null;

      for (let i = 3; i < args.length; i++) {
        const opt = args[i].toUpperCase();
        if (opt === 'NX') hasNx = true;
        else if (opt === 'PX' && args[i + 1]) {
          pxMs = parseInt(args[i + 1], 10);
          i++;
        } else if (opt === 'EX' && args[i + 1]) {
          pxMs = parseInt(args[i + 1], 10) * 1000;
          i++;
        }
      }

      const isCurrent = this.kvStore.has(key) && !this._isExpired(key);
      if (hasNx && isCurrent) {
        // NX condition failed
        sock.write('$-1\r\n');
        return;
      }

      this.kvStore.set(key, val);
      if (pxMs) {
        this.ttlStore.set(key, Date.now() + pxMs);
      } else {
        this.ttlStore.delete(key);
      }

      sock.write('+OK\r\n');
    } else if (cmd === 'GET') {
      const key = args[1];
      if (this.kvStore.has(key) && !this._isExpired(key)) {
        const val = this.kvStore.get(key);
        sock.write('$' + Buffer.byteLength(val) + '\r\n' + val + '\r\n');
      } else {
        sock.write('$-1\r\n');
      }
    } else if (cmd === 'DEL') {
      let count = 0;
      for (let i = 1; i < args.length; i++) {
        const k = args[i];
        if (this.kvStore.has(k)) {
          this.kvStore.delete(k);
          this.ttlStore.delete(k);
          count++;
        }
      }
      sock.write(':' + count + '\r\n');
    } else if (cmd === 'PEXPIRE') {
      const key = args[1];
      const ms = parseInt(args[2], 10);
      if (this.kvStore.has(key) && !this._isExpired(key)) {
        this.ttlStore.set(key, Date.now() + ms);
        sock.write(':1\r\n');
      } else {
        sock.write(':0\r\n');
      }
    } else if (cmd === 'EVAL') {
      // EVAL script numkeys [keys...] [args...]
      const script = args[1] || '';
      const numKeys = parseInt(args[2], 10) || 0;
      const keys = args.slice(3, 3 + numKeys);
      const evalArgs = args.slice(3 + numKeys);

      const lockKey = keys[0];
      const targetOwnerId = evalArgs[0];

      if (script.includes('del') || script.includes('DEL')) {
        // Safe lock release
        if (this.kvStore.has(lockKey) && !this._isExpired(lockKey)) {
          try {
            const data = JSON.parse(this.kvStore.get(lockKey));
            if (data.ownerId === targetOwnerId) {
              this.kvStore.delete(lockKey);
              this.ttlStore.delete(lockKey);
              sock.write(':1\r\n');
              return;
            }
          } catch (_) {}
        }
        sock.write(':0\r\n');
      } else if (script.includes('pexpire') || script.includes('PEXPIRE')) {
        // Lock lease extension
        const addTtlMs = parseInt(evalArgs[1], 10) || 60000;
        if (this.kvStore.has(lockKey) && !this._isExpired(lockKey)) {
          try {
            const data = JSON.parse(this.kvStore.get(lockKey));
            if (data.ownerId === targetOwnerId) {
              this.ttlStore.set(lockKey, Date.now() + addTtlMs);
              sock.write(':1\r\n');
              return;
            }
          } catch (_) {}
        }
        sock.write(':0\r\n');
      } else {
        sock.write(':1\r\n');
      }
    } else {
      sock.write('+OK\r\n');
    }
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((sock) => {
        this.sockets.add(sock);
        let remainder = Buffer.alloc(0);

        sock.on('data', (chunk) => {
          remainder = Buffer.concat([remainder, chunk]);
          const { commands, remaining } = this._parseCommands(remainder);
          remainder = remaining;

          for (const cmdArgs of commands) {
            this._handleCommand(sock, cmdArgs);
          }
        });

        sock.on('close', () => {
          this.sockets.delete(sock);
        });

        sock.on('error', () => {
          this.sockets.delete(sock);
        });
      });

      this.server.listen(this.port, this.host, () => {
        this.isListening = true;
        resolve();
      });

      this.server.once('error', reject);
    });
  }

  simulateOutage() {
    for (const sock of this.sockets) {
      try {
        sock.destroy();
      } catch (_) {}
    }
    this.sockets.clear();
    if (this.server) {
      this.server.close();
      this.isListening = false;
    }
  }

  async simulateRecovery() {
    return this.start();
  }

  async stop() {
    this.simulateOutage();
  }
}

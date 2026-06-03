// Multiplayer client. Self-contained module with a tiny API:
//   MP.connect({ url, onJoin, onLeave, onState, onChat, onTroll, onAdmin })
//   MP.sendState({ x, z, ry, anim, role })
//   MP.sendTroll(targetId, kind)
//   MP.sendAdmin(op, data)
//   MP.chat(text)
//   MP.peers   // map of id -> peer
//   MP.id      // your id once connected

export const MP = {
  ws: null,
  id: null,
  url: null,
  peers: new Map(),
  cb: {},
  _stateBuf: null,
  _stateTimer: null,
  status: 'idle', // idle | connecting | open | closed | error

  connect(opts) {
    this.cb = opts;
    this.url = opts.url;
    this.status = 'connecting';
    this.room = null;
    try {
      this.ws = new WebSocket(opts.url);
    } catch (e) {
      this.status = 'error';
      opts.onError?.(e);
      return;
    }
    this.ws.addEventListener('open', () => {
      this.status = 'open';
      this.ws.send(JSON.stringify({
        t: 'hello',
        name: opts.name || 'guest',
        role: opts.role || 'george',
        room: opts.room || undefined,
      }));
      opts.onOpen?.();
    });
    this.ws.addEventListener('close', () => {
      this.status = 'closed';
      this.peers.clear();
      opts.onClose?.();
    });
    this.ws.addEventListener('error', (e) => {
      this.status = 'error';
      opts.onError?.(e);
    });
    this.ws.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this._handle(m);
    });

    // Throttled state sender
    this._stateTimer = setInterval(() => {
      if (this.status === 'open' && this._stateBuf) {
        this.ws.send(JSON.stringify({ t: 'state', ...this._stateBuf }));
      }
    }, 100); // 10 Hz
  },

  disconnect() {
    if (this._stateTimer) { clearInterval(this._stateTimer); this._stateTimer = null; }
    try { this.ws?.close(); } catch {}
    this.peers.clear();
    this.status = 'closed';
  },

  sendState(s) {
    this._stateBuf = s;
  },

  sendKidDead(kidId, mode) {
    if (this.status !== 'open') return;
    this.ws.send(JSON.stringify({ t: 'kidDead', id: kidId, mode: mode || 'brisket' }));
  },

  requestRooms(url, cb) {
    // Quick one-shot: open a temp socket, ask for rooms, close.
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'rooms' })));
    ws.addEventListener('message', (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.t === 'rooms') { cb(m.rooms); ws.close(); }
      } catch {}
    });
    ws.addEventListener('error', () => cb(null));
  },

  sendTroll(target, kind) {
    if (this.status !== 'open') return;
    this.ws.send(JSON.stringify({ t: 'troll', target, kind }));
  },

  sendAdmin(op, data) {
    if (this.status !== 'open') return;
    this.ws.send(JSON.stringify({ t: 'admin', op, data }));
  },

  chat(msg) {
    if (this.status !== 'open') return;
    this.ws.send(JSON.stringify({ t: 'chat', msg }));
  },

  _handle(m) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.room = m.room;
        for (const p of m.peers || []) this.peers.set(p.id, p);
        this.cb.onWelcome?.(m);
        break;
      case 'join':
        this.peers.set(m.id, { id: m.id, name: m.name, role: m.role, x: 0, z: 0, ry: 0, anim: 'idle' });
        this.cb.onJoin?.(m);
        break;
      case 'leave':
        this.peers.delete(m.id);
        this.cb.onLeave?.(m);
        break;
      case 'state': {
        const p = this.peers.get(m.id) || {};
        Object.assign(p, m);
        this.peers.set(m.id, p);
        this.cb.onState?.(m);
        break;
      }
      case 'roster':
        // Replace local peer state, but keep ids we already had (avoid flicker)
        for (const p of m.peers || []) {
          const existing = this.peers.get(p.id);
          this.peers.set(p.id, existing ? { ...existing, ...p } : p);
        }
        for (const id of [...this.peers.keys()]) {
          if (!m.peers.find((p) => p.id === id)) this.peers.delete(id);
        }
        this.cb.onRoster?.(m);
        break;
      case 'kidSpawn':
        this.cb.onKidSpawn?.(m.kid);
        break;
      case 'kidDead':
        this.cb.onKidDead?.(m);
        break;
      case 'troll':
        this.cb.onTroll?.(m);
        break;
      case 'admin':
        this.cb.onAdmin?.(m);
        break;
      case 'chat':
        this.cb.onChat?.(m);
        break;
    }
  },
};

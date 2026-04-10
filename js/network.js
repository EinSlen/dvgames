// P2P Multiplayer via PeerJS (WebRTC) - no server needed after signaling

const COLORS = [0xe74c3c,0x2ecc71,0x3498db,0xf1c40f,0x9b59b6,0xe67e22,0x1abc9c,0xfd79a8];

// Lazy-load PeerJS only when needed (not on page load)
let peerLoaded = false;
function loadPeerJS() {
    if (peerLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
        s.onload = () => { peerLoaded = true; resolve(); };
        s.onerror = () => reject('Failed to load PeerJS');
        document.head.appendChild(s);
    });
}

export class Network {
    constructor() {
        this.peer = null;
        this.isHost = false;
        this.roomCode = '';
        this.myName = 'Steve';
        this.myId = '';
        this.myColor = 0xffffff;
        this.seed = 0;
        this.conns = new Map();       // peerId -> DataConnection
        this.players = new Map();     // peerId -> {name, color, x, y, z, yaw, pitch}
        this.blockChanges = [];       // host tracks all changes for new joiners

        // Callbacks (set by main.js)
        this.onPlayerJoin = null;
        this.onPlayerLeave = null;
        this.onPlayerMove = null;
        this.onRemoteBlock = null;
        this.onReady = null;
        this.onError = null;
    }

    _code() {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < 5; i++) s += c[(Math.random() * c.length) | 0];
        return s;
    }

    // ── Host ──
    async host(name) {
        this.isHost = true;
        this.myName = name || 'Host';
        this.seed = (Math.random() * 999999) | 0;
        this.roomCode = this._code();

        await loadPeerJS();
        return new Promise((resolve, reject) => {
            this.peer = new Peer('mc3d-' + this.roomCode, { debug: 0 });

            this.peer.on('open', () => {
                this.myId = this.peer.id;
                this.peer.on('connection', (conn) => this._onHostConn(conn));
                resolve(this.roomCode);
            });

            this.peer.on('error', (e) => {
                if (e.type === 'unavailable-id') {
                    this.peer.destroy();
                    this.roomCode = this._code();
                    this.peer = new Peer('mc3d-' + this.roomCode, { debug: 0 });
                    this.peer.on('open', () => {
                        this.myId = this.peer.id;
                        this.peer.on('connection', (conn) => this._onHostConn(conn));
                        resolve(this.roomCode);
                    });
                } else {
                    reject(e.message || 'Connection error');
                }
            });
        });
    }

    _onHostConn(conn) {
        conn.on('open', () => {
            conn.on('data', (raw) => {
                const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (d.t === 'join') {
                    const color = COLORS[this.conns.size % COLORS.length];
                    this.conns.set(conn.peer, conn);
                    this.players.set(conn.peer, { name: d.name, color, x:0, y:80, z:0, yaw:0, pitch:0 });

                    // Send welcome
                    const pList = [];
                    for (const [id, p] of this.players) {
                        if (id !== conn.peer) pList.push({ id, name: p.name, color: p.color });
                    }
                    this._send(conn, { t:'welcome', seed: this.seed, color, changes: this.blockChanges, players: pList, hostName: this.myName });

                    // Tell others
                    this._broadcast({ t:'pjoin', id: conn.peer, name: d.name, color }, conn.peer);
                    if (this.onPlayerJoin) this.onPlayerJoin(conn.peer, d.name, color);
                } else {
                    this._onMsg(conn.peer, d);
                }
            });
            conn.on('close', () => this._removePlayer(conn.peer));
            conn.on('error', () => this._removePlayer(conn.peer));
        });
    }

    _removePlayer(id) {
        this.conns.delete(id);
        this.players.delete(id);
        this._broadcast({ t:'pleave', id });
        if (this.onPlayerLeave) this.onPlayerLeave(id);
    }

    // ── Client ──
    async join(code, name) {
        this.isHost = false;
        this.myName = name || 'Player';
        this.roomCode = code.toUpperCase().trim();

        await loadPeerJS();
        return new Promise((resolve, reject) => {
            this.peer = new Peer(undefined, { debug: 0 });

            this.peer.on('open', () => {
                this.myId = this.peer.id;
                const conn = this.peer.connect('mc3d-' + this.roomCode, { reliable: true });

                const timeout = setTimeout(() => reject('Timeout - code invalide ?'), 8000);

                conn.on('open', () => {
                    this.conns.set('host', conn);
                    this._send(conn, { t:'join', name: this.myName });

                    conn.on('data', (raw) => {
                        const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        if (d.t === 'welcome') {
                            clearTimeout(timeout);
                            this.seed = d.seed;
                            this.myColor = d.color;
                            this.players.set('host', { name: d.hostName, color: 0xffffff, x:0, y:80, z:0, yaw:0, pitch:0 });
                            if (this.onPlayerJoin) this.onPlayerJoin('host', d.hostName, 0xffffff);
                            for (const p of (d.players || [])) {
                                this.players.set(p.id, { name: p.name, color: p.color, x:0, y:80, z:0, yaw:0, pitch:0 });
                                if (this.onPlayerJoin) this.onPlayerJoin(p.id, p.name, p.color);
                            }
                            resolve({ seed: d.seed, changes: d.changes || [] });
                        } else {
                            this._onMsg('host', d);
                        }
                    });
                    conn.on('close', () => { if (this.onPlayerLeave) this.onPlayerLeave('host'); });
                });
                conn.on('error', (e) => { clearTimeout(timeout); reject(e.message || 'Connection failed'); });
            });

            this.peer.on('error', (e) => reject(e.message || 'PeerJS error'));
        });
    }

    // ── Message handling ──
    _onMsg(from, d) {
        switch (d.t) {
            case 'pos':
                const id = d.id || from;
                if (this.onPlayerMove) this.onPlayerMove(id, d.x, d.y, d.z, d.yaw, d.pitch);
                if (this.isHost) this._broadcast({ ...d, id: from }, from);
                break;
            case 'block':
                if (this.onRemoteBlock) this.onRemoteBlock(d.x, d.y, d.z, d.bt);
                if (this.isHost) {
                    this.blockChanges.push({ x:d.x, y:d.y, z:d.z, bt:d.bt });
                    this._broadcast(d, from);
                }
                break;
            case 'pjoin':
                this.players.set(d.id, { name:d.name, color:d.color, x:0, y:80, z:0, yaw:0, pitch:0 });
                if (this.onPlayerJoin) this.onPlayerJoin(d.id, d.name, d.color);
                break;
            case 'pleave':
                this.players.delete(d.id);
                if (this.onPlayerLeave) this.onPlayerLeave(d.id);
                break;
        }
    }

    _send(conn, obj) { try { conn.send(JSON.stringify(obj)); } catch(e) {} }

    _broadcast(obj, exclude) {
        const msg = JSON.stringify(obj);
        for (const [id, conn] of this.conns) {
            if (id !== exclude && conn.open) try { conn.send(msg); } catch(e) {}
        }
    }

    // ── Public API ──
    sendPos(x, y, z, yaw, pitch) {
        const d = { t:'pos', x:+x.toFixed(2), y:+y.toFixed(2), z:+z.toFixed(2), yaw:+yaw.toFixed(3), pitch:+pitch.toFixed(3) };
        if (this.isHost) this._broadcast(d);
        else { const c = this.conns.get('host'); if (c && c.open) this._send(c, d); }
    }

    sendBlock(x, y, z, bt) {
        const d = { t:'block', x, y, z, bt };
        if (this.isHost) { this.blockChanges.push({ x, y, z, bt }); this._broadcast(d); }
        else { const c = this.conns.get('host'); if (c && c.open) this._send(c, d); }
    }

    destroy() { if (this.peer) this.peer.destroy(); }
}

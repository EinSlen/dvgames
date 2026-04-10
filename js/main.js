import * as THREE from 'three';
import { createTextureAtlas } from './textures.js';
import { World, CHUNK_SIZE } from './world.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { Network } from './network.js';

class RemotePlayer {
    constructor(scene, name, color) {
        this.name = name;
        this.tx = 0; this.ty = 80; this.tz = 0; this.tyaw = 0;
        const mat = new THREE.MeshLambertMaterial({ color });
        this.group = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.4), mat);
        body.position.y = 0.6;
        this.group.add(body);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
        head.position.y = 1.45;
        this.group.add(head);
        const c = document.createElement('canvas');
        c.width = 256; c.height = 64;
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(name, 128, 42);
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
        tag.position.y = 2.1; tag.scale.set(1.5, 0.4, 1);
        this.group.add(tag);
        scene.add(this.group);
        this.scene = scene;
    }
    update(x, y, z, yaw) { this.tx = x; this.ty = y; this.tz = z; this.tyaw = yaw; }
    interpolate() {
        const g = this.group.position;
        g.x += (this.tx - g.x) * 0.25; g.y += (this.ty - g.y) * 0.25; g.z += (this.tz - g.z) * 0.25;
        this.group.rotation.y += (this.tyaw - this.group.rotation.y) * 0.25;
    }
    dispose() { this.scene.remove(this.group); }
}

class Game {
    constructor() {
        this.clock = new THREE.Clock();
        this.fps = 0; this.frameCount = 0; this.fpsTimer = 0;
        this.network = null;
        this.remotePlayers = new Map();
        this.posTimer = 0;
        this.started = false;

        this._initRenderer();
        this._initScene();
        this._initMaterials();
        this._initUI();
        this._initHighlight();
        this.animate = this.animate.bind(this);
    }

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x87CEEB);
        document.getElementById('game').appendChild(this.renderer.domElement);
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x87CEEB, 60, 110);
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const sun = new THREE.DirectionalLight(0xffffff, 0.8);
        sun.position.set(50, 100, 30);
        this.scene.add(sun);
    }

    _initMaterials() {
        const atlas = createTextureAtlas();
        this.material = new THREE.MeshLambertMaterial({ map: atlas, side: THREE.FrontSide });
        this.waterMaterial = new THREE.MeshLambertMaterial({ map: atlas, side: THREE.FrontSide, transparent: true, opacity: 0.7 });
    }

    _initUI() {
        this.ui = new UI();
        document.addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); this.ui.toggleDebug(); } });
        this.ui.onSolo(() => { if (!this.started) this._startGame(12345); });
        this.ui.onHost(() => { if (!this.started) this._hostGame(); });
        this.ui.onJoin(() => { if (!this.started) this._joinGame(); });
    }

    _initHighlight() {
        const geo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
        this.highlight = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }));
        this.highlight.visible = false;
        this.scene.add(this.highlight);
    }

    _startGame(seed, blockChanges) {
        if (this.started) return;
        this.world = new World(this.scene, this.material, this.waterMaterial, seed);
        if (this.network) this.world.onBlockChange = (x, y, z, t) => this.network.sendBlock(x, y, z, t);
        if (blockChanges) for (const c of blockChanges) this.world.setBlock(c.x, c.y, c.z, c.bt, true);

        this.player = new Player(this.camera, this.world);
        this.player.spawn();
        const scx = Math.floor(this.player.position.x / CHUNK_SIZE);
        const scz = Math.floor(this.player.position.z / CHUNK_SIZE);
        for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
                this.world.forceLoad(scx + dx, scz + dz);

        this._initPointerLock();
        this.ui.hideStartScreen();
        this.started = true;
        try {
            const r = this.renderer.domElement.requestPointerLock();
            if (r && r.catch) r.catch(() => this.ui.showPauseScreen());
        } catch (e) { this.ui.showPauseScreen(); }
        setTimeout(() => { if (this.started && !document.pointerLockElement) this.ui.showPauseScreen(); }, 200);
        requestAnimationFrame(this.animate);
    }

    async _hostGame() {
        this.ui.setStatus('Connexion...');
        this.network = new Network();
        this._wireNetwork();
        try {
            const code = await this.network.host(this.ui.getPlayerName());
            this.ui.setStatus(''); this.ui.showRoomCode(code);
            this._startGame(this.network.seed);
        } catch (e) { this.ui.setStatus('Erreur: ' + e); }
    }

    async _joinGame() {
        const code = this.ui.getRoomCode();
        if (!code || code.length < 3) { this.ui.setStatus('Entre un code valide'); return; }
        this.ui.setStatus('Connexion a ' + code + '...');
        this.network = new Network();
        this._wireNetwork();
        try {
            const { seed, changes } = await this.network.join(code, this.ui.getPlayerName());
            this.ui.setStatus(''); this.ui.showRoomCode(code);
            this._startGame(seed, changes);
        } catch (e) { this.ui.setStatus('Erreur: ' + e); this.network = null; }
    }

    _wireNetwork() {
        this.network.onPlayerJoin = (id, n, c) => this.remotePlayers.set(id, new RemotePlayer(this.scene, n, c));
        this.network.onPlayerLeave = (id) => { const r = this.remotePlayers.get(id); if (r) { r.dispose(); this.remotePlayers.delete(id); } };
        this.network.onPlayerMove = (id, x, y, z, yaw) => { const r = this.remotePlayers.get(id); if (r) r.update(x, y, z, yaw); };
        this.network.onRemoteBlock = (x, y, z, bt) => { if (this.world) this.world.setBlock(x, y, z, bt, true); };
    }

    _initPointerLock() {
        if (this._plReady) return;
        this._plReady = true;
        const canvas = this.renderer.domElement;
        document.addEventListener('click', () => { if (this.started && !document.pointerLockElement) canvas.requestPointerLock(); });
        document.addEventListener('pointerlockchange', () => {
            if (!this.started) return;
            this.player.locked = document.pointerLockElement === canvas;
            if (this.player.locked) this.ui.hideStartScreen();
            else this.ui.showPauseScreen();
        });
    }

    animate() {
        requestAnimationFrame(this.animate);
        const dt = this.clock.getDelta();
        this.frameCount++; this.fpsTimer += dt;
        if (this.fpsTimer >= 0.5) { this.fps = (this.frameCount / this.fpsTimer + 0.5) | 0; this.frameCount = 0; this.fpsTimer = 0; }

        this.player.update(dt);
        this.world.update(this.player.position.x, this.player.position.z);
        for (const rp of this.remotePlayers.values()) rp.interpolate();

        if (this.network) { this.posTimer += dt; if (this.posTimer >= 0.1) { this.posTimer = 0; const p = this.player; this.network.sendPos(p.position.x, p.position.y, p.position.z, p.yaw, p.pitch); } }

        const sb = this.player.selectedBlock;
        if (sb && this.player.locked) { this.highlight.position.set(sb.x + 0.5, sb.y + 0.5, sb.z + 0.5); this.highlight.visible = true; }
        else this.highlight.visible = false;

        this.ui.updateHotbar(this.player.hotbar, this.player.selectedSlot);
        this.renderer.render(this.scene, this.camera);
        this.ui.updateDebug(this.fps, this.player, sb, this.world.chunks.size);
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });

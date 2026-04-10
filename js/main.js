import * as THREE from 'three';
import { createTextureAtlas } from './textures.js';
import { World, CHUNK_SIZE } from './world.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { Network } from './network.js';

// ── Remote player 3D model ──
class RemotePlayer {
    constructor(scene, name, color) {
        this.name = name;
        this.targetX = 0; this.targetY = 80; this.targetZ = 0; this.targetYaw = 0;

        const mat = new THREE.MeshLambertMaterial({ color });
        this.group = new THREE.Group();

        // Body
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.4), mat);
        body.position.y = 0.6;
        this.group.add(body);

        // Head
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
        head.position.y = 1.45;
        this.group.add(head);

        // Name tag
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(name, 128, 42);
        const tex = new THREE.CanvasTexture(canvas);
        const tagMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const tag = new THREE.Sprite(tagMat);
        tag.position.y = 2.1;
        tag.scale.set(1.5, 0.4, 1);
        this.group.add(tag);

        scene.add(this.group);
        this.scene = scene;
    }

    update(x, y, z, yaw) {
        this.targetX = x; this.targetY = y; this.targetZ = z; this.targetYaw = yaw;
    }

    interpolate() {
        const g = this.group.position;
        g.x += (this.targetX - g.x) * 0.25;
        g.y += (this.targetY - g.y) * 0.25;
        g.z += (this.targetZ - g.z) * 0.25;
        this.group.rotation.y += (this.targetYaw - this.group.rotation.y) * 0.25;
    }

    dispose() {
        this.scene.remove(this.group);
        this.group.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } });
    }
}

// ── Game ──
class Game {
    constructor() {
        this.clock = new THREE.Clock();
        this.fps = 0; this.frameCount = 0; this.fpsTimer = 0;
        this.network = null;
        this.remotePlayers = new Map(); // peerId -> RemotePlayer
        this.posTimer = 0;

        this._initRenderer();
        this._initScene();
        this._initMaterials();
        this._initUI();
        this._initHighlight();

        this.animate = this.animate.bind(this);
    }

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

        this.ui.onSolo(() => this._startGame(12345));
        this.ui.onHost(() => this._hostGame());
        this.ui.onJoin(() => this._joinGame());
    }

    _initHighlight() {
        const geo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
        this.highlight = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }));
        this.highlight.visible = false;
        this.scene.add(this.highlight);
    }

    // ── Game start modes ──

    _startGame(seed, blockChanges) {
        this.world = new World(this.scene, this.material, this.waterMaterial, seed);

        if (this.network) {
            this.world.onBlockChange = (x, y, z, type) => this.network.sendBlock(x, y, z, type);
        }

        if (blockChanges) {
            for (const c of blockChanges) this.world.setBlock(c.x, c.y, c.z, c.bt, true);
        }

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

        // Pointer lock will be requested by the document click handler
        // (the button click event bubbles up to document)
        requestAnimationFrame(this.animate);
    }

    async _hostGame() {
        const name = this.ui.getPlayerName();
        this.ui.setStatus('Connexion...');
        this.network = new Network();
        this._wireNetwork();

        try {
            const code = await this.network.host(name);
            this.ui.setStatus('');
            this.ui.showRoomCode(code);
            this._startGame(this.network.seed);
        } catch (e) {
            this.ui.setStatus('Erreur: ' + e);
        }
    }

    async _joinGame() {
        const name = this.ui.getPlayerName();
        const code = this.ui.getRoomCode();
        if (!code || code.length < 3) { this.ui.setStatus('Entre un code valide'); return; }

        this.ui.setStatus('Connexion a ' + code + '...');
        this.network = new Network();
        this._wireNetwork();

        try {
            const { seed, changes } = await this.network.join(code, name);
            this.ui.setStatus('');
            this.ui.showRoomCode(code);
            this._startGame(seed, changes);
        } catch (e) {
            this.ui.setStatus('Erreur: ' + e);
            this.network = null;
        }
    }

    _wireNetwork() {
        const net = this.network;

        net.onPlayerJoin = (id, name, color) => {
            const rp = new RemotePlayer(this.scene, name, color);
            this.remotePlayers.set(id, rp);
        };

        net.onPlayerLeave = (id) => {
            const rp = this.remotePlayers.get(id);
            if (rp) { rp.dispose(); this.remotePlayers.delete(id); }
        };

        net.onPlayerMove = (id, x, y, z, yaw, pitch) => {
            const rp = this.remotePlayers.get(id);
            if (rp) rp.update(x, y, z, yaw);
        };

        net.onRemoteBlock = (x, y, z, bt) => {
            if (this.world) this.world.setBlock(x, y, z, bt, true);
        };
    }

    _initPointerLock() {
        if (this._pointerLockReady) return; // only bind once
        this._pointerLockReady = true;
        const canvas = this.renderer.domElement;

        document.addEventListener('click', () => {
            if (this.started && !document.pointerLockElement) canvas.requestPointerLock();
        });

        document.addEventListener('pointerlockchange', () => {
            if (!this.started) return;
            this.player.locked = document.pointerLockElement === canvas;
            if (this.player.locked) this.ui.hideStartScreen();
            else {
                // Show a minimal "paused" overlay, not the full menu
                this.ui.showPauseScreen();
            }
        });
    }

    // ── Game loop ──
    animate() {
        requestAnimationFrame(this.animate);
        const dt = this.clock.getDelta();

        // FPS
        this.frameCount++;
        this.fpsTimer += dt;
        if (this.fpsTimer >= 0.5) { this.fps = (this.frameCount / this.fpsTimer + 0.5) | 0; this.frameCount = 0; this.fpsTimer = 0; }

        this.player.update(dt);
        this.world.update(this.player.position.x, this.player.position.z);

        // Interpolate remote players
        for (const rp of this.remotePlayers.values()) rp.interpolate();

        // Send position over network (10 Hz)
        if (this.network) {
            this.posTimer += dt;
            if (this.posTimer >= 0.1) {
                this.posTimer = 0;
                const p = this.player;
                this.network.sendPos(p.position.x, p.position.y, p.position.z, p.yaw, p.pitch);
            }
        }

        // Block highlight
        const sb = this.player.selectedBlock;
        if (sb && this.player.locked) {
            this.highlight.position.set(sb.x + 0.5, sb.y + 0.5, sb.z + 0.5);
            this.highlight.visible = true;
        } else {
            this.highlight.visible = false;
        }

        this.ui.updateHotbar(this.player.hotbar, this.player.selectedSlot);
        this.ui.updateDebug(this.fps, this.player, sb, this.world.chunks.size);
        this.renderer.render(this.scene, this.camera);
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });

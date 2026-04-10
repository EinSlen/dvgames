import * as THREE from 'three';
import { createTextureAtlas, getBlockIconURL, blockFaces, createCrackTextures, BlockType } from './textures.js';
import { World, CHUNK_SIZE } from './world.js';
import { Player } from './player.js';
import { UI } from './ui.js';
// Network loaded lazily only for multiplayer

const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;

class RemotePlayer {
    constructor(scene, name, color) {
        this.name = name;
        this.tx = 0; this.ty = 80; this.tz = 0; this.tyaw = 0;
        this._prevX = 0; this._prevZ = 0;
        this._walkPhase = 0;
        this._isWalking = false;

        const mat = new THREE.MeshLambertMaterial({ color });
        const matDark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.7) });

        this.group = new THREE.Group();

        // Head (0.5 x 0.5 x 0.5)
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
        head.position.y = 1.45;
        this.group.add(head);

        // Body (0.5 x 0.75 x 0.25)
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.25), mat);
        body.position.y = 0.825;
        this.group.add(body);

        // Right arm pivot at shoulder
        this.rightArmPivot = new THREE.Group();
        this.rightArmPivot.position.set(-0.375, 1.2, 0);
        const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), matDark);
        rightArm.position.y = -0.375;
        this.rightArmPivot.add(rightArm);
        this.group.add(this.rightArmPivot);

        // Left arm pivot at shoulder
        this.leftArmPivot = new THREE.Group();
        this.leftArmPivot.position.set(0.375, 1.2, 0);
        const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), matDark);
        leftArm.position.y = -0.375;
        this.leftArmPivot.add(leftArm);
        this.group.add(this.leftArmPivot);

        // Right leg pivot at hip
        this.rightLegPivot = new THREE.Group();
        this.rightLegPivot.position.set(-0.125, 0.45, 0);
        const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), matDark);
        rightLeg.position.y = -0.375;
        this.rightLegPivot.add(rightLeg);
        this.group.add(this.rightLegPivot);

        // Left leg pivot at hip
        this.leftLegPivot = new THREE.Group();
        this.leftLegPivot.position.set(0.125, 0.45, 0);
        const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), matDark);
        leftLeg.position.y = -0.375;
        this.leftLegPivot.add(leftLeg);
        this.group.add(this.leftLegPivot);

        // Nametag
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

    interpolate(dt) {
        const g = this.group.position;
        const dx = this.tx - g.x;
        const dz = this.tz - g.z;
        g.x += dx * 0.25;
        g.y += (this.ty - g.y) * 0.25;
        g.z += dz * 0.25;
        this.group.rotation.y += (this.tyaw - this.group.rotation.y) * 0.25;

        // Detect movement for walk animation
        const speed = Math.sqrt(dx * dx + dz * dz);
        this._isWalking = speed > 0.01;

        if (this._isWalking) {
            this._walkPhase += (dt || 0.016) * 8;
            const swing = Math.sin(this._walkPhase) * 0.6;
            this.rightArmPivot.rotation.x = swing;
            this.leftArmPivot.rotation.x = -swing;
            this.rightLegPivot.rotation.x = -swing;
            this.leftLegPivot.rotation.x = swing;
        } else {
            // Return to idle
            this.rightArmPivot.rotation.x *= 0.85;
            this.leftArmPivot.rotation.x *= 0.85;
            this.rightLegPivot.rotation.x *= 0.85;
            this.leftLegPivot.rotation.x *= 0.85;
            this._walkPhase = 0;
        }
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
        this.renderer.autoClear = false;
        document.getElementById('game').appendChild(this.renderer.domElement);
        window.addEventListener('resize', () => {
            const w = window.innerWidth, h = window.innerHeight;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            if (this.vmCamera) {
                this.vmCamera.aspect = w / h;
                this.vmCamera.updateProjectionMatrix();
            }
            this.renderer.setSize(w, h);
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
        this.atlas = atlas;
        this.material = new THREE.MeshLambertMaterial({ map: atlas, side: THREE.FrontSide });
        this.waterMaterial = new THREE.MeshLambertMaterial({ map: atlas, side: THREE.FrontSide, transparent: true, opacity: 0.7 });

        // Generate block icons for hotbar
        this._blockIconURLs = {};
        for (const key of Object.keys(BlockType)) {
            const bt = BlockType[key];
            if (bt === BlockType.AIR) continue;
            const url = getBlockIconURL(bt);
            if (url) this._blockIconURLs[bt] = url;
        }

        // Crack textures for progressive breaking
        this.crackTextures = createCrackTextures();
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

    _initCrackOverlay() {
        const geo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
        this.crackMaterial = new THREE.MeshBasicMaterial({
            map: this.crackTextures[0],
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        });
        this.crackMesh = new THREE.Mesh(geo, this.crackMaterial);
        this.crackMesh.visible = false;
        this.scene.add(this.crackMesh);
    }

    _initViewmodel() {
        // Viewmodel scene (no fog)
        this.vmScene = new THREE.Scene();
        this.vmCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 2);

        // Lighting for viewmodel
        this.vmScene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const vmSun = new THREE.DirectionalLight(0xffffff, 0.8);
        vmSun.position.set(1, 2, 1);
        this.vmScene.add(vmSun);

        const skinMat = new THREE.MeshBasicMaterial({ color: 0xc8a882 });

        this.vmArmGroup = new THREE.Group();
        this.vmArmGroup.position.set(0.35, -0.45, -0.55);
        this.vmArmGroup.rotation.set(-0.5, -0.3, 0.1);

        // Arm
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), skinMat);
        arm.position.set(0, 0.05, 0);
        this.vmArmGroup.add(arm);

        // Hand
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.12), skinMat);
        hand.position.set(0, -0.17, 0.02);
        this.vmArmGroup.add(hand);

        // Held block — on top of hand
        const heldMat = new THREE.MeshBasicMaterial({ map: this.atlas, side: THREE.DoubleSide });
        this.heldBlockMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), heldMat);
        this.heldBlockMesh.position.set(0, 0.32, -0.04);
        this.heldBlockMesh.rotation.set(0.2, 0.5, 0);
        this.vmArmGroup.add(this.heldBlockMesh);

        this.vmScene.add(this.vmArmGroup);

        this.vmScene.add(this.vmArmGroup);

        // Animation state
        this._swingTime = -1;
        this._swingDuration = 0.25;
        this._idleTime = 0;
        this._lastSelectedSlot = -1;

        // Set initial held block UVs
        this._updateHeldBlockUVs(1); // default to GRASS
    }

    _updateHeldBlockUVs(blockType) {
        const faces = blockFaces[blockType];
        if (!faces) {
            this.heldBlockMesh.visible = false;
            return;
        }
        this.heldBlockMesh.visible = true;
        const geo = this.heldBlockMesh.geometry;
        const uv = geo.attributes.uv;

        // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
        // Map: +X=side, -X=side, +Y=top, -Y=bottom, +Z=side, -Z=side
        const faceTexMap = [
            faces[2], // +X = side
            faces[2], // -X = side
            faces[0], // +Y = top
            faces[1], // -Y = bottom
            faces[2], // +Z = side
            faces[2], // -Z = side
        ];

        for (let f = 0; f < 6; f++) {
            const texIdx = faceTexMap[f];
            const col = texIdx % ATLAS_COLS;
            const row = Math.floor(texIdx / ATLAS_COLS);
            const u0 = col / ATLAS_COLS;
            const v0 = 1 - (row + 1) / ATLAS_ROWS;
            const u1 = (col + 1) / ATLAS_COLS;
            const v1 = 1 - row / ATLAS_ROWS;

            const base = f * 4;
            uv.setXY(base, u0, v1);
            uv.setXY(base + 1, u1, v1);
            uv.setXY(base + 2, u0, v0);
            uv.setXY(base + 3, u1, v0);
        }
        uv.needsUpdate = true;
    }

    _updateViewmodel(dt) {
        if (!this.vmArmGroup || !this.player) return;

        // Update held block when slot changes
        const slot = this.player.selectedSlot;
        if (slot !== this._lastSelectedSlot) {
            this._lastSelectedSlot = slot;
            this._updateHeldBlockUVs(this.player.hotbar[slot]);
        }

        // Swing animation
        if (this.player.didSwing && this._swingTime < 0) {
            this._swingTime = 0;
        }

        if (this._swingTime >= 0) {
            this._swingTime += dt;
            const progress = this._swingTime / this._swingDuration;
            if (progress >= 1) {
                this._swingTime = -1;
                this.vmArmGroup.rotation.x = 0;
            } else {
                this.vmArmGroup.rotation.x = Math.sin(progress * Math.PI) * 0.5;
            }
        } else {
            this._idleTime += dt;
            this.vmArmGroup.position.y = -0.45 + Math.sin(this._idleTime * 1.5) * 0.005;
        }
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

        // Initialize viewmodel and crack overlay
        this._initViewmodel();
        this._initCrackOverlay();

        // Set block icons in UI
        this.ui.setBlockIcons(this._blockIconURLs);

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
        this.ui.setStatus('Chargement...');
        const { Network } = await import('./network.js');
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
        this.ui.setStatus('Chargement...');
        const { Network } = await import('./network.js');
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
        for (const rp of this.remotePlayers.values()) rp.interpolate(dt);

        if (this.network) { this.posTimer += dt; if (this.posTimer >= 0.1) { this.posTimer = 0; const p = this.player; this.network.sendPos(p.position.x, p.position.y, p.position.z, p.yaw, p.pitch); } }

        const sb = this.player.selectedBlock;
        if (sb && this.player.locked) { this.highlight.position.set(sb.x + 0.5, sb.y + 0.5, sb.z + 0.5); this.highlight.visible = true; }
        else this.highlight.visible = false;

        // Crack overlay
        if (this.player.breakStage >= 0 && this.player.breakingBlock) {
            const bb = this.player.breakingBlock;
            this.crackMesh.position.set(bb.x + 0.5, bb.y + 0.5, bb.z + 0.5);
            this.crackMaterial.map = this.crackTextures[this.player.breakStage];
            this.crackMaterial.needsUpdate = true;
            this.crackMesh.visible = true;
        } else {
            this.crackMesh.visible = false;
        }

        this._updateViewmodel(dt);

        this.ui.updateHotbar(this.player.hotbar, this.player.selectedSlot);

        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        this.renderer.clearDepth();
        this.renderer.render(this.vmScene, this.vmCamera);

        this.ui.updateDebug(this.fps, this.player, sb, this.world.chunks.size);
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });

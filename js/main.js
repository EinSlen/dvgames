import * as THREE from 'three';
import { createTextureAtlas } from './textures.js';
import { World, CHUNK_SIZE } from './world.js';
import { Player } from './player.js';
import { UI } from './ui.js';

class Game {
    constructor() {
        this.clock = new THREE.Clock();
        this.fps = 0;
        this.frameCount = 0;
        this.fpsTimer = 0;

        this._initRenderer();
        this._initScene();
        this._initMaterials();
        this._initWorld();
        this._initPlayer();
        this._initUI();
        this._initPointerLock();
        this._initHighlight();

        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
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

        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        const sun = new THREE.DirectionalLight(0xffffff, 0.8);
        sun.position.set(50, 100, 30);
        this.scene.add(sun);
    }

    _initMaterials() {
        const atlas = createTextureAtlas();
        this.material = new THREE.MeshLambertMaterial({ map: atlas, side: THREE.FrontSide });
        this.waterMaterial = new THREE.MeshLambertMaterial({ map: atlas, side: THREE.FrontSide, transparent: true, opacity: 0.7 });
    }

    _initWorld() {
        this.world = new World(this.scene, this.material, this.waterMaterial);
    }

    _initPlayer() {
        this.player = new Player(this.camera, this.world);
        this.player.spawn();

        // Force-load chunks around spawn so player doesn't fall through
        const scx = Math.floor(this.player.position.x / CHUNK_SIZE);
        const scz = Math.floor(this.player.position.z / CHUNK_SIZE);
        for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
                this.world.forceLoad(scx + dx, scz + dz);
    }

    _initUI() {
        this.ui = new UI();
        document.addEventListener('keydown', (e) => {
            if (e.code === 'F3') { e.preventDefault(); this.ui.toggleDebug(); }
        });
    }

    _initPointerLock() {
        const canvas = this.renderer.domElement;
        document.addEventListener('click', () => {
            if (!document.pointerLockElement) canvas.requestPointerLock();
        });
        document.addEventListener('pointerlockchange', () => {
            this.player.locked = document.pointerLockElement === canvas;
            if (this.player.locked) this.ui.hideStartScreen();
            else this.ui.showStartScreen();
        });
    }

    _initHighlight() {
        const geo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
        const edges = new THREE.EdgesGeometry(geo);
        this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }));
        this.highlight.visible = false;
        this.scene.add(this.highlight);
    }

    animate() {
        requestAnimationFrame(this.animate);
        const dt = this.clock.getDelta();

        // FPS
        this.frameCount++;
        this.fpsTimer += dt;
        if (this.fpsTimer >= 0.5) {
            this.fps = (this.frameCount / this.fpsTimer + 0.5) | 0;
            this.frameCount = 0;
            this.fpsTimer = 0;
        }

        this.player.update(dt);
        this.world.update(this.player.position.x, this.player.position.z);

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

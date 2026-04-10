import * as THREE from 'three';
import { BlockType, BlockProps } from './textures.js';
import { CHUNK_HEIGHT, SEA_LEVEL } from './world.js';

const GRAVITY = -25;
const JUMP_VEL = 9;
const MOVE_SPEED = 5.5;
const SPRINT_SPEED = 8;
const FLY_SPEED = 15;
const P_HEIGHT = 1.7;
const P_WIDTH = 0.6;
const P_EYE = 1.55;
const SENS = 0.002;
const HW = P_WIDTH / 2;

export class Player {
    constructor(camera, world) {
        this.camera = camera;
        this.world = world;
        this.position = new THREE.Vector3(0, 80, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.pitch = 0;
        this.yaw = 0;
        this.onGround = false;
        this.flying = false;
        this.sprinting = false;
        this.keys = {};
        this.mouseDown = { left: false, right: false };
        this.locked = false;
        this.selectedBlock = null;
        this.breakCooldown = 0;
        this.placeCooldown = 0;
        this.hotbar = [1, 2, 3, 12, 13, 6, 7, 4, 14]; // block type IDs
        this.selectedSlot = 0;

        // Cached vectors (avoid per-frame allocation)
        this._lookDir = new THREE.Vector3();
        this._sinYaw = 0; this._cosYaw = 0;
        this._sinPitch = 0; this._cosPitch = 0;

        this._setupControls();
    }

    _setupControls() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code >= 'Digit1' && e.code <= 'Digit9')
                this.selectedSlot = parseInt(e.code[5]) - 1;
            if (e.code === 'KeyF') { this.flying = !this.flying; this.velocity.y = 0; }
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprinting = true;
        });
        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprinting = false;
        });
        document.addEventListener('mousemove', (e) => {
            if (!this.locked) return;
            this.yaw -= e.movementX * SENS;
            this.pitch -= e.movementY * SENS;
            if (this.pitch > 1.5607) this.pitch = 1.5607;
            if (this.pitch < -1.5607) this.pitch = -1.5607;
        });
        document.addEventListener('mousedown', (e) => {
            if (!this.locked) return;
            if (e.button === 0) this.mouseDown.left = true;
            if (e.button === 2) this.mouseDown.right = true;
        });
        document.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.mouseDown.left = false;
            if (e.button === 2) this.mouseDown.right = false;
        });
        document.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('wheel', (e) => {
            if (!this.locked) return;
            this.selectedSlot = e.deltaY > 0 ? (this.selectedSlot + 1) % 9 : (this.selectedSlot + 8) % 9;
        });
    }

    update(dt) {
        dt = Math.min(dt, 0.1);

        // Pre-compute trig (used by movement, camera, and raycast)
        this._sinYaw = Math.sin(this.yaw);
        this._cosYaw = Math.cos(this.yaw);
        this._sinPitch = Math.sin(this.pitch);
        this._cosPitch = Math.cos(this.pitch);

        // Look direction (shared between camera and raycast)
        this._lookDir.set(
            -this._sinYaw * this._cosPitch,
            this._sinPitch,
            -this._cosYaw * this._cosPitch
        );

        this._updateMovement(dt);
        this._updateBlockInteraction(dt);
        this._updateCamera();
        this._updateRaycast();
    }

    _updateMovement(dt) {
        const sy = this._sinYaw, cy = this._cosYaw;
        const speed = this.flying ? FLY_SPEED : (this.sprinting ? SPRINT_SPEED : MOVE_SPEED);

        let mx = 0, mz = 0;
        if (this.keys['KeyW']) { mx -= sy; mz -= cy; }
        if (this.keys['KeyS']) { mx += sy; mz += cy; }
        if (this.keys['KeyA']) { mx -= cy; mz += sy; }
        if (this.keys['KeyD']) { mx += cy; mz -= sy; }

        const len = Math.sqrt(mx * mx + mz * mz);
        if (len > 0) { const inv = 1 / len; mx *= inv; mz *= inv; }

        this.velocity.x = mx * speed;
        this.velocity.z = mz * speed;

        if (this.flying) {
            this.velocity.y = 0;
            if (this.keys['Space']) this.velocity.y = speed;
            if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) this.velocity.y = -speed;
        } else {
            this.velocity.y += GRAVITY * dt;
            if (this.keys['Space'] && this.onGround) { this.velocity.y = JUMP_VEL; this.onGround = false; }
        }

        this._moveWithCollision(dt);
    }

    _moveWithCollision(dt) {
        // X
        this.position.x += this.velocity.x * dt;
        if (this._checkCollision()) { this.position.x -= this.velocity.x * dt; this.velocity.x = 0; }
        // Y
        this.position.y += this.velocity.y * dt;
        this.onGround = false;
        if (this._checkCollision()) {
            if (this.velocity.y < 0) this.onGround = true;
            this.position.y -= this.velocity.y * dt; this.velocity.y = 0;
        }
        // Z
        this.position.z += this.velocity.z * dt;
        if (this._checkCollision()) { this.position.z -= this.velocity.z * dt; this.velocity.z = 0; }

        if (this.position.y < -10) { this.position.y = 80; this.velocity.set(0, 0, 0); }
    }

    _checkCollision() {
        const px = this.position.x, py = this.position.y, pz = this.position.z;
        const minX = Math.floor(px - HW), maxX = Math.floor(px + HW);
        const minY = Math.floor(py), maxY = Math.floor(py + P_HEIGHT);
        const minZ = Math.floor(pz - HW), maxZ = Math.floor(pz + HW);

        for (let bx = minX; bx <= maxX; bx++) {
            for (let by = minY; by <= maxY; by++) {
                for (let bz = minZ; bz <= maxZ; bz++) {
                    const b = this.world.getBlock(bx, by, bz);
                    if (b && BlockProps[b].solid &&
                        px + HW > bx && px - HW < bx + 1 &&
                        py + P_HEIGHT > by && py < by + 1 &&
                        pz + HW > bz && pz - HW < bz + 1) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    _updateCamera() {
        const pos = this.position;
        this.camera.position.set(pos.x, pos.y + P_EYE, pos.z);
        this.camera.lookAt(
            pos.x + this._lookDir.x,
            pos.y + P_EYE + this._lookDir.y,
            pos.z + this._lookDir.z
        );
    }

    _updateRaycast() {
        this.selectedBlock = this.world.raycast(this.camera.position, this._lookDir, 7);
    }

    _updateBlockInteraction(dt) {
        this.breakCooldown = Math.max(0, this.breakCooldown - dt);
        this.placeCooldown = Math.max(0, this.placeCooldown - dt);

        if (this.mouseDown.left && this.breakCooldown <= 0 && this.selectedBlock) {
            const { x, y, z } = this.selectedBlock;
            if (this.world.getBlock(x, y, z) !== BlockType.BEDROCK) {
                this.world.setBlock(x, y, z, BlockType.AIR);
                this.breakCooldown = 0.25;
            }
        }

        if (this.mouseDown.right && this.placeCooldown <= 0 && this.selectedBlock) {
            const { normalX: nx, normalY: ny, normalZ: nz } = this.selectedBlock;
            const px = this.position.x, py = this.position.y, pz = this.position.z;
            if (!(nx < px + HW && nx + 1 > px - HW &&
                  ny < py + P_HEIGHT && ny + 1 > py &&
                  nz < pz + HW && nz + 1 > pz - HW)) {
                if (ny >= 0 && ny < CHUNK_HEIGHT) {
                    this.world.setBlock(nx, ny, nz, this.hotbar[this.selectedSlot]);
                    this.placeCooldown = 0.25;
                }
            }
        }
    }

    spawn() {
        for (let r = 0; r < 200; r += 4) {
            for (let a = 0; a < 6; a++) {
                const wx = Math.floor(Math.cos(a) * r);
                const wz = Math.floor(Math.sin(a) * r);
                const h = this.world.getHeight(wx, wz);
                if (h > SEA_LEVEL + 2) { this.position.set(wx + 0.5, h + 2, wz + 0.5); return; }
            }
        }
        this.position.set(0, 80, 0);
    }
}

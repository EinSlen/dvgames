import * as THREE from 'three';

const MOB_TYPES = {
    FRITE: { color: 0xf0d060, darkColor: 0xc8a830, bodyW: 0.2, bodyH: 0.6, bodyD: 0.2, legH: 0.2, headSize: 0.25, hp: 3, name: 'Frite' },
    GAUFRE: { color: 0xe0c060, darkColor: 0xb89830, bodyW: 0.6, bodyH: 0.15, bodyD: 0.5, legH: 0.25, headSize: 0.3, hp: 4, name: 'Gaufre' },
    CHOCOLAT: { color: 0x4a2a10, darkColor: 0x301808, bodyW: 0.35, bodyH: 0.35, bodyD: 0.35, legH: 0.25, headSize: 0.3, hp: 5, name: 'Chocolat' },
    BIERE: { color: 0xd4a030, darkColor: 0xa07020, bodyW: 0.3, bodyH: 0.5, bodyD: 0.3, legH: 0.2, headSize: 0.2, hp: 4, name: 'Biere' },
    VENDOR: { color: 0xf0f0f0, darkColor: 0xc00020, bodyW: 0.4, bodyH: 0.6, bodyD: 0.25, legH: 0.35, headSize: 0.35, hp: 100, name: 'Friteur', isVendor: true },
};

class Mob {
    constructor(scene, world, type, x, y, z) {
        this.scene = scene;
        this.world = world;
        this.type = type;
        this.hp = type.hp;
        this.maxHp = type.hp;
        this.dead = false;
        this.deathTimer = 0;

        this.x = x; this.y = y; this.z = z;
        this.vx = 0; this.vy = 0; this.vz = 0;
        this.yaw = Math.random() * Math.PI * 2;
        this.onGround = false;

        // AI
        this.aiTimer = 0;
        this.aiState = 'idle'; // idle, walk
        this.walkDir = 0;
        this.hurtTimer = 0;

        this._buildMesh();
        this.group.position.set(x, y, z);
        scene.add(this.group);
    }

    _buildMesh() {
        const t = this.type;
        const mat = new THREE.MeshBasicMaterial({ color: t.color });
        const matDark = new THREE.MeshBasicMaterial({ color: t.darkColor });

        this.group = new THREE.Group();

        if (t.isVendor) {
            // Human-like vendor: skin head, white body (apron), dark legs, chef hat
            const skinMat = new THREE.MeshBasicMaterial({ color: 0xd4a574 });

            // Legs (dark pants)
            this.legs = [];
            for (const lx of [-0.1, 0.1]) {
                const pivot = new THREE.Group();
                pivot.position.set(lx, 0.35, 0);
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.35, 0.15), matDark);
                leg.position.y = -0.175;
                pivot.add(leg);
                this.group.add(pivot);
                this.legs.push(pivot);
            }

            // Body (white apron)
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.25), mat);
            body.position.y = 0.6;
            this.group.add(body);

            // Arms
            for (const ax of [-0.27, 0.27]) {
                const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.12), skinMat);
                arm.position.set(ax, 0.55, 0);
                this.group.add(arm);
            }

            // Head (skin)
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skinMat);
            head.position.set(0, 1.0, 0);
            this.group.add(head);

            // Chef hat (white, tall)
            const hat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.25, 0.28), mat);
            hat.position.set(0, 1.28, 0);
            this.group.add(hat);

            // Mustache (dark)
            const stache = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.05), matDark);
            stache.position.set(0, 0.9, 0.16);
            this.group.add(stache);

            // Nametag
            const c = document.createElement('canvas');
            c.width = 256; c.height = 64;
            const ctx = c.getContext('2d');
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, 256, 64);
            ctx.fillStyle = '#fdda24'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Friteur Jean-Claude', 128, 42);
            const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
            tag.position.y = 1.6; tag.scale.set(1.8, 0.45, 1);
            this.group.add(tag);

            this.bodyHeight = 1.4;
        } else {
            // Animal mob
            const body = new THREE.Mesh(new THREE.BoxGeometry(t.bodyW, t.bodyH, t.bodyD), mat);
            body.position.y = t.legH + t.bodyH / 2;
            this.group.add(body);

            const head = new THREE.Mesh(new THREE.BoxGeometry(t.headSize, t.headSize, t.headSize), mat);
            head.position.set(0, t.legH + t.bodyH + t.headSize * 0.3, t.bodyD / 2 + t.headSize * 0.3);
            this.group.add(head);

            const snout = new THREE.Mesh(new THREE.BoxGeometry(t.headSize * 0.5, t.headSize * 0.3, t.headSize * 0.2), matDark);
            snout.position.set(0, t.legH + t.bodyH + t.headSize * 0.15, t.bodyD / 2 + t.headSize * 0.7);
            this.group.add(snout);

            this.legs = [];
            const legGeo = new THREE.BoxGeometry(0.12, t.legH, 0.12);
            const offsets = [
                [-t.bodyW/2+0.08, 0, -t.bodyD/2+0.1],
                [t.bodyW/2-0.08, 0, -t.bodyD/2+0.1],
                [-t.bodyW/2+0.08, 0, t.bodyD/2-0.1],
                [t.bodyW/2-0.08, 0, t.bodyD/2-0.1],
            ];
            for (const [ox, _, oz] of offsets) {
                const pivot = new THREE.Group();
                pivot.position.set(ox, t.legH, oz);
                const leg = new THREE.Mesh(legGeo, matDark);
                leg.position.y = -t.legH / 2;
                pivot.add(leg);
                this.group.add(pivot);
                this.legs.push(pivot);
            }

            this.bodyHeight = t.legH + t.bodyH + t.headSize;
        }
    }

    update(dt) {
        if (this.dead) {
            this.deathTimer += dt;
            this.group.rotation.z += dt * 3;
            this.group.position.y -= dt * 2;
            if (this.deathTimer > 1) return true; // remove
            return false;
        }

        // Hurt flash
        if (this.hurtTimer > 0) {
            this.hurtTimer -= dt;
            this.group.visible = Math.sin(this.hurtTimer * 30) > 0; // blink
        } else {
            this.group.visible = true;
        }

        // Vendor stays put
        if (this.type.isVendor) {
            this.group.position.set(this.x, this.y, this.z);
            return false;
        }

        // AI
        this.aiTimer -= dt;
        if (this.aiTimer <= 0) {
            if (this.aiState === 'idle') {
                this.aiState = 'walk';
                this.walkDir = Math.random() * Math.PI * 2;
                this.aiTimer = 1 + Math.random() * 3;
            } else {
                this.aiState = 'idle';
                this.aiTimer = 1 + Math.random() * 4;
            }
        }

        // Movement
        const speed = 1.5;
        if (this.aiState === 'walk') {
            this.vx = Math.sin(this.walkDir) * speed;
            this.vz = Math.cos(this.walkDir) * speed;
            this.yaw = this.walkDir;
        } else {
            this.vx = 0;
            this.vz = 0;
        }

        // Gravity
        this.vy -= 20 * dt;

        // Move with collision
        this.x += this.vx * dt;
        if (this._collides()) { this.x -= this.vx * dt; this.walkDir = Math.random() * Math.PI * 2; }
        this.z += this.vz * dt;
        if (this._collides()) { this.z -= this.vz * dt; this.walkDir = Math.random() * Math.PI * 2; }
        this.y += this.vy * dt;
        this.onGround = false;
        if (this._collides()) {
            if (this.vy < 0) this.onGround = true;
            this.y -= this.vy * dt;
            this.vy = 0;
        }

        // Prevent falling through world
        if (this.y < -10) return true; // remove

        // Animate legs
        if (this.aiState === 'walk') {
            this._walkPhase = (this._walkPhase || 0) + dt * 6;
            const s = Math.sin(this._walkPhase) * 0.4;
            this.legs[0].rotation.x = s;
            this.legs[1].rotation.x = -s;
            this.legs[2].rotation.x = -s;
            this.legs[3].rotation.x = s;
        } else {
            for (const l of this.legs) l.rotation.x *= 0.8;
        }

        // Update mesh
        this.group.position.set(this.x, this.y, this.z);
        this.group.rotation.y = this.yaw;

        return false;
    }

    _collides() {
        const hw = 0.25, h = this.bodyHeight * 0.8;
        for (let bx = Math.floor(this.x - hw); bx <= Math.floor(this.x + hw); bx++) {
            for (let by = Math.floor(this.y); by <= Math.floor(this.y + h); by++) {
                for (let bz = Math.floor(this.z - hw); bz <= Math.floor(this.z + hw); bz++) {
                    const b = this.world.getBlock(bx, by, bz);
                    if (b && b !== 5) { // not air, not water
                        // Simplified AABB
                        if (this.x + hw > bx && this.x - hw < bx + 1 &&
                            this.y + h > by && this.y < by + 1 &&
                            this.z + hw > bz && this.z - hw < bz + 1) return true;
                    }
                }
            }
        }
        return false;
    }

    hit(damage) {
        if (this.dead) return;
        this.hp -= damage;
        this.hurtTimer = 0.4;
        // Knockback
        this.vy = 5;
        if (this.hp <= 0) {
            this.dead = true;
            this.deathTimer = 0;
        }
    }

    distanceTo(px, py, pz) {
        return Math.sqrt((this.x - px) ** 2 + (this.y - py) ** 2 + (this.z - pz) ** 2);
    }

    // Check if a ray hits this mob (for player attack)
    rayHit(origin, dir, maxDist) {
        // AABB intersection test
        const hw = 0.3;
        const minX = this.x - hw, maxX = this.x + hw;
        const minY = this.y, maxY = this.y + this.bodyHeight;
        const minZ = this.z - hw, maxZ = this.z + hw;

        let tmin = 0, tmax = maxDist;

        for (let i = 0; i < 3; i++) {
            const o = i === 0 ? origin.x : (i === 1 ? origin.y : origin.z);
            const d = i === 0 ? dir.x : (i === 1 ? dir.y : dir.z);
            const mn = i === 0 ? minX : (i === 1 ? minY : minZ);
            const mx = i === 0 ? maxX : (i === 1 ? maxY : maxZ);

            if (Math.abs(d) < 1e-8) {
                if (o < mn || o > mx) return Infinity;
            } else {
                let t1 = (mn - o) / d, t2 = (mx - o) / d;
                if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
                if (tmin > tmax) return Infinity;
            }
        }
        return tmin;
    }

    dispose() {
        this.scene.remove(this.group);
    }
}

export class MobManager {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.mobs = [];
        this.spawnTimer = 0;
        this.maxMobs = 15;
    }

    spawnVendor(x, y, z) {
        this.mobs.push(new Mob(this.scene, this.world, MOB_TYPES.VENDOR, x, y, z));
    }

    update(dt, playerX, playerY, playerZ) {
        // Spawn vendors from friteries
        if (this.world._friterieVendors && this.world._friterieVendors.length > 0) {
            for (const v of this.world._friterieVendors) {
                this.spawnVendor(v.wx + 0.5, v.y, v.wz + 0.5);
            }
            this.world._friterieVendors = [];
        }

        // Spawn mobs near player
        this.spawnTimer += dt;
        if (this.spawnTimer > 3 && this.mobs.length < this.maxMobs) {
            this.spawnTimer = 0;
            this._trySpawn(playerX, playerZ);
        }

        // Update all mobs
        for (let i = this.mobs.length - 1; i >= 0; i--) {
            const mob = this.mobs[i];
            // Despawn if too far (but not vendors)
            if (!mob.type.isVendor && mob.distanceTo(playerX, playerY, playerZ) > 60) {
                mob.dispose();
                this.mobs.splice(i, 1);
                continue;
            }
            const remove = mob.update(dt);
            if (remove) {
                mob.dispose();
                this.mobs.splice(i, 1);
            }
        }
    }

    _trySpawn(px, pz) {
        // Random position 15-35 blocks from player
        const angle = Math.random() * Math.PI * 2;
        const dist = 15 + Math.random() * 20;
        const wx = Math.floor(px + Math.cos(angle) * dist);
        const wz = Math.floor(pz + Math.sin(angle) * dist);

        // Find ground level
        const h = this.world.getHeight(wx, wz);
        if (h <= 38) return; // don't spawn in water

        const ground = this.world.getBlock(wx, h, wz);
        if (ground !== 1) return; // only spawn on grass

        // Pick random Belgian delicacy
        const types = [MOB_TYPES.FRITE, MOB_TYPES.GAUFRE, MOB_TYPES.CHOCOLAT, MOB_TYPES.BIERE];
        const type = types[Math.floor(Math.random() * types.length)];

        this.mobs.push(new Mob(this.scene, this.world, type, wx + 0.5, h + 1, wz + 0.5));
    }

    // Check if player's attack ray hits any mob, return closest hit
    attackRay(origin, dir, maxDist) {
        let closest = null;
        let closestDist = maxDist;

        for (const mob of this.mobs) {
            if (mob.dead) continue;
            const d = mob.rayHit(origin, dir, maxDist);
            if (d < closestDist) {
                closestDist = d;
                closest = mob;
            }
        }
        return closest;
    }
}

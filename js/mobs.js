import * as THREE from 'three';

const MOB_TYPES = {
    PIG: { color: 0xf0a0a0, darkColor: 0xd08080, bodyW: 0.5, bodyH: 0.4, bodyD: 0.8, legH: 0.3, headSize: 0.35, hp: 4, name: 'Pig' },
    COW: { color: 0x6b3a2a, darkColor: 0x4a2818, bodyW: 0.55, bodyH: 0.5, bodyD: 0.9, legH: 0.4, headSize: 0.4, hp: 5, name: 'Cow' },
    SHEEP: { color: 0xe8e8e8, darkColor: 0xc0c0c0, bodyW: 0.5, bodyH: 0.45, bodyD: 0.75, legH: 0.35, headSize: 0.35, hp: 4, name: 'Sheep' },
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

        // Body
        const body = new THREE.Mesh(new THREE.BoxGeometry(t.bodyW, t.bodyH, t.bodyD), mat);
        body.position.y = t.legH + t.bodyH / 2;
        this.group.add(body);

        // Head
        const head = new THREE.Mesh(new THREE.BoxGeometry(t.headSize, t.headSize, t.headSize), mat);
        head.position.set(0, t.legH + t.bodyH + t.headSize * 0.3, t.bodyD / 2 + t.headSize * 0.3);
        this.group.add(head);

        // Snout (small pink box)
        const snout = new THREE.Mesh(new THREE.BoxGeometry(t.headSize * 0.5, t.headSize * 0.3, t.headSize * 0.2), matDark);
        snout.position.set(0, t.legH + t.bodyH + t.headSize * 0.15, t.bodyD / 2 + t.headSize * 0.7);
        this.group.add(snout);

        // 4 Legs
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

    update(dt, playerX, playerY, playerZ) {
        // Spawn mobs near player
        this.spawnTimer += dt;
        if (this.spawnTimer > 3 && this.mobs.length < this.maxMobs) {
            this.spawnTimer = 0;
            this._trySpawn(playerX, playerZ);
        }

        // Update all mobs
        for (let i = this.mobs.length - 1; i >= 0; i--) {
            const mob = this.mobs[i];
            // Despawn if too far
            if (mob.distanceTo(playerX, playerY, playerZ) > 60) {
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

        // Pick random type
        const types = [MOB_TYPES.PIG, MOB_TYPES.COW, MOB_TYPES.SHEEP];
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

import * as THREE from 'three';
import { SimplexNoise } from './noise.js';
import { BlockType, BlockProps } from './textures.js';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 128;
export const SEA_LEVEL = 38;

const CS = 16, CH = 128, CS2 = 256;

const FACES = [
    { dir: [0,1,0],  corners: [[0,1,0,0,0],[1,1,0,1,0],[1,1,1,1,1],[0,1,1,0,1]] },
    { dir: [0,-1,0], corners: [[0,0,1,0,0],[1,0,1,1,0],[1,0,0,1,1],[0,0,0,0,1]] },
    { dir: [0,0,-1], corners: [[1,1,0,0,1],[0,1,0,1,1],[0,0,0,1,0],[1,0,0,0,0]] },
    { dir: [0,0,1],  corners: [[0,1,1,0,1],[1,1,1,1,1],[1,0,1,1,0],[0,0,1,0,0]] },
    { dir: [-1,0,0], corners: [[0,1,0,0,1],[0,1,1,1,1],[0,0,1,1,0],[0,0,0,0,0]] },
    { dir: [1,0,0],  corners: [[1,1,1,0,1],[1,1,0,1,1],[1,0,0,1,0],[1,0,1,0,0]] },
];

// UV atlas
const ATLAS_COLS = 8, ATLAS_ROWS = 4;
const TEX_IDS = { GRASS_TOP:0,GRASS_SIDE:1,DIRT:2,STONE:3,SAND:4,WOOD_SIDE:5,WOOD_TOP:6,LEAVES:7,WATER:8,BEDROCK:9,SNOW_TOP:10,COBBLESTONE:11,COAL_ORE:12,IRON_ORE:13,PLANKS:14,GLASS:15,BRICK:16,SNOW_SIDE:17 };
const BFACES = [];
BFACES[1]=[0,2,1]; BFACES[2]=[2,2,2]; BFACES[3]=[3,3,3]; BFACES[4]=[4,4,4]; BFACES[5]=[8,8,8];
BFACES[6]=[6,6,5]; BFACES[7]=[7,7,7]; BFACES[8]=[9,9,9]; BFACES[9]=[12,12,12]; BFACES[10]=[13,13,13];
BFACES[11]=[10,2,17]; BFACES[12]=[11,11,11]; BFACES[13]=[14,14,14]; BFACES[14]=[15,15,15]; BFACES[15]=[16,16,16];

function getTexIdx(bt, faceDir) {
    const f = BFACES[bt];
    return f ? f[faceDir < 2 ? faceDir : 2] : 0;
}

function getUV(ti) {
    const c = ti % ATLAS_COLS, r = (ti / ATLAS_COLS) | 0;
    return [c / ATLAS_COLS, 1 - (r + 1) / ATLAS_ROWS, (c + 1) / ATLAS_COLS, 1 - r / ATLAS_ROWS];
}

class Chunk {
    constructor(cx, cz) {
        this.cx = cx; this.cz = cz;
        this.blocks = new Uint8Array(CS * CH * CS);
        this.mesh = null; this.waterMesh = null;
        this.dirty = true; this.generated = false;
    }
}

export class World {
    constructor(scene, material, waterMaterial, seed = 12345) {
        this.scene = scene;
        this.material = material;
        this.waterMaterial = waterMaterial;
        this.chunks = new Map();
        this.seed = seed;
        this.noise = new SimplexNoise(seed);
        this.treeNoise = new SimplexNoise(seed + 55555);
        this.caveNoise = new SimplexNoise(seed + 11111);
        this.renderDistance = 4;
        this.meshQueue = [];
        this.onBlockChange = null;
        this.pendingRemoteChanges = [];
    }

    _key(cx, cz) { return cx + ',' + cz; }
    getChunk(cx, cz) { return this.chunks.get(this._key(cx, cz)); }

    getBlock(wx, wy, wz) {
        if (wy < 0 || wy >= CH) return 0;
        const cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
        const ch = this.chunks.get(this._key(cx, cz));
        if (!ch || !ch.generated) return 0;
        const lx = ((wx % CS) + CS) % CS, lz = ((wz % CS) + CS) % CS;
        return ch.blocks[lx + lz * CS + wy * CS2];
    }

    setBlock(wx, wy, wz, type, fromNetwork = false) {
        const cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
        const ch = this.getChunk(cx, cz);
        if (!ch || !ch.generated) {
            if (fromNetwork) this.pendingRemoteChanges.push({ wx, wy, wz, type });
            return;
        }
        const lx = ((wx % CS) + CS) % CS, lz = ((wz % CS) + CS) % CS;
        ch.blocks[lx + lz * CS + wy * CS2] = type;
        ch.dirty = true;
        if (lx === 0) this._markDirty(cx-1, cz);
        if (lx === CS-1) this._markDirty(cx+1, cz);
        if (lz === 0) this._markDirty(cx, cz-1);
        if (lz === CS-1) this._markDirty(cx, cz+1);
        if (!fromNetwork && this.onBlockChange) this.onBlockChange(wx, wy, wz, type);

        // Gravity: check all neighbors for unsupported sand
        this._updateNeighborGravity(wx, wy, wz, fromNetwork);
    }

    _updateNeighborGravity(wx, wy, wz, fromNetwork) {
        // Check above + 4 sides for sand that needs to fall
        this._applyGravity(wx, wy + 1, wz, fromNetwork);
        this._applyGravity(wx + 1, wy, wz, fromNetwork);
        this._applyGravity(wx - 1, wy, wz, fromNetwork);
        this._applyGravity(wx, wy, wz + 1, fromNetwork);
        this._applyGravity(wx, wy, wz - 1, fromNetwork);
        // Also check the placed block itself (sand placed in air)
        this._applyGravity(wx, wy, wz, fromNetwork);
    }

    _applyGravity(wx, wy, wz, fromNetwork) {
        const b = this.getBlock(wx, wy, wz);
        if (b !== 4) return; // 4 = SAND only

        // Check if block below is air or water
        const below = this.getBlock(wx, wy - 1, wz);
        if (below !== 0 && below !== 5) return; // supported, don't fall

        // Find landing position
        let landY = wy - 1;
        while (landY > 0) {
            const lb = this.getBlock(wx, landY, wz);
            if (lb !== 0 && lb !== 5) break; // hit solid
            landY--;
        }
        landY++; // one above solid

        if (landY < wy) {
            // Move sand down (avoid recursive setBlock triggering more gravity)
            const cx1 = Math.floor(wx / CS), cz1 = Math.floor(wz / CS);
            const ch1 = this.getChunk(cx1, cz1);
            if (!ch1 || !ch1.generated) return;
            const lx = ((wx % CS) + CS) % CS, lz = ((wz % CS) + CS) % CS;
            // Remove from old position
            ch1.blocks[lx + lz * CS + wy * CS2] = 0;
            // Place at new position
            const cx2 = Math.floor(wx / CS), cz2 = Math.floor(wz / CS);
            const ch2 = this.getChunk(cx2, cz2);
            if (ch2 && ch2.generated) {
                ch2.blocks[lx + lz * CS + landY * CS2] = 4;
                ch2.dirty = true;
            }
            ch1.dirty = true;
            if (!fromNetwork && this.onBlockChange) {
                this.onBlockChange(wx, wy, wz, 0);
                this.onBlockChange(wx, landY, wz, 4);
            }
            // Check above for more sand
            this._applyGravity(wx, wy + 1, wz, fromNetwork);
        }
    }

    _markDirty(cx, cz) { const c = this.getChunk(cx, cz); if (c) c.dirty = true; }

    _srand(x, z) {
        let s = (x * 73856093) ^ (z * 19349663);
        s = ((s >> 16) ^ s) * 0x45d9f3b; s = ((s >> 16) ^ s) * 0x45d9f3b; s = (s >> 16) ^ s;
        return (s & 0x7fffffff) / 0x7fffffff;
    }

    getHeight(wx, wz) {
        return (40 + this.noise.fbm2D(wx * 0.005, wz * 0.005, 5) * 40 +
                this.noise.fbm2D(wx * 0.015 + 100, wz * 0.015 + 100, 4) * 15 +
                this.noise.noise2D(wx * 0.04, wz * 0.04) * 5) | 0;
    }

    generateTerrain(chunk) {
        const { cx, cz } = chunk;
        const ox = cx * CS, oz = cz * CS, bl = chunk.blocks;

        for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
            const wx = ox + lx, wz = oz + lz, h = this.getHeight(wx, wz);
            for (let y = 0; y < CH; y++) {
                let b = 0;
                if (y === 0) b = 8;
                else if (y < h - 4) {
                    b = 3;
                    if (y < 40) { const v = this.caveNoise.noise3D(wx*.1, y*.1, wz*.1); if (v > .7) b = 9; else if (v > .65 && y < 25) b = 10; }
                } else if (y < h) b = h < SEA_LEVEL + 2 ? 4 : 2;
                else if (y === h) b = h < SEA_LEVEL + 2 ? 4 : (h > 75 ? 11 : 1);
                else if (y <= SEA_LEVEL && y > h) b = 5;

                if (b && y > 1 && y < h - 2 && b !== 5 && b !== 8) {
                    const c1 = this.caveNoise.noise3D(wx*.05, y*.08, wz*.05);
                    const c2 = this.caveNoise.noise3D(wx*.05+500, y*.08+500, wz*.05+500);
                    if (c1*c1 + c2*c2 < .02) b = 0;
                }
                if (b) bl[lx + lz * CS + y * CS2] = b;
            }
        }

        // Trees
        for (let lx = 2; lx < CS-2; lx++) for (let lz = 2; lz < CS-2; lz++) {
            const wx = ox+lx, wz = oz+lz;
            if (this.treeNoise.noise2D(wx*.5, wz*.5) > .75) {
                const h = this.getHeight(wx, wz);
                if (h > SEA_LEVEL+2 && h < 70 && bl[lx+lz*CS+h*CS2] === 1) {
                    const th = 4+(this._srand(wx,wz)*3|0);
                    for (let dy = 0; dy < th; dy++) if (h+1+dy < CH) bl[lx+lz*CS+(h+1+dy)*CS2] = 6;
                    for (let dy = th-2; dy <= th+1; dy++) {
                        const r = dy <= th-1 ? 2 : 1;
                        for (let dx=-r; dx<=r; dx++) for (let dz=-r; dz<=r; dz++) {
                            if (!dx && !dz && dy < th) continue;
                            if (Math.abs(dx)===r && Math.abs(dz)===r && this._srand(wx+dx*7,wz+dz*13+dy)>.5) continue;
                            const tx=lx+dx, ty=h+1+dy, tz=lz+dz;
                            if (tx>=0 && tx<CS && ty<CH && tz>=0 && tz<CS && !bl[tx+tz*CS+ty*CS2]) bl[tx+tz*CS+ty*CS2] = 7;
                        }
                    }
                }
            }
        }

        chunk.generated = true;

        const rem = [];
        for (const c of this.pendingRemoteChanges) {
            const pcx = Math.floor(c.wx/CS), pcz = Math.floor(c.wz/CS);
            if (pcx === cx && pcz === cz) {
                const lx2 = ((c.wx%CS)+CS)%CS, lz2 = ((c.wz%CS)+CS)%CS;
                bl[lx2 + lz2*CS + c.wy*CS2] = c.type;
            } else rem.push(c);
        }
        this.pendingRemoteChanges = rem;
    }

    buildChunkMesh(chunk) {
        const bl = chunk.blocks;
        const ox = chunk.cx * CS, oz = chunk.cz * CS;
        const pos = [], norm = [], uv = [];
        const wpos = [], wnorm = [], wuv = [];
        let si = 0, wi = 0;

        for (let y = 0; y < CH; y++) {
            const yo = y * CS2;
            for (let z = 0; z < CS; z++) {
                const zo = z * CS;
                for (let x = 0; x < CS; x++) {
                    const bt = bl[x + zo + yo];
                    if (!bt) continue;
                    const isW = bt === 5;

                    for (let fi = 0; fi < 6; fi++) {
                        const face = FACES[fi];
                        const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];

                        let nb;
                        if (ny < 0 || ny >= CH) nb = 0;
                        else if (nx >= 0 && nx < CS && nz >= 0 && nz < CS) nb = bl[nx + nz*CS + ny*CS2];
                        else nb = this.getBlock(ox+nx, ny, oz+nz);

                        const nbp = BlockProps[nb];
                        if (isW ? (nb === 5 || !nbp.transparent) : !nbp.transparent) continue;

                        const ti = getTexIdx(bt, fi);
                        const [u0,v0,u1,v1] = getUV(ti);
                        const p = isW ? wpos : pos;
                        const n = isW ? wnorm : norm;
                        const u = isW ? wuv : uv;
                        const wyo = isW && fi === 0 ? -0.1 : 0;

                        for (const c of face.corners) {
                            p.push(ox+x+c[0], y+c[1]+wyo, oz+z+c[2]);
                            n.push(face.dir[0], face.dir[1], face.dir[2]);
                            u.push(u0 + c[3]*(u1-u0), v0 + c[4]*(v1-v0));
                        }
                        if (isW) wi++; else si++;
                    }
                }
            }
        }

        if (chunk.mesh) { this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); chunk.mesh = null; }
        if (chunk.waterMesh) { this.scene.remove(chunk.waterMesh); chunk.waterMesh.geometry.dispose(); chunk.waterMesh = null; }

        if (si > 0) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            const idx = new Uint32Array(si * 6);
            for (let i = 0; i < si; i++) { const v=i*4,o=i*6; idx[o]=v;idx[o+1]=v+2;idx[o+2]=v+1;idx[o+3]=v;idx[o+4]=v+3;idx[o+5]=v+2; }
            g.setIndex(new THREE.BufferAttribute(idx, 1));
            chunk.mesh = new THREE.Mesh(g, this.material);
            this.scene.add(chunk.mesh);

            if (g > 1 && new Uint8Array(si * 6)) {
                g.setIndex(new THREE.BufferGeometry(idx))
            }
        }

        if (wi > 0) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(wnorm, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
            const idx = new Uint32Array(wi * 6);
            for (let i = 0; i < wi; i++) { const v=i*4,o=i*6; idx[o]=v;idx[o+1]=v+2;idx[o+2]=v+1;idx[o+3]=v;idx[o+4]=v+3;idx[o+5]=v+2; }
            g.setIndex(new THREE.BufferAttribute(idx, 1));
            chunk.waterMesh = new THREE.Mesh(g, this.waterMaterial);
            this.scene.add(chunk.waterMesh);
        }

        chunk.dirty = false;
    }

    forceLoad(cx, cz) {
        const key = this._key(cx, cz);
        let ch = this.chunks.get(key);
        if (ch && ch.generated && ch.mesh) return;
        if (!ch) { ch = new Chunk(cx, cz); this.chunks.set(key, ch); }
        if (!ch.generated) this.generateTerrain(ch);
        this.buildChunkMesh(ch);
    }

    update(playerX, playerZ) {
        const pcx = Math.floor(playerX / CS), pcz = Math.floor(playerZ / CS);
        const rd = this.renderDistance;

        for (let dx = -rd; dx <= rd; dx++) for (let dz = -rd; dz <= rd; dz++) {
            if (dx*dx + dz*dz > rd*rd) continue;
            const cx = pcx+dx, cz = pcz+dz, key = this._key(cx, cz);
            if (!this.chunks.has(key)) {
                const ch = new Chunk(cx, cz);
                this.chunks.set(key, ch);
                this.generateTerrain(ch);
                this.meshQueue.push(ch);
                this._markDirty(cx-1,cz); this._markDirty(cx+1,cz);
                this._markDirty(cx,cz-1); this._markDirty(cx,cz+1);
            }
        }

        let built = 0;
        if (this.meshQueue.length > 0) {
            this.meshQueue.sort((a,b) => ((a.cx-pcx)**2+(a.cz-pcz)**2) - ((b.cx-pcx)**2+(b.cz-pcz)**2));
            while (this.meshQueue.length > 0 && built < 4) { this.buildChunkMesh(this.meshQueue.shift()); built++; }
        }

        for (const ch of this.chunks.values()) {
            if (built >= 4) break;
            if (ch.dirty && ch.generated) { this.buildChunkMesh(ch); built++; }
        }

        const ud2 = (rd+2)*(rd+2);
        for (const [key, ch] of this.chunks) {
            if ((ch.cx-pcx)**2 + (ch.cz-pcz)**2 > ud2) {
                if (ch.mesh) { this.scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
                if (ch.waterMesh) { this.scene.remove(ch.waterMesh); ch.waterMesh.geometry.dispose(); }
                this.chunks.delete(key);
            }
        }
    }

    raycast(origin, dir, maxDist = 8) {
        let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
        const sx = dir.x >= 0 ? 1 : -1, sy = dir.y >= 0 ? 1 : -1, sz = dir.z >= 0 ? 1 : -1;
        const tdx = dir.x ? Math.abs(1/dir.x) : 1e30, tdy = dir.y ? Math.abs(1/dir.y) : 1e30, tdz = dir.z ? Math.abs(1/dir.z) : 1e30;
        let tmx = dir.x ? (dir.x>0 ? x+1-origin.x : origin.x-x)*tdx : 1e30;
        let tmy = dir.y ? (dir.y>0 ? y+1-origin.y : origin.y-y)*tdy : 1e30;
        let tmz = dir.z ? (dir.z>0 ? z+1-origin.z : origin.z-z)*tdz : 1e30;
        let px=x, py=y, pz=z, d=0;
        while (d < maxDist) {
            const b = this.getBlock(x,y,z);
            if (b && b !== 5) return {x,y,z,block:b,normalX:px,normalY:py,normalZ:pz};
            px=x; py=y; pz=z;
            if (tmx<tmy) { if (tmx<tmz){x+=sx;d=tmx;tmx+=tdx}else{z+=sz;d=tmz;tmz+=tdz} }
            else { if (tmy<tmz){y+=sy;d=tmy;tmy+=tdy}else{z+=sz;d=tmz;tmz+=tdz} }
        }
        return null;
    }
}

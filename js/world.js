import * as THREE from 'three';
import { SimplexNoise } from './noise.js';
import { BlockType, IS_TRANSPARENT, UV_TABLE } from './textures.js';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 128;
export const SEA_LEVEL = 38;
const BASE_HEIGHT = 40;
const CS = CHUNK_SIZE;
const CH = CHUNK_HEIGHT;
const CS2 = CS * CS;

// ── Static face data (flattened for cache-friendly access) ──

// 6 faces × 4 verts × 3 coords = 72
const FVERT = new Float32Array([
    0,1,0, 1,1,0, 1,1,1, 0,1,1,   // Top +Y
    0,0,1, 1,0,1, 1,0,0, 0,0,0,   // Bottom -Y
    1,1,0, 0,1,0, 0,0,0, 1,0,0,   // North -Z
    0,1,1, 1,1,1, 1,0,1, 0,0,1,   // South +Z
    0,1,0, 0,1,1, 0,0,1, 0,0,0,   // West -X
    1,1,1, 1,1,0, 1,0,0, 1,0,1,   // East +X
]);

// 6 faces × 3 = 18
const FNORM = new Float32Array([0,1,0, 0,-1,0, 0,0,-1, 0,0,1, -1,0,0, 1,0,0]);

// Neighbor offsets per face
const FDIR_X = new Int8Array([0, 0, 0, 0,-1, 1]);
const FDIR_Y = new Int8Array([1,-1, 0, 0, 0, 0]);
const FDIR_Z = new Int8Array([0, 0,-1, 1, 0, 0]);

// 6 faces × 4 verts × 2 uv = 48
const FUV = new Float32Array([
    0,0,1,0,1,1,0,1, 0,0,1,0,1,1,0,1,
    0,1,1,1,1,0,0,0, 0,1,1,1,1,0,0,0,
    0,1,1,1,1,0,0,0, 0,1,1,1,1,0,0,0,
]);

// ── Chunk ──
class Chunk {
    constructor(cx, cz) {
        this.cx = cx;
        this.cz = cz;
        this.blocks = new Uint8Array(CS * CH * CS);
        this.mesh = null;
        this.waterMesh = null;
        this.dirty = true;
        this.generated = false;
        this.maxY = 0;
    }
}

// ── World ──
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
        this.renderDistance = 6;
        this.meshQueue = [];
        this.onBlockChange = null;
        this.pendingRemoteChanges = [];
    }

    // Integer key (no string alloc in hot paths)
    _key(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }
    getChunk(cx, cz) { return this.chunks.get(this._key(cx, cz)); }

    getBlock(wx, wy, wz) {
        if (wy < 0 || wy >= CH) return 0;
        const cx = Math.floor(wx / CS);
        const cz = Math.floor(wz / CS);
        const chunk = this.chunks.get(this._key(cx, cz));
        if (!chunk || !chunk.generated) return 0;
        return chunk.blocks[(wx - cx * CS) + (wz - cz * CS) * CS + wy * CS2];
    }

    setBlock(wx, wy, wz, type, fromNetwork = false) {
        const cx = Math.floor(wx / CS);
        const cz = Math.floor(wz / CS);
        const chunk = this.getChunk(cx, cz);
        if (!chunk || !chunk.generated) {
            if (fromNetwork) this.pendingRemoteChanges.push({ wx, wy, wz, type });
            return;
        }
        const lx = wx - cx * CS, lz = wz - cz * CS;
        chunk.blocks[lx + lz * CS + wy * CS2] = type;
        chunk.dirty = true;
        if (type !== 0 && wy > chunk.maxY) chunk.maxY = wy;
        if (lx === 0)      this._markDirty(cx - 1, cz);
        if (lx === CS - 1) this._markDirty(cx + 1, cz);
        if (lz === 0)      this._markDirty(cx, cz - 1);
        if (lz === CS - 1) this._markDirty(cx, cz + 1);
        // Notify network (only for local player actions)
        if (!fromNetwork && this.onBlockChange) this.onBlockChange(wx, wy, wz, type);
    }

    _markDirty(cx, cz) { const c = this.getChunk(cx, cz); if (c) c.dirty = true; }

    _seededRandom(x, z) {
        let s = (x * 73856093) ^ (z * 19349663);
        s = ((s >> 16) ^ s) * 0x45d9f3b;
        s = ((s >> 16) ^ s) * 0x45d9f3b;
        s = (s >> 16) ^ s;
        return (s & 0x7fffffff) / 0x7fffffff;
    }

    getHeight(wx, wz) {
        const n1 = this.noise.fbm2D(wx * 0.005, wz * 0.005, 5) * 40;
        const n2 = this.noise.fbm2D(wx * 0.015 + 100, wz * 0.015 + 100, 4) * 15;
        const n3 = this.noise.noise2D(wx * 0.04, wz * 0.04) * 5;
        return (BASE_HEIGHT + n1 + n2 + n3) | 0;
    }

    // ── Terrain generation ──
    generateTerrain(chunk) {
        const { cx, cz } = chunk;
        const worldX = cx * CS, worldZ = cz * CS;
        const blocks = chunk.blocks;
        let maxY = 0;

        // Cache height map (reused by trees)
        const heightMap = new Int32Array(CS2);
        for (let lz = 0; lz < CS; lz++)
            for (let lx = 0; lx < CS; lx++)
                heightMap[lx + lz * CS] = this.getHeight(worldX + lx, worldZ + lz);

        for (let lz = 0; lz < CS; lz++) {
            for (let lx = 0; lx < CS; lx++) {
                const wx = worldX + lx, wz = worldZ + lz;
                const height = heightMap[lx + lz * CS];
                const colBase = lx + lz * CS;

                for (let y = 0; y < CH; y++) {
                    let bt = 0;
                    if (y === 0) {
                        bt = BlockType.BEDROCK;
                    } else if (y < height - 4) {
                        bt = BlockType.STONE;
                        if (y < 40) {
                            const ov = this.caveNoise.noise3D(wx * 0.1, y * 0.1, wz * 0.1);
                            if (ov > 0.7) bt = BlockType.COAL_ORE;
                            else if (ov > 0.65 && y < 25) bt = BlockType.IRON_ORE;
                        }
                    } else if (y < height) {
                        bt = height < SEA_LEVEL + 2 ? BlockType.SAND : BlockType.DIRT;
                    } else if (y === height) {
                        bt = height < SEA_LEVEL + 2 ? BlockType.SAND : (height > 75 ? BlockType.SNOW : BlockType.GRASS);
                    } else if (y <= SEA_LEVEL && y > height) {
                        bt = BlockType.WATER;
                    }

                    if (bt !== 0 && y > 1 && y < height - 2 && bt !== BlockType.WATER && bt !== BlockType.BEDROCK) {
                        const c1 = this.caveNoise.noise3D(wx * 0.05, y * 0.08, wz * 0.05);
                        const c2 = this.caveNoise.noise3D(wx * 0.05 + 500, y * 0.08 + 500, wz * 0.05 + 500);
                        if (c1 * c1 + c2 * c2 < 0.02) bt = 0;
                    }

                    if (bt !== 0) { blocks[colBase + y * CS2] = bt; if (y > maxY) maxY = y; }
                }
            }
        }

        // Trees
        for (let lx = 2; lx < CS - 2; lx++) {
            for (let lz = 2; lz < CS - 2; lz++) {
                const wx = worldX + lx, wz = worldZ + lz;
                if (this.treeNoise.noise2D(wx * 0.5, wz * 0.5) > 0.75) {
                    const h = heightMap[lx + lz * CS];
                    if (h > SEA_LEVEL + 2 && h < 70 && blocks[lx + lz * CS + h * CS2] === BlockType.GRASS) {
                        const tmy = this._placeTree(blocks, lx, h + 1, lz, wx, wz);
                        if (tmy > maxY) maxY = tmy;
                    }
                }
            }
        }

        chunk.maxY = Math.min(maxY, CH - 1);
        chunk.generated = true;

        // Apply pending remote changes for this chunk
        const remaining = [];
        for (const c of this.pendingRemoteChanges) {
            const pcx = Math.floor(c.wx / CS), pcz = Math.floor(c.wz / CS);
            if (pcx === cx && pcz === cz) {
                const lx2 = c.wx - cx * CS, lz2 = c.wz - cz * CS;
                blocks[lx2 + lz2 * CS + c.wy * CS2] = c.type;
                if (c.type !== 0 && c.wy > chunk.maxY) chunk.maxY = c.wy;
            } else {
                remaining.push(c);
            }
        }
        this.pendingRemoteChanges = remaining;
    }

    _placeTree(blocks, x, y, z, wx, wz) {
        const th = 4 + (this._seededRandom(wx, wz) * 3 | 0);
        let my = y;
        for (let dy = 0; dy < th; dy++) {
            if (y + dy < CH) { blocks[x + z * CS + (y + dy) * CS2] = BlockType.WOOD; if (y + dy > my) my = y + dy; }
        }
        for (let dy = th - 2; dy <= th + 1; dy++) {
            const r = dy <= th - 1 ? 2 : 1;
            for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
                if (dx === 0 && dz === 0 && dy < th) continue;
                if (Math.abs(dx) === r && Math.abs(dz) === r && this._seededRandom(wx + dx * 7, wz + dz * 13 + dy) > 0.5) continue;
                const lx = x + dx, ly = y + dy, lz = z + dz;
                if (lx >= 0 && lx < CS && ly < CH && lz >= 0 && lz < CS) {
                    const idx = lx + lz * CS + ly * CS2;
                    if (blocks[idx] === 0) { blocks[idx] = BlockType.LEAVES; if (ly > my) my = ly; }
                }
            }
        }
        return my;
    }

    // ── Optimized mesh building ──
    // Uses regular arrays (V8-optimized push) + all other optimizations
    buildChunkMesh(chunk) {
        const { cx, cz } = chunk;
        const blocks = chunk.blocks;
        const worldX = cx * CS, worldZ = cz * CS;
        const maxY = chunk.maxY;

        // Cache neighbor block arrays (avoid Map lookup per face)
        const cnx = this.getChunk(cx - 1, cz);
        const cpx = this.getChunk(cx + 1, cz);
        const cnz = this.getChunk(cx, cz - 1);
        const cpz = this.getChunk(cx, cz + 1);
        const bnx = cnx && cnx.generated ? cnx.blocks : null;
        const bpx = cpx && cpx.generated ? cpx.blocks : null;
        const bnz = cnz && cnz.generated ? cnz.blocks : null;
        const bpz = cpz && cpz.generated ? cpz.blocks : null;

        const sPos = [], sNorm = [], sUV = [];
        const wPos = [], wNorm = [], wUV = [];
        let sf = 0, wf = 0;

        for (let y = 0; y <= maxY; y++) {
            const yOff = y * CS2;
            for (let z = 0; z < CS; z++) {
                const zOff = z * CS;
                for (let x = 0; x < CS; x++) {
                    const bt = blocks[x + zOff + yOff];
                    if (bt === 0) continue;
                    const isW = bt === 5;

                    for (let f = 0; f < 6; f++) {
                        const nx = x + FDIR_X[f];
                        const ny = y + FDIR_Y[f];
                        const nz = z + FDIR_Z[f];

                        // Inline neighbor lookup
                        let nb;
                        if (ny < 0 || ny >= CH) { nb = 0; }
                        else if (nx >= 0 && nx < CS && nz >= 0 && nz < CS) {
                            nb = blocks[nx + nz * CS + ny * CS2];
                        } else if (nx < 0) { nb = bnx ? bnx[(CS-1) + nz * CS + ny * CS2] : 0; }
                        else if (nx >= CS) { nb = bpx ? bpx[nz * CS + ny * CS2] : 0; }
                        else if (nz < 0) { nb = bnz ? bnz[nx + (CS-1) * CS + ny * CS2] : 0; }
                        else { nb = bpz ? bpz[nx + ny * CS2] : 0; }

                        // Visibility (array lookup, no object property access)
                        if (isW) { if (nb === 5 || !IS_TRANSPARENT[nb]) continue; }
                        else { if (!IS_TRANSPARENT[nb]) continue; }

                        // Choose target arrays
                        const pA = isW ? wPos : sPos;
                        const nA = isW ? wNorm : sNorm;
                        const uA = isW ? wUV : sUV;

                        // Vertex positions (unrolled)
                        const vb = f * 12;
                        const wx = worldX + x, wz = worldZ + z;
                        const wyo = (isW && f === 0) ? -0.1 : 0;
                        pA.push(
                            wx+FVERT[vb],  y+FVERT[vb+1]+wyo,  wz+FVERT[vb+2],
                            wx+FVERT[vb+3],y+FVERT[vb+4]+wyo,  wz+FVERT[vb+5],
                            wx+FVERT[vb+6],y+FVERT[vb+7]+wyo,  wz+FVERT[vb+8],
                            wx+FVERT[vb+9],y+FVERT[vb+10]+wyo, wz+FVERT[vb+11]
                        );

                        // Normals
                        const n3 = f * 3;
                        const nn0 = FNORM[n3], nn1 = FNORM[n3+1], nn2 = FNORM[n3+2];
                        nA.push(nn0,nn1,nn2, nn0,nn1,nn2, nn0,nn1,nn2, nn0,nn1,nn2);

                        // UVs (pre-computed table)
                        const uvOff = (bt * 6 + f) * 4;
                        const u0 = UV_TABLE[uvOff], v0 = UV_TABLE[uvOff+1];
                        const du = UV_TABLE[uvOff+2], dv = UV_TABLE[uvOff+3];
                        const fb = f * 8;
                        uA.push(
                            u0+FUV[fb]*du,   v0+FUV[fb+1]*dv,
                            u0+FUV[fb+2]*du, v0+FUV[fb+3]*dv,
                            u0+FUV[fb+4]*du, v0+FUV[fb+5]*dv,
                            u0+FUV[fb+6]*du, v0+FUV[fb+7]*dv
                        );

                        if (isW) wf++; else sf++;
                    }
                }
            }
        }

        // Dispose old
        if (chunk.mesh) { this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); chunk.mesh = null; }
        if (chunk.waterMesh) { this.scene.remove(chunk.waterMesh); chunk.waterMesh.geometry.dispose(); chunk.waterMesh = null; }

        // Build solid mesh
        if (sf > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(sNorm, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(sUV, 2));

            // Generate indices
            const idx = new Uint32Array(sf * 6);
            for (let i = 0; i < sf; i++) {
                const v = i * 4, o = i * 6;
                idx[o]=v; idx[o+1]=v+2; idx[o+2]=v+1; idx[o+3]=v; idx[o+4]=v+3; idx[o+5]=v+2;
            }
            geo.setIndex(new THREE.BufferAttribute(idx, 1));

            chunk.mesh = new THREE.Mesh(geo, this.material);
            this.scene.add(chunk.mesh);
        }

        // Build water mesh
        if (wf > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(wNorm, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(wUV, 2));

            const idx = new Uint32Array(wf * 6);
            for (let i = 0; i < wf; i++) {
                const v = i * 4, o = i * 6;
                idx[o]=v; idx[o+1]=v+2; idx[o+2]=v+1; idx[o+3]=v; idx[o+4]=v+3; idx[o+5]=v+2;
            }
            geo.setIndex(new THREE.BufferAttribute(idx, 1));

            chunk.waterMesh = new THREE.Mesh(geo, this.waterMaterial);
            this.scene.add(chunk.waterMesh);
        }

        chunk.dirty = false;
    }

    // Force-load a chunk synchronously (for spawn area)
    forceLoad(cx, cz) {
        const key = this._key(cx, cz);
        let chunk = this.chunks.get(key);
        if (chunk && chunk.mesh) return;
        if (!chunk) {
            chunk = new Chunk(cx, cz);
            this.chunks.set(key, chunk);
            this.generateTerrain(chunk);
        }
        this.buildChunkMesh(chunk);
    }

    // ── Per-frame update ──
    update(playerX, playerZ) {
        const pcx = Math.floor(playerX / CS);
        const pcz = Math.floor(playerZ / CS);
        const rd = this.renderDistance;

        // 1. Generate terrain immediately for new chunks (one-time cost)
        for (let dx = -rd; dx <= rd; dx++) {
            for (let dz = -rd; dz <= rd; dz++) {
                if (dx * dx + dz * dz > rd * rd) continue;
                const cx = pcx + dx, cz = pcz + dz;
                const key = this._key(cx, cz);
                if (!this.chunks.has(key)) {
                    const chunk = new Chunk(cx, cz);
                    this.chunks.set(key, chunk);
                    this.generateTerrain(chunk);
                    this.meshQueue.push(chunk);
                    this._markDirty(cx - 1, cz);
                    this._markDirty(cx + 1, cz);
                    this._markDirty(cx, cz - 1);
                    this._markDirty(cx, cz + 1);
                }
            }
        }

        // 2. Build meshes progressively (4 per frame)
        let built = 0;
        if (this.meshQueue.length > 0) {
            this.meshQueue.sort((a, b) =>
                ((a.cx-pcx)**2 + (a.cz-pcz)**2) - ((b.cx-pcx)**2 + (b.cz-pcz)**2)
            );
            while (this.meshQueue.length > 0 && built < 4) {
                const chunk = this.meshQueue.shift();
                this.buildChunkMesh(chunk);
                built++;
            }
        }

        // 3. Rebuild dirty chunks
        for (const chunk of this.chunks.values()) {
            if (built >= 4) break;
            if (chunk.dirty && chunk.generated) {
                this.buildChunkMesh(chunk);
                built++;
            }
        }

        // 4. Unload far chunks
        const unloadDist2 = (rd + 2) * (rd + 2);
        for (const [key, chunk] of this.chunks) {
            const dx = chunk.cx - pcx, dz = chunk.cz - pcz;
            if (dx * dx + dz * dz > unloadDist2) {
                if (chunk.mesh) { this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); }
                if (chunk.waterMesh) { this.scene.remove(chunk.waterMesh); chunk.waterMesh.geometry.dispose(); }
                this.chunks.delete(key);
            }
        }
    }

    // ── DDA Raycast ──
    raycast(origin, direction, maxDist = 8) {
        let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
        const sx = direction.x >= 0 ? 1 : -1;
        const sy = direction.y >= 0 ? 1 : -1;
        const sz = direction.z >= 0 ? 1 : -1;
        const tdx = direction.x !== 0 ? Math.abs(1 / direction.x) : 1e30;
        const tdy = direction.y !== 0 ? Math.abs(1 / direction.y) : 1e30;
        const tdz = direction.z !== 0 ? Math.abs(1 / direction.z) : 1e30;
        let tmx = direction.x !== 0 ? (direction.x > 0 ? x+1-origin.x : origin.x-x) * tdx : 1e30;
        let tmy = direction.y !== 0 ? (direction.y > 0 ? y+1-origin.y : origin.y-y) * tdy : 1e30;
        let tmz = direction.z !== 0 ? (direction.z > 0 ? z+1-origin.z : origin.z-z) * tdz : 1e30;
        let px = x, py = y, pz = z, dist = 0;

        while (dist < maxDist) {
            const b = this.getBlock(x, y, z);
            if (b !== 0 && b !== 5) return { x, y, z, block: b, normalX: px, normalY: py, normalZ: pz };
            px = x; py = y; pz = z;
            if (tmx < tmy) {
                if (tmx < tmz) { x += sx; dist = tmx; tmx += tdx; }
                else { z += sz; dist = tmz; tmz += tdz; }
            } else {
                if (tmy < tmz) { y += sy; dist = tmy; tmy += tdy; }
                else { z += sz; dist = tmz; tmz += tdz; }
            }
        }
        return null;
    }
}

import * as THREE from 'three';

export const BlockType = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5,
    WOOD: 6, LEAVES: 7, BEDROCK: 8, COAL_ORE: 9, IRON_ORE: 10,
    SNOW: 11, COBBLESTONE: 12, PLANKS: 13, GLASS: 14, BRICK: 15,
    FRITES: 16, FRITERIE: 17,
};

export const BlockProps = {
    [BlockType.AIR]:         { name: 'Air',         solid: false, transparent: true },
    [BlockType.GRASS]:       { name: 'Grass',       solid: true,  transparent: false },
    [BlockType.DIRT]:        { name: 'Dirt',         solid: true,  transparent: false },
    [BlockType.STONE]:       { name: 'Stone',       solid: true,  transparent: false },
    [BlockType.SAND]:        { name: 'Sand',         solid: true,  transparent: false },
    [BlockType.WATER]:       { name: 'Water',       solid: false, transparent: true },
    [BlockType.WOOD]:        { name: 'Wood',         solid: true,  transparent: false },
    [BlockType.LEAVES]:      { name: 'Leaves',       solid: true,  transparent: false },
    [BlockType.BEDROCK]:     { name: 'Bedrock',     solid: true,  transparent: false },
    [BlockType.COAL_ORE]:    { name: 'Coal Ore',     solid: true,  transparent: false },
    [BlockType.IRON_ORE]:    { name: 'Iron Ore',     solid: true,  transparent: false },
    [BlockType.SNOW]:        { name: 'Gaufre',       solid: true,  transparent: false },
    [BlockType.COBBLESTONE]: { name: 'Cobblestone', solid: true,  transparent: false },
    [BlockType.PLANKS]:      { name: 'Planks',       solid: true,  transparent: false },
    [BlockType.GLASS]:       { name: 'Glass',       solid: true,  transparent: true },
    [BlockType.BRICK]:       { name: 'Belgique',     solid: true,  transparent: false },
    [BlockType.FRITES]:      { name: 'Frites',       solid: true,  transparent: false },
    [BlockType.FRITERIE]:    { name: 'Friterie',     solid: true,  transparent: false },
};

const NUM_TYPES = 18;
export const IS_TRANSPARENT = new Uint8Array(NUM_TYPES);
export const IS_SOLID = new Uint8Array(NUM_TYPES);
for (let i = 0; i < NUM_TYPES; i++) {
    const p = BlockProps[i];
    if (p) { IS_TRANSPARENT[i] = p.transparent ? 1 : 0; IS_SOLID[i] = p.solid ? 1 : 0; }
}

// Texture atlas layout
const TEX = {
    GRASS_TOP:0, GRASS_SIDE:1, DIRT:2, STONE:3, SAND:4, WOOD_SIDE:5,
    WOOD_TOP:6, LEAVES:7, WATER:8, BEDROCK:9, SNOW_TOP:10, COBBLESTONE:11,
    COAL_ORE:12, IRON_ORE:13, PLANKS:14, GLASS:15, BRICK:16, SNOW_SIDE:17,
    FRITES:18, FRITERIE:19,
};

// Block face mapping: [top, bottom, side]
const blockFaces = {
    [BlockType.GRASS]:       [TEX.GRASS_TOP, TEX.DIRT, TEX.GRASS_SIDE],
    [BlockType.DIRT]:        [TEX.DIRT, TEX.DIRT, TEX.DIRT],
    [BlockType.STONE]:       [TEX.STONE, TEX.STONE, TEX.STONE],
    [BlockType.SAND]:        [TEX.SAND, TEX.SAND, TEX.SAND],
    [BlockType.WATER]:       [TEX.WATER, TEX.WATER, TEX.WATER],
    [BlockType.WOOD]:        [TEX.WOOD_TOP, TEX.WOOD_TOP, TEX.WOOD_SIDE],
    [BlockType.LEAVES]:      [TEX.LEAVES, TEX.LEAVES, TEX.LEAVES],
    [BlockType.BEDROCK]:     [TEX.BEDROCK, TEX.BEDROCK, TEX.BEDROCK],
    [BlockType.COAL_ORE]:    [TEX.COAL_ORE, TEX.COAL_ORE, TEX.COAL_ORE],
    [BlockType.IRON_ORE]:    [TEX.IRON_ORE, TEX.IRON_ORE, TEX.IRON_ORE],
    [BlockType.SNOW]:        [TEX.SNOW_TOP, TEX.DIRT, TEX.SNOW_SIDE],
    [BlockType.COBBLESTONE]: [TEX.COBBLESTONE, TEX.COBBLESTONE, TEX.COBBLESTONE],
    [BlockType.PLANKS]:      [TEX.PLANKS, TEX.PLANKS, TEX.PLANKS],
    [BlockType.GLASS]:       [TEX.GLASS, TEX.GLASS, TEX.GLASS],
    [BlockType.BRICK]:       [TEX.BRICK, TEX.BRICK, TEX.BRICK],
    [BlockType.FRITES]:      [TEX.FRITES, TEX.FRITES, TEX.FRITES],
    [BlockType.FRITERIE]:    [TEX.FRITERIE, TEX.FRITERIE, TEX.FRITERIE],
};

const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;
const TEX_SIZE = 16;
const ATLAS_W = ATLAS_COLS * TEX_SIZE;
const ATLAS_H = ATLAS_ROWS * TEX_SIZE;

function getTextureIndex(blockType, faceDir) {
    const faces = blockFaces[blockType];
    if (!faces) return 0;
    if (faceDir === 0) return faces[0];
    if (faceDir === 1) return faces[1];
    return faces[2];
}

// Pre-computed UV table: UV_TABLE[(blockType * 6 + face) * 4] = u0, v0, du, dv
export const UV_TABLE = new Float32Array(NUM_TYPES * 6 * 4);
(function initUVTable() {
    const invCols = 1 / ATLAS_COLS;
    const invRows = 1 / ATLAS_ROWS;
    for (let bt = 0; bt < NUM_TYPES; bt++) {
        for (let f = 0; f < 6; f++) {
            const texIdx = getTextureIndex(bt, f);
            const col = texIdx % ATLAS_COLS;
            const row = (texIdx / ATLAS_COLS) | 0;
            const base = (bt * 6 + f) * 4;
            UV_TABLE[base]     = col * invCols;           // u0
            UV_TABLE[base + 1] = 1 - (row + 1) * invRows; // v0
            UV_TABLE[base + 2] = invCols;                  // du
            UV_TABLE[base + 3] = invRows;                  // dv
        }
    }
})();

// Seeded random
function seededRandom(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function createTextureAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    const ctx = canvas.getContext('2d');

    // Use ImageData for batch pixel ops (10x faster than individual fillRect)
    const imageData = ctx.createImageData(ATLAS_W, ATLAS_H);
    const px = imageData.data;

    function setP(x, y, r, g, b) {
        const i = (y * ATLAS_W + x) * 4;
        px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = 255;
    }

    function texOrigin(idx) {
        return [(idx % ATLAS_COLS) * TEX_SIZE, ((idx / ATLAS_COLS) | 0) * TEX_SIZE];
    }

    // Fill with magenta debug
    for (let i = 0; i < px.length; i += 4) { px[i]=255; px[i+1]=0; px[i+2]=255; px[i+3]=255; }

    // GRASS_TOP
    let [ox, oy] = texOrigin(TEX.GRASS_TOP);
    let rng = seededRandom(1);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const v=80+(rng()*40|0); setP(ox+x,oy+y,50,v+50,30); }

    // GRASS_SIDE
    [ox,oy] = texOrigin(TEX.GRASS_SIDE); rng = seededRandom(2);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) {
        if (y<3) { const v=80+(rng()*40|0); setP(ox+x,oy+y,50,v+50,30); }
        else { const v=100+(rng()*30|0); setP(ox+x,oy+y,v,v-30,v-50); }
    }

    // DIRT
    [ox,oy] = texOrigin(TEX.DIRT); rng = seededRandom(3);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const v=100+(rng()*35|0); setP(ox+x,oy+y,v,v-30,v-50); }

    // STONE
    [ox,oy] = texOrigin(TEX.STONE); rng = seededRandom(4);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const v=100+(rng()*40|0); setP(ox+x,oy+y,v,v,v); }

    // SAND
    [ox,oy] = texOrigin(TEX.SAND); rng = seededRandom(5);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const v=190+(rng()*30|0); setP(ox+x,oy+y,v,v-20,v-70); }

    // WOOD_SIDE
    [ox,oy] = texOrigin(TEX.WOOD_SIDE); rng = seededRandom(6);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const v=70+((y%4<2)?10:0)+(rng()*20|0); setP(ox+x,oy+y,v,v-15,v-35); }

    // WOOD_TOP
    [ox,oy] = texOrigin(TEX.WOOD_TOP); rng = seededRandom(7);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const d=Math.sqrt((x-7.5)**2+(y-7.5)**2); const v=85+(Math.sin(d*1.5)*15|0)+(rng()*10|0); setP(ox+x,oy+y,v,v-15,v-35); }

    // LEAVES
    [ox,oy] = texOrigin(TEX.LEAVES); rng = seededRandom(8);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const g=rng()>0.5?90+(rng()*30|0):120+(rng()*40|0); setP(ox+x,oy+y,20,g,20); }

    // WATER
    [ox,oy] = texOrigin(TEX.WATER); rng = seededRandom(9);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const v=rng()*30|0; setP(ox+x,oy+y,30+v,60+v,180+(rng()*40|0)); }

    // BEDROCK
    [ox,oy] = texOrigin(TEX.BEDROCK); rng = seededRandom(10);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const v=30+(rng()*40|0); setP(ox+x,oy+y,v,v,v); }

    // SNOW_TOP — Waffle texture!
    [ox,oy] = texOrigin(TEX.SNOW_TOP); rng = seededRandom(11);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) {
        const grid = (x % 4 === 0 || y % 4 === 0);
        if (grid) setP(ox+x,oy+y, 180, 140, 80);     // waffle grid lines
        else { const v = rng()*20|0; setP(ox+x,oy+y, 220+v, 190+v, 110+v); } // golden waffle
    }

    // COBBLESTONE
    [ox,oy] = texOrigin(TEX.COBBLESTONE); rng = seededRandom(12);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const v=110+((x%4===0||y%4===0)?-20:0)+(rng()*25|0); setP(ox+x,oy+y,v,v,v); }

    // COAL_ORE
    [ox,oy] = texOrigin(TEX.COAL_ORE); rng = seededRandom(13);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) {
        const isOre=(x>3&&x<7&&y>4&&y<8)||(x>8&&x<13&&y>9&&y<13);
        if(isOre) setP(ox+x,oy+y,20+(rng()*15|0),20+(rng()*15|0),20+(rng()*15|0));
        else { const v=100+(rng()*40|0); setP(ox+x,oy+y,v,v,v); }
    }

    // IRON_ORE
    [ox,oy] = texOrigin(TEX.IRON_ORE); rng = seededRandom(14);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) {
        const isOre=(x>2&&x<6&&y>3&&y<7)||(x>9&&x<14&&y>8&&y<12);
        if(isOre) { const v=170+(rng()*40|0); setP(ox+x,oy+y,v,v-20,v-50); }
        else { const v=100+(rng()*40|0); setP(ox+x,oy+y,v,v,v); }
    }

    // PLANKS
    [ox,oy] = texOrigin(TEX.PLANKS); rng = seededRandom(15);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) { const v=140+((y/4|0)*15)%30+((y%4===0)?-20:0)+(rng()*15|0); setP(ox+x,oy+y,v,v-20,v-55); }

    // GLASS
    [ox,oy] = texOrigin(TEX.GLASS);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) {
        if(x===0||x===15||y===0||y===15) setP(ox+x,oy+y,180,200,220); else setP(ox+x,oy+y,200,220,240);
    }

    // BRICK — Belgian flag pattern!
    [ox,oy] = texOrigin(TEX.BRICK); rng = seededRandom(17);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) {
        const v = rng() * 15 | 0;
        if (x < 5) setP(ox+x,oy+y, 30+v, 30+v, 30+v);           // noir
        else if (x < 11) setP(ox+x,oy+y, 253, 218+v, 36);        // jaune
        else setP(ox+x,oy+y, 200+v, 16, 46);                      // rouge
    }

    // SNOW_SIDE
    [ox,oy] = texOrigin(TEX.SNOW_SIDE); rng = seededRandom(18);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) {
        if(y<3) { const v=230+(rng()*25|0); setP(ox+x,oy+y,v,v,v); }
        else { const v=100+(rng()*35|0); setP(ox+x,oy+y,v,v-30,v-50); }
    }

    // FRITES — golden fries on red background (cornet de frites)
    [ox,oy] = texOrigin(TEX.FRITES); rng = seededRandom(19);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) {
        // Red cornet background
        setP(ox+x,oy+y, 200, 40, 40);
    }
    // Draw yellow fries sticking up
    for (let i = 0; i < 7; i++) {
        const fx = 2 + (rng() * 12 | 0);
        const fh = 6 + (rng() * 8 | 0);
        for (let fy = 16 - fh; fy < 16; fy++) {
            const v = rng() * 30 | 0;
            if (fx >= 0 && fx < 16 && fy >= 0 && fy < 16)
                setP(ox+fx, oy+fy, 230+v/2, 190+v, 60+v);
        }
    }

    // FRITERIE — white/red striped building block
    [ox,oy] = texOrigin(TEX.FRITERIE); rng = seededRandom(20);
    for (let y=0;y<TEX_SIZE;y++) for (let x=0;x<TEX_SIZE;x++) {
        const stripe = ((y / 4 | 0) % 2 === 0);
        if (stripe) { const v=rng()*10|0; setP(ox+x,oy+y, 240+v, 240+v, 240+v); } // white
        else { const v=rng()*15|0; setP(ox+x,oy+y, 200+v, 30+v, 30+v); }           // red
    }
    // Window/counter in the middle
    for (let y=5;y<11;y++) for (let x=3;x<13;x++) {
        setP(ox+x,oy+y, 60, 40, 20); // dark brown counter
    }
    // "FRITES" sign hint (yellow pixels at top)
    for (let x=2;x<14;x++) setP(ox+x,oy+1, 253, 218, 36);
    for (let x=2;x<14;x++) setP(ox+x,oy+2, 253, 218, 36);

    ctx.putImageData(imageData, 0, 0);

    // Store atlas canvas for icon extraction
    _atlasCanvas = canvas;

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

// Module-level atlas canvas reference
let _atlasCanvas = null;

export function getAtlasCanvas() {
    return _atlasCanvas;
}

export function getBlockIconURL(blockType) {
    if (!_atlasCanvas) return '';
    const faces = blockFaces[blockType];
    if (!faces) return '';
    const topTexIdx = faces[0]; // top face
    const col = topTexIdx % ATLAS_COLS;
    const row = (topTexIdx / ATLAS_COLS) | 0;
    const sx = col * TEX_SIZE;
    const sy = row * TEX_SIZE;
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = 32;
    tmpCanvas.height = 32;
    const ctx = tmpCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(_atlasCanvas, sx, sy, TEX_SIZE, TEX_SIZE, 0, 0, 32, 32);
    return tmpCanvas.toDataURL();
}

export { blockFaces };

export function createCrackTextures() {
    const textures = [];
    for (let stage = 0; stage < 5; stage++) {
        const canvas = document.createElement('canvas');
        canvas.width = TEX_SIZE;
        canvas.height = TEX_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
        const rng = seededRandom(100 + stage);
        const numCracks = 2 + stage * 2;
        ctx.strokeStyle = 'rgba(0, 0, 0, ' + (0.3 + stage * 0.15) + ')';
        ctx.lineWidth = 1;
        for (let c = 0; c < numCracks; c++) {
            ctx.beginPath();
            let cx = 4 + (rng() * 8) | 0;
            let cy = 4 + (rng() * 8) | 0;
            ctx.moveTo(cx, cy);
            const segments = 2 + ((rng() * 3) | 0);
            for (let s = 0; s < segments; s++) {
                cx += ((rng() * 6) | 0) - 3;
                cy += ((rng() * 6) | 0) - 3;
                cx = Math.max(0, Math.min(15, cx));
                cy = Math.max(0, Math.min(15, cy));
                ctx.lineTo(cx, cy);
            }
            ctx.stroke();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        textures.push(tex);
    }
    return textures;
}
